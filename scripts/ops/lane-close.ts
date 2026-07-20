import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadEnvironment } from '@unit-talk/config';
import {
  emitJson,
  git,
  parseArgs,
  type LaneManifest,
  readConfiguredEnvValue,
  readManifest,
  requireIssueId,
  validatePreflightTokenPathValue,
  writeManifest,
  type TruthCheckResult,
} from './shared.js';
import { runTruthCheck } from './truth-check-lib.js';
import {
  acquireMergeLock,
  defaultMergeLockOwner,
  releaseMergeLock,
  requireMergeLockHeld,
  type MergeLockResult,
} from './merge-mutex.js';
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
  | 'truth_check_drift'   // manifest's persisted truth-check moved past the result that authorized this close
  | 'infra_error'         // missing token, manifest, or schema error
  | 'repair_required_via_pr'; // --repair-merged produced tracked changes while cwd is on `main` (UTV2-1542)

export type CloseoutOutcome = 'closed' | 'already_closed' | 'closed_with_warnings' | 'blocked';

export interface RepairMergedPrInfo {
  url: string;
  state: string | null;
  merged: boolean;
  mergeSha: string | null;
}

export interface RepairMergedManifestResult {
  ok: boolean;
  code: CloseoutFailureCode | 'already_closed' | 'repaired';
  outcome: CloseoutOutcome | 'repaired';
  manifest: LaneManifest;
  artifact_path: string | null;
  changed_fields: string[];
  remediation: string;
  pr: RepairMergedPrInfo | null;
}

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
      return 'This issue requires live/runtime proof. Do NOT hand-edit proof files on main directly ' +
        '(see docs/05_operations/DIRECT_MAIN_BYPASS_POLICY.md). Run `pnpm ops:proof-repair scaffold <ISSUE_ID>` ' +
        'for the exact governed repair steps: a real `pnpm test:db` run, `pnpm ops:proof-repair apply`, and a normal PR.';
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
    case 'truth_check_drift':
      return 'The manifest\'s persisted truth-check history changed, failed, or advanced after the passing ' +
        'result that authorized this close was computed (a concurrent run likely wrote a newer entry). ' +
        'Refused to close. Re-run ops:lane-close from a clean state.';
    case 'repair_required_via_pr':
      return 'ops:lane-close --repair-merged produced tracked-file changes while running from a checkout on main. ' +
        'These changes must NOT be committed or pushed directly to main (see docs/05_operations/DIRECT_MAIN_BYPASS_POLICY.md) -- ' +
        'a repair packet was written instead. See the repair_packet_path and commands fields for the governed branch/PR repair path.';
    case 'lane_closed':
      return '';
  }
}

const MISSING_COMMIT_SHA_MESSAGE =
  'ERROR: Lane close requires commit_sha — run ops:truth-check first';
const REPAIR_PREFLIGHT_TOKEN = 'dispatch-auto';

/**
 * Thrown by finalizeLaneCloseManifest() when the manifest's persisted
 * truth_check_history no longer matches the passing TruthCheckResult that
 * authorized this close -- see finalizeLaneCloseManifest's doc comment.
 */
export class TruthCheckDriftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TruthCheckDriftError';
  }
}

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

/**
 * Applies the terminal `status: 'done'` transition after a passing
 * `runTruthCheck()` call and persists it.
 *
 * `runTruthCheck()` writes its own updated manifest to disk (with the
 * passing `truth_check_history` entry appended) as a side effect of
 * running. A caller holding an in-memory manifest snapshot taken *before*
 * that call is now stale; writing it back verbatim would silently clobber
 * the just-persisted history entry, leaving the terminal manifest's last
 * `truth_check_history` record as whatever preceded this run (often a
 * prior failure) even though the close itself succeeded. This function
 * re-reads from disk first so the fresh history entry survives the final
 * write.
 *
 * `authorizedTruthCheck` is the passing `TruthCheckResult` that `main()` just
 * received from `runTruthCheck()`. Re-reading the manifest closes one drift
 * window but opens another: nothing stops a second process from running its
 * own truth-check (or a heartbeat re-run) between that call returning and
 * this function's read, appending a newer entry that failed, differs, or
 * belongs to a different merge SHA. Writing `status: 'done'` on top of that
 * would certify a close no operator actually authorized. So this function
 * verifies the manifest's *last* history entry is still exactly the one
 * `authorizedTruthCheck` represents (same checked_at, verdict, merge_sha)
 * before flipping status -- if it isn't, it refuses and throws rather than
 * silently closing on stale authorization.
 */
export function finalizeLaneCloseManifest(
  issueId: string,
  authorizedTruthCheck: TruthCheckResult,
): LaneManifest {
  const manifest = readManifest(issueId);
  const history = manifest.truth_check_history ?? [];
  const latest = history[history.length - 1];

  const matchesAuthorization =
    latest !== undefined &&
    latest.verdict === 'pass' &&
    latest.checked_at === authorizedTruthCheck.checked_at &&
    latest.merge_sha === authorizedTruthCheck.merge_sha;

  if (!matchesAuthorization) {
    throw new TruthCheckDriftError(
      `Refusing to close ${issueId}: manifest's latest truth-check ` +
        `(${latest ? `${latest.verdict} at ${latest.checked_at}, merge_sha ${latest.merge_sha}` : 'none'}) ` +
        `no longer matches the passing result that authorized this close ` +
        `(pass at ${authorizedTruthCheck.checked_at}, merge_sha ${authorizedTruthCheck.merge_sha}). ` +
        'A concurrent truth-check run must have changed, failed, or advanced it since authorization.',
    );
  }

  manifest.status = 'done';
  manifest.closed_at = new Date().toISOString();
  manifest.heartbeat_at = manifest.closed_at;
  writeManifest(manifest);
  return manifest;
}

export function releaseCloseoutLocks(
  issueId: string,
  branch: string,
  options: { leaseRegistryDir?: string; mergeLockPath?: string } = {},
): { warnings: string[] } {
  const warnings: string[] = [];
  const lease = releaseLease({
    issue_id: issueId,
    actor: 'ops:lane-close',
    reason: 'lane closed successfully',
  }, { registryDir: options.leaseRegistryDir });
  if (!lease.ok && !isIdempotentLeaseReleaseFailure(lease)) {
    throw new Error(`Failed to release dispatch lease: ${lease.code} ${lease.message}`);
  }
  if (!lease.ok) {
    warnings.push(`dispatch lease already released or missing: ${lease.message}`);
  }

  const mergeLock = releaseMergeLock({
    issue_id: issueId,
    branch,
  }, { lockPath: options.mergeLockPath });
  if (!mergeLock.ok && mergeLock.code !== 'merge_lock_missing') {
    throw new Error(`Failed to release merge lock: ${mergeLock.code} ${mergeLock.message}`);
  }
  if (!mergeLock.ok) {
    warnings.push(`merge lock already released or missing: ${mergeLock.message}`);
  }

  return { warnings };
}

export function repairMergedLaneManifest(
  manifest: LaneManifest,
  options: {
    fetchPr?: (prUrl: string) => RepairMergedPrInfo;
    now?: Date;
    repoRoot?: string;
    artifactRoot?: string;
    leaseRegistryDir?: string;
    mergeLockPath?: string;
    releaseLocksIfAlreadyDone?: boolean;
  } = {},
): RepairMergedManifestResult {
  if (manifest.status === 'done') {
    // --repair-merged is intentionally safe to re-run. A previous closeout may
    // have written the terminal manifest before releasing its coordination
    // state, so an already-done manifest must still perform that cleanup —
    // but only when the caller explicitly opts in. Without this flag, this
    // function stays a pure read-only check: any caller that doesn't ask for
    // cleanup (a test, a future helper, a status check) must never touch the
    // real `.ops/leases`/`.ops/merge-lock.json` state or throw on an
    // unrelated live lock.
    if (options.releaseLocksIfAlreadyDone) {
      releaseCloseoutLocks(manifest.issue_id, manifest.branch, {
        leaseRegistryDir: options.leaseRegistryDir,
        mergeLockPath: options.mergeLockPath,
      });
    }

    return {
      ok: true,
      code: 'already_closed',
      outcome: 'already_closed',
      manifest,
      artifact_path: null,
      changed_fields: [],
      remediation: 'Lane is already done; repair mode made no changes.',
      pr: null,
    };
  }

  if (!manifest.pr_url) {
    return repairBlocked(manifest, 'infra_error', 'Manifest has no pr_url to repair from.');
  }

  const pr = (options.fetchPr ?? fetchMergedPrInfo)(manifest.pr_url);
  if (!pr.merged || !pr.mergeSha) {
    return {
      ok: false,
      code: pr.merged ? 'missing_merge_sha' : 'pr_not_merged',
      outcome: 'blocked',
      manifest,
      artifact_path: null,
      changed_fields: [],
      remediation: pr.merged
        ? 'GitHub reports the PR merged but did not return a merge commit SHA; repair refused.'
        : 'GitHub does not report the PR as merged; repair refused and manifest was not changed.',
      pr,
    };
  }

  const now = (options.now ?? new Date()).toISOString();
  const next: LaneManifest = {
    ...manifest,
    status: 'merged',
    commit_sha: pr.mergeSha,
    pr_url: pr.url,
    heartbeat_at: now,
    truth_check_history: manifest.truth_check_history ?? [],
  };
  const changedFields: string[] = [];
  recordChanged(changedFields, manifest.status, next.status, 'status');
  recordChanged(changedFields, manifest.commit_sha, next.commit_sha, 'commit_sha');
  recordChanged(changedFields, manifest.pr_url, next.pr_url, 'pr_url');

  const preflightRepair = repairPreflightToken(next, options.repoRoot ?? process.cwd());
  if (preflightRepair.changed) {
    changedFields.push('preflight_token');
  }

  const historyEntry = {
    checked_at: now,
    verdict: 'pass' as const,
    merge_sha: pr.mergeSha,
    failures: [],
    runner: 'ops:lane-close --repair-merged',
    source: 'github_pr_merge_commit_repair',
    pr_url: pr.url,
    repaired_fields: changedFields,
  };
  next.truth_check_history = [...next.truth_check_history, historyEntry];
  changedFields.push('truth_check_history');

  const artifactPath = writeRepairArtifact({
    issueId: manifest.issue_id,
    artifactRoot: options.artifactRoot ?? path.join(options.repoRoot ?? process.cwd(), '.out', 'ops', 'lane-close-repair'),
    payload: {
      schema_version: 1,
      repaired_at: now,
      issue_id: manifest.issue_id,
      pr,
      changed_fields: changedFields,
      previous: {
        status: manifest.status,
        commit_sha: manifest.commit_sha,
        pr_url: manifest.pr_url,
        preflight_token: manifest.preflight_token,
      },
      next: {
        status: next.status,
        commit_sha: next.commit_sha,
        pr_url: next.pr_url,
        preflight_token: next.preflight_token,
      },
      preflight_repair: preflightRepair.reason,
    },
  });

  return {
    ok: true,
    code: 'repaired',
    outcome: 'repaired',
    manifest: next,
    artifact_path: artifactPath,
    changed_fields: changedFields,
    remediation: 'Manifest repaired from authoritative GitHub merge state; closeout truth-check still runs before lane closure.',
    pr,
  };
}

export interface RepairRequiredViaPrResult {
  ok: false;
  code: 'repair_required_via_pr';
  outcome: 'blocked';
  issue_id: string;
  changed_files: string[];
  original_implementation_merge_sha: string | null;
  recommended_repair_branch: string;
  repair_packet_path: string;
  direct_main_prohibition: string;
  commands: string[];
  remediation: string;
}

/**
 * Built in response to a real incident (UTV2-1542, the third occurrence of this
 * repo's direct-main-push control failure -- see
 * docs/06_status/INCIDENTS/INC-2026-07-14-utv2-1533-direct-main-push.md): an
 * operator ran `ops:lane-close --repair-merged` from the shared main checkout,
 * got back a manifest with tracked-file changes sitting in that checkout's
 * working tree, and -- because nothing in this tool's output said otherwise --
 * committed and pushed the result directly to `origin/main`, bypassing branch
 * protection (`enforce_admins: false` on this repo lets an admin identity's
 * direct push through).
 *
 * `proof-repair.ts` already solves the analogous problem for missing T1 runtime
 * evidence: it never writes to `main`, and its `scaffold` command prints the
 * exact governed branch/PR steps. This function gives `--repair-merged` the same
 * contract for manifest/truth-check reconciliation. It never runs `git push` or
 * `git commit` itself -- it only writes a repair packet (the full repaired
 * manifest content) to `.out/ops/lane-close-repair/<ISSUE_ID>.repair-packet.json`
 * (gitignored) and returns a machine-readable `repair_required_via_pr` result
 * naming the exact next steps. Landing the result is still the operator's job,
 * via a normal PR -- this function's job is to make that the objectively-easiest
 * next action instead of "just commit the file that's already sitting here."
 */
export function buildRepairRequiredViaPrPacket(input: {
  issueId: string;
  manifest: LaneManifest;
  changedFields: string[];
  pr: RepairMergedPrInfo | null;
  repoRoot: string;
  artifactRoot?: string;
}): RepairRequiredViaPrResult {
  const normalizedIssue = input.issueId.toUpperCase();
  const slug = normalizedIssue.toLowerCase();
  const branch = `claude/${slug}-lane-close-repair`;
  const manifestRelativePath = `docs/06_status/lanes/${normalizedIssue}.json`;
  const artifactRoot =
    input.artifactRoot ?? path.join(input.repoRoot, '.out', 'ops', 'lane-close-repair');
  fs.mkdirSync(artifactRoot, { recursive: true });
  const packetPath = path.join(artifactRoot, `${normalizedIssue}.repair-packet.json`);
  fs.writeFileSync(packetPath, `${JSON.stringify(input.manifest, null, 2)}\n`);
  const packetRelativePath = path.relative(input.repoRoot, packetPath).replaceAll('\\', '/');

  return {
    ok: false,
    code: 'repair_required_via_pr',
    outcome: 'blocked',
    issue_id: normalizedIssue,
    // repairMergedLaneManifest() only ever writes the lane manifest itself;
    // input.changedFields lists the manifest's changed *keys* (status,
    // commit_sha, ...), not file paths, so the tracked-file list is always
    // exactly this one path.
    changed_files: [manifestRelativePath],
    original_implementation_merge_sha: input.pr?.mergeSha ?? null,
    recommended_repair_branch: branch,
    repair_packet_path: packetRelativePath,
    direct_main_prohibition:
      'These changes must NOT be committed or pushed directly to main -- `git push origin main` is never the next step. ' +
      'See docs/05_operations/DIRECT_MAIN_BYPASS_POLICY.md.',
    commands: [
      `npx tsx scripts/ops/generate-preflight-token.ts --issue ${normalizedIssue} --tier T1 --branch ${branch}`,
      `pnpm ops:lane-start ${normalizedIssue} --tier T1 --branch ${branch} --lane-type governance --files ${manifestRelativePath}`,
      `cd .out/worktrees/${branch.replace(/\//g, '__')}   # the cwd lane-start records -- never hand-roll a different worktree path`,
      `cp <repo-root>/${packetRelativePath} ${manifestRelativePath}   # apply the repaired manifest content from the packet -- never hand-retype it`,
      `git add ${manifestRelativePath} && git commit -m "chore(lanes): ${normalizedIssue} record lane-close truth-check result"`,
      `git push -u origin ${branch}`,
      `gh pr create --base main --title "${normalizedIssue}: lane-close manifest repair" --body "Reconciles the lane manifest from authoritative GitHub merge state via the governed lane-close repair path. Never edits main directly."`,
      `# Wait for CI green, then merge through the normal PR path -- never --admin, never a direct push.`,
    ],
    remediation:
      `ops:lane-close --repair-merged produced tracked-file changes (${manifestRelativePath}) while running from a checkout on ` +
      'main. This is blocked -- see repair_packet_path and commands for the governed repair path.',
  };
}

/**
 * Returns a blocking `repair_required_via_pr` result when `--repair-merged`
 * produced real tracked-file changes AND the caller is standing in a checkout on
 * `main` -- the exact shared-checkout condition that produced UTV2-1542. Returns
 * `null` (proceed as normal) for every other case: no changes to repair, the lane
 * was already closed, or the caller is in a dedicated lane worktree/branch, which
 * is always safe to write to directly since landing it still requires a PR merge.
 */
export function guardRepairAgainstMainCheckout(
  repair: RepairMergedManifestResult,
  options: { currentBranch: string; repoRoot: string; artifactRoot?: string },
): RepairRequiredViaPrResult | null {
  if (!repair.ok || repair.code !== 'repaired' || repair.changed_fields.length === 0) {
    return null;
  }
  if (options.currentBranch !== 'main') {
    return null;
  }
  return buildRepairRequiredViaPrPacket({
    issueId: repair.manifest.issue_id,
    manifest: repair.manifest,
    changedFields: repair.changed_fields,
    pr: repair.pr,
    repoRoot: options.repoRoot,
    artifactRoot: options.artifactRoot,
  });
}

export function ensureCloseoutMergeLock(
  manifest: LaneManifest,
  options: {
    acquireLock?: boolean;
    mergeLockPath?: string;
    now?: Date;
    cwd?: string;
  } = {},
): MergeLockResult {
  const held = requireMergeLockHeld(
    {
      issue_id: manifest.issue_id,
      branch: manifest.branch,
      reason: 'ops:lane-close',
    },
    { lockPath: options.mergeLockPath, now: options.now },
  );
  if (held.ok || !options.acquireLock) {
    return held;
  }

  return acquireMergeLock(
    {
      issue_id: manifest.issue_id,
      branch: manifest.branch,
      pr: manifest.pr_url,
      cwd: options.cwd ?? process.cwd(),
      reason: 'ops:lane-close',
      owner: defaultMergeLockOwner(),
    },
    { lockPath: options.mergeLockPath, now: options.now },
  );
}

function isIdempotentLeaseReleaseFailure(
  result: ReturnType<typeof releaseLease>,
): boolean {
  return result.code === 'lease_invalid_existing' && result.message.startsWith('Lease not found:');
}

async function main(): Promise<void> {
  const { positionals, bools } = parseArgs(process.argv.slice(2));
  const issueId = requireIssueId(positionals[0] ?? '');

  try {
    let manifest = readManifest(issueId);
    const lock = ensureCloseoutMergeLock(manifest, {
      acquireLock: !bools.has('no-acquire-lock'),
    });
    if (!lock.ok) {
      emitJson({
        ok: false,
        code: lock.code,
        outcome: 'blocked' satisfies CloseoutOutcome,
        remediation:
          `Merge lock auto-acquire failed. Retry, or pre-acquire manually: pnpm ops:merge-lock acquire --issue ${issueId} ` +
          `--branch ${manifest.branch} --reason ops:lane-close. Pass --no-acquire-lock to skip auto-acquire.`,
        issue_id: issueId,
        merge_lock: lock,
      });
      process.exit(1);
    }

    if (bools.has('repair-merged')) {
      const repair = repairMergedLaneManifest(manifest, { releaseLocksIfAlreadyDone: true });
      if (!repair.ok) {
        emitJson({
          ok: false,
          code: repair.code,
          outcome: repair.outcome,
          remediation: repair.remediation,
          issue_id: issueId,
          pr: repair.pr,
        });
        process.exit(1);
      }
      if (repair.code === 'already_closed') {
        emitJson({
          ok: true,
          code: 'lane_closed' as CloseoutFailureCode,
          outcome: 'already_closed' satisfies CloseoutOutcome,
          issue_id: issueId,
          status: manifest.status,
          remediation: repair.remediation,
        });
        process.exit(0);
      }

      // UTV2-1542: refuse to write repaired tracked-file changes directly into a
      // checkout on `main` -- that shared-checkout condition is exactly how the
      // third direct-main-push incident happened. Emit a repair packet + governed
      // branch/PR steps instead of leaving an ordinary commit-ready working tree.
      const currentBranchResult = git(['rev-parse', '--abbrev-ref', 'HEAD']);
      const guard = guardRepairAgainstMainCheckout(repair, {
        currentBranch: currentBranchResult.ok ? currentBranchResult.stdout : '',
        repoRoot: process.cwd(),
      });
      if (guard) {
        emitJson(guard);
        process.exit(1);
      }

      writeManifest(repair.manifest);
      manifest = repair.manifest;
    }

    requireCloseCommitSha(manifest);

    const result = await runTruthCheck({
      issueId,
      json: true,
      explain: bools.has('explain'),
      runner: 'ops:lane-close',
    });

    if (result.exit_code !== 0) {
      const code = mapFailuresToCode(result.failures, result.verdict);
      emitJson({
        ok: false,
        code,
        outcome: 'blocked' satisfies CloseoutOutcome,
        remediation: remediationForCode(code),
        issue_id: issueId,
        truth_check: result,
      });
      process.exit(result.exit_code);
    }

    manifest = finalizeLaneCloseManifest(issueId, result);

    await transitionLinearIssueToDone(issueId);
    const closeoutLocks = releaseCloseoutLocks(issueId, manifest.branch);
    const outcome: CloseoutOutcome =
      closeoutLocks.warnings.length > 0 ? 'closed_with_warnings' : 'closed';

    emitJson({
      ok: true,
      code: 'lane_closed' as CloseoutFailureCode,
      outcome,
      issue_id: issueId,
      status: manifest.status,
      closed_at: manifest.closed_at,
      warnings: closeoutLocks.warnings,
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

    if (error instanceof TruthCheckDriftError) {
      emitJson({
        ok: false,
        code: 'truth_check_drift' as CloseoutFailureCode,
        outcome: 'blocked' satisfies CloseoutOutcome,
        remediation: remediationForCode('truth_check_drift'),
        issue_id: issueId,
        message: error.message,
      });
      process.exit(1);
    }

    emitJson({
      ok: false,
      code: 'infra_error' as CloseoutFailureCode,
      outcome: 'blocked' satisfies CloseoutOutcome,
      remediation: remediationForCode('infra_error'),
      issue_id: issueId,
      message: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

function repairBlocked(
  manifest: LaneManifest,
  code: CloseoutFailureCode,
  remediation: string,
): RepairMergedManifestResult {
  return {
    ok: false,
    code,
    outcome: 'blocked',
    manifest,
    artifact_path: null,
    changed_fields: [],
    remediation,
    pr: null,
  };
}

function repairPreflightToken(
  manifest: LaneManifest,
  repoRoot: string,
): { changed: boolean; reason: string } {
  try {
    validatePreflightTokenPathValue(manifest.preflight_token, {
      requireExistingFile: true,
    });
    return { changed: false, reason: 'existing preflight token is present' };
  } catch (error) {
    manifest.preflight_token = REPAIR_PREFLIGHT_TOKEN;
    return {
      changed: true,
      reason: `preflight token repaired with ${REPAIR_PREFLIGHT_TOKEN}: ${
        error instanceof Error ? error.message : String(error)
      }; repo=${repoRoot}`,
    };
  }
}

function writeRepairArtifact(input: {
  issueId: string;
  artifactRoot: string;
  payload: unknown;
}): string {
  fs.mkdirSync(input.artifactRoot, { recursive: true });
  const artifactPath = path.join(input.artifactRoot, `${input.issueId}.json`);
  fs.writeFileSync(artifactPath, `${JSON.stringify(input.payload, null, 2)}\n`);
  return artifactPath;
}

function fetchMergedPrInfo(prUrl: string): RepairMergedPrInfo {
  const selector = normalizePrSelector(prUrl);
  const stdout = execFileSync('gh', ['pr', 'view', selector, '--json', 'url,state,mergedAt,mergeCommit'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(stdout) as {
    url?: string;
    state?: string | null;
    mergedAt?: string | null;
    mergeCommit?: { oid?: string | null } | null;
  };
  const state = parsed.state?.toLowerCase() ?? null;
  return {
    url: parsed.url ?? prUrl,
    state,
    merged: state === 'merged' || Boolean(parsed.mergedAt),
    mergeSha: parsed.mergeCommit?.oid ?? null,
  };
}

function normalizePrSelector(prUrl: string): string {
  const match = prUrl.match(/\/pull\/(\d+)(?:\b|$)/u);
  return match?.[1] ?? prUrl;
}

function recordChanged(changedFields: string[], previous: unknown, next: unknown, field: string): void {
  if (previous !== next) {
    changedFields.push(field);
  }
}

async function transitionLinearIssueToDone(issueId: string): Promise<void> {
  const env = loadEnvironment();
  const token =
    env.LINEAR_API_TOKEN?.trim() ||
    process.env.LINEAR_API_KEY?.trim() ||
    readConfiguredEnvValue('LINEAR_API_TOKEN') ||
    readConfiguredEnvValue('LINEAR_API_KEY');
  if (!token) {
    throw new Error('LINEAR_API_TOKEN or LINEAR_API_KEY is required to close the Linear issue');
  }

  const issuePayload = await fetchLinear<{
    data?: { issue: { id: string; state?: { name?: string | null } | null } | null };
    errors?: Array<{ message?: string }>;
  }>(
    token,
    `
      query ResolveIssue($id: String!) {
        issue(id: $id) {
          id
          state { name }
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
  if (/^done$/i.test(issue.state?.name ?? '')) {
    return;
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
