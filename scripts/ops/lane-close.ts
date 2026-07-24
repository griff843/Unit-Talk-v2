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
import { rebindMergeSha, type ShaRebindOutcome } from './proof-generate.js';
import {
  acquireMergeLock,
  defaultMergeLockOwner,
  MERGE_LOCK_PATH,
  releaseMergeLock,
  requireMergeLockHeld,
  type MergeLockResult,
} from './merge-mutex.js';
import { leasePathForIssue, releaseLease } from './lease-registry.js';

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
  | 'untrusted_invocation' // explicit PR binding was not invoked by the trusted post-merge workflow
  | 'explicit_pr_requires_repair' // --pr was supplied without --repair-merged
  | 'pr_not_found'        // supplied PR does not exist or could not be resolved
  | 'wrong_repository'    // supplied/resolved PR is outside griff843/Unit-Talk-v2
  | 'issue_identity_mismatch' // PR branch/title does not identify the requested lane
  | 'conflicting_pr_binding' // manifest already points at a different PR
  | 'repair_pr_substitution' // candidate PR never contained this issue's lane manifest
  | 'missing_implementation_artifacts' // candidate PR omitted declared proof artifacts
  | 'unreachable_merge_sha' // GitHub merge SHA is not reachable from current main
  | 'repair_required_via_pr'; // --repair-merged produced tracked changes while cwd is on `main` (UTV2-1542)

export type CloseoutOutcome = 'closed' | 'already_closed' | 'closed_with_warnings' | 'blocked';

export interface RepairMergedPrInfo {
  url: string;
  number?: number;
  repository?: string;
  state: string | null;
  merged: boolean;
  mergeSha: string | null;
  headRefName?: string | null;
  title?: string | null;
  files?: string[];
}

export interface RepairMergedManifestResult {
  ok: boolean;
  code: CloseoutFailureCode | 'already_closed' | 'already_repaired' | 'repaired';
  outcome: CloseoutOutcome | 'already_repaired' | 'repaired';
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
    case 'untrusted_invocation':
      return 'Explicit post-merge PR binding is restricted to the trusted Post-Merge Lane Close workflow on main.';
    case 'explicit_pr_requires_repair':
      return 'The --pr option is valid only together with --repair-merged.';
    case 'pr_not_found':
      return 'The supplied pull request could not be resolved in griff843/Unit-Talk-v2.';
    case 'wrong_repository':
      return 'The supplied pull request must belong to exactly griff843/Unit-Talk-v2.';
    case 'issue_identity_mismatch':
      return 'The supplied pull request branch and title do not match this issue lane.';
    case 'conflicting_pr_binding':
      return 'The manifest already records a different authoritative pull request.';
    case 'repair_pr_substitution':
      return 'The supplied pull request did not contain this issue lane manifest and cannot substitute for the implementation PR.';
    case 'missing_implementation_artifacts':
      return 'The supplied pull request omitted one or more proof artifacts declared by the lane manifest.';
    case 'unreachable_merge_sha':
      return 'GitHub reports a merge SHA that is not reachable from current origin/main.';
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
const TRUSTED_POST_MERGE_REPOSITORY = 'griff843/Unit-Talk-v2';

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

export interface TrustedPostMergeRepairValidation {
  ok: boolean;
  code: 'trusted_pr_validated' | CloseoutFailureCode;
  remediation: string;
  pr: RepairMergedPrInfo | null;
}

/**
 * Validates an explicit historical implementation PR before any tracked lane
 * state is changed. The caller passes the result of
 * isTrustedPostMergeAutomation(), rather than a raw CLI flag, so merely adding
 * --post-merge-trusted can never grant this capability.
 */
export function validateTrustedPostMergeRepair(
  manifest: LaneManifest,
  prInput: string,
  options: {
    repairMerged: boolean;
    trustedPostMerge: boolean;
    fetchPr?: (pr: string) => RepairMergedPrInfo;
    isMergeReachable?: (mergeSha: string) => boolean;
  },
): TrustedPostMergeRepairValidation {
  const blocked = (
    code: CloseoutFailureCode,
    pr: RepairMergedPrInfo | null = null,
  ): TrustedPostMergeRepairValidation => ({
    ok: false,
    code,
    remediation: remediationForCode(code),
    pr,
  });

  if (!options.repairMerged) {
    return blocked('explicit_pr_requires_repair');
  }
  if (!options.trustedPostMerge) {
    return blocked('untrusted_invocation');
  }

  const supplied = parsePrReference(prInput);
  if (!supplied) {
    return blocked('pr_not_found');
  }
  if (supplied.repository !== TRUSTED_POST_MERGE_REPOSITORY) {
    return blocked('wrong_repository');
  }

  if (manifest.pr_url) {
    const existing = parsePrReference(manifest.pr_url);
    if (
      !existing ||
      existing.repository !== supplied.repository ||
      existing.number !== supplied.number
    ) {
      return blocked('conflicting_pr_binding');
    }
  }

  let pr: RepairMergedPrInfo;
  try {
    pr = (options.fetchPr ?? fetchTrustedMergedPrInfo)(prInput);
  } catch {
    return blocked('pr_not_found');
  }

  const resolved = parsePrReference(pr.url);
  const resolvedRepository = pr.repository ?? resolved?.repository ?? '';
  const resolvedNumber = pr.number ?? resolved?.number ?? null;
  if (
    resolvedRepository !== TRUSTED_POST_MERGE_REPOSITORY ||
    resolvedNumber !== supplied.number
  ) {
    return blocked('wrong_repository', pr);
  }
  if (!pr.merged) {
    return blocked('pr_not_merged', pr);
  }
  if (!pr.mergeSha) {
    return blocked('missing_merge_sha', pr);
  }

  const issuePattern = new RegExp(`(^|[^A-Z0-9])${escapeRegExp(manifest.issue_id)}([^A-Z0-9]|$)`, 'iu');
  if (
    pr.headRefName !== manifest.branch ||
    !issuePattern.test(pr.title ?? '')
  ) {
    return blocked('issue_identity_mismatch', pr);
  }

  const files = pr.files ?? [];
  const manifestPath = `docs/06_status/lanes/${manifest.issue_id}.json`;
  if (!files.includes(manifestPath)) {
    return blocked('repair_pr_substitution', pr);
  }
  if (manifest.expected_proof_paths.some((proofPath) => !files.includes(proofPath))) {
    return blocked('missing_implementation_artifacts', pr);
  }
  if (manifest.commit_sha && manifest.commit_sha !== pr.mergeSha) {
    return blocked('pr_sha_mismatch', pr);
  }

  const reachable = options.isMergeReachable ?? isMergeShaReachableFromMain;
  if (!reachable(pr.mergeSha)) {
    return blocked('unreachable_merge_sha', pr);
  }

  return {
    ok: true,
    code: 'trusted_pr_validated',
    remediation: '',
    pr,
  };
}

export function repairMergedLaneManifest(
  manifest: LaneManifest,
  options: {
    fetchPr?: (prUrl: string) => RepairMergedPrInfo;
    validatedPr?: RepairMergedPrInfo;
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

  if (!manifest.pr_url && !options.validatedPr) {
    return repairBlocked(manifest, 'infra_error', 'Manifest has no pr_url to repair from.');
  }

  const pr = options.validatedPr ?? (options.fetchPr ?? fetchMergedPrInfo)(manifest.pr_url ?? '');
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
    files_changed: options.validatedPr?.files ?? manifest.files_changed,
    heartbeat_at: now,
    truth_check_history: manifest.truth_check_history ?? [],
  };
  const changedFields: string[] = [];
  recordChanged(changedFields, manifest.status, next.status, 'status');
  recordChanged(changedFields, manifest.commit_sha, next.commit_sha, 'commit_sha');
  recordChanged(changedFields, manifest.pr_url, next.pr_url, 'pr_url');
  if (!arraysEqual(manifest.files_changed, next.files_changed)) {
    changedFields.push('files_changed');
  }

  // repairPreflightToken() re-derives its `changed` flag from whether its own
  // validation threw, not from whether the persisted value actually differs
  // -- a manifest already resting at the REPAIR_PREFLIGHT_TOKEN sentinel
  // ('dispatch-auto', which never passes requireExistingFile validation)
  // reports `changed: true` on every single call even though
  // next.preflight_token ends up exactly where it started. Comparing values
  // directly is what actually determines whether this field changed
  // (UTV2-1564).
  const previousPreflightToken = manifest.preflight_token;
  const preflightRepair = repairPreflightToken(next, options.repoRoot ?? process.cwd());
  if (preflightRepair.changed && next.preflight_token !== previousPreflightToken) {
    changedFields.push('preflight_token');
  }

  // UTV2-1564: a genuine no-op re-run (e.g. post-merge-lane-close.yml's CI
  // auto-closer re-triggering --repair-merged against a manifest that was
  // already correctly repaired) must not append another truth_check_history
  // entry. Every prior call unconditionally appended one below regardless of
  // whether status/commit_sha/pr_url/preflight_token actually changed, which
  // permanently tripped guardRepairAgainstMainCheckout's tracked-file-change
  // detection on every subsequent call -- once a manifest was correctly
  // repaired, every future automated repair attempt (including harmless
  // no-op ones) hit the same main-checkout block forever. If nothing above
  // actually changed, skip the append and return the manifest exactly as it
  // already was -- a true no-op, matching the `status === 'done'` early
  // return above.
  if (changedFields.length === 0) {
    return {
      ok: true,
      code: 'already_repaired',
      outcome: 'already_repaired',
      manifest,
      artifact_path: null,
      changed_fields: [],
      remediation: 'Manifest already reflects this PR\'s authoritative merge state; repair mode made no changes.',
      pr,
    };
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
 * Post-merge automation initially sees the repair PR's merge SHA, but
 * --repair-merged resolves the implementation PR recorded in manifest.pr_url.
 * Rebind proof to that authoritative implementation SHA before truth-check so
 * manifest and proof cannot diverge when a historical lane is repaired.
 */
export function rebindRepairedLaneProof(
  manifest: LaneManifest,
  options: { repoRoot?: string; now?: Date } = {},
): ShaRebindOutcome[] {
  return rebindMergeSha(
    options.repoRoot ?? process.cwd(),
    manifest.issue_id,
    manifest.commit_sha,
    (options.now ?? new Date()).toISOString(),
    manifest.pr_url,
  );
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
 * Repository this trusted post-merge capability is bound to. Hard-coded (not
 * read from GITHUB_REPOSITORY alone as the sole check) so a forked/renamed
 * repo context can never satisfy the trusted-context check by accident.
 */
/**
 * GITHUB_WORKFLOW_REF identifies the exact workflow *file* that is executing
 * (e.g. `griff843/Unit-Talk-v2/.github/workflows/post-merge-lane-close.yml@refs/heads/main`),
 * unlike GITHUB_WORKFLOW (the human-readable `name:` field, which any workflow
 * file could reuse). Matching on the file path is what makes this identity
 * check meaningful rather than cosmetic.
 */
const TRUSTED_POST_MERGE_WORKFLOW_REF_PATTERN =
  /(^|\/)\.github\/workflows\/post-merge-lane-close\.yml@refs\/heads\/main$/;

/**
 * UTV2-1576: the post-merge closeout persistence contradiction proven by PR
 * #1296 workflow run 30002061214 -- `guardRepairAgainstMainCheckout` fires
 * against *any* checkout literally on the `main` branch, which is exactly
 * what `actions/checkout@v4` leaves post-merge-lane-close.yml standing on
 * (GitHub Actions checks out a real local branch named `main` for a `push`
 * trigger, not a detached HEAD), so the workflow this guard exists to let
 * operate safely on `main` was itself always blocked by it.
 *
 * This function decides whether the CURRENT invocation is that one, specific,
 * trusted automation context -- never by actor identity (spoofable/varies
 * between push and workflow_dispatch), always by the conjunction of every
 * marker GitHub sets for that exact workflow file running against that exact
 * repo and ref, PLUS the caller having explicitly opted in via CLI flag. Any
 * single missing marker fails closed to "not trusted", including the flag
 * being passed alone with no matching environment, or the environment being
 * complete with no flag passed.
 */
export function isTrustedPostMergeAutomation(
  env: Record<string, string | undefined>,
  flags: { postMergeTrusted: boolean },
): boolean {
  if (!flags.postMergeTrusted) return false;
  if (env.GITHUB_ACTIONS !== 'true') return false;
  if (env.GITHUB_REPOSITORY !== TRUSTED_POST_MERGE_REPOSITORY) return false;
  if (env.GITHUB_REF !== 'refs/heads/main') return false;
  if (!TRUSTED_POST_MERGE_WORKFLOW_REF_PATTERN.test(env.GITHUB_WORKFLOW_REF ?? '')) return false;
  return true;
}

/**
 * Returns a blocking `repair_required_via_pr` result when `--repair-merged`
 * produced real tracked-file changes AND the caller is standing in a checkout on
 * `main` -- the exact shared-checkout condition that produced UTV2-1542. Returns
 * `null` (proceed as normal) for every other case: no changes to repair, the lane
 * was already closed, the caller is in a dedicated lane worktree/branch (always
 * safe to write to directly since landing it still requires a PR merge), or the
 * caller is the one trusted post-merge automation context (UTV2-1576) -- verified
 * by `isTrustedPostMergeAutomation`, never by this function itself, so this
 * function never reads process.env directly.
 */
export function guardRepairAgainstMainCheckout(
  repair: RepairMergedManifestResult,
  options: {
    currentBranch: string;
    repoRoot: string;
    artifactRoot?: string;
    trustedPostMerge?: boolean;
  },
): RepairRequiredViaPrResult | null {
  if (!repair.ok || repair.code !== 'repaired' || repair.changed_fields.length === 0) {
    return null;
  }
  if (options.currentBranch !== 'main') {
    return null;
  }
  if (options.trustedPostMerge === true) {
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

export interface RepairRollbackTransaction {
  rollback: () => void;
  commit: () => void;
}

interface FileSnapshot {
  path: string;
  contents: Buffer | null;
}

/**
 * Snapshots every local persistence surface changed by trusted repair:
 * manifest, proof, sync registration, lease, and merge mutex. Restoring this
 * snapshot prevents a failed closeout from leaving only pr_url/commit_sha (or
 * partially rebound proof/cleanup state) persisted.
 */
export function createRepairRollbackTransaction(
  issueId: string,
  repoRoot = process.cwd(),
): RepairRollbackTransaction {
  const manifestPath = path.join(repoRoot, 'docs', '06_status', 'lanes', `${issueId}.json`);
  const proofDir = path.join(repoRoot, 'docs', '06_status', 'proof', issueId);
  const fileSnapshots: FileSnapshot[] = [
    snapshotFile(manifestPath),
    snapshotFile(path.join(repoRoot, '.ops', 'sync', `${issueId}.yml`)),
    snapshotFile(leasePathForIssue(issueId, path.join(repoRoot, '.ops', 'leases'))),
    snapshotFile(path.join(repoRoot, '.ops', path.basename(MERGE_LOCK_PATH))),
  ];
  const proofFiles = snapshotDirectory(proofDir);
  let active = true;

  return {
    rollback: () => {
      if (!active) return;
      for (const snapshot of fileSnapshots) {
        restoreFile(snapshot);
      }
      fs.rmSync(proofDir, { recursive: true, force: true });
      for (const [relativePath, contents] of proofFiles) {
        const destination = path.join(proofDir, relativePath);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, contents);
      }
      active = false;
    },
    commit: () => {
      active = false;
    },
  };
}

export type LaneWorktreeCleanup = 'not_requested' | 'already_absent' | 'removed';

export interface SuccessfulLaneCloseResult {
  manifest: LaneManifest;
  warnings: string[];
  sync_removed: boolean;
  worktree_cleanup: LaneWorktreeCleanup;
}

/**
 * Completes the terminal closeout sequence after a passing truth-check. The
 * injected operations keep the full success path testable without contacting
 * Linear or mutating the developer's real lease/worktree state.
 */
export async function completeSuccessfulLaneClose(
  issueId: string,
  manifestBeforeClose: LaneManifest,
  authorizedTruthCheck: TruthCheckResult,
  options: {
    trustedBindingRepair?: boolean;
    repoRoot?: string;
    finalizeManifest?: (issue: string, result: TruthCheckResult) => LaneManifest;
    transitionLinear?: (issue: string) => Promise<void>;
    releaseLocks?: (issue: string, branch: string) => { warnings: string[] };
    cleanupWorktree?: (manifest: LaneManifest) => Exclude<LaneWorktreeCleanup, 'not_requested'>;
  } = {},
): Promise<SuccessfulLaneCloseResult> {
  const manifest = (options.finalizeManifest ?? finalizeLaneCloseManifest)(
    issueId,
    authorizedTruthCheck,
  );
  await (options.transitionLinear ?? transitionLinearIssueToDone)(issueId);

  let syncRemoved = false;
  let worktreeCleanup: LaneWorktreeCleanup = 'not_requested';
  if (options.trustedBindingRepair) {
    const syncPath = path.join(
      options.repoRoot ?? process.cwd(),
      '.ops',
      'sync',
      `${issueId}.yml`,
    );
    syncRemoved = fs.existsSync(syncPath);
    fs.rmSync(syncPath, { force: true });
  }

  const closeoutLocks = (options.releaseLocks ?? releaseCloseoutLocks)(
    issueId,
    manifestBeforeClose.branch,
  );

  // Worktree removal is deliberately last: every earlier fallible local
  // mutation can be restored by RepairRollbackTransaction. Once a clean,
  // non-current worktree is removed there are no later fallible operations.
  if (options.trustedBindingRepair) {
    worktreeCleanup = (options.cleanupWorktree ?? cleanupClosedLaneWorktree)(manifest);
  }

  return {
    manifest,
    warnings: closeoutLocks.warnings,
    sync_removed: syncRemoved,
    worktree_cleanup: worktreeCleanup,
  };
}

/**
 * Removes only the exact clean worktree recorded by the terminal manifest.
 * Hosted post-merge runners normally see the original machine path as absent,
 * which is already a clean state on that runner. Dirty, unregistered, or
 * current worktrees fail closed instead of being deleted.
 */
export function cleanupClosedLaneWorktree(
  manifest: LaneManifest,
): Exclude<LaneWorktreeCleanup, 'not_requested'> {
  const target = path.resolve(manifest.worktree_path);
  if (!fs.existsSync(target)) {
    return 'already_absent';
  }

  const current = fs.realpathSync(process.cwd());
  const resolvedTarget = fs.realpathSync(target);
  if (current === resolvedTarget) {
    throw new Error(`Refusing to remove current lane worktree: ${target}`);
  }

  const worktrees = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const registered = worktrees
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('worktree '))
    .some((line) => path.resolve(line.slice('worktree '.length).trim()) === target);
  if (!registered) {
    throw new Error(`Refusing to remove unregistered lane worktree path: ${target}`);
  }

  const dirty = execFileSync('git', ['-C', target, 'status', '--porcelain=v1'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (dirty) {
    throw new Error(`Refusing to remove dirty lane worktree: ${target}`);
  }

  execFileSync('git', ['worktree', 'remove', target], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return 'removed';
}

async function main(): Promise<void> {
  const { positionals, flags, bools } = parseArgs(process.argv.slice(2));
  const issueId = requireIssueId(positionals[0] ?? '');
  const explicitPr = flags.get('pr')?.at(-1)?.trim() ?? '';
  let transaction: RepairRollbackTransaction | null = null;

  try {
    let manifest = readManifest(issueId);
    const repairMerged = bools.has('repair-merged');
    const trustedPostMerge = isTrustedPostMergeAutomation(process.env, {
      postMergeTrusted: bools.has('post-merge-trusted'),
    });

    if (explicitPr && !repairMerged) {
      emitJson({
        ok: false,
        code: 'explicit_pr_requires_repair' as CloseoutFailureCode,
        outcome: 'blocked' satisfies CloseoutOutcome,
        remediation: remediationForCode('explicit_pr_requires_repair'),
        issue_id: issueId,
      });
      process.exit(1);
    }

    let validatedPr: RepairMergedPrInfo | undefined;
    if (explicitPr) {
      const validation = validateTrustedPostMergeRepair(manifest, explicitPr, {
        repairMerged,
        trustedPostMerge,
      });
      if (!validation.ok || !validation.pr) {
        emitJson({
          ok: false,
          code: validation.code,
          outcome: 'blocked' satisfies CloseoutOutcome,
          remediation: validation.remediation,
          issue_id: issueId,
          pr: validation.pr,
        });
        process.exit(1);
      }
      validatedPr = validation.pr;
    }

    // Snapshot before auto-acquiring the merge mutex. If any later repair step
    // fails, rollback must restore the caller's pre-invocation coordination
    // state rather than preserve a mutex acquired only for this failed run.
    if (repairMerged) {
      transaction = createRepairRollbackTransaction(issueId);
    }

    const lock = ensureCloseoutMergeLock(manifest, {
      acquireLock: !bools.has('no-acquire-lock'),
    });
    if (!lock.ok) {
      transaction?.rollback();
      transaction = null;
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

    if (repairMerged) {
      const repair = repairMergedLaneManifest(manifest, {
        releaseLocksIfAlreadyDone: true,
        validatedPr,
      });
      if (!repair.ok) {
        transaction.rollback();
        transaction = null;
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
        let worktreeCleanup: LaneWorktreeCleanup = 'not_requested';
        let syncRemoved = false;
        if (validatedPr) {
          const syncPath = path.join(process.cwd(), '.ops', 'sync', `${issueId}.yml`);
          syncRemoved = fs.existsSync(syncPath);
          fs.rmSync(syncPath, { force: true });
          worktreeCleanup = cleanupClosedLaneWorktree(manifest);
        }
        transaction.commit();
        transaction = null;
        emitJson({
          ok: true,
          code: 'lane_closed' as CloseoutFailureCode,
          outcome: 'already_closed' satisfies CloseoutOutcome,
          issue_id: issueId,
          status: manifest.status,
          remediation: repair.remediation,
          sync_removed: syncRemoved,
          worktree_cleanup: worktreeCleanup,
        });
        process.exit(0);
      }

      // UTV2-1542: refuse to write repaired tracked-file changes directly into a
      // checkout on `main` -- that shared-checkout condition is exactly how the
      // third direct-main-push incident happened. Emit a repair packet + governed
      // branch/PR steps instead of leaving an ordinary commit-ready working tree.
      //
      // UTV2-1576: except for the one trusted post-merge automation context this
      // guard was always meant to permit -- see isTrustedPostMergeAutomation().
      const currentBranchResult = git(['rev-parse', '--abbrev-ref', 'HEAD']);
      const guard = guardRepairAgainstMainCheckout(repair, {
        currentBranch: currentBranchResult.ok ? currentBranchResult.stdout : '',
        repoRoot: process.cwd(),
        trustedPostMerge,
      });
      if (guard) {
        transaction.rollback();
        transaction = null;
        emitJson(guard);
        process.exit(1);
      }

      writeManifest(repair.manifest);
      manifest = repair.manifest;
      rebindRepairedLaneProof(manifest);
    }

    requireCloseCommitSha(manifest);

    const result = await runTruthCheck({
      issueId,
      json: true,
      explain: bools.has('explain'),
      runner: 'ops:lane-close',
    });

    if (result.exit_code !== 0) {
      transaction?.rollback();
      transaction = null;
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

    const completion = await completeSuccessfulLaneClose(
      issueId,
      manifest,
      result,
      { trustedBindingRepair: Boolean(validatedPr) },
    );
    manifest = completion.manifest;
    const outcome: CloseoutOutcome =
      completion.warnings.length > 0 ? 'closed_with_warnings' : 'closed';
    transaction?.commit();
    transaction = null;

    emitJson({
      ok: true,
      code: 'lane_closed' as CloseoutFailureCode,
      outcome,
      issue_id: issueId,
      status: manifest.status,
      closed_at: manifest.closed_at,
      warnings: completion.warnings,
      sync_removed: completion.sync_removed,
      worktree_cleanup: completion.worktree_cleanup,
      truth_check: result,
    });
  } catch (error) {
    transaction?.rollback();
    transaction = null;
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

function snapshotDirectory(directory: string): Map<string, Buffer> {
  const snapshot = new Map<string, Buffer>();
  if (!fs.existsSync(directory)) return snapshot;

  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile()) {
        snapshot.set(path.relative(directory, absolute), fs.readFileSync(absolute));
      }
    }
  };
  visit(directory);
  return snapshot;
}

function snapshotFile(filePath: string): FileSnapshot {
  return {
    path: filePath,
    contents: fs.existsSync(filePath) ? fs.readFileSync(filePath) : null,
  };
}

function restoreFile(snapshot: FileSnapshot): void {
  if (snapshot.contents === null) {
    fs.rmSync(snapshot.path, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(snapshot.path), { recursive: true });
  fs.writeFileSync(snapshot.path, snapshot.contents);
}

function fetchMergedPrInfo(prUrl: string): RepairMergedPrInfo {
  return fetchPrInfo(prUrl, false);
}

function fetchTrustedMergedPrInfo(prUrl: string): RepairMergedPrInfo {
  return fetchPrInfo(prUrl, true);
}

function fetchPrInfo(prUrl: string, includeFiles: boolean): RepairMergedPrInfo {
  const reference = parsePrReference(prUrl);
  if (!reference || reference.repository !== TRUSTED_POST_MERGE_REPOSITORY) {
    throw new Error(`Invalid pull request reference: ${prUrl}`);
  }
  const selector = String(reference.number);
  const stdout = execFileSync(
    'gh',
    [
      'pr',
      'view',
      selector,
      '--repo',
      TRUSTED_POST_MERGE_REPOSITORY,
      '--json',
      'url,state,mergedAt,mergeCommit,headRefName,title',
    ],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const filesStdout = includeFiles
    ? execFileSync(
        'gh',
        [
          'api',
          '--paginate',
          `repos/${TRUSTED_POST_MERGE_REPOSITORY}/pulls/${selector}/files`,
          '--jq',
          '.[].filename',
        ],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
    : '';
  const parsed = JSON.parse(stdout) as {
    url?: string;
    state?: string | null;
    mergedAt?: string | null;
    mergeCommit?: { oid?: string | null } | null;
    headRefName?: string | null;
    title?: string | null;
  };
  const state = parsed.state?.toLowerCase() ?? null;
  return {
    url: parsed.url ?? prUrl,
    number: reference.number,
    repository: reference.repository,
    state,
    merged: state === 'merged' || Boolean(parsed.mergedAt),
    mergeSha: parsed.mergeCommit?.oid ?? null,
    headRefName: parsed.headRefName ?? null,
    title: parsed.title ?? null,
    ...(includeFiles
      ? { files: filesStdout.split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean) }
      : {}),
  };
}

function parsePrReference(
  input: string,
): { repository: string; number: number } | null {
  const value = input.trim();
  const numeric = value.match(/^#?(\d+)$/u);
  if (numeric) {
    return {
      repository: TRUSTED_POST_MERGE_REPOSITORY,
      number: Number(numeric[1]),
    };
  }

  const url = value.match(
    /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)(?:[/?#].*)?$/iu,
  );
  if (!url) return null;
  return {
    repository: url[1] ?? '',
    number: Number(url[2]),
  };
}

function isMergeShaReachableFromMain(mergeSha: string): boolean {
  const result = git(['merge-base', '--is-ancestor', mergeSha, 'origin/main']);
  return result.ok;
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
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
