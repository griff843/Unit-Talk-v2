import { loadEnvironment } from '@unit-talk/config';
import {
  emitJson,
  parseArgs,
  type LaneManifest,
  readManifest,
  requireIssueId,
  writeManifest,
  type TruthCheckResult,
} from './shared.js';
import { runTruthCheck } from './truth-check-lib.js';
import { releaseMergeLock, requireMergeLockHeld } from './merge-mutex.js';
import { releaseLease } from './lease-registry.js';

/**
 * Machine-readable codes emitted in the closeout JSON response.
 * Each code maps to a distinct failure class so operators and scripts can
 * branch on the exact reason without parsing human-readable messages.
 */
export type CloseoutFailureCode =
  | 'lane_closed'         // success
  | 'manifest_not_ready'  // manifest status not eligible (M4 / ineligible verdict)
  | 'missing_merge_sha'   // merged/done closeout lacks manifest or PR merge SHA (C1/C2/M6)
  | 'missing_proof'       // proof files absent or unreadable (P1/P2)
  | 'stale_proof'         // proof files predate or missing merge SHA reference (P3/P4)
  | 'runtime_proof_required' // runtime closeout attempted with static/narrative proof only (C6)
  | 'state_drift'         // PR, manifest, or Linear state drift exceeds transition semantics (C7)
  | 'pr_not_merged'       // PR not merged on GitHub (G1)
  | 'pr_sha_mismatch'     // PR merge SHA doesn't match manifest (G2)
  | 'registry_mismatch'   // Linear attachment doesn't include the PR URL (L4)
  | 'truth_check_failed'  // general truth-check failure (catch-all)
  | 'infra_error';        // missing token, manifest, or schema error

/**
 * Maps a truth-check result to the most specific CloseoutFailureCode.
 * Priority order: infra > ineligible > pr_not_merged > pr_sha_mismatch >
 * registry_mismatch > missing_proof > stale_proof > truth_check_failed.
 */
export function mapFailuresToCode(
  failures: string[],
  verdict: TruthCheckResult['verdict'],
): CloseoutFailureCode {
  if (verdict === 'pass') return 'lane_closed';
  if (verdict === 'infra_error') return 'infra_error';
  if (verdict === 'ineligible') return 'manifest_not_ready';

  const f = new Set(failures);

  if (f.has('M1') || f.has('M2') || f.has('M3') || f.has('L1')) return 'infra_error';
  if (f.has('M4')) return 'manifest_not_ready';
  if (f.has('C1') || f.has('C2') || f.has('M6')) return 'missing_merge_sha';
  if (f.has('G1')) return 'pr_not_merged';
  if (f.has('G2')) return 'pr_sha_mismatch';
  if (f.has('L4')) return 'registry_mismatch';
  if (f.has('P1') || f.has('P2')) return 'missing_proof';
  if (f.has('P3') || f.has('P4') || f.has('C4') || f.has('C5')) return 'stale_proof';
  if (f.has('C6')) return 'runtime_proof_required';
  if (f.has('C7')) return 'state_drift';

  return 'truth_check_failed';
}

/**
 * Human-readable remediation hint for each failure code.
 * Used in the `remediation` field of the JSON response.
 */
export function remediationForCode(code: CloseoutFailureCode): string {
  switch (code) {
    case 'manifest_not_ready':
      return 'Manifest status must be "merged" or "done" before closeout. Ensure the PR is merged and the manifest commit_sha is set.';
    case 'missing_merge_sha':
      return 'Closeout requires both manifest.commit_sha and the merged PR SHA. Run truth-check after merge and do not silently repair missing SHAs.';
    case 'missing_proof':
      return 'One or more expected_proof_paths files are absent or empty. Generate proof artifacts before closing.';
    case 'stale_proof':
      return 'Proof files do not reference the merge SHA or predate the merge commit. Regenerate proof after merge.';
    case 'runtime_proof_required':
      return 'This issue requires live/runtime proof. Attach structured runtime evidence with queries, row counts, or receipts tied to the closeout SHA.';
    case 'state_drift':
      return 'PR, manifest, proof, and Linear state disagree beyond the allowed transition window. Reconcile the lane before closeout.';
    case 'pr_not_merged':
      return 'The PR listed in manifest.pr_url is not merged. Merge the PR before closing the lane.';
    case 'pr_sha_mismatch':
      return 'PR merge SHA does not match manifest.commit_sha. Update manifest.commit_sha to the actual merge commit.';
    case 'registry_mismatch':
      return 'Linear issue does not have an attachment pointing to manifest.pr_url. Add the PR link as a Linear attachment.';
    case 'infra_error':
      return 'Required token (LINEAR_API_TOKEN or GITHUB_TOKEN) is missing, or the manifest is absent or invalid. Check environment and manifest.';
    case 'truth_check_failed':
      return 'One or more truth-check gates failed. Run `pnpm ops:truth-check <issue-id> --explain` for details.';
    case 'lane_closed':
      return '';
  }
}

const MISSING_COMMIT_SHA_MESSAGE =
  'ERROR: Lane close requires commit_sha — run ops:truth-check first';

export function requireCloseCommitSha(manifest: LaneManifest): void {
  if (manifest.status === 'done') {
    return;
  }

  const commitSha = (manifest as LaneManifest & { commit_sha?: string | null })
    .commit_sha;
  if (
    commitSha === null ||
    commitSha === undefined ||
    commitSha.trim() === ''
  ) {
    throw new Error(MISSING_COMMIT_SHA_MESSAGE);
  }
}

export function releaseCloseoutLocks(
  issueId: string,
  branch: string,
  options: { leaseRegistryDir?: string; mergeLockPath?: string } = {},
): void {
  const lease = releaseLease({
    issue_id: issueId,
    actor: 'ops:lane-close',
    reason: 'lane closed successfully',
  }, { registryDir: options.leaseRegistryDir });
  if (!lease.ok) {
    throw new Error(`Failed to release dispatch lease: ${lease.code} ${lease.message}`);
  }

  const mergeLock = releaseMergeLock({
    issue_id: issueId,
    branch,
  }, { lockPath: options.mergeLockPath });
  if (!mergeLock.ok) {
    throw new Error(`Failed to release merge lock: ${mergeLock.code} ${mergeLock.message}`);
  }
}

async function main(): Promise<void> {
  const { positionals, bools } = parseArgs(process.argv.slice(2));
  const issueId = requireIssueId(positionals[0] ?? '');

  try {
    const manifest = readManifest(issueId);
    const lock = requireMergeLockHeld({
      issue_id: issueId,
      branch: manifest.branch,
      reason: 'ops:lane-close',
    });
    if (!lock.ok) {
      emitJson({
        ok: false,
        code: lock.code,
        remediation:
          `Acquire the merge mutex before closeout: pnpm ops:merge-lock acquire --issue ${issueId} ` +
          `--branch ${manifest.branch} --reason ops:lane-close`,
        issue_id: issueId,
        merge_lock: lock,
      });
      process.exit(1);
    }
    requireCloseCommitSha(manifest);

    const result = await runTruthCheck({
      issueId,
      json: true,
      explain: bools.has('explain'),
      runner: 'ops:lane:close',
    });

    if (result.exit_code !== 0) {
      const code = mapFailuresToCode(result.failures, result.verdict);
      emitJson({
        ok: false,
        code,
        remediation: remediationForCode(code),
        issue_id: issueId,
        truth_check: result,
      });
      process.exit(result.exit_code);
    }

    manifest.status = 'done';
    manifest.closed_at = new Date().toISOString();
    manifest.heartbeat_at = manifest.closed_at;
    writeManifest(manifest);

    await transitionLinearIssueToDone(issueId);
    releaseCloseoutLocks(issueId, manifest.branch);

    emitJson({
      ok: true,
      code: 'lane_closed' as CloseoutFailureCode,
      issue_id: issueId,
      status: manifest.status,
      closed_at: manifest.closed_at,
      truth_check: result,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === MISSING_COMMIT_SHA_MESSAGE
    ) {
      console.error(error.message);
      process.exit(1);
    }

    emitJson({
      ok: false,
      code: 'infra_error' as CloseoutFailureCode,
      remediation: remediationForCode('infra_error'),
      issue_id: issueId,
      message: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

async function transitionLinearIssueToDone(issueId: string): Promise<void> {
  const env = loadEnvironment();
  const token = env.LINEAR_API_TOKEN?.trim() || process.env.LINEAR_API_KEY?.trim();
  if (!token) {
    throw new Error('LINEAR_API_TOKEN or LINEAR_API_KEY is required to close the Linear issue');
  }

  const issuePayload = await fetchLinear<{ data?: { issue: { id: string } | null }; errors?: Array<{ message?: string }> }>(
    token,
    `
      query ResolveIssue($id: String!) {
        issue(id: $id) {
          id
        }
      }
    `,
    { id: issueId },
  );
  if (issuePayload.errors?.length) {
    throw new Error(issuePayload.errors.map((entry) => entry.message ?? 'Unknown Linear error').join('; '));
  }
  const issue = issuePayload.data?.issue;
  if (!issue) {
    throw new Error(`Linear issue not found: ${issueId}`);
  }

  const statesPayload = await fetchLinear<{
    data?: { workflowStates: { nodes: Array<{ id: string; name: string }> } };
    errors?: Array<{ message?: string }>;
  }>(
    token,
    `
      query DoneStates {
        workflowStates(filter: { name: { eq: "Done" } }, first: 20) {
          nodes { id name }
        }
      }
    `,
    {},
  );
  if (statesPayload.errors?.length) {
    throw new Error(statesPayload.errors.map((entry) => entry.message ?? 'Unknown Linear error').join('; '));
  }
  const doneState = statesPayload.data?.workflowStates.nodes[0];
  if (!doneState) {
    throw new Error('Linear Done state not found');
  }

  const updatePayload = await fetchLinear<{
    data?: { issueUpdate: { success: boolean } };
    errors?: Array<{ message?: string }>;
  }>(
    token,
    `
      mutation CloseIssue($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
        }
      }
    `,
    {
      id: issue.id,
      input: {
        stateId: doneState.id,
      },
    },
  );
  if (updatePayload.errors?.length) {
    throw new Error(updatePayload.errors.map((entry) => entry.message ?? 'Unknown Linear error').join('; '));
  }
  if (!updatePayload.data?.issueUpdate.success) {
    throw new Error(`Failed to transition Linear issue ${issueId} to Done`);
  }
}

async function fetchLinear<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new Error(`Linear API request failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

// Guard: only run main when this file is the CLI entry point, not when imported as a module
const argv1 = process.argv[1] ?? '';
if (argv1.endsWith('lane-close.ts') || argv1.endsWith('lane-close.js')) {
  void main();
}
