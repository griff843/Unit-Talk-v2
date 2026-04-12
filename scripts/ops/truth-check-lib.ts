import fs from 'node:fs';
import path from 'node:path';
import { loadEnvironment } from '@unit-talk/config';
import {
  type CheckResult,
  type LaneManifest,
  type LaneTier,
  type TruthCheckHistoryEntry,
  type TruthCheckResult,
  EVIDENCE_BUNDLE_SCHEMA_PATH,
  MANIFEST_DIR,
  ROOT,
  git,
  issueToManifestPath,
  parseJsonFile,
  readManifest,
  relativeToRoot,
  validateManifest,
  validateTruthResultSchemaDependencies,
  writeManifest,
} from './shared.js';

interface RunTruthCheckOptions {
  issueId: string;
  json?: boolean;
  tierOverride?: LaneTier;
  sinceSha?: string;
  noRuntime?: boolean;
  explain?: boolean;
  runner?: 'ops:lane:close' | 'ops:reconcile' | 'manual';
}

interface LinearIssueRecord {
  id: string;
  identifier: string;
  title: string;
  state?: { name: string } | null;
  labels?: { nodes: Array<{ name: string }> } | null;
  attachments?: { nodes: Array<{ title?: string | null; url?: string | null }> } | null;
}

interface EvidenceBundleV1 {
  schema_version: number;
  merge_sha?: string;
  generated_at?: string;
  verifier?: {
    identity?: string;
  };
  static_proof?: {
    test_run_logs?: Array<{
      path?: string;
      merge_sha?: string;
    }>;
  };
  runtime_proof?: {
    queries?: unknown[];
    receipts?: unknown[];
    row_counts?: unknown[];
  };
}

type Verdict = TruthCheckResult['verdict'];

export async function runTruthCheck(
  options: RunTruthCheckOptions,
): Promise<TruthCheckResult> {
  validateTruthResultSchemaDependencies();
  const env = loadEnvironment();
  const issueId = options.issueId.toUpperCase();
  const checkedAt = new Date().toISOString();
  const manifestPath = issueToManifestPath(issueId);
  const checks: CheckResult[] = [];
  const failures = new Set<string>();
  const reopenReasons = new Set<string>();
  const explain = options.explain ?? false;
  let manifest: LaneManifest | null = null;
  let tier: LaneTier = options.tierOverride ?? 'T3';
  let mergeSha: string | null = null;
  let prUrl: string | null = null;
  let mergeTimestamp: string | null = null;

  const addCheck = (id: string, status: 'pass' | 'fail' | 'skip', detail: string): void => {
    checks.push({ id, status, detail });
    if (status === 'fail') {
      failures.add(id);
      if (id === 'G5') {
        reopenReasons.add(detail);
      }
    }
    if (explain) {
      process.stderr.write(`[${status.toUpperCase()}] ${id} ${detail}\n`);
    }
  };

  try {
    if (!fs.existsSync(manifestPath)) {
      addCheck('M1', 'fail', `manifest missing at ${relativeToRoot(manifestPath)}`);
      return finalizeResult({
        issueId,
        tier,
        verdict: 'infra_error',
        exitCode: 3,
        mergeSha,
        prUrl,
        checkedAt,
        checks,
        failures,
        reopenReasons,
      });
    }
    addCheck('M1', 'pass', `manifest found at ${relativeToRoot(manifestPath)}`);

    manifest = readManifest(issueId);
    const manifestValidation = validateManifest(manifest, manifestPath);
    if (manifestValidation.length > 0) {
      addCheck('M2', 'fail', manifestValidation.join('; '));
      return finalizeResult({
        issueId,
        tier,
        verdict: 'infra_error',
        exitCode: 3,
        mergeSha,
        prUrl,
        checkedAt,
        checks,
        failures,
        reopenReasons,
      });
    }
    addCheck('M2', 'pass', 'manifest schema validated');

    if (manifest.issue_id !== issueId) {
      addCheck('M3', 'fail', 'manifest.issue_id does not match requested issue');
      return finalizeResult({
        issueId,
        tier,
        verdict: 'infra_error',
        exitCode: 3,
        mergeSha,
        prUrl,
        checkedAt,
        checks,
        failures,
        reopenReasons,
      });
    }
    addCheck('M3', 'pass', 'manifest.issue_id matches CLI argument');

    tier = options.tierOverride ?? manifest.tier;
    if (manifest.status !== 'merged' && manifest.status !== 'done') {
      addCheck('M4', 'fail', `manifest status ${manifest.status} is not eligible for truth-check`);
      return finalizeResult({
        issueId,
        tier,
        verdict: 'ineligible',
        exitCode: 2,
        mergeSha: manifest.commit_sha,
        prUrl: manifest.pr_url,
        checkedAt,
        checks,
        failures,
        reopenReasons,
      });
    }
    addCheck('M4', 'pass', `manifest status ${manifest.status} is eligible`);

    prUrl = manifest.pr_url;
    if (!prUrl) {
      addCheck('M5', 'fail', 'manifest.pr_url is missing');
    } else {
      try {
        new URL(prUrl);
        addCheck('M5', 'pass', 'manifest.pr_url is parseable');
      } catch {
        addCheck('M5', 'fail', 'manifest.pr_url is not parseable');
      }
    }

    mergeSha = manifest.commit_sha;
    if (!mergeSha) {
      addCheck('M6', 'fail', 'manifest.commit_sha is missing');
    } else {
      addCheck('M6', 'pass', 'manifest.commit_sha is set');
    }

    if ((tier === 'T1' || tier === 'T2') && manifest.expected_proof_paths.length === 0) {
      addCheck('M7', 'fail', 'expected_proof_paths must be non-empty for T1/T2');
    } else {
      addCheck('M7', 'pass', 'expected_proof_paths satisfies tier requirement');
    }

    const linearToken = env.LINEAR_API_TOKEN?.trim() || process.env.LINEAR_API_KEY?.trim();
    if (!linearToken) {
      addCheck('L1', 'fail', 'LINEAR_API_TOKEN or LINEAR_API_KEY is required');
      return finalizeWithManifest({
        manifest,
        issueId,
        tier,
        checkedAt,
        checks,
        failures,
        reopenReasons,
        mergeSha,
        prUrl,
        verdict: 'infra_error',
        exitCode: 3,
        runner: options.runner ?? 'manual',
      });
    }

    const linearIssue = await fetchLinearIssue(issueId, linearToken);
    addCheck('L1', 'pass', `Linear issue ${linearIssue.identifier} exists`);
    const tierLabels = (linearIssue.labels?.nodes ?? [])
      .map((label) => label.name.toLowerCase())
      .filter((label) => label === 't1' || label === 't2' || label === 't3');
    const uniqueTierLabels = [...new Set(tierLabels)];
    if (uniqueTierLabels.length !== 1) {
      addCheck('L2', 'fail', `expected exactly one tier label, found ${uniqueTierLabels.length}`);
    } else {
      if (!options.tierOverride) {
        tier = uniqueTierLabels[0].toUpperCase() as LaneTier;
      }
      addCheck('L2', 'pass', `Linear tier label is ${uniqueTierLabels[0]}`);
    }

    const stateName = linearIssue.state?.name ?? '';
    if (stateName !== 'In Review' && stateName !== 'Done') {
      addCheck('L3', 'fail', `Linear state ${stateName || 'Unknown'} is not In Review or Done`);
    } else {
      addCheck('L3', 'pass', `Linear state ${stateName} is permitted`);
    }

    const attachmentUrls = (linearIssue.attachments?.nodes ?? [])
      .map((attachment) => attachment.url?.trim())
      .filter((entry): entry is string => Boolean(entry));
    if (!prUrl || !attachmentUrls.includes(prUrl)) {
      addCheck('L4', 'fail', 'Linear attachments do not include manifest.pr_url');
    } else {
      addCheck('L4', 'pass', 'Linear attachments include manifest.pr_url');
    }

    const githubToken = process.env.GITHUB_TOKEN?.trim();
    if (!githubToken) {
      addCheck('G1', 'fail', 'GITHUB_TOKEN is required');
      return finalizeWithManifest({
        manifest,
        issueId,
        tier,
        checkedAt,
        checks,
        failures,
        reopenReasons,
        mergeSha,
        prUrl,
        verdict: 'infra_error',
        exitCode: 3,
        runner: options.runner ?? 'manual',
      });
    }
    if (!prUrl) {
      return finalizeWithManifest({
        manifest,
        issueId,
        tier,
        checkedAt,
        checks,
        failures,
        reopenReasons,
        mergeSha,
        prUrl,
        verdict: 'fail',
        exitCode: 1,
        runner: options.runner ?? 'manual',
      });
    }

    const prRef = parsePullRequestUrl(prUrl);
    const pullRequest = await fetchGitHubPullRequest(prRef.owner, prRef.repo, prRef.number, githubToken);
    if (!pullRequest.merged || !pullRequest.merge_commit_sha) {
      addCheck('G1', 'fail', 'pull request is not merged');
    } else {
      addCheck('G1', 'pass', 'pull request is merged');
    }

    if (!mergeSha || pullRequest.merge_commit_sha !== mergeSha) {
      addCheck('G2', 'fail', 'PR merge commit SHA does not match manifest.commit_sha');
    } else {
      addCheck('G2', 'pass', 'PR merge commit SHA matches manifest.commit_sha');
    }

    if (mergeSha && isCommitOnMainFirstParent(mergeSha)) {
      addCheck('G3', 'pass', 'merge commit is reachable on main first-parent history');
    } else {
      addCheck('G3', 'fail', 'merge commit is not reachable on main first-parent history');
    }

    const requiredChecks = await fetchRequiredChecks(prRef.owner, prRef.repo, githubToken);
    const mergeChecks = mergeSha
      ? await fetchCommitChecks(prRef.owner, prRef.repo, mergeSha, githubToken)
      : { passed: false, missing: requiredChecks };
    if (mergeChecks.passed) {
      addCheck('G4', 'pass', 'required GitHub checks are green on merge SHA');
    } else {
      addCheck('G4', 'fail', `required checks missing or failing: ${mergeChecks.missing.join(', ')}`);
    }

    if (tier === 'T1') {
      const labels = (pullRequest.labels ?? []).map((label: { name?: string }) => label.name?.toLowerCase());
      if (labels.includes('t1-approved')) {
        addCheck('L5', 'pass', 'PR carries t1-approved label');
      } else {
        addCheck('L5', 'fail', 'PR is missing t1-approved label');
      }
    } else {
      addCheck('L5', 'skip', 'L5 skipped for non-T1 tier');
    }

    const mergeCommit = mergeSha
      ? gitShowCommit(mergeSha)
      : null;
    mergeTimestamp = mergeCommit?.timestamp ?? null;
    const proofFiles = manifest.expected_proof_paths.map((proofPath) => path.join(ROOT, proofPath));

    const missingProofs = proofFiles.filter((proofPath) => !fs.existsSync(proofPath));
    if (missingProofs.length > 0) {
      addCheck('P1', 'fail', `missing proof files: ${missingProofs.map(relativeToRoot).join(', ')}`);
    } else {
      addCheck('P1', 'pass', 'all expected proof files exist');
    }

    const readableProofs = proofFiles.filter((proofPath) => {
      try {
        return fs.readFileSync(proofPath, 'utf8').trim().length > 0;
      } catch {
        return false;
      }
    });
    if (readableProofs.length !== proofFiles.length) {
      addCheck('P2', 'fail', 'one or more proof files are unreadable or empty');
    } else {
      addCheck('P2', 'pass', 'proof files are readable and non-empty');
    }

    if (mergeSha) {
      const staleShaProofs = proofFiles.filter((proofPath) => {
        try {
          const content = fs.readFileSync(proofPath, 'utf8');
          return !content.includes(mergeSha) && !new RegExp(`merge_sha:\\s*${mergeSha}`, 'i').test(content);
        } catch {
          return true;
        }
      });
      if (staleShaProofs.length > 0) {
        addCheck('P3', 'fail', `proof files missing merge SHA reference: ${staleShaProofs.map(relativeToRoot).join(', ')}`);
      } else {
        addCheck('P3', 'pass', 'proof files reference the merge SHA');
      }
    } else {
      addCheck('P3', 'fail', 'cannot evaluate proof SHA without manifest.commit_sha');
    }

    if (mergeTimestamp) {
      const staleMtimeProofs = proofFiles.filter((proofPath) => {
        try {
          return fs.statSync(proofPath).mtime.getTime() < new Date(mergeTimestamp).getTime();
        } catch {
          return true;
        }
      });
      if (staleMtimeProofs.length > 0) {
        addCheck('P4', 'fail', `proof files predate merge commit: ${staleMtimeProofs.map(relativeToRoot).join(', ')}`);
      } else {
        addCheck('P4', 'pass', 'proof files are newer than the merge commit');
      }
    } else {
      addCheck('P4', 'fail', 'cannot evaluate proof freshness without merge commit timestamp');
    }

    if (tier === 'T1') {
      if (!fs.existsSync(EVIDENCE_BUNDLE_SCHEMA_PATH)) {
        addCheck('P5', 'fail', `missing evidence bundle schema at ${relativeToRoot(EVIDENCE_BUNDLE_SCHEMA_PATH)}`);
      } else {
        const evidence = readFirstEvidenceBundle(proofFiles);
        if (!evidence) {
          addCheck('P5', 'fail', 'no expected proof path resolved to a readable evidence bundle');
        } else {
          addCheck('P5', 'pass', 'evidence bundle found');
          if (evidence.bundle.schema_version === 1) {
            addCheck('P6', 'pass', 'evidence bundle schema_version is 1');
          } else {
            addCheck('P6', 'fail', 'evidence bundle schema_version must be 1');
          }

          if (hasPopulatedObject(evidence.bundle.static_proof) && hasPopulatedObject(evidence.bundle.runtime_proof)) {
            addCheck('P7', 'pass', 'evidence bundle includes static_proof and runtime_proof');
          } else {
            addCheck('P7', 'fail', 'evidence bundle must include populated static_proof and runtime_proof sections');
          }

          if (
            mergeSha &&
            Array.isArray(evidence.bundle.static_proof?.test_run_logs) &&
            evidence.bundle.static_proof!.test_run_logs!.some((entry) => entry.merge_sha === mergeSha)
          ) {
            addCheck('P8', 'pass', 'static_proof references test run logs tied to merge SHA');
          } else {
            addCheck('P8', 'fail', 'static_proof must reference test run logs tied to merge SHA');
          }

          if (hasRuntimeReferences(evidence.bundle.runtime_proof)) {
            addCheck('P9', 'pass', 'runtime_proof references live DB evidence');
          } else {
            addCheck('P9', 'fail', 'runtime_proof must reference live DB queries, row counts, or receipts');
          }

          const verifierIdentity = evidence.bundle.verifier?.identity?.trim();
          if (verifierIdentity && verifierIdentity !== manifest.created_by) {
            addCheck('P10', 'pass', 'verifier.identity is set and distinct from implementing lane identity');
          } else {
            addCheck('P10', 'fail', 'verifier.identity must be set and not equal to manifest.created_by');
          }

          addUnsupportedRuntimeChecks(addCheck, options.noRuntime ?? false, tier);
        }
      }
    } else if (tier === 'T2') {
      const proofContents = proofFiles.map((proofPath) => safeRead(proofPath)).join('\n');
      if (/diff summary/i.test(proofContents) || proofFiles.some((proofPath) => /diff-summary/i.test(path.basename(proofPath)))) {
        addCheck('P11', 'pass', 'proof includes a diff summary file');
      } else {
        addCheck('P11', 'fail', 'proof must include a diff summary file');
      }

      if (/pnpm type-check/i.test(proofContents) && /pnpm test/i.test(proofContents)) {
        addCheck('P12', 'pass', 'verification log references pnpm type-check and pnpm test');
      } else {
        addCheck('P12', 'fail', 'verification log must reference pnpm type-check and pnpm test');
      }
    }

    if (manifest.files_changed.length > 0 && manifest.file_scope_lock.length > 0) {
      const allowedPaths = new Set([
        ...manifest.file_scope_lock,
        ...manifest.expected_proof_paths,
      ]);
      const outOfScope = manifest.files_changed.filter(
        (f) =>
          !allowedPaths.has(f) &&
          !f.includes('deleted-file') &&
          !f.startsWith('docs/06_status/proof/'),
      );
      if (outOfScope.length > 0) {
        addCheck('S1', 'fail', `files_changed outside file_scope_lock: ${outOfScope.join(', ')}`);
      } else {
        addCheck('S1', 'pass', 'all files_changed are within file_scope_lock or proof paths');
      }
    } else {
      addCheck('S1', 'pass', 'scope-diff check not applicable (empty files_changed or scope)');
    }

    if (mergeSha && manifest.files_changed.length > 0) {
      const postMergeTouches = findPostMergeTouches({
        mergeSha,
        filesChanged: manifest.files_changed,
        issueId,
        sinceSha: options.sinceSha,
      });
      if (postMergeTouches.length > 0) {
        addCheck(
          'G5',
          'fail',
          `commits touched locked files after merge without linked follow-up issue: ${postMergeTouches.join(', ')}`,
        );
      } else {
        addCheck('G5', 'pass', 'no post-merge touches without linked follow-up issue detected');
      }
    } else {
      addCheck('G5', 'pass', 'no finalized files_changed entries to inspect');
    }

    const exitCode = determineExitCode(checks, manifest.status);
    const verdict = determineVerdict(exitCode);
    return finalizeWithManifest({
      manifest,
      issueId,
      tier,
      checkedAt,
      checks,
      failures,
      reopenReasons,
      mergeSha,
      prUrl,
      verdict,
      exitCode,
      runner: options.runner ?? 'manual',
    });
  } catch (error) {
    addCheck('INFRA', 'fail', error instanceof Error ? error.message : String(error));
    return finalizeWithManifest({
      manifest,
      issueId,
      tier,
      checkedAt,
      checks,
      failures,
      reopenReasons,
      mergeSha,
      prUrl,
      verdict: 'infra_error',
      exitCode: 3,
      runner: options.runner ?? 'manual',
    });
  }
}

function addUnsupportedRuntimeChecks(
  addCheck: (id: string, status: 'pass' | 'fail' | 'skip', detail: string) => void,
  noRuntime: boolean,
  tier: LaneTier,
): void {
  if (tier !== 'T1') {
    addCheck('R1', 'skip', 'runtime checks skipped for non-T1 tier');
    addCheck('R2', 'skip', 'runtime checks skipped for non-T1 tier');
    addCheck('R3', 'skip', 'runtime checks skipped for non-T1 tier');
    return;
  }

  if (noRuntime) {
    addCheck('R1', 'fail', '--no-runtime is rejected for T1');
    addCheck('R2', 'fail', '--no-runtime is rejected for T1');
    addCheck('R3', 'fail', '--no-runtime is rejected for T1');
    return;
  }

  addCheck('R1', 'fail', 'Phase 1 lacks a canonical runtime query contract for executing T1 runtime_proof.queries');
  addCheck('R2', 'fail', 'Phase 1 lacks a canonical monitored-table contract for failed/dead_letter reopen checks');
  addCheck('R3', 'fail', 'Phase 1 lacks the phase-boundary-guard mechanical contract needed for T1 runtime enforcement');
}

function determineExitCode(
  checks: CheckResult[],
  manifestStatus: LaneManifest['status'],
): 0 | 1 | 2 | 3 | 4 {
  if (checks.some((check) => check.id === 'M4' && check.status === 'fail')) {
    return 2;
  }
  if (checks.some((check) => check.id === 'G5' && check.status === 'fail' && manifestStatus === 'done')) {
    return 4;
  }
  if (
    checks.some(
      (check) =>
        check.status === 'fail' &&
        (
          check.id === 'M1' ||
          check.id === 'M2' ||
          check.id === 'M3' ||
          check.id === 'L1' ||
          /is required|missing required schema/i.test(check.detail)
        ),
    )
  ) {
    return 3;
  }

  if (checks.some((check) => check.id === 'G5' && check.status === 'fail')) {
    return 4;
  }
  if (checks.some((check) => check.status === 'fail')) {
    return 1;
  }

  return 0;
}

function determineVerdict(exitCode: 0 | 1 | 2 | 3 | 4): Verdict {
  switch (exitCode) {
    case 0:
      return 'pass';
    case 1:
      return 'fail';
    case 2:
      return 'ineligible';
    case 3:
      return 'infra_error';
    case 4:
      return 'reopen';
  }
}

function finalizeResult(input: {
  issueId: string;
  tier: LaneTier;
  verdict: Verdict;
  exitCode: 0 | 1 | 2 | 3 | 4;
  mergeSha: string | null;
  prUrl: string | null;
  checkedAt: string;
  checks: CheckResult[];
  failures: Set<string>;
  reopenReasons: Set<string>;
}): TruthCheckResult {
  return {
    schema_version: 1,
    issue_id: input.issueId,
    tier: input.tier,
    verdict: input.verdict,
    exit_code: input.exitCode,
    merge_sha: input.mergeSha,
    pr_url: input.prUrl,
    checked_at: input.checkedAt,
    checks: input.checks,
    failures: [...input.failures],
    reopen_reasons: [...input.reopenReasons],
    manifest_path: relativeToRoot(path.join(MANIFEST_DIR, `${input.issueId}.json`)),
  };
}

function finalizeWithManifest(input: {
  manifest: LaneManifest | null;
  issueId: string;
  tier: LaneTier;
  checkedAt: string;
  checks: CheckResult[];
  failures: Set<string>;
  reopenReasons: Set<string>;
  mergeSha: string | null;
  prUrl: string | null;
  verdict: Verdict;
  exitCode: 0 | 1 | 2 | 3 | 4;
  runner: TruthCheckHistoryEntry['runner'];
}): TruthCheckResult {
  const result = finalizeResult({
    issueId: input.issueId,
    tier: input.tier,
    verdict: input.verdict,
    exitCode: input.exitCode,
    mergeSha: input.mergeSha,
    prUrl: input.prUrl,
    checkedAt: input.checkedAt,
    checks: input.checks,
    failures: input.failures,
    reopenReasons: input.reopenReasons,
  });

  if (!input.manifest || input.exitCode === 2 || input.exitCode === 3) {
    return result;
  }

  const historyEntry: TruthCheckHistoryEntry = {
    checked_at: input.checkedAt,
    verdict: input.verdict === 'pass' ? 'pass' : input.verdict === 'reopen' ? 'reopen' : 'fail',
    merge_sha: input.mergeSha,
    failures: [...input.failures],
    runner: input.runner,
  };

  const updated: LaneManifest = {
    ...input.manifest,
    heartbeat_at: input.checkedAt,
    truth_check_history: [...input.manifest.truth_check_history, historyEntry],
  };

  if (input.exitCode === 4) {
    updated.status = 'reopened';
    updated.closed_at = null;
    updated.reopen_history = [
      ...input.manifest.reopen_history,
      {
        timestamp: input.checkedAt,
        reasons: [...input.reopenReasons],
        detected_by: input.runner,
      },
    ];
  }

  writeManifest(updated);
  return result;
}

async function fetchLinearIssue(issueId: string, token: string): Promise<LinearIssueRecord> {
  const payload = await fetchJson<{
    data?: { issue: LinearIssueRecord | null };
    errors?: Array<{ message?: string }>;
  }>('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `
        query IssueForTruthCheck($id: String!) {
          issue(id: $id) {
            id
            identifier
            title
            state { name }
            labels(first: 20) { nodes { name } }
            attachments(first: 20) { nodes { title url } }
          }
        }
      `,
      variables: { id: issueId },
    }),
  });

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((entry) => entry.message ?? 'Unknown Linear error').join('; '));
  }
  if (!payload.data?.issue) {
    throw new Error(`Linear issue not found: ${issueId}`);
  }

  return payload.data.issue;
}

function parsePullRequestUrl(prUrl: string): { owner: string; repo: string; number: number } {
  const url = new URL(prUrl);
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)$/);
  if (!match) {
    throw new Error(`Unsupported PR URL: ${prUrl}`);
  }

  return {
    owner: match[1],
    repo: match[2],
    number: Number.parseInt(match[3], 10),
  };
}

async function fetchGitHubPullRequest(
  owner: string,
  repo: string,
  number: number,
  token: string,
): Promise<{
  merged: boolean;
  merge_commit_sha: string | null;
  labels: Array<{ name?: string }>;
}> {
  return fetchJson(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`, {
    headers: githubHeaders(token),
  });
}

async function fetchRequiredChecks(
  owner: string,
  repo: string,
  token: string,
): Promise<string[]> {
  const response = await fetchJson<{
    contexts?: string[];
    checks?: Array<{ context?: string }>;
  }>(`https://api.github.com/repos/${owner}/${repo}/branches/main/protection/required_status_checks`, {
    headers: githubHeaders(token),
  });

  const contexts = response.contexts ?? [];
  const checks = (response.checks ?? [])
    .map((entry) => entry.context?.trim())
    .filter((entry): entry is string => Boolean(entry));
  return [...new Set([...contexts, ...checks])];
}

async function fetchCommitChecks(
  owner: string,
  repo: string,
  sha: string,
  token: string,
): Promise<{ passed: boolean; missing: string[] }> {
  const [statusPayload, checksPayload] = await Promise.all([
    fetchJson<{
      statuses?: Array<{ context?: string; state?: string }>;
    }>(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}/status`, {
      headers: githubHeaders(token),
    }),
    fetchJson<{
      check_runs?: Array<{ name?: string; conclusion?: string | null; status?: string }>;
    }>(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}/check-runs`, {
      headers: {
        ...githubHeaders(token),
        Accept: 'application/vnd.github+json',
      },
    }),
  ]);

  const requiredChecks = await fetchRequiredChecks(owner, repo, token);
  if (requiredChecks.length === 0) {
    return { passed: true, missing: [] };
  }

  const statusMap = new Map<string, boolean>();
  for (const status of statusPayload.statuses ?? []) {
    if (status.context) {
      statusMap.set(status.context, status.state === 'success');
    }
  }
  for (const checkRun of checksPayload.check_runs ?? []) {
    if (checkRun.name) {
      statusMap.set(
        checkRun.name,
        checkRun.status === 'completed' && checkRun.conclusion === 'success',
      );
    }
  }

  const missing = requiredChecks.filter((check) => statusMap.get(check) !== true);
  return {
    passed: missing.length === 0,
    missing,
  };
}

function isCommitOnMainFirstParent(sha: string): boolean {
  const revList = parseGit(['rev-list', '--first-parent', 'main']);
  return revList.includes(sha);
}

function parseGit(args: string[]): string[] {
  const { stdout, ok } = git(args);
  if (!ok) {
    return [];
  }

  return stdout.split(/\r?\n/).filter(Boolean);
}

function gitShowCommit(sha: string): { timestamp: string; subject: string } | null {
  const result = git(['show', '-s', '--format=%cI%n%s', sha]);
  if (!result.ok || !result.stdout) {
    return null;
  }
  const [timestamp, ...subject] = result.stdout.split(/\r?\n/);
  return {
    timestamp,
    subject: subject.join(' '),
  };
}

function safeRead(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function readFirstEvidenceBundle(
  proofFiles: string[],
): { path: string; bundle: EvidenceBundleV1 } | null {
  for (const proofPath of proofFiles) {
    try {
      const parsed = parseJsonFile<EvidenceBundleV1>(proofPath);
      if (parsed && typeof parsed === 'object') {
        return { path: proofPath, bundle: parsed };
      }
    } catch {
      continue;
    }
  }

  return null;
}

function hasPopulatedObject(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && Object.keys(value as Record<string, unknown>).length > 0);
}

function hasRuntimeReferences(runtimeProof: EvidenceBundleV1['runtime_proof']): boolean {
  if (!runtimeProof) {
    return false;
  }

  return (
    Array.isArray(runtimeProof.queries) && runtimeProof.queries.length > 0 ||
    Array.isArray(runtimeProof.receipts) && runtimeProof.receipts.length > 0 ||
    Array.isArray(runtimeProof.row_counts) && runtimeProof.row_counts.length > 0
  );
}

function findPostMergeTouches(input: {
  mergeSha: string;
  filesChanged: string[];
  issueId: string;
  sinceSha?: string;
}): string[] {
  const logArgs = ['log', '--format=%H%x09%s%x09%cI', 'main', '--max-count=200'];
  const result = git(logArgs);
  if (!result.ok) {
    return [];
  }

  const mergeCommit = gitShowCommit(input.mergeSha);
  if (!mergeCommit?.timestamp) {
    return [];
  }
  const windowEnd = new Date(mergeCommit.timestamp).getTime() + 24 * 60 * 60 * 1000;
  const output: string[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line) {
      continue;
    }
    const [sha, subject, committedAt] = line.split('\t');
    if (!sha || sha === input.mergeSha) {
      continue;
    }
    if (input.sinceSha && sha === input.sinceSha) {
      break;
    }
    const committedTime = Date.parse(committedAt);
    if (Number.isNaN(committedTime) || committedTime > windowEnd) {
      continue;
    }
    const touchedFiles = git(['show', '--format=', '--name-only', sha]).stdout
      .split(/\r?\n/)
      .filter(Boolean);
    const overlaps = touchedFiles.some((filePath) => input.filesChanged.includes(filePath));
    if (!overlaps) {
      continue;
    }
    const referencedIssues = subject.match(/UTV2-\d+/gi) ?? [];
    const hasFollowUpIssue = referencedIssues.some(
      (candidate) => candidate.toUpperCase() !== input.issueId,
    );
    if (!hasFollowUpIssue) {
      output.push(sha);
    }
  }

  return output;
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt === 1) {
        break;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`Request failed for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function githubHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'unit-talk-ops-truth-check',
  };
}
