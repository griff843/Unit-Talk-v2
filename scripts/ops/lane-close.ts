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
  SUCCESS_TERMINAL_STATUSES,
} from './shared.js';
import { runTruthCheck } from './truth-check-lib.js';
import {
  ModelRoutingRebindError,
  rebindMergeSha,
  rebindModelRoutingJsonSha,
  safeRepoPath,
  type ShaRebindOutcome,
} from './proof-generate.js';
import {
  buildMergedPrAttestation,
  rebindProofBundle,
  validatePrIdentity,
  type ShaSet,
} from './proof-rebind.js';
import {
  acquireMergeLock,
  defaultMergeLockOwner,
  MERGE_LOCK_PATH,
  reclaimMergeLock,
  releaseMergeLock,
  requireMergeLockHeld,
  type MergeLockResult,
} from './merge-mutex.js';
import {
  beginTerminalLeaseRelease,
  CONTROL_CHECKOUT_ROOT,
  LEASE_REGISTRY_DIR,
  leasePathForIssue,
  releaseLease,
  type TerminalLeaseReleaseTransaction,
} from './lease-registry.js';
import {
  assertCanonicalRunner,
  buildRepairPacket,
  hashState,
  isMeasuredPass,
  measuredTruthCheckReceipt,
  truthHistoryEntryForMeasuredReceipt,
  unexecutedTruthCheckReceipt,
  writeRepairPacket,
  type LaneCloseRepairPacket,
  type MeasuredTruthCheckReceipt,
  type MergeBindingInference,
  isCanonicalRunner,
} from './lane-close-repair-packet.js';
import { PR_BASE_MISMATCH_BLOCKER } from './lane-link-pr.js';

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
  | 'pr_base_mismatch' // PR base branch disagrees with the lane manifest
  | 'conflicting_pr_binding' // manifest already points at a different PR
  | 'repair_pr_substitution' // candidate PR never contained this issue's lane manifest
  | 'missing_implementation_artifacts' // candidate PR omitted declared proof artifacts
  | 'unreachable_merge_sha' // GitHub merge SHA is not reachable from current main
  | 'repair_required_via_pr' // --repair-merged produced tracked changes while cwd is on `main` (UTV2-1542)
  | 'model_routing_rebind_failed' // required model-routing.json sidecar rebind failed (UTV2-1589)
  | 'merge_lock_reap_failed'; // an orphaned-pid merge lock for this lane could not be reclaimed (UTV2-1613)

export type CloseoutOutcome = 'closed' | 'already_closed' | 'closed_with_warnings' | 'blocked';

export interface RepairMergedPrInfo {
  url: string;
  number?: number;
  repository?: string;
  state: string | null;
  merged: boolean;
  mergeSha: string | null;
  headSha?: string | null;
  headRefName?: string | null;
  baseRefName?: string | null;
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
  /**
   * The INFERRED merge binding (UTV2-1613 separation of concerns). Present
   * only when a real, merged, identity-checked PR was resolved. Deliberately
   * carries no verdict field: this is a statement about GitHub, never about
   * whether the lane passes.
   */
  merge_binding?: MergeBindingInference | null;
  /**
   * The manifest exactly as it was before repair. Carried on the result so a
   * repair packet can record what its proposal was computed *from* without
   * every caller having to thread a second copy through -- that input hash is
   * what makes stale application detectable at apply time.
   */
  input_manifest?: LaneManifest;
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
    case 'pr_base_mismatch':
      return 'The pull request base branch does not match manifest.base_branch, or the lane carries the pr-base-mismatch blocker. Repair refused; restore the intended base and re-establish the governed PR binding.';
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
    case 'model_routing_rebind_failed':
      return 'A required model-routing.json sidecar could not be bound to the authoritative merge SHA/PR ' +
        '(missing, malformed, wrong lane identity, or conflicting prior binding). No proof or manifest state was ' +
        'left partially bound -- see model_routing_error_code and proof_path for the specific cause.';
    case 'merge_lock_reap_failed':
      return 'This lane holds a merge lock whose owning process is gone (orphaned PID), but the lock could not be ' +
        'reclaimed. Inspect .ops/merge-lock.json and run `pnpm ops:merge-lock reclaim` explicitly.';
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
export type TruthCheckAuthorization = 'authorized' | 'already_closed' | 'drift';

/**
 * Distinguishes the three states the persisted history can be in relative to
 * the passing result that authorized this close. Before UTV2-1613 only two
 * were modelled -- "matches" and "everything else" -- and the second silently
 * absorbed a benign case as if it were a concurrency incident.
 *
 * The benign case is re-closing an already-`done` lane.
 * `truth-check-lib.ts`'s `finalizeWithManifest()` deliberately refuses to
 * append history to a `done` manifest (UTV2-1224: done lanes are immutable
 * except for explicit reopen events). So on a re-close the fresh in-run
 * truth-check passes but writes nothing, leaving the persisted latest entry as
 * the *original* close's entry -- a different `checked_at` by construction. A
 * timestamp comparison alone therefore reports `truth_check_drift` on every
 * single re-close, forever, even though both entries are passes on the same
 * merge SHA and nothing concurrent happened at all. That made `ops:lane-close`
 * non-idempotent and buried the signal a real drift would carry.
 *
 * `already_closed` is that case, recognised narrowly: the manifest is already
 * terminal, its latest persisted entry is a pass, and that pass is bound to
 * the same merge SHA the fresh run just evaluated. Anything weaker (no
 * history, a failing latest entry, a different merge SHA) is still `drift` --
 * this widens nothing about what counts as a pass, it only stops
 * misclassifying a no-op as an incident.
 */
export function classifyTruthCheckAuthorization(
  manifest: LaneManifest,
  authorizedTruthCheck: TruthCheckResult,
): TruthCheckAuthorization {
  const history = manifest.truth_check_history ?? [];
  const latest = history[history.length - 1];
  if (latest === undefined || latest.verdict !== 'pass') {
    return 'drift';
  }
  if (
    latest.checked_at === authorizedTruthCheck.checked_at &&
    latest.merge_sha === authorizedTruthCheck.merge_sha
  ) {
    return 'authorized';
  }
  if (manifest.status === 'done' && latest.merge_sha === authorizedTruthCheck.merge_sha) {
    return 'already_closed';
  }
  return 'drift';
}

export function finalizeLaneCloseManifest(
  issueId: string,
  authorizedTruthCheck: TruthCheckResult,
): LaneManifest {
  const manifest = readManifest(issueId);
  const history = manifest.truth_check_history ?? [];
  const latest = history[history.length - 1];
  const authorization = classifyTruthCheckAuthorization(manifest, authorizedTruthCheck);

  // Criterion 5: every recorded history entry must use the canonical runner
  // union, enforced at the moment a manifest is about to be made terminal
  // rather than only where entries are written. The defective repair path
  // reached this exact point with a `runner: 'ops:lane-close --repair-merged'`
  // entry sitting at the head of the history and nothing objected.
  if (latest !== undefined) {
    assertCanonicalRunner(latest.runner);
  }

  if (authorization === 'drift') {
    throw new TruthCheckDriftError(
      `Refusing to close ${issueId}: manifest's latest truth-check ` +
        `(${latest ? `${latest.verdict} at ${latest.checked_at}, merge_sha ${latest.merge_sha}` : 'none'}) ` +
        `no longer matches the passing result that authorized this close ` +
        `(pass at ${authorizedTruthCheck.checked_at}, merge_sha ${authorizedTruthCheck.merge_sha}). ` +
        'A concurrent truth-check run must have changed, failed, or advanced it since authorization.',
    );
  }

  if (authorization === 'already_closed') {
    // Idempotent re-close: the terminal manifest is already correct and its
    // history is immutable by design. Refresh nothing except the heartbeat --
    // in particular do NOT overwrite closed_at, which records when the lane
    // actually closed, not when someone re-ran the closer.
    manifest.heartbeat_at = new Date().toISOString();
    writeManifest(manifest);
    return manifest;
  }

  manifest.status = 'done';
  manifest.closed_at = new Date().toISOString();
  manifest.heartbeat_at = manifest.closed_at;
  writeManifest(manifest);
  return manifest;
}

function controlMergeLockPath(): string {
  return path.join(CONTROL_CHECKOUT_ROOT, '.ops', path.basename(MERGE_LOCK_PATH));
}

export function releaseCloseoutLocks(
  issueId: string,
  branch: string,
  options: {
    leaseRegistryDir?: string;
    mergeLockPath?: string;
    leaseAlreadyReleased?: boolean;
    /**
     * Set when a CALLER already holds the control-checkout merge mutex and this
     * cleanup runs inside it. Releasing the mutex here would free the parent's
     * serialization slot mid-transaction and let another lane mutate
     * coordination state concurrently.
     */
    preserveMergeLock?: boolean;
  } = {},
): { warnings: string[] } {
  const warnings: string[] = [];
  if (!options.leaseAlreadyReleased) {
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
  }

  if (options.preserveMergeLock) {
    warnings.push('merge lock preserved: released by the caller that acquired it');
    return { warnings };
  }

  const mergeLock = releaseMergeLock({
    issue_id: issueId,
    branch,
  }, { lockPath: options.mergeLockPath ?? controlMergeLockPath() });
  // `merge_lock_owner_mismatch` means the live lock belongs to a DIFFERENT
  // lane. There is nothing of ours to release, and releasing it anyway would
  // steal another lane's serialization slot -- so it is neither an error nor
  // an action, just a warning (UTV2-1613). Throwing here used to make an
  // otherwise-successful closeout fail *after* the manifest was already
  // terminal, which is the worst possible place to fail.
  if (
    !mergeLock.ok &&
    mergeLock.code !== 'merge_lock_missing' &&
    mergeLock.code !== 'merge_lock_owner_mismatch'
  ) {
    throw new Error(`Failed to release merge lock: ${mergeLock.code} ${mergeLock.message}`);
  }
  if (!mergeLock.ok) {
    warnings.push(
      mergeLock.code === 'merge_lock_owner_mismatch'
        ? `merge lock is held by another lane; left untouched: ${mergeLock.message}`
        : `merge lock already released or missing: ${mergeLock.message}`,
    );
  }

  return { warnings };
}

export interface TrustedPostMergeRepairValidation {
  ok: boolean;
  code: 'trusted_pr_validated' | CloseoutFailureCode;
  remediation: string;
  pr: RepairMergedPrInfo | null;
}

export function implementationFilesFromTrustedRepair(
  manifest: LaneManifest,
  files: string[],
): string[] {
  const controlPlanePaths = new Set([
    `docs/06_status/lanes/${manifest.issue_id}.json`,
    `.ops/sync/${manifest.issue_id}.yml`,
  ]);
  return files.filter((file) => !controlPlanePaths.has(file));
}

function fileScopeLockEntryMatches(lockEntry: string, file: string): boolean {
  if (lockEntry.endsWith('/**')) {
    return file.startsWith(lockEntry.slice(0, -2));
  }
  return lockEntry === file;
}

/**
 * Confirms a candidate repair PR's file list contains at least one file
 * belonging to the lane's own declared file_scope_lock, outside that lane's
 * own proof directory. A forged PR that only ever contains the lane manifest
 * plus every declared proof artifact (see the manifestPath/expected_proof_paths
 * checks above) would otherwise pass validation with zero real implementation
 * content -- this closes that gap.
 */
function hasDeclaredImplementationFile(manifest: LaneManifest, files: string[]): boolean {
  const proofDirPrefix = `docs/06_status/proof/${manifest.issue_id}/`;
  const candidateFiles = implementationFilesFromTrustedRepair(manifest, files).filter(
    (file) => !file.startsWith(proofDirPrefix),
  );
  if (candidateFiles.length === 0) {
    return false;
  }
  const scopeEntries = (manifest.file_scope_lock ?? []).filter(
    (entry) => !entry.startsWith(proofDirPrefix),
  );
  if (scopeEntries.length === 0) {
    // Nothing outside the proof directory was ever declared in scope (a
    // pure docs/proof lane) -- there is no implementation-file invariant to
    // check beyond what the manifest/proof checks above already enforce.
    return true;
  }
  return candidateFiles.some((file) =>
    scopeEntries.some((entry) => fileScopeLockEntryMatches(entry, file)),
  );
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

  // The inferred-PR path refuses a base-branch mismatch before it binds. This
  // path must refuse it too: `blocked_by` only carries a marker left by a
  // PREVIOUS lane-link-pr run, so it says nothing about the base of the
  // candidate PR being bound here. Without this, an explicit --pr can bind a
  // manifest to a PR merged against the wrong base.
  if (pr.baseRefName !== manifest.base_branch) {
    return blocked('pr_base_mismatch', pr);
  }

  const files = pr.files ?? [];
  const manifestPath = `docs/06_status/lanes/${manifest.issue_id}.json`;
  if (!files.includes(manifestPath)) {
    return blocked('repair_pr_substitution', pr);
  }
  if (manifest.expected_proof_paths.some((proofPath) => !files.includes(proofPath))) {
    return blocked('missing_implementation_artifacts', pr);
  }
  // A PR can legitimately contain the lane manifest and every declared proof
  // artifact while never touching any real implementation file -- e.g. a
  // fabricated/forged PR authored purely to satisfy the two checks above.
  // Require at least one file matching the lane's own declared
  // file_scope_lock (outside its own proof directory, which is already
  // covered above) so a manifest-and-proof-only PR cannot substitute for the
  // genuine implementation PR.
  if (!hasDeclaredImplementationFile(manifest, files)) {
    return blocked('repair_pr_substitution', pr);
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
    inferMergedPrForBranch?: (branch: string, issueId: string) => RepairMergedPrInfo | null;
    isMergeReachable?: (mergeSha: string) => boolean;
    validatedPr?: RepairMergedPrInfo;
    now?: Date;
    repoRoot?: string;
    artifactRoot?: string;
    leaseRegistryDir?: string;
    mergeLockPath?: string;
    releaseLocksIfAlreadyDone?: boolean;
  } = {},
): RepairMergedManifestResult {
  const inputManifest = structuredClone(manifest);
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

  if (manifest.blocked_by.includes(PR_BASE_MISMATCH_BLOCKER)) {
    return repairBlocked(
      manifest,
      'pr_base_mismatch',
      `Manifest blocked_by contains ${PR_BASE_MISMATCH_BLOCKER}; --repair-merged must not replace a binding invalidated by a PR base-branch mismatch.`,
    );
  }

  // UTV2-1613 (ghost lanes): a manifest can be stranded in an ACTIVE status
  // with pr_url still null while its implementation PR merged days ago -- the
  // lane never got far enough to record the binding. UTV2-1553 is exactly
  // this: status `started`, pr_url null, commit_sha null, PR #1322 merged.
  // Such a manifest keeps holding its file_scope_lock against every other
  // lane, and `--repair-merged` used to refuse it outright ("no pr_url to
  // repair from"), so the only remaining fix was a hand edit -- on the very
  // machinery whose whole purpose is to make hand edits unnecessary.
  //
  // The binding is mechanically inferable without guessing: ask GitHub for
  // the MERGED pull request whose head ref is this lane's own branch. That is
  // authoritative GitHub state, identity-checked against the manifest's
  // branch, exactly like every other field this function repairs. It infers a
  // binding only -- it never implies anything about the truth-check outcome.
  let selectedBy: MergeBindingInference['selected_by'] = options.validatedPr
    ? 'explicit_pr'
    : 'manifest_pr_url';
  let inferredPr: RepairMergedPrInfo | null = null;
  if (!manifest.pr_url && !options.validatedPr) {
    inferredPr = (options.inferMergedPrForBranch ?? inferMergedPrForBranch)(
      manifest.branch,
      manifest.issue_id,
    );
    if (!inferredPr) {
      return repairBlocked(
        manifest,
        'infra_error',
        `Manifest has no pr_url, and no merged pull request was found whose head ref is "${manifest.branch}". ` +
          'Repair refused; the merge binding cannot be inferred and must not be guessed.',
      );
    }
    if (inferredPr.baseRefName !== manifest.base_branch) {
      return repairBlocked(
        manifest,
        'pr_base_mismatch',
        `Inferred PR ${inferredPr.url} targets base ${inferredPr.baseRefName ?? '(unresolved)'}, ` +
          `but manifest.base_branch is ${manifest.base_branch}. Repair refused.`,
      );
    }
    // Defense in depth on top of selectInferredMergedPr's identity check:
    // this path has no --pr flag, no isTrustedPostMergeAutomation gate, and
    // is reachable from an ordinary worktree, so it warrants the same
    // reachability check the explicit --pr path applies in
    // validateTrustedPostMergeRepair. A merge SHA GitHub calls "merged" but
    // that is not reachable from origin/main (a force-push, a since-reverted
    // merge, a cross-fork oddity) is refused rather than bound.
    const reachable = (options.isMergeReachable ?? isMergeShaReachableFromMain)(
      inferredPr.mergeSha as string,
    );
    if (!reachable) {
      return repairBlocked(
        manifest,
        'unreachable_merge_sha',
        `Inferred PR ${inferredPr.url} reports merge SHA ${inferredPr.mergeSha}, which is not reachable from origin/main. Repair refused.`,
      );
    }
    selectedBy = 'branch_merged_head';
  }

  const pr =
    options.validatedPr ??
    inferredPr ??
    (options.fetchPr ?? fetchMergedPrInfo)(manifest.pr_url ?? '');
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
    files_changed: options.validatedPr
      ? implementationFilesFromTrustedRepair(manifest, options.validatedPr.files ?? [])
      : manifest.files_changed,
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

  // UTV2-1613: NOTHING is appended to truth_check_history here.
  //
  // This is where `--repair-merged` used to synthesize
  //   { verdict: 'pass', failures: [], runner: 'ops:lane-close --repair-merged' }
  // before the canonical truth-check had run at all. That entry claimed a
  // governance outcome nobody had measured, using a runner outside the
  // canonical union, and it was written *unconditionally* -- including when the
  // proof bundle was invalid and the close was about to be refused (PR #1312 /
  // UTV2-1592). Repairing a merge binding is an inference from GitHub state; it
  // is not evidence about whether the lane's work is correct, and the two must
  // not share a record type.
  //
  // The only writer of truth_check_history on this path is now the real
  // `runTruthCheck()` call in main(), which records what it actually measured.
  // The measured receipt for this run is carried separately in the repair
  // packet's `truth_check` field -- see lane-close-repair-packet.ts.

  const mergeBinding: MergeBindingInference = {
    source: 'github_pull_request',
    repository: pr.repository ?? TRUSTED_POST_MERGE_REPOSITORY,
    pr_url: pr.url,
    pr_number: pr.number ?? null,
    head_ref: pr.headRefName ?? null,
    merge_sha: pr.mergeSha,
    inferred_at: now,
    selected_by: selectedBy,
  };

  const artifactPath = writeRepairArtifact({
    issueId: manifest.issue_id,
    artifactRoot: options.artifactRoot ?? path.join(options.repoRoot ?? process.cwd(), '.out', 'ops', 'lane-close-repair'),
    payload: {
      schema_version: 1,
      repaired_at: now,
      issue_id: manifest.issue_id,
      pr,
      merge_binding: mergeBinding,
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
    remediation:
      'Merge binding inferred from authoritative GitHub merge state and proposed for the manifest. ' +
      'This records NO truth-check outcome; the canonical truth-check still runs, and only its measured ' +
      'result can close the lane.',
    pr,
    merge_binding: mergeBinding,
    input_manifest: inputManifest,
  };
}

/**
 * Resolves the merged pull request whose head ref is exactly this lane's
 * branch. Returns null when there is no such PR, when more than one merged PR
 * shares the head ref (ambiguous authority must never be resolved by picking
 * one), or when the resolved PR fails the same issue-identity check the
 * trusted path applies.
 */
/**
 * Selects the one merged PR authoritatively backing this ghost lane.
 *
 * UTV2-1613 adversarial review finding: the first version of this function
 * accepted `issuePattern.test(candidate.title ?? '') || issuePattern.test(branch)`.
 * `branch` here is always `manifest.branch`, and by this repo's own
 * `BRANCH_PATTERN` naming convention a conforming lane branch already embeds
 * the issue ID -- so `issuePattern.test(branch)` was true for essentially
 * every candidate regardless of its actual title, making the title check
 * vacuous. The real gate was `headRefName === branch` alone: a stale or
 * reused branch name (plausible for short-lived, low-entropy lane branches
 * after worktree cleanup) could bind a wrong PR's merge SHA with no content
 * verification at all -- silently, since this path is reachable from an
 * ordinary worktree, not gated by `isTrustedPostMergeAutomation`.
 *
 * The fix requires the candidate's own title to name the issue -- never the
 * branch name as a stand-in for it -- on top of the head-ref match.
 */
export function selectInferredMergedPr(
  candidates: RepairMergedPrInfo[],
  branch: string,
  issueId: string,
): RepairMergedPrInfo | null {
  const issuePattern = new RegExp(`(^|[^A-Z0-9])${escapeRegExp(issueId)}([^A-Z0-9]|$)`, 'iu');
  const matches = candidates.filter(
    (candidate) =>
      candidate.merged &&
      Boolean(candidate.mergeSha) &&
      candidate.headRefName === branch &&
      issuePattern.test(candidate.title ?? ''),
  );
  if (matches.length !== 1) {
    return null;
  }
  return matches[0] ?? null;
}

function inferMergedPrForBranch(branch: string, issueId: string): RepairMergedPrInfo | null {
  let stdout: string;
  try {
    stdout = execFileSync(
      'gh',
      [
        'pr',
        'list',
        '--repo',
        TRUSTED_POST_MERGE_REPOSITORY,
        '--head',
        branch,
        '--state',
        'merged',
        '--limit',
        '20',
        '--json',
        'url,number,state,mergedAt,mergeCommit,headRefName,baseRefName,title',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch {
    return null;
  }

  let parsed: Array<{
    url?: string;
    number?: number;
    state?: string | null;
    mergedAt?: string | null;
    mergeCommit?: { oid?: string | null } | null;
    headRefName?: string | null;
    baseRefName?: string | null;
    title?: string | null;
  }>;
  try {
    parsed = JSON.parse(stdout) as typeof parsed;
  } catch {
    return null;
  }

  const candidates: RepairMergedPrInfo[] = parsed.map((entry) => {
    const state = entry.state?.toLowerCase() ?? null;
    return {
      url: entry.url ?? '',
      number: entry.number,
      repository: TRUSTED_POST_MERGE_REPOSITORY,
      state,
      merged: state === 'merged' || Boolean(entry.mergedAt),
      mergeSha: entry.mergeCommit?.oid ?? null,
      headRefName: entry.headRefName ?? null,
      baseRefName: entry.baseRefName ?? null,
      title: entry.title ?? null,
    };
  });

  return selectInferredMergedPr(candidates, branch, issueId);
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

function modelRoutingSidecarPaths(manifest: LaneManifest): string[] {
  return manifest.expected_proof_paths.filter(
    (proofPath) => path.posix.basename(proofPath) === 'model-routing.json',
  );
}

/**
 * Post-merge automation initially sees the repair PR's merge SHA, but
 * --repair-merged resolves the implementation PR recorded in manifest.pr_url.
 * Rebind proof to that authoritative implementation SHA before truth-check so
 * manifest and proof cannot diverge when a historical lane is repaired.
 *
 * UTV2-1589: `generateProofArtifacts()` binds every declared model-routing.json
 * sidecar the same way it binds evidence.json/verification.md, but the trusted
 * `--repair-merged` path (this function) never called it -- only rebindMergeSha()
 * -- so a real replay of UTV2-1585/UTV2-1586 through this path left
 * model-routing.json unbound and P3/C4 blocked the close. Every required
 * sidecar is validated (write:false) before ANY proof file is mutated, mirroring
 * generateProofArtifacts()'s atomic validate-then-write ordering, so a
 * conflicting/malformed/identity-mismatched sidecar fails this repair with zero
 * proof mutation rather than a partially-bound bundle. The caller (`main()`)
 * still owns rollback of whatever this function *did* write (manifest, sync,
 * lease, merge-lock, and the whole proof directory) via
 * `createRepairRollbackTransaction()`.
 */
export function rebindRepairedLaneProof(
  manifest: LaneManifest,
  options: {
    repoRoot?: string;
    gitRoot?: string;
    now?: Date;
    pr?: RepairMergedPrInfo | null;
    isCommitReachable?: (ancestor: string, descendant: string) => boolean;
  } = {},
): ShaRebindOutcome[] {
  const repoRoot = options.repoRoot ?? process.cwd();
  const generatedAt = (options.now ?? new Date()).toISOString();
  const mergeSha = manifest.commit_sha;
  const modelRoutingPaths = modelRoutingSidecarPaths(manifest);

  let attestedShas: ShaSet | null = null;
  if (mergeSha && options.pr) {
    const evidencePath = safeRepoPath(
      repoRoot,
      path.posix.join('docs', '06_status', 'proof', manifest.issue_id, 'evidence.json'),
    );
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8')) as Record<string, unknown>;
    const binding = evidence['sha_binding'] as Record<string, unknown> | undefined;
    const executionSha = typeof binding?.['verified_source_sha'] === 'string'
      ? binding['verified_source_sha']
      : null;
    const built = buildMergedPrAttestation({
      number: options.pr.number,
      headRefOid: options.pr.headSha,
      mergeCommitOid: options.pr.mergeSha,
    });
    if (!built.attestation) {
      throw new Error(`Merged-PR re-attestation refused: ${built.errors.join('; ')}`);
    }
    attestedShas = {
      merge_sha: mergeSha,
      approved_head_sha: built.attestation.head_sha,
      execution_sha: executionSha,
    };
    const reachable = options.isCommitReachable ?? ((ancestor: string, descendant: string): boolean => {
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
          cwd: options.gitRoot ?? repoRoot,
          stdio: 'ignore',
        });
        return true;
      } catch {
        return false;
      }
    });
    const identityErrors = validatePrIdentity(
      attestedShas,
      {
        attestation: built.attestation,
        state: options.pr.merged ? 'MERGED' : options.pr.state ?? 'UNKNOWN',
        base_ref: options.pr.baseRefName ?? 'main',
        merge_sha_on_base: reachable(mergeSha, `origin/${options.pr.baseRefName ?? 'main'}`),
      },
      {
        executionShaOnBranch:
          executionSha === null ? true : reachable(executionSha, built.attestation.head_sha),
      },
    );
    if (identityErrors.length > 0) {
      throw new Error(`Merged-PR re-attestation refused: ${identityErrors.join('; ')}`);
    }
  }

  if (mergeSha) {
    // Validate-only pass first: throws ModelRoutingRebindError before any
    // proof artifact (including evidence.json/verification.md below) is
    // written, so a failing sidecar never leaves a partially-rebound bundle.
    for (const modelRoutingPath of modelRoutingPaths) {
      rebindModelRoutingJsonSha(
        safeRepoPath(repoRoot, modelRoutingPath),
        mergeSha,
        generatedAt,
        manifest.pr_url,
        {
          required: true,
          write: false,
          relPath: modelRoutingPath,
          expectedIssueId: manifest.issue_id,
          manifestModelRouting: manifest.model_routing,
          allowLegacyExecutionReattestation: attestedShas !== null,
          executionSha: attestedShas?.execution_sha,
        },
      );
    }
  }

  let outcomes: ShaRebindOutcome[];
  if (mergeSha && attestedShas) {
    const proofRoot = path.posix.join('docs', '06_status', 'proof', manifest.issue_id);
    const files = ['evidence.json', 'verification.md'].map((name) => path.posix.join(proofRoot, name));
    const result = rebindProofBundle(
      { issueId: manifest.issue_id, shas: attestedShas, prUrl: manifest.pr_url, files, root: repoRoot },
      { write: true, allowActiveSchemaStructuralRepair: true },
    );
    if (!result.ok) {
      throw new Error(`Merged-PR proof re-attestation refused: ${result.errors.join('; ')}`);
    }
    outcomes = result.checksums.map((checksum) => ({
      path: checksum.file,
      status: checksum.changed ? 'updated' : 'unchanged',
    }));
  } else {
    outcomes = rebindMergeSha(repoRoot, manifest.issue_id, mergeSha, generatedAt, manifest.pr_url);
  }

  if (mergeSha) {
    for (const modelRoutingPath of modelRoutingPaths) {
      outcomes.push(
        rebindModelRoutingJsonSha(
          safeRepoPath(repoRoot, modelRoutingPath),
          mergeSha,
          generatedAt,
          manifest.pr_url,
          {
            required: true,
            write: true,
            relPath: modelRoutingPath,
            expectedIssueId: manifest.issue_id,
            manifestModelRouting: manifest.model_routing,
            allowLegacyExecutionReattestation: attestedShas !== null,
            executionSha: attestedShas?.execution_sha,
          },
        ),
      );
    }
  }

  return outcomes;
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
  inputManifest: LaneManifest;
  changedFields: string[];
  pr: RepairMergedPrInfo | null;
  mergeBinding?: MergeBindingInference | null;
  repoRoot: string;
  artifactRoot?: string;
  command?: string;
  now?: Date;
}): RepairRequiredViaPrResult {
  const normalizedIssue = input.issueId.toUpperCase();
  const slug = normalizedIssue.toLowerCase();
  const branch = `claude/${slug}-lane-close-repair`;
  const manifestRelativePath = `docs/06_status/lanes/${normalizedIssue}.json`;
  const artifactRoot =
    input.artifactRoot ?? path.join(input.repoRoot, '.out', 'ops', 'lane-close-repair');

  // UTV2-1613: the packet is a schema-v2 repair packet, not a bare manifest
  // dump. The old format was literally the proposed manifest JSON, which the
  // operator was told to `cp` over the real file -- there was no record of what
  // it was generated from, no way to detect that the manifest had moved on
  // since, and no place to distinguish "GitHub says this PR merged" from "a
  // truth-check measured this lane as passing". This packet records the input
  // hash, the candidate hash, the inferred merge authority, and an explicit
  // truth-check receipt -- which on THIS path is always `executed: false`,
  // because reaching here means the close was blocked before any truth-check
  // ran. It therefore cannot carry a pass.
  const truthCheck = unexecutedTruthCheckReceipt({
    command: input.command ?? 'ops:lane-close --repair-merged',
    runner: 'ops:lane-close',
    mergeSha: input.mergeBinding?.merge_sha ?? input.pr?.mergeSha ?? null,
    evaluatedStateHash: null,
  });
  const packet = buildRepairPacket({
    issueId: normalizedIssue,
    command: input.command ?? 'ops:lane-close --repair-merged',
    inputManifest: input.inputManifest,
    proposedManifest: input.manifest,
    changedFields: input.changedFields,
    mergeBinding: input.mergeBinding ?? null,
    truthCheck,
    now: input.now,
  });
  const packetPath = writeRepairPacket(packet, { artifactRoot });
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
      `pnpm ops:lane-repair-packet apply ${normalizedIssue} --packet <repo-root>/${packetRelativePath}   # fails closed if the manifest, the packet, or the GitHub merge authority moved since generation -- never cp/hand-retype`,
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
    inputManifest?: LaneManifest;
    artifactRoot?: string;
    trustedPostMerge?: boolean;
    command?: string;
    now?: Date;
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
    inputManifest: options.inputManifest ?? repair.input_manifest ?? repair.manifest,
    changedFields: repair.changed_fields,
    pr: repair.pr,
    mergeBinding: repair.merge_binding ?? null,
    repoRoot: options.repoRoot,
    artifactRoot: options.artifactRoot,
    command: options.command,
    now: options.now,
  });
}

/**
 * Decides whether a blocking merge lock is this same lane's own abandoned
 * lock and may therefore be reclaimed automatically.
 *
 * The compounding failure this exists to stop (UTV2-1613): `ops:lane-close`
 * auto-acquires the merge lock, and every blocked exit path used to
 * `process.exit(1)` without releasing it. The lock file was left `held` by a
 * PID that no longer exists. On the next retry `markExpiredLock()` correctly
 * reclassified it `stale_reclaim_required` -- but nothing reclaimed it, so
 * `acquireMergeLock()` refused, and that retry then left its own residue too.
 * Each attempt to fix the lane blocked on the previous attempt's wreckage;
 * the failure compounded instead of being idempotent.
 *
 * Reaping is deliberately narrow. Only a lock for THIS issue on THIS branch
 * whose staleness is specifically `orphaned_pid` (a dead process on this
 * host, proven by `isProcessAlive`) is reclaimable here. A merely *expired*
 * lock may still have a live owner mid-merge, and another lane's lock is never
 * ours to take -- both keep requiring an explicit operator reclaim.
 */
export function isReapableOwnOrphanedLock(
  lock: MergeLockResult['lock'],
  manifest: LaneManifest,
): boolean {
  if (!lock) return false;
  return (
    lock.status === 'stale_reclaim_required' &&
    lock.stale_reason === 'orphaned_pid' &&
    lock.issue_id === manifest.issue_id &&
    lock.branch === manifest.branch
  );
}

export interface MergeLockReapFailure {
  ok: false;
  code: 'merge_lock_reap_failed';
  message: string;
  lock?: MergeLockResult['lock'];
  lock_path?: string;
}

export type CloseoutMergeLockResult = MergeLockResult | MergeLockReapFailure;

export function ensureCloseoutMergeLock(
  manifest: LaneManifest,
  options: {
    acquireLock?: boolean;
    mergeLockPath?: string;
    now?: Date;
    cwd?: string;
  } = {},
): CloseoutMergeLockResult {
  const mergeLockPath = options.mergeLockPath ?? controlMergeLockPath();
  const held = requireMergeLockHeld(
    {
      issue_id: manifest.issue_id,
      branch: manifest.branch,
      reason: 'ops:lane-close',
    },
    { lockPath: mergeLockPath, now: options.now },
  );
  if (held.ok || !options.acquireLock) {
    return held;
  }

  const lockInput = {
    issue_id: manifest.issue_id,
    branch: manifest.branch,
    pr: manifest.pr_url,
    cwd: options.cwd ?? process.cwd(),
    reason: 'ops:lane-close',
    owner: defaultMergeLockOwner(),
  };

  // Reap this lane's own orphaned lock before attempting acquisition --
  // otherwise acquireMergeLock() refuses a lock nobody is holding and the
  // retry loop never converges.
  if (isReapableOwnOrphanedLock(held.lock, manifest)) {
    const reclaimed = reclaimMergeLock(lockInput, {
      lockPath: mergeLockPath,
      now: options.now,
    });
    if (reclaimed.ok) {
      return reclaimed;
    }
    return {
      ok: false,
      code: 'merge_lock_reap_failed',
      lock: reclaimed.lock,
      lock_path: reclaimed.lock_path,
      message:
        `Orphaned merge lock for ${manifest.issue_id} on ${manifest.branch} could not be reclaimed: ` +
        `${reclaimed.code} ${reclaimed.message}`,
    };
  }

  return acquireMergeLock(lockInput, {
    lockPath: mergeLockPath,
    now: options.now,
  });
}

/**
 * Releases a merge lock that THIS invocation acquired, on a path that is about
 * to exit without closing the lane. Every blocked exit must call this: the
 * lock exists only to serialize this attempt, and an attempt that is giving up
 * has no claim on it. Silent about failures -- the caller is already reporting
 * a more important error, and a failed release here must not mask it.
 */
export function releaseSelfAcquiredMergeLock(
  lock: CloseoutMergeLockResult | null,
  manifest: LaneManifest,
  options: { mergeLockPath?: string } = {},
): void {
  if (!lock?.ok) return;
  if (lock.code !== 'merge_lock_acquired' && lock.code !== 'merge_lock_reclaimed') return;
  try {
    releaseMergeLock(
      { issue_id: manifest.issue_id, branch: manifest.branch },
      { lockPath: options.mergeLockPath ?? controlMergeLockPath() },
    );
  } catch {
    // Intentionally swallowed: see doc comment.
  }
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
  const usesActiveCheckout = path.resolve(repoRoot) === path.resolve(process.cwd());
  const coordinationRoot = usesActiveCheckout ? CONTROL_CHECKOUT_ROOT : repoRoot;
  const leaseRegistryDir = usesActiveCheckout
    ? LEASE_REGISTRY_DIR
    : path.join(coordinationRoot, '.ops', 'leases');
  const manifestPath = path.join(repoRoot, 'docs', '06_status', 'lanes', `${issueId}.json`);
  const proofDir = path.join(repoRoot, 'docs', '06_status', 'proof', issueId);
  const fileSnapshots: FileSnapshot[] = [
    snapshotFile(manifestPath),
    snapshotFile(path.join(repoRoot, '.ops', 'sync', `${issueId}.yml`)),
    snapshotFile(leasePathForIssue(issueId, leaseRegistryDir)),
    snapshotFile(path.join(coordinationRoot, '.ops', path.basename(MERGE_LOCK_PATH))),
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
  /**
   * UTV2-1619 capability 17: whether the ISSUE was completed, and if not, why.
   * Surfaced so a lane closing without completing its issue is visibly a
   * deliberate outcome rather than a silent omission.
   */
  issue_completed: boolean;
  issue_completion: IssueCompletionEligibility;
}

/**
 * Replays only the residual cleanup portion of closeout for a lane whose
 * terminal manifest and proof authority are already correct. The caller must
 * validate the explicit historical PR before entering this function.
 *
 * This path deliberately never writes the manifest, transitions Linear, or
 * rebinds proof. It only removes the per-issue sync record, releases supported
 * coordination state, and removes the exact clean recorded worktree.
 */
export function completeAlreadyClosedLaneCleanup(
  manifest: LaneManifest,
  options: {
    repoRoot?: string;
    preserveMergeLock?: boolean;
    releaseLocks?: (
      issue: string,
      branch: string,
      lockOptions?: { preserveMergeLock?: boolean },
    ) => { warnings: string[] };
    cleanupWorktree?: (manifest: LaneManifest) => Exclude<LaneWorktreeCleanup, 'not_requested'>;
  } = {},
): SuccessfulLaneCloseResult {
  const syncPath = path.join(
    options.repoRoot ?? process.cwd(),
    '.ops',
    'sync',
    `${manifest.issue_id}.yml`,
  );
  const syncRemoved = fs.existsSync(syncPath);
  fs.rmSync(syncPath, { force: true });

  const closeoutLocks = (options.releaseLocks ?? releaseCloseoutLocks)(
    manifest.issue_id,
    manifest.branch,
    { preserveMergeLock: options.preserveMergeLock },
  );
  const worktreeCleanup = (options.cleanupWorktree ?? cleanupClosedLaneWorktree)(manifest);

  return {
    manifest,
    warnings: closeoutLocks.warnings,
    sync_removed: syncRemoved,
    worktree_cleanup: worktreeCleanup,
    // UTV2-1619 capability 17: this path replays residual cleanup for a lane
    // that was ALREADY closed. It completes nothing and must never be read as a
    // statement about the issue.
    issue_completed: false,
    issue_completion: {
      eligible: false,
      satisfied: [],
      unsatisfied: [
        {
          condition: 'completion_intent',
          reason:
            'cleanup replay for an already-closed lane never completes an issue; it releases ' +
            'coordination state only',
        },
      ],
    },
  };
}

/**
 * Truth-gated lifecycle completion (UTV2-1619 capability 17).
 *
 * WHY THIS EXISTS. Closing a lane and completing an issue were the same act, so
 * an issue was declared complete whenever any of its lanes closed. That produced
 * three distinct false-`Done` reproductions in a single day, and they fail in
 * different ways on purpose -- a design that fixes only the first two is
 * incomplete:
 *
 *   1. Closeout FAILED and the issue was marked Done anyway. `post-merge-lane-close`
 *      exited non-zero while `Linear Auto-Close`, triggered by the same merge,
 *      succeeded. No receipt existed.
 *   2. NO LANE existed at all. A governance bootstrap PR merged for an issue with
 *      no manifest; completion was asserted with no evidence available, and none
 *      could have been.
 *   3. The lane closed TRUTHFULLY -- valid receipt, `runner: ops:lane-close`,
 *      bound to the merge SHA -- on a multi-increment issue with three
 *      capabilities still outstanding.
 *
 * The third is the one that matters for design: a receipt-only gate PERMITS it,
 * because the receipt is real and honest. Evidence was never the missing piece.
 * The missing piece is that lane completion and issue completion are different
 * facts, and only the first was ever represented.
 *
 * Fail-closed direction: absence of an explicit completion intent means "the
 * issue is not complete". A lane that says nothing about its issue closes the
 * lane and leaves the issue open.
 */
export type IssueCompletionCondition =
  | 'evidence_truth'
  | 'authority_truth'
  | 'scope_truth'
  | 'state_truth'
  | 'completion_intent';

export interface IssueCompletionEligibility {
  eligible: boolean;
  satisfied: IssueCompletionCondition[];
  unsatisfied: { condition: IssueCompletionCondition; reason: string }[];
}

/**
 * Decide whether closing this lane may also complete its ISSUE.
 *
 * All five conditions must hold. Each is checked independently and every failure
 * is reported, rather than short-circuiting on the first -- an operator who has
 * to fix these one CI cycle at a time is the failure mode the truth-check M2
 * short-circuit already demonstrated.
 */
export function evaluateIssueCompletionEligibility(input: {
  manifest: LaneManifest;
  truthCheck: TruthCheckResult;
  /**
   * Explicit operator declaration that this lane completes the issue. Absent or
   * false leaves the issue open. This is deliberately an explicit act rather
   * than an inference from lane state: inferring it from a terminal lane is
   * precisely reproduction 3.
   */
  completionIntent?: boolean;
}): IssueCompletionEligibility {
  const satisfied: IssueCompletionCondition[] = [];
  const unsatisfied: { condition: IssueCompletionCondition; reason: string }[] = [];
  const record = (condition: IssueCompletionCondition, ok: boolean, reason: string): void => {
    if (ok) satisfied.push(condition);
    else unsatisfied.push({ condition, reason });
  };

  // 1. Evidence truth -- a passing receipt from a canonical runner. A merge
  //    event is never evidence of completion (reproductions 1 and 2).
  const verdictPass = input.truthCheck.verdict === 'pass';
  const runnerCanonical = isCanonicalRunner(input.truthCheck.runner ?? 'manual');
  record(
    'evidence_truth',
    verdictPass && runnerCanonical,
    !verdictPass
      ? `truth-check verdict is "${input.truthCheck.verdict}", not "pass"`
      : `truth-check runner "${String(input.truthCheck.runner)}" is not a canonical runner`,
  );

  // 2. Authority truth -- the receipt is bound to the merge SHA the manifest
  //    records. A receipt for a different commit proves nothing about this one.
  const receiptSha = (input.truthCheck.merge_sha ?? '').trim();
  const manifestSha = (input.manifest.commit_sha ?? '').trim();
  record(
    'authority_truth',
    receiptSha.length > 0 && manifestSha.length > 0 && receiptSha === manifestSha,
    receiptSha.length === 0 || manifestSha.length === 0
      ? 'truth-check merge_sha or manifest.commit_sha is missing'
      : `truth-check merge_sha ${receiptSha} does not match manifest.commit_sha ${manifestSha}`,
  );

  // 3. Scope truth -- the lane actually delivered, and delivered inside what it
  //    declared. An empty files_changed cannot substantiate a completion claim.
  const filesChanged = input.manifest.files_changed ?? [];
  const lock = input.manifest.file_scope_lock ?? [];
  const outsideLock = filesChanged.filter(
    (file) => !lock.some((entry) => file === entry || file.startsWith(`${entry}/`)),
  );
  record(
    'scope_truth',
    filesChanged.length > 0 && outsideLock.length === 0,
    filesChanged.length === 0
      ? 'manifest.files_changed is empty; the lane delivered nothing to substantiate completion'
      : `files delivered outside the declared scope lock: ${outsideLock.join(', ')}`,
  );

  // 4. State truth -- the lane reached a terminal state that ASSERTS success.
  //    `failed`, `superseded` and `cancelled` are terminal but assert no
  //    completion, and must never complete an issue.
  const statusAssertsSuccess = SUCCESS_TERMINAL_STATUSES.has(input.manifest.status);
  record(
    'state_truth',
    statusAssertsSuccess,
    `manifest status "${input.manifest.status}" does not assert successful completion`,
  );

  // 5. Completion intent -- declared, never inferred.
  record(
    'completion_intent',
    input.completionIntent === true,
    'no explicit final-completion intent was declared for this issue; the lane closes and the issue stays open',
  );

  return { eligible: unsatisfied.length === 0, satisfied, unsatisfied };
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
    /**
     * UTV2-1619 capability 17: explicit declaration that this lane completes the
     * ISSUE, not merely the lane. Absent means the issue stays open.
     */
    completionIntent?: boolean;
    /**
     * Trusted post-merge automation may keep the merge mutex through the
     * subsequent persistence step. The caller must release it after the push
     * attempt; ordinary lane-close callers retain the existing release-on-close
     * behavior.
     */
    preserveMergeLock?: boolean;
    beginLeaseRelease?: (issue: string) => TerminalLeaseReleaseTransaction;
    releaseLocks?: (
      issue: string,
      branch: string,
      lockOptions?: { preserveMergeLock?: boolean },
    ) => { warnings: string[] };
    cleanupWorktree?: (manifest: LaneManifest) => Exclude<LaneWorktreeCleanup, 'not_requested'>;
  } = {},
): Promise<SuccessfulLaneCloseResult> {
  // Release the control-checkout lease first and retain its exact rollback
  // snapshot until the terminal manifest write succeeds. This ordering makes
  // the forbidden state (terminal manifest + active lease) unreachable through
  // any synchronous failure in the transition.
  const leaseTransition = (options.beginLeaseRelease ?? ((issue) =>
    beginTerminalLeaseRelease({
      issue_id: issue,
      actor: 'ops:lane-close',
      reason: 'lane reached terminal status',
    })))(issueId);
  let manifest: LaneManifest;
  try {
    manifest = (options.finalizeManifest ?? finalizeLaneCloseManifest)(
      issueId,
      authorizedTruthCheck,
    );
    leaseTransition.commit();
  } catch (error) {
    leaseTransition.rollback();
    throw error;
  }
  // UTV2-1619 capability 17: lane completion is not issue completion. The
  // transition happens only when all five conditions hold; otherwise the lane
  // closes and the issue is deliberately left open, with the reasons recorded.
  const completionEligibility = evaluateIssueCompletionEligibility({
    manifest,
    truthCheck: authorizedTruthCheck,
    completionIntent: options.completionIntent,
  });
  if (completionEligibility.eligible) {
    await (options.transitionLinear ?? transitionLinearIssueToDone)(issueId);
  }

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

  const closeoutLocks = options.releaseLocks
    ? options.releaseLocks(issueId, manifestBeforeClose.branch, {
        preserveMergeLock: options.preserveMergeLock,
      })
    : releaseCloseoutLocks(issueId, manifestBeforeClose.branch, {
        leaseAlreadyReleased: true,
        preserveMergeLock: options.preserveMergeLock,
      });

  // Worktree removal is deliberately last: every earlier fallible local
  // mutation can be restored by RepairRollbackTransaction. Once a clean,
  // non-current worktree is removed there are no later fallible operations.
  if (options.trustedBindingRepair) {
    worktreeCleanup = (options.cleanupWorktree ?? cleanupClosedLaneWorktree)(manifest);
  }

  return {
    manifest,
    warnings: [...leaseTransition.warnings, ...closeoutLocks.warnings],
    sync_removed: syncRemoved,
    worktree_cleanup: worktreeCleanup,
    issue_completed: completionEligibility.eligible,
    issue_completion: completionEligibility,
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

/**
 * Idempotent re-close of an already-terminal lane.
 *
 * Before UTV2-1613 a second `ops:lane-close` on a `done` lane took the full
 * path: it auto-acquired the merge lock, ran a truth-check whose result could
 * not possibly match the immutable persisted history (see
 * `classifyTruthCheckAuthorization`), reported `truth_check_drift`, and exited
 * without releasing the lock it had just taken. The next retry then blocked on
 * *that* lock. Retrying a closed lane made it strictly worse each time.
 *
 * This path exists so a re-close is what it should always have been: confirm
 * the lane is terminal, release any coordination state still attributable to
 * it, and report `already_closed`. It writes no manifest, transitions no
 * Linear issue, and marks nothing Done that was not already Done -- it can
 * only ever release, never grant.
 */
export function completeIdempotentReclose(
  manifest: LaneManifest,
  options: {
    repoRoot?: string;
    releaseLocks?: (
      issue: string,
      branch: string,
      locksOptions?: { preserveMergeLock?: boolean },
    ) => { warnings: string[] };
    /**
     * Terminal-cleanup replay: reclaim only the gitignored lease/lock
     * coordination state that a hosted closeout could not reach.
     *
     * `.ops/sync/<issue>.yml` is TRACKED. Deleting it here leaves the control
     * checkout dirty with a staged-looking deletion that reconciliation never
     * restores, which then disrupts the serialized merge operations this replay
     * runs alongside. The mutex is left to whichever caller acquired it.
     */
    terminalCleanupOnly?: boolean;
  } = {},
): SuccessfulLaneCloseResult {
  const syncPath = path.join(
    options.repoRoot ?? process.cwd(),
    '.ops',
    'sync',
    `${manifest.issue_id}.yml`,
  );
  let syncRemoved = false;
  if (!options.terminalCleanupOnly) {
    syncRemoved = fs.existsSync(syncPath);
    fs.rmSync(syncPath, { force: true });
  }

  const closeoutLocks = (options.releaseLocks ?? releaseCloseoutLocks)(
    manifest.issue_id,
    manifest.branch,
    { preserveMergeLock: options.terminalCleanupOnly ?? false },
  );

  return {
    manifest,
    warnings: closeoutLocks.warnings,
    sync_removed: syncRemoved,
    worktree_cleanup: 'not_requested',
    issue_completed: false,
    issue_completion: {
      eligible: false,
      satisfied: [],
      unsatisfied: [
        {
          condition: 'completion_intent',
          reason: 'idempotent terminal cleanup never completes an issue',
        },
      ],
    },
  };
}

/**
 * Composes the manifest state persisted when a repaired-but-failing close
 * gives up: the merge binding is real (GitHub state), so it stays; the
 * measured truth-check outcome is real too, and must not be silently
 * dropped.
 *
 * UTV2-1613 adversarial review finding: `repairedManifest` is captured by
 * `repairMergedLaneManifest` before `runTruthCheck()` runs, so its
 * `truth_check_history` is the STALE pre-run array. `runTruthCheck()`'s own
 * write (with the real failing entry appended) is correctly discarded by the
 * transaction rollback on this path -- but persisting `repairedManifest`
 * verbatim afterward would then permanently lose that measured failure. This
 * function appends the measured entry from the same receipt the caller
 * already computed, exported so the composition is unit-testable without
 * spawning the full CLI.
 *
 * Never appends a pass: `truthHistoryEntryForMeasuredReceipt` only returns
 * one for a receipt that executed and exited 0, and this function is only
 * ever called from the `result.exit_code !== 0` branch in `main()`.
 */
export function manifestForFailedRepairClose(
  repairedManifest: LaneManifest,
  receipt: MeasuredTruthCheckReceipt,
): LaneManifest {
  const failureEntry = truthHistoryEntryForMeasuredReceipt(receipt);
  if (!failureEntry) {
    return repairedManifest;
  }
  return {
    ...repairedManifest,
    truth_check_history: [...repairedManifest.truth_check_history, failureEntry],
  };
}

async function main(): Promise<void> {
  const { positionals, flags, bools } = parseArgs(process.argv.slice(2));
  const issueId = requireIssueId(positionals[0] ?? '');
  const explicitPr = flags.get('pr')?.at(-1)?.trim() ?? '';
  const invokedCommand = ['ops:lane-close', ...process.argv.slice(2)].join(' ');
  let transaction: RepairRollbackTransaction | null = null;
  let heldLock: CloseoutMergeLockResult | null = null;
  let lockManifest: LaneManifest | null = null;

  /**
   * Every non-success exit funnels through here. A run that is giving up must
   * not leave behind the merge lock it acquired for itself -- that residue is
   * precisely what made repeated `ops:lane-close` invocations compound instead
   * of converge (UTV2-1613).
   */
  const abandonSelfAcquiredLock = (): void => {
    if (heldLock && lockManifest) {
      releaseSelfAcquiredMergeLock(heldLock, lockManifest);
    }
    heldLock = null;
  };

  try {
    let manifest = readManifest(issueId);
    const inputManifest = structuredClone(manifest);
    lockManifest = manifest;
    const repairMerged = bools.has('repair-merged');
    const trustedPostMerge = isTrustedPostMergeAutomation(process.env, {
      postMergeTrusted: bools.has('post-merge-trusted'),
    });
    const retainMergeLock = bools.has('retain-merge-lock');

    // Holding the mutex beyond this process is a capability reserved for the
    // exact trusted post-merge workflow. Without this guard a local caller
    // could strand the serialized merge queue simply by passing a CLI flag.
    if (retainMergeLock && !trustedPostMerge) {
      emitJson({
        ok: false,
        code: 'untrusted_invocation' as CloseoutFailureCode,
        outcome: 'blocked' satisfies CloseoutOutcome,
        remediation: remediationForCode('untrusted_invocation'),
        issue_id: issueId,
      });
      process.exit(1);
    }

    // Idempotent no-op BEFORE any lock is taken, so a re-close cannot create
    // the residue it would then trip over on the next attempt.
    if (manifest.status === 'done' && !repairMerged && !explicitPr) {
      const cleanup = completeIdempotentReclose(manifest, {
        terminalCleanupOnly: bools.has('terminal-cleanup-only'),
      });
      emitJson({
        ok: true,
        code: 'lane_closed' as CloseoutFailureCode,
        outcome: 'already_closed' satisfies CloseoutOutcome,
        issue_id: issueId,
        status: manifest.status,
        closed_at: manifest.closed_at,
        remediation:
          'Lane is already closed. Coordination state was released idempotently; no manifest, proof, or Linear ' +
          'state was changed, and no truth-check outcome was recorded. Reopen detection remains the job of ' +
          'ops:truth-check, not of re-running the closer.',
        warnings: cleanup.warnings,
        sync_removed: cleanup.sync_removed,
        worktree_cleanup: cleanup.worktree_cleanup,
      });
      process.exit(0);
    }

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
    let repairedManifest: LaneManifest | null = null;
    let repairChangedFields: string[] = [];
    let mergeBinding: MergeBindingInference | null = null;
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
    heldLock = lock;
    if (!lock.ok) {
      transaction?.rollback();
      transaction = null;
      heldLock = null;
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
        releaseLocksIfAlreadyDone: !validatedPr,
        validatedPr,
      });
      if (!repair.ok) {
        transaction?.rollback();
        transaction = null;
        abandonSelfAcquiredLock();
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
        let cleanup: SuccessfulLaneCloseResult = {
          manifest,
          warnings: [],
          sync_removed: false,
          worktree_cleanup: 'not_requested',
          issue_completed: false,
          issue_completion: {
            eligible: false,
            satisfied: [],
            unsatisfied: [
              {
                condition: 'completion_intent',
                reason: 'already-closed repair made no issue completion claim',
              },
            ],
          },
        };
        if (validatedPr) {
          cleanup = completeAlreadyClosedLaneCleanup(manifest, {
            preserveMergeLock: retainMergeLock,
          });
        }
        transaction?.commit();
        transaction = null;
        heldLock = null;
        emitJson({
          ok: true,
          code: 'lane_closed' as CloseoutFailureCode,
          outcome: 'already_closed' satisfies CloseoutOutcome,
          issue_id: issueId,
          status: manifest.status,
          remediation: repair.remediation,
          warnings: cleanup.warnings,
          sync_removed: cleanup.sync_removed,
          worktree_cleanup: cleanup.worktree_cleanup,
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
        inputManifest,
        trustedPostMerge,
        command: invokedCommand,
      });
      if (guard) {
        transaction?.rollback();
        transaction = null;
        abandonSelfAcquiredLock();
        emitJson(guard);
        process.exit(1);
      }

      writeManifest(repair.manifest);
      manifest = repair.manifest;
      repairedManifest = repair.manifest;
      repairChangedFields = repair.changed_fields;
      mergeBinding = repair.merge_binding ?? null;
      rebindRepairedLaneProof(manifest, { pr: repair.pr ?? validatedPr });
    }

    requireCloseCommitSha(manifest);

    // The exact state the truth-check is about to evaluate. Recorded in the
    // measured receipt so a pass can never be credited to a state other than
    // the one that produced it.
    const evaluatedStateHash = hashState(manifest);

    const result = await runTruthCheck({
      issueId,
      json: true,
      explain: bools.has('explain'),
      runner: 'ops:lane-close',
    });

    const truthCheckCommand = `ops:truth-check ${issueId} (runner ops:lane-close)`;
    const receipt: MeasuredTruthCheckReceipt = measuredTruthCheckReceipt({
      command: truthCheckCommand,
      runner: assertCanonicalRunner('ops:lane-close'),
      result,
      evaluatedStateHash,
    });
    const repairPacket: LaneCloseRepairPacket | null = repairedManifest
      ? buildRepairPacket({
          issueId,
          command: invokedCommand,
          inputManifest,
          proposedManifest: repairedManifest,
          changedFields: repairChangedFields,
          mergeBinding,
          truthCheck: receipt,
        })
      : null;
    const repairPacketPathWritten = repairPacket
      ? writeRepairPacket(repairPacket, {
          artifactRoot: path.join(process.cwd(), '.out', 'ops', 'lane-close-repair'),
        })
      : null;

    if (result.exit_code !== 0) {
      transaction?.rollback();
      transaction = null;

      // UTV2-1613: a failing truth-check rolls back everything this run wrote
      // EXCEPT the inferred merge binding, which is re-applied below.
      //
      // The binding is a fact about GitHub -- this PR merged, at this SHA --
      // and it stays true whether or not the lane's proof bundle is valid.
      // Rolling it back was what made ghost lanes permanent: a stranded
      // manifest (UTV2-1553: `started`, pr_url null) would be correctly
      // repaired to `merged`, fail its truth-check for an unrelated reason
      // (missing proof), and be reverted to `started` -- so it kept holding
      // its file_scope_lock against every other lane, forever, and the next
      // repair attempt began from the same broken state.
      //
      // Persisting the binding releases that lock without asserting anything
      // about correctness: the lane lands in `merged`, which is exactly what
      // GitHub says, and NOT in `done`. `truth_check_history` records the
      // measured failure; nothing records a pass. Closing still requires a
      // genuine passing truth-check on a later run.
      //
      // UTV2-1613 adversarial review finding: `repairedManifest` was captured
      // by `repairMergedLaneManifest` before `runTruthCheck()` ran, so its
      // `truth_check_history` is the STALE pre-run array. `runTruthCheck()`'s
      // own write (with the real failing entry appended) was correctly
      // discarded by the rollback above -- but writing `repairedManifest`
      // back verbatim would then permanently lose that measured failure,
      // directly contradicting this comment. The measured failure entry is
      // appended explicitly here, from the same `receipt` this run already
      // computed, so the persisted state matches what was actually measured.
      let mergeBindingPersisted = false;
      if (repairedManifest && mergeBinding) {
        writeManifest(manifestForFailedRepairClose(repairedManifest, receipt));
        mergeBindingPersisted = true;
      }

      abandonSelfAcquiredLock();
      const code = mapFailuresToCode(result.failures, result.verdict);
      emitJson({
        ok: false,
        code,
        outcome: 'blocked' satisfies CloseoutOutcome,
        remediation: remediationForCode(code),
        issue_id: issueId,
        truth_check: result,
        measured_truth_check: receipt,
        merge_binding: mergeBinding,
        merge_binding_persisted: mergeBindingPersisted,
        repair_packet_path: repairPacketPathWritten,
      });
      process.exit(result.exit_code);
    }

    const completion = await completeSuccessfulLaneClose(
      issueId,
      manifest,
      result,
      {
        trustedBindingRepair: Boolean(validatedPr),
        preserveMergeLock: retainMergeLock,
      },
    );
    manifest = completion.manifest;
    const outcome: CloseoutOutcome =
      completion.warnings.length > 0 ? 'closed_with_warnings' : 'closed';
    transaction?.commit();
    transaction = null;
    heldLock = null;

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
      measured_truth_check: receipt,
      measured_pass: isMeasuredPass(receipt),
      merge_binding: mergeBinding,
      repair_packet_path: repairPacketPathWritten,
    });
  } catch (error) {
    abandonSelfAcquiredLock();
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

    if (error instanceof ModelRoutingRebindError) {
      emitJson({
        ok: false,
        code: 'model_routing_rebind_failed' as CloseoutFailureCode,
        outcome: 'blocked' satisfies CloseoutOutcome,
        remediation: remediationForCode('model_routing_rebind_failed'),
        issue_id: issueId,
        model_routing_error_code: error.code,
        proof_path: error.proofPath,
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
      'url,state,mergedAt,mergeCommit,headRefOid,headRefName,baseRefName,title',
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
    headRefOid?: string | null;
    headRefName?: string | null;
    baseRefName?: string | null;
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
    headSha: parsed.headRefOid ?? null,
    headRefName: parsed.headRefName ?? null,
    baseRefName: parsed.baseRefName ?? null,
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
