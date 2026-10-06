import { spawnSync } from 'node:child_process';
import type { LaneManifest } from './shared.js';
import { ROOT } from './shared.js';

export const MERGED_RECOVERY_WORKFLOW_PATH = '.github/workflows/post-merge-lane-close.yml';
export const MERGED_RECOVERY_RECEIPT_FILE = 'merged-lane-recovery-admission.json';

export interface MergedLaneRecoveryRequest {
  source_issue_id: string;
  original_pr_number: number;
  merge_sha: string;
  failed_closeout_run_id: number;
  authority_comment_id: number;
}

export interface MergedLaneRecoveryEvidence {
  repository: string;
  repository_owner: string;
  source_manifest: Pick<LaneManifest, 'issue_id' | 'branch' | 'status' | 'pr_url' | 'commit_sha'> | null;
  pull_request: {
    number: number;
    state: string;
    merged: boolean;
    merged_at: string | null;
    merge_commit_sha: string | null;
    html_url: string;
    body: string | null;
    head: { ref: string; repo: { full_name: string } | null };
    base: { ref: string; repo: { full_name: string } | null };
  } | null;
  closeout_run: {
    id: number;
    event: string;
    status: string;
    conclusion: string | null;
    head_sha: string;
    head_branch: string | null;
    path: string;
    created_at: string;
    updated_at: string;
    html_url: string;
    actor?: { login?: string } | null;
    triggering_actor?: { login?: string } | null;
  } | null;
  closeout_log: string | null;
  authority_comment: {
    id: number;
    issue_url: string;
    html_url: string;
    body: string;
    created_at: string;
    updated_at: string;
    author_association: string;
    user: { login: string };
  } | null;
  merge_is_on_main: boolean;
}

export interface MergedLaneRecoveryAttestation {
  schema_version: 1;
  source_issue_id: string;
  source_branch: string;
  source_manifest_status: string;
  original_pr_number: number;
  original_pr_url: string;
  merge_sha: string;
  failed_closeout_run_id: number;
  failed_closeout_run_url: string;
  authority_comment_id: number;
  authority_comment_url: string;
  repository: string;
  workflow_path: typeof MERGED_RECOVERY_WORKFLOW_PATH;
  verified_at: string;
}

export type MergedLaneRecoveryEvaluation =
  | { ok: true; attestation: MergedLaneRecoveryAttestation }
  | { ok: false; errors: string[] };

type FlagMap = Map<string, string[]>;

function lastFlag(flags: FlagMap, name: string): string | undefined {
  return flags.get(name)?.at(-1);
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseMergedLaneRecoveryRequest(flags: FlagMap):
  | { requested: false; request: null; errors: [] }
  | { requested: true; request: MergedLaneRecoveryRequest | null; errors: string[] } {
  const names = [
    'merged-recovery-source',
    'merged-recovery-pr',
    'merged-recovery-merge-sha',
    'merged-recovery-run',
    'merged-recovery-authority-comment',
  ] as const;
  const values = Object.fromEntries(names.map((name) => [name, lastFlag(flags, name)])) as Record<
    (typeof names)[number],
    string | undefined
  >;
  if (names.every((name) => values[name] === undefined)) {
    return { requested: false, request: null, errors: [] };
  }

  const errors = names
    .filter((name) => !values[name])
    .map((name) => `--${name} is required when merged-lane recovery is requested`);
  const sourceIssue = values['merged-recovery-source']?.toUpperCase() ?? '';
  const prNumber = parsePositiveInteger(values['merged-recovery-pr']);
  const runId = parsePositiveInteger(values['merged-recovery-run']);
  const commentId = parsePositiveInteger(values['merged-recovery-authority-comment']);
  const mergeSha = values['merged-recovery-merge-sha']?.toLowerCase() ?? '';
  if (sourceIssue && !/^WORK-\d+$/u.test(sourceIssue)) {
    errors.push('--merged-recovery-source must be a repo-owned WORK-### identity');
  }
  if (values['merged-recovery-pr'] && prNumber === null) {
    errors.push('--merged-recovery-pr must be a positive pull-request number');
  }
  if (values['merged-recovery-run'] && runId === null) {
    errors.push('--merged-recovery-run must be a positive GitHub Actions run id');
  }
  if (values['merged-recovery-authority-comment'] && commentId === null) {
    errors.push('--merged-recovery-authority-comment must be a positive GitHub comment id');
  }
  if (values['merged-recovery-merge-sha'] && !/^[0-9a-f]{40}$/u.test(mergeSha)) {
    errors.push('--merged-recovery-merge-sha must be a full 40-character Git SHA');
  }
  if (errors.length > 0 || !sourceIssue || prNumber === null || runId === null || commentId === null) {
    return { requested: true, request: null, errors };
  }
  return {
    requested: true,
    request: {
      source_issue_id: sourceIssue,
      original_pr_number: prNumber,
      merge_sha: mergeSha,
      failed_closeout_run_id: runId,
      authority_comment_id: commentId,
    },
    errors: [],
  };
}

function exactIdentity(text: string, identity: string): boolean {
  const escaped = identity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^A-Z0-9])${escaped}(?:$|[^A-Z0-9])`, 'imu').test(text);
}

function prNumberFromUrl(value: string | null): number | null {
  const match = value?.match(/\/pull\/(\d+)\/?$/u);
  return match ? Number(match[1]) : null;
}

const REQUIRED_CLOSEOUT_PASS_GATES = ['G1', 'G2', 'G3', 'G4', 'G6', 'C6'] as const;
const ADMITTED_PROOF_FAILURE_GATES = new Set(['P6', 'P9', 'R1', 'R2']);

function evaluateCloseoutGateEvidence(log: string): string[] {
  const errors: string[] = [];
  const gateResults = [...log.matchAll(/\[(PASS|FAIL)\]\s+([A-Z][A-Z0-9]*)\b/gu)].map((match) => ({
    verdict: match[1],
    gate: match[2],
  }));

  for (const gate of REQUIRED_CLOSEOUT_PASS_GATES) {
    if (!gateResults.some((result) => result.verdict === 'PASS' && result.gate === gate)) {
      errors.push(`closeout log does not prove required ${gate} passed`);
    }
  }

  const disallowedFailures = [
    ...new Set(
      gateResults
        .filter((result) => result.verdict === 'FAIL' && !ADMITTED_PROOF_FAILURE_GATES.has(result.gate))
        .map((result) => result.gate),
    ),
  ];
  if (disallowedFailures.length > 0) {
    errors.push(`closeout log contains non-admitted gate failures: ${disallowedFailures.join(', ')}`);
  }
  return errors;
}

function hasAffirmativeAdmissionAuthority(body: string): boolean {
  const admissionScope = '(?:admission|readmission)(?:[ \\t]+(?:recovery|bridge))?';
  const separator = '(?:[ \\t]*(?::|[-—])[ \\t]*|[ \\t]+)';
  const rejection = '(?:not[ \\t]+authorized|never[ \\t]+authorized|unauthorized|(?:authorization[ \\t]+)?(?:denied|revoked)|pending)';
  const bindingSuffix = '(?:[ \\t]+for[ \\t]+#\\d+[ \\t]+/[ \\t]+WORK-\\d+[ \\t]+at[ \\t]+[0-9a-f]{40})?';
  const decisionEnd = `(?:,[ \\t]*narrowly)?${bindingSuffix}[ \\t]*$`;
  const authoritativeDecision = new RegExp(
    `(?:^\\s*PM[ \\t]+DECISION[ \\t]*(?:[-—]|:)[ \\t]*` +
      `(?:BOUNDED[ \\t]+T1[ \\t]+CLOSEOUT[ \\t]*/[ \\t]*)?${admissionScope}${separator}authorized${decisionEnd}|` +
      `^\\s*#{1,6}[ \\t]+(?:\\d+\\.[ \\t]+)?(?:ownership/)?${admissionScope}${separator}authorized${decisionEnd})`,
    'iu',
  );
  const explicitRejection = new RegExp(
    `(?:\\b${admissionScope}\\b${separator}(?:is[ \\t]+)?${rejection}\\b|` +
      `\\b(?:${rejection}|do[ \\t]+not[ \\t]+authorize)${separator}${admissionScope}\\b|` +
      `\\bno[ \\t]+${admissionScope}\\b[ \\t]+authorized\\b)`,
    'iu',
  );

  // An earlier affirmative sentence cannot outlive a later revocation in the
  // same attested comment. Keep this deliberately conservative: the comment
  // is the authority artifact, so an explicit scoped rejection or any
  // revocation language makes it unusable.
  if (explicitRejection.test(body) || /\b(?:authorization[ \t]+)?revoked\b/iu.test(body)) return false;

  return body.split(/\r?\n/u).some((line) => authoritativeDecision.test(line));
}

export function evaluateMergedLaneRecoveryEvidence(
  request: MergedLaneRecoveryRequest,
  evidence: MergedLaneRecoveryEvidence,
  verifiedAt = new Date().toISOString(),
): MergedLaneRecoveryEvaluation {
  const errors: string[] = [];
  const manifest = evidence.source_manifest;
  const pr = evidence.pull_request;
  const run = evidence.closeout_run;
  const comment = evidence.authority_comment;

  if (!manifest) {
    errors.push('source lane manifest is unavailable');
  } else {
    if (manifest.issue_id !== request.source_issue_id) errors.push('source manifest identity does not match');
    if (manifest.status !== 'in_review') {
      errors.push(`source lane status ${manifest.status} is not a stranded post-merge state`);
    }
    if (prNumberFromUrl(manifest.pr_url) !== request.original_pr_number) {
      errors.push('source manifest original PR does not match the request');
    }
    if (manifest.commit_sha !== null && manifest.commit_sha !== request.merge_sha) {
      errors.push('source manifest merge SHA conflicts with the request');
    }
  }

  if (!pr) {
    errors.push('original pull request evidence is unavailable');
  } else {
    if (pr.number !== request.original_pr_number) errors.push('original pull request number does not match');
    if (!pr.merged || pr.state.toLowerCase() !== 'closed' || !pr.merged_at) {
      errors.push('original pull request is not merged');
    }
    if (pr.merge_commit_sha !== request.merge_sha) errors.push('original pull request merge SHA does not match');
    if (pr.base.ref !== 'main') errors.push('original pull request did not target main');
    if (pr.head.ref !== manifest?.branch) errors.push('original pull request branch does not match the source manifest');
    if (pr.head.repo?.full_name !== evidence.repository || pr.base.repo?.full_name !== evidence.repository) {
      errors.push('original pull request is not a same-repository main PR');
    }
    if (!exactIdentity(pr.body ?? '', request.source_issue_id)) {
      errors.push('original pull request body does not bind the source WORK identity');
    }
  }
  if (!evidence.merge_is_on_main) errors.push('requested merge SHA is not reachable from current origin/main');

  if (!run) {
    errors.push('failed closeout run evidence is unavailable');
  } else {
    if (run.id !== request.failed_closeout_run_id) errors.push('closeout run id does not match');
    if (run.path !== MERGED_RECOVERY_WORKFLOW_PATH) errors.push('run is not the canonical post-merge closeout workflow');
    if (run.event !== 'workflow_dispatch') errors.push('closeout run is not an explicit canonical recovery dispatch');
    if (run.status !== 'completed' || run.conclusion !== 'failure') {
      errors.push('closeout run did not complete with failure');
    }
    if (run.head_sha !== request.merge_sha || run.head_branch !== 'main') {
      errors.push('closeout run is not bound to the requested merge on main');
    }
    if (run.actor?.login !== evidence.repository_owner || run.triggering_actor?.login !== evidence.repository_owner) {
      errors.push('closeout run was not dispatched by the repository owner');
    }
    if (pr?.merged_at && Date.parse(run.created_at) < Date.parse(pr.merged_at)) {
      errors.push('closeout run predates the original merge');
    }
  }

  const log = evidence.closeout_log;
  if (log === null) {
    errors.push('closeout run log evidence is unavailable');
  } else {
    const commandPattern = new RegExp(
      `(?:ops:lane-close|scripts/ops/lane-close\\.ts)\\s+${request.source_issue_id}\\s+.*--repair-merged.*--pr\\s+${request.original_pr_number}(?:\\s|$)`,
      'u',
    );
    if (!log.includes(`DISPATCH_ISSUE_ID: ${request.source_issue_id}`)) {
      errors.push('closeout log does not bind the source WORK identity');
    }
    if (!log.includes(`DISPATCH_PR: ${request.original_pr_number}`)) {
      errors.push('closeout log does not bind the original PR');
    }
    if (!log.includes(`PUSH_SHA: ${request.merge_sha}`) || !log.includes(`MERGE_SHA: ${request.merge_sha}`)) {
      errors.push('closeout log does not bind the actual merge SHA');
    }
    if (!commandPattern.test(log)) errors.push('closeout log did not execute the canonical repair command');
    if (!log.includes('"code": "truth_check_failed"') || !/\[FAIL\] P\d+\b/u.test(log)) {
      errors.push('closeout log does not prove a fail-closed proof rejection');
    }
    errors.push(...evaluateCloseoutGateEvidence(log));
    if (log.includes(`Lane closeout PASSED for ${request.source_issue_id}`)) {
      errors.push('closeout log records a successful closeout');
    }
  }

  if (!comment) {
    errors.push('PM authority comment evidence is unavailable');
  } else {
    if (comment.id !== request.authority_comment_id) errors.push('PM authority comment id does not match');
    if (!comment.issue_url.endsWith(`/issues/${request.original_pr_number}`)) {
      errors.push('PM authority comment is attached to an unrelated PR');
    }
    if (comment.author_association !== 'OWNER' || comment.user.login !== evidence.repository_owner) {
      errors.push('PM authority comment is not authored by the repository owner');
    }
    if (!exactIdentity(comment.body, request.source_issue_id)) errors.push('PM authority omits the source WORK identity');
    if (!comment.body.includes(`#${request.original_pr_number}`)) errors.push('PM authority omits the original PR');
    if (!comment.body.includes(request.merge_sha)) errors.push('PM authority omits the actual merge SHA');
    if (!hasAffirmativeAdmissionAuthority(comment.body)) {
      errors.push('PM authority does not explicitly authorize admission recovery');
    }
    if (run && Date.parse(comment.created_at) < Date.parse(run.updated_at)) {
      errors.push('PM authority predates the failed closeout evidence');
    }
  }

  if (errors.length > 0 || !manifest || !pr || !run || !comment) return { ok: false, errors };
  return {
    ok: true,
    attestation: {
      schema_version: 1,
      source_issue_id: request.source_issue_id,
      source_branch: manifest.branch,
      source_manifest_status: manifest.status,
      original_pr_number: request.original_pr_number,
      original_pr_url: pr.html_url,
      merge_sha: request.merge_sha,
      failed_closeout_run_id: request.failed_closeout_run_id,
      failed_closeout_run_url: run.html_url,
      authority_comment_id: request.authority_comment_id,
      authority_comment_url: comment.html_url,
      repository: evidence.repository,
      workflow_path: MERGED_RECOVERY_WORKFLOW_PATH,
      verified_at: verifiedAt,
    },
  };
}

function run(command: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
  };
}

function readJson<T>(repository: string, endpoint: string): T | null {
  const result = run('gh', ['api', `repos/${repository}/${endpoint}`]);
  if (!result.ok) return null;
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    return null;
  }
}

export function attestMergedLaneRecovery(input: {
  request: MergedLaneRecoveryRequest;
  verifiedAt?: string;
}): MergedLaneRecoveryEvaluation {
  const repositoryResult = run('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
  const repository = repositoryResult.ok ? repositoryResult.stdout : '';
  const repositoryOwner = repository.split('/')[0] ?? '';
  if (!repository || !repositoryOwner) {
    return { ok: false, errors: ['current GitHub repository evidence is unavailable'] };
  }
  const pr = readJson<MergedLaneRecoveryEvidence['pull_request']>(
    repository,
    `pulls/${input.request.original_pr_number}`,
  );
  const closeoutRun = readJson<MergedLaneRecoveryEvidence['closeout_run']>(
    repository,
    `actions/runs/${input.request.failed_closeout_run_id}`,
  );
  const comment = readJson<MergedLaneRecoveryEvidence['authority_comment']>(
    repository,
    `issues/comments/${input.request.authority_comment_id}`,
  );
  const logResult = run('gh', [
    'run',
    'view',
    String(input.request.failed_closeout_run_id),
    '--repo',
    repository,
    '--log',
  ]);
  const fetchMain = run('git', ['fetch', 'origin', 'main']);
  const manifestResult = fetchMain.ok
    ? run('git', [
        'show',
        `origin/main:docs/06_status/lanes/${input.request.source_issue_id}.json`,
      ])
    : { ok: false, stdout: '', stderr: 'origin/main fetch failed' };
  let sourceManifest: MergedLaneRecoveryEvidence['source_manifest'] = null;
  if (manifestResult.ok) {
    try {
      sourceManifest = JSON.parse(manifestResult.stdout) as MergedLaneRecoveryEvidence['source_manifest'];
    } catch {
      sourceManifest = null;
    }
  }
  const mergeOnMain = fetchMain.ok
    ? run('git', ['merge-base', '--is-ancestor', input.request.merge_sha, 'origin/main']).ok
    : false;
  return evaluateMergedLaneRecoveryEvidence(
    input.request,
    {
      repository,
      repository_owner: repositoryOwner,
      source_manifest: sourceManifest,
      pull_request: pr,
      closeout_run: closeoutRun,
      closeout_log: logResult.ok ? logResult.stdout : null,
      authority_comment: comment,
      merge_is_on_main: mergeOnMain,
    },
    input.verifiedAt,
  );
}

export function sameMergedLaneRecoveryBinding(
  left: MergedLaneRecoveryAttestation,
  right: MergedLaneRecoveryAttestation,
): boolean {
  const { verified_at: _leftVerified, ...leftBinding } = left;
  const { verified_at: _rightVerified, ...rightBinding } = right;
  return JSON.stringify(leftBinding) === JSON.stringify(rightBinding);
}

export function mergedRecoveryOverlapCandidates<T extends { issue_id: string }>(
  manifests: T[],
  attestation: MergedLaneRecoveryAttestation | null,
): T[] {
  return attestation
    ? manifests.filter((manifest) => manifest.issue_id !== attestation.source_issue_id)
    : manifests;
}

export function buildMergedLaneRecoveryReceipt(input: {
  recoveryIssueId: string;
  recoveryBranch: string;
  preflight: MergedLaneRecoveryAttestation;
  laneStart: MergedLaneRecoveryAttestation;
}): Record<string, unknown> {
  return {
    schema_version: 1,
    admission: 'merged-lane-recovery',
    recovery_issue_id: input.recoveryIssueId,
    recovery_branch: input.recoveryBranch,
    source_lane_remains_counted: true,
    overlap_exception: {
      source_issue_id: input.laneStart.source_issue_id,
      scope: 'attested-source-only',
    },
    original: {
      issue_id: input.laneStart.source_issue_id,
      branch: input.laneStart.source_branch,
      pr_number: input.laneStart.original_pr_number,
      pr_url: input.laneStart.original_pr_url,
      merge_sha: input.laneStart.merge_sha,
    },
    failed_closeout: {
      workflow_path: input.laneStart.workflow_path,
      run_id: input.laneStart.failed_closeout_run_id,
      run_url: input.laneStart.failed_closeout_run_url,
    },
    authority: {
      comment_id: input.laneStart.authority_comment_id,
      comment_url: input.laneStart.authority_comment_url,
    },
    attestations: {
      preflight_at: input.preflight.verified_at,
      lane_start_at: input.laneStart.verified_at,
    },
  };
}
