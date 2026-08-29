/**
 * Canonical proof schema v2 for Workflow Runtime v2.
 *
 * Single source of truth for proof shape across:
 *   proof-binding-validator, proof-auditor, runtime-verifier,
 *   truth-check / lane-close, PM gate, and proof-check.
 *
 * Why schema_version=2: v1 mixed static fields with runtime fields and had no
 * SHA binding. V1 remains readable through the version-aware evidence-bundle
 * validator below; all v2 consumers share the same binding and proof-profile
 * contract.
 */

import { spawnSync } from 'node:child_process';

export const PROOF_SCHEMA_VERSION = 2 as const;

export type GateVerdict = 'PASS' | 'FAIL' | 'SKIP';

export interface GateResult {
  gate: string;
  verdict: GateVerdict;
  detail: string;
}

export interface ReviewerVerdict {
  reviewer: string;
  verdict: 'PASS' | 'FAIL' | 'PENDING';
  reviewed_head_sha: string;
  blocking_findings: string[];
  resolved_findings: string[];
  recorded_at: string;
}

export interface PmVerdict {
  actor: string;
  verdict: 'APPROVED' | 'REJECTED' | 'PENDING';
  recorded_at: string;
  notes?: string;
}

/**
 * Canonical proof record v2.
 *
 * All SHA fields must be 40-char hex. Fields optional before merge
 * become required after merge (merge_sha, evidence_commit_sha).
 */
export interface ProofSchemaV2 {
  schema_version: 2;

  issue_id: string;
  pr_number: number;

  /** SHA of the branch at the time proof was generated. */
  source_sha: string;

  /** PR head SHA the reviewer inspected. */
  reviewed_head_sha: string;

  /** Commit that contains the evidence bundle in the repo. */
  evidence_commit_sha: string | null;

  /** Current branch/PR head SHA at validation time. */
  current_head_sha: string | null;

  /** Merge SHA — null until PR is merged. */
  merge_sha: string | null;

  gate_results: GateResult[];

  reviewer_verdict: ReviewerVerdict | null;

  pm_verdict: PmVerdict | null;

  generated_at: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const SHA_RE = /^[0-9a-f]{40}$/i;

export interface ValidationFailure {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  failures: ValidationFailure[];
}

export type EvidenceProofProfile = 'legacy-v1' | 'app-runtime' | 'migration' | 'static';

export interface EvidenceContractFailure extends ValidationFailure {
  code:
    | 'invalid_root'
    | 'unsupported_schema_version'
    | 'legacy_v1_not_allowed_pre_merge'
    | 'sha_binding_missing'
    | 'sha_binding_invalid'
    | 'sha_binding_merge_slot_missing'
    | 'sha_binding_premature_merge_sha'
    | 'legacy_merge_sha_forbidden'
    | 'proof_profile_missing'
    | 'proof_profile_unknown'
    | 'proof_profile_mismatch'
    | 'static_proof_missing'
    | 'runtime_proof_missing'
    | 'runtime_queries_missing'
    | 'runtime_row_counts_missing'
    | 'migration_head_missing'
    | 'migration_receipt_head_mismatch'
    | 'migration_receipt_not_ancestor'
    | 'migration_receipt_non_proof_delta'
    | 'migration_receipt_ancestry_unverified'
    | 'migration_receipt_merge_attestation_mismatch'
    | 'migration_refusal_drill_missing'
    | 'migration_empty_scratch_missing'
    | 'migration_roundtrip_missing'
    | 'migration_schema_parity_missing'
    | 'migration_staging_proof_missing'
    | 'author_verifier_forbidden';
}

export type EvidenceValidationGate = 'pre-merge' | 'post-merge-read';

export interface MergedPrAttestation {
  merge_sha: string;
  head_sha: string;
  pr_number: number;
  source: 'github-api';
}

export interface EvidenceContractContext {
  /** Explicit caller boundary: authoring gates reject v1; historical readers may accept it. */
  gate: EvidenceValidationGate;
  /** Authoritative declaration from the lane manifest. */
  laneType?: string | null;
  tier?: string | null;
  /** Required to mechanically verify a post-merge migration receipt rebind. */
  repoRoot?: string | null;
  /** Rank-1 GitHub merge record supplied by the caller; the contract may fetch its immutable PR-head ref. */
  mergedPrAttestation?: MergedPrAttestation | null;
  /** Deterministic test seam; production callers always use the local Git repository. */
  gitRunner?: EvidenceGitRunner;
}

export interface EvidenceGitResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export type EvidenceGitRunner = (args: readonly string[], cwd: string) => EvidenceGitResult;

export interface EvidenceContractResult {
  valid: boolean;
  schemaVersion: 1 | 2 | null;
  profile: EvidenceProofProfile | null;
  profileSource: 'legacy-schema' | 'manifest-lane-type' | 'evidence' | null;
  failures: EvidenceContractFailure[];
  bundle: Record<string, unknown> | null;
}

/** Line indexes that are part of CommonMark fenced code blocks, including fences. */
export function markdownFencedLineIndexes(content: string): Set<number> {
  const fenced = new Set<number>();
  const lines = content.split(/\r?\n/u);
  let active: { char: '`' | '~'; length: number } | null = null;

  for (const [index, line] of lines.entries()) {
    if (active) {
      fenced.add(index);
      const closing = line.match(/^[ \t]{0,3}(`+|~+)[ \t]*$/u);
      if (closing && closing[1]?.[0] === active.char && closing[1].length >= active.length) {
        active = null;
      }
      continue;
    }

    const opening = line.match(/^[ \t]{0,3}(`{3,}|~{3,}).*$/u);
    if (!opening) continue;
    const run = opening[1]!;
    active = { char: run[0] as '`' | '~', length: run.length };
    fenced.add(index);
  }
  return fenced;
}

// Ratified T1 precedent treats modeling/analytics and canonical-data lanes as
// decision/data truth: they require the same live queries + row counts as
// application runtime lanes and cannot self-select the static profile.
const APP_RUNTIME_LANE_TYPES = new Set(['runtime', 'delivery-ui', 'modeling', 'data-canonical']);
const STATIC_LANE_TYPES = new Set([
  'claude',
  'claude-governance',
  'codex',
  'codex-cli',
  'governance',
  'hygiene',
  'verification',
]);
const AUTHORABLE_PROFILES = new Set<EvidenceProofProfile>(['app-runtime', 'migration', 'static']);

export function declaredProfileForLaneType(laneType: string | null | undefined): EvidenceProofProfile | null {
  const normalized = laneType?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'migration') return 'migration';
  if (APP_RUNTIME_LANE_TYPES.has(normalized)) return 'app-runtime';
  if (STATIC_LANE_TYPES.has(normalized)) return 'static';
  return null;
}

function isPopulatedRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length > 0;
}

function isPositiveRunId(value: unknown): boolean {
  return (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) ||
    (typeof value === 'string' && /^[1-9][0-9]*$/.test(value));
}

function migrationReceiptPass(value: unknown): value is Record<string, unknown> {
  if (!isPopulatedRecord(value)) return false;
  return String(value['result'] ?? '').toUpperCase() === 'PASS' &&
    isPositiveRunId(value['run']) &&
    isPositiveRunId(value['job']);
}

function runEvidenceGit(
  args: readonly string[],
  repoRoot: string,
  runner?: EvidenceGitRunner,
): EvidenceGitResult {
  if (runner) return runner(args, repoRoot);
  const result = spawnSync('git', [...args], { cwd: repoRoot, encoding: 'utf8' });
  return {
    status: result.status,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
    ...(result.error ? { error: result.error } : {}),
  };
}

type MigrationReceiptBindingResult =
  | { status: 'pass' }
  | { status: 'not-ancestor' }
  | { status: 'non-proof-delta'; paths: string[] }
  | { status: 'attestation-mismatch'; detail: string }
  | { status: 'unverified'; detail: string };

type MergedPrAttestationResolution =
  | { status: 'pass'; attestation: MergedPrAttestation; mainRef: string }
  | Extract<MigrationReceiptBindingResult, { status: 'attestation-mismatch' | 'unverified' }>;

function verifyCommitAvailable(
  sha: string,
  label: string,
  context: EvidenceContractContext,
): Extract<MigrationReceiptBindingResult, { status: 'unverified' }> | null {
  const result = runEvidenceGit(['cat-file', '-e', `${sha}^{commit}`], context.repoRoot!, context.gitRunner);
  if (!result.error && result.status === 0) return null;
  return {
    status: 'unverified',
    detail: `${label} commit ${sha} is not available: ${
      result.error?.message || String(result.stderr ?? '').trim() || 'git cat-file did not complete'
    }`,
  };
}

function ensureAttestedPrHeadAvailable(
  attestation: MergedPrAttestation,
  context: EvidenceContractContext,
): Extract<MigrationReceiptBindingResult, { status: 'unverified' }> | null {
  const unavailable = verifyCommitAvailable(attestation.head_sha, 'GitHub-recorded PR head', context);
  if (!unavailable) return null;

  // A merged source branch may be auto-deleted before post-merge closeout.
  // GitHub retains refs/pull/<n>/head, so fetch that immutable PR ref rather
  // than making verifier authority depend on incidental local object state.
  const fetched = runEvidenceGit(
    ['fetch', '--no-tags', 'origin', `refs/pull/${attestation.pr_number}/head`],
    context.repoRoot!,
    context.gitRunner,
  );
  if (fetched.error || fetched.status !== 0) {
    return {
      status: 'unverified',
      detail: fetched.error?.message ||
        String(fetched.stderr ?? '').trim() ||
        `${unavailable.detail}; immutable PR-head fetch did not complete`,
    };
  }

  return verifyCommitAvailable(attestation.head_sha, 'GitHub-recorded PR head after fetch', context);
}

function verifyProofOnlyMigrationAncestry(
  receiptHead: string,
  verifiedSourceSha: string,
  mainSideReference: string,
  issueId: string,
  context: EvidenceContractContext,
): MigrationReceiptBindingResult {
  const repoRoot = context.repoRoot;
  if (!repoRoot) {
    return { status: 'unverified', detail: 'post-merge migration receipt ancestry requires repoRoot' };
  }
  if (!/^(?:UTV2|UNI)-\d+$/.test(issueId)) {
    return { status: 'unverified', detail: 'post-merge migration receipt ancestry requires a valid issue_id' };
  }

  const ancestry = runEvidenceGit(
    ['merge-base', '--is-ancestor', receiptHead, verifiedSourceSha],
    repoRoot,
    context.gitRunner,
  );
  if (ancestry.error || ancestry.status === null || ancestry.status > 1) {
    return {
      status: 'unverified',
      detail: ancestry.error?.message || String(ancestry.stderr ?? '').trim() || 'git ancestry check did not complete',
    };
  }
  if (ancestry.status === 1) return { status: 'not-ancestor' };

  const mainSide = runEvidenceGit(
    ['rev-parse', '--verify', `${mainSideReference}^{commit}`],
    repoRoot,
    context.gitRunner,
  );
  if (mainSide.error || mainSide.status !== 0) {
    return {
      status: 'unverified',
      detail: mainSide.error?.message ||
        String(mainSide.stderr ?? '').trim() ||
        `main-side reference ${mainSideReference} could not be resolved`,
    };
  }

  // Compare the shipped trees, not the intervening commit walk. This permits a
  // main-sync import only when its target blob exactly matches main immediately
  // before the merge. A non-proof change made and fully reverted after receipts
  // is intentionally invisible: reverted content never shipped, so the receipts
  // remain representative of the delivered tree.
  const changed = runEvidenceGit(
    ['diff', '--name-only', receiptHead, verifiedSourceSha],
    repoRoot,
    context.gitRunner,
  );
  if (changed.error || changed.status !== 0) {
    return {
      status: 'unverified',
      detail: changed.error?.message || String(changed.stderr ?? '').trim() || 'git changed-path check did not complete',
    };
  }

  const proofPrefix = `docs/06_status/proof/${issueId}/`;
  const exactBookkeepingPaths = new Set([
    `docs/06_status/lanes/${issueId}.json`,
    `.ops/sync/${issueId}.yml`,
  ]);
  const paths = [...new Set(changed.stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean))];
  const nonProof = paths.filter(
    (filePath) => !filePath.startsWith(proofPrefix) && !exactBookkeepingPaths.has(filePath),
  );
  const offendingPaths: string[] = [];
  for (const filePath of nonProof) {
    const targetBlob = runEvidenceGit(
      ['rev-parse', `${verifiedSourceSha}:${filePath}`],
      repoRoot,
      context.gitRunner,
    );
    const mainBlob = runEvidenceGit(
      ['rev-parse', `${mainSideReference}:${filePath}`],
      repoRoot,
      context.gitRunner,
    );
    if (targetBlob.error || targetBlob.status === null || mainBlob.error || mainBlob.status === null) {
      return {
        status: 'unverified',
        detail: targetBlob.error?.message || mainBlob.error?.message ||
          `blob identity for ${filePath} could not be resolved`,
      };
    }
    if (
      targetBlob.status !== 0 ||
      mainBlob.status !== 0 ||
      targetBlob.stdout.trim() !== mainBlob.stdout.trim()
    ) {
      offendingPaths.push(filePath);
    }
  }
  return offendingPaths.length > 0
    ? { status: 'non-proof-delta', paths: offendingPaths }
    : { status: 'pass' };
}

/**
 * Resolves the GitHub merged-PR attestation and verifies that `mergeAuthoritySha`
 * — the SHA the caller claims carries merge authority — is the merge SHA GitHub
 * actually recorded.
 *
 * `authorityField` names the evidence field the caller drew that SHA from, so a
 * mismatch says which field lied. Callers that predate the explicit
 * `sha_binding.merge_sha` slot pass `verified_source_sha` and keep the historical
 * meaning; the schema-v2 consumer passes the explicit slot instead.
 */
function resolveMergedPrAttestation(
  mergeAuthoritySha: string,
  context: EvidenceContractContext,
  authorityField = 'sha_binding.verified_source_sha',
): MergedPrAttestationResolution {
  if (!context.repoRoot) {
    return { status: 'unverified', detail: 'post-merge migration receipt ancestry requires repoRoot' };
  }

  const attestation = context.mergedPrAttestation;
  if (
    !attestation ||
    attestation.source !== 'github-api' ||
    !SHA_RE.test(attestation.merge_sha) ||
    !SHA_RE.test(attestation.head_sha) ||
    !Number.isSafeInteger(attestation.pr_number) ||
    attestation.pr_number <= 0
  ) {
    return {
      status: 'unverified',
      detail: 'post-merge migration receipt binding requires a complete GitHub merged-PR attestation',
    };
  }

  if (mergeAuthoritySha.toLowerCase() !== attestation.merge_sha.toLowerCase()) {
    return {
      status: 'attestation-mismatch',
      detail: `${authorityField} does not equal the GitHub-recorded merge SHA`,
    };
  }

  const headUnavailable = ensureAttestedPrHeadAvailable(attestation, context);
  if (headUnavailable) return headUnavailable;
  const mergeUnavailable = verifyCommitAvailable(attestation.merge_sha, 'GitHub-recorded merge', context);
  if (mergeUnavailable) return mergeUnavailable;

  const headAncestry = runEvidenceGit(
    ['merge-base', '--is-ancestor', attestation.head_sha, attestation.merge_sha],
    context.repoRoot,
    context.gitRunner,
  );
  if (headAncestry.error || headAncestry.status === null || headAncestry.status > 1) {
    return {
      status: 'unverified',
      detail: headAncestry.error?.message ||
        String(headAncestry.stderr ?? '').trim() ||
        'GitHub-recorded PR-head ancestry check did not complete',
    };
  }

  let mainRef: string;
  if (headAncestry.status === 0) {
    // A two-parent merge commit contains the original PR head, so merge-base
    // would degenerate to that head. Require a real merge and use parent 1,
    // which GitHub records as the pre-merge base-branch tip.
    const parents = runEvidenceGit(
      ['rev-list', '--parents', '-n', '1', attestation.merge_sha],
      context.repoRoot,
      context.gitRunner,
    );
    const parentTokens = String(parents.stdout ?? '').trim().split(/\s+/).filter(Boolean);
    if (parents.error || parents.status !== 0 || parentTokens.length < 3) {
      return {
        status: 'unverified',
        detail: parents.error?.message ||
          String(parents.stderr ?? '').trim() ||
          'GitHub-recorded merge contains the PR head but is not a two-parent merge commit',
      };
    }

    const firstParent = runEvidenceGit(
      ['rev-parse', `${attestation.merge_sha}^1`],
      context.repoRoot,
      context.gitRunner,
    );
    mainRef = String(firstParent.stdout ?? '').trim();
    if (firstParent.error || firstParent.status !== 0 || !SHA_RE.test(mainRef)) {
      return {
        status: 'unverified',
        detail: firstParent.error?.message ||
          String(firstParent.stderr ?? '').trim() ||
          'GitHub-recorded merge first parent could not be resolved',
      };
    }
    if (mainRef.toLowerCase() === attestation.head_sha.toLowerCase()) {
      return {
        status: 'unverified',
        detail: 'GitHub-recorded merge has anomalous parent ordering: parent 1 equals the PR head',
      };
    }
  } else {
    // Squash and rebase strategies leave the original PR head disjoint from the
    // recorded merge SHA. Their merge base is the pre-PR main-side reference.
    const mergeBase = runEvidenceGit(
      ['merge-base', attestation.head_sha, attestation.merge_sha],
      context.repoRoot,
      context.gitRunner,
    );
    mainRef = String(mergeBase.stdout ?? '').trim();
    if (mergeBase.error || mergeBase.status !== 0 || !SHA_RE.test(mainRef)) {
      return {
        status: 'unverified',
        detail: mergeBase.error?.message ||
          String(mergeBase.stderr ?? '').trim() ||
          'GitHub-recorded PR head and merge SHA do not have a resolvable merge base',
      };
    }
  }

  return { status: 'pass', attestation, mainRef };
}

function verifyPostMergeMigrationReceiptBinding(
  receiptHead: string,
  verifiedSourceSha: string,
  issueId: string,
  context: EvidenceContractContext,
): MigrationReceiptBindingResult {
  if (!context.repoRoot) {
    return { status: 'unverified', detail: 'post-merge migration receipt ancestry requires repoRoot' };
  }

  const receiptUnavailable = verifyCommitAvailable(receiptHead, 'migration receipt head', context);
  if (receiptUnavailable) return receiptUnavailable;

  const resolution = resolveMergedPrAttestation(verifiedSourceSha, context);
  if (resolution.status !== 'pass') return resolution;
  const { attestation, mainRef } = resolution;

  if (receiptHead.toLowerCase() === attestation.head_sha.toLowerCase()) {
    return { status: 'pass' };
  }

  // A squash merge disconnects the PR-head history from the merge commit.
  // Validate both real branch-side ancestry and the direct non-squash path;
  // either path may establish a proof-only rebind, but neither may bypass the
  // authoritative GitHub merge/head attestation above. The original PR head is
  // retained by GitHub across squash, merge, and rebase strategies. The
  // strategy-specific reference above identifies the main state from which an
  // allowed main-sync import could have come without accepting a degenerate
  // reference back to the PR head.
  const branchSide = verifyProofOnlyMigrationAncestry(
    receiptHead,
    attestation.head_sha,
    mainRef,
    issueId,
    context,
  );
  const direct = verifyProofOnlyMigrationAncestry(
    receiptHead,
    verifiedSourceSha,
    mainRef,
    issueId,
    context,
  );
  if (branchSide.status === 'pass' || direct.status === 'pass') return { status: 'pass' };

  const unverified = [branchSide, direct].find(
    (result): result is Extract<MigrationReceiptBindingResult, { status: 'unverified' }> =>
      result.status === 'unverified',
  );
  if (unverified) return unverified;

  const nonProofPaths = [...new Set(
    [branchSide, direct]
      .filter(
        (result): result is Extract<MigrationReceiptBindingResult, { status: 'non-proof-delta' }> =>
          result.status === 'non-proof-delta',
      )
      .flatMap((result) => result.paths),
  )];
  if (nonProofPaths.length > 0) return { status: 'non-proof-delta', paths: nonProofPaths };

  return { status: 'not-ancestor' };
}

export type ExternalVerifierBindingCode =
  | 'verifier_provenance_bound_exact_source'
  | 'verifier_provenance_bound_merged_pr_head'
  | 'verifier_provenance_bound_merge_slot'
  | 'verifier_receipt_sha_invalid'
  | 'verifier_source_sha_invalid'
  | 'verifier_receipt_head_mismatch'
  | 'verifier_merge_slot_invalid'
  | 'verifier_merge_slot_premature'
  | 'verifier_source_not_in_merged_pr'
  | 'verifier_merge_attestation_mismatch'
  | 'verifier_merge_attestation_unverified';

type ExternalVerifierBindingSuccessCode =
  | 'verifier_provenance_bound_exact_source'
  | 'verifier_provenance_bound_merged_pr_head'
  | 'verifier_provenance_bound_merge_slot';

export type ExternalVerifierBindingResult =
  | { valid: true; code: ExternalVerifierBindingSuccessCode; detail: string }
  | { valid: false; code: Exclude<ExternalVerifierBindingCode, ExternalVerifierBindingSuccessCode>; detail: string };

/**
 * The caller's view of the schema-v2 authoritative merge slot.
 *
 * `declared` must be derived with `hasOwnProperty` on `sha_binding`, never from
 * truthiness: an explicitly-`null` slot is a *declared* slot, and conflating it
 * with an absent one would route a modern bundle into the historical
 * pre-slot compatibility path. Omitting `mergeSlot` entirely preserves the
 * pre-UTV2-1776 behaviour, which is the stricter of the two.
 */
export interface EvidenceMergeSlot {
  declared: boolean;
  value?: unknown;
}

/**
 * Reads the authoritative merge slot off a `sha_binding` block without
 * collapsing "absent" and "null" into the same state.
 */
export function readEvidenceMergeSlot(binding: unknown): EvidenceMergeSlot {
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return { declared: false };
  if (!Object.prototype.hasOwnProperty.call(binding, 'merge_sha')) return { declared: false };
  return { declared: true, value: (binding as Record<string, unknown>)['merge_sha'] };
}

/**
 * Post-merge verification for a bundle that declares the authoritative merge
 * slot. Total: every path returns a decision, so a declared slot can never fall
 * through to source-derived merge authority.
 */
function verifyDeclaredMergeSlotBinding(
  receiptSha: string,
  verifiedSourceSha: string,
  slotValue: unknown,
  context: EvidenceContractContext,
): ExternalVerifierBindingResult {
  if (typeof slotValue !== 'string' || !SHA_RE.test(slotValue)) {
    return {
      valid: false,
      code: 'verifier_merge_slot_invalid',
      detail: 'post-merge evidence requires sha_binding.merge_sha to be a full 40-character Git SHA',
    };
  }

  const resolution = resolveMergedPrAttestation(slotValue, context, 'sha_binding.merge_sha');
  if (resolution.status === 'attestation-mismatch') {
    return { valid: false, code: 'verifier_merge_attestation_mismatch', detail: resolution.detail };
  }
  if (resolution.status !== 'pass') {
    return { valid: false, code: 'verifier_merge_attestation_unverified', detail: resolution.detail };
  }

  const attestation = resolution.attestation;

  // Execution/source identity keeps its own obligation. Two shapes are honest,
  // and nothing else is:
  //   1. the attested merge SHA itself — verification ran on the merge commit.
  //      This is the pre-UTV2-1776 shape, retained rather than broadened: it is
  //      no longer what *grants* merge authority, only what a verified source is
  //      allowed to be.
  //   2. the attested PR head, or an ancestor of it — verification ran inside
  //      the PR that GitHub merged. This is the split identity UTV2-1729 has.
  // Without this check any commit anywhere in the repository could claim to be
  // the verified source of a legitimately merged PR.
  if (verifiedSourceSha.toLowerCase() !== attestation.merge_sha.toLowerCase()) {
    const sourceInPr = verifiedSourceIsWithinAttestedPr(verifiedSourceSha, attestation.head_sha, context);
    if (sourceInPr !== true) {
      return {
        valid: false,
        code: sourceInPr === false ? 'verifier_source_not_in_merged_pr' : 'verifier_merge_attestation_unverified',
        detail: sourceInPr === false
          ? `sha_binding.verified_source_sha ${verifiedSourceSha} is neither the GitHub-recorded merge SHA nor the attested PR head ${attestation.head_sha} nor an ancestor of it`
          : sourceInPr,
      };
    }
  }

  const matchesSource = receiptSha.toLowerCase() === verifiedSourceSha.toLowerCase();
  const matchesHead = receiptSha.toLowerCase() === attestation.head_sha.toLowerCase();
  if (!matchesSource && !matchesHead) {
    return {
      valid: false,
      code: 'verifier_receipt_head_mismatch',
      detail: 'external verifier receipt must match sha_binding.verified_source_sha or the GitHub-attested original PR head',
    };
  }

  return {
    valid: true,
    code: 'verifier_provenance_bound_merge_slot',
    detail: `sha_binding.merge_sha ${slotValue} matches the GitHub-recorded merge of PR #${attestation.pr_number}; verified source ${verifiedSourceSha} is within that PR`,
  };
}

/**
 * `true` when the verified source is the attested PR head or an ancestor of it,
 * `false` when it provably is not, and a diagnostic string when the check could
 * not be completed — which the caller treats as unverified, never as a pass.
 */
function verifiedSourceIsWithinAttestedPr(
  verifiedSourceSha: string,
  headSha: string,
  context: EvidenceContractContext,
): true | false | string {
  if (verifiedSourceSha.toLowerCase() === headSha.toLowerCase()) return true;
  if (!context.repoRoot) return 'verified-source ancestry requires repoRoot';

  const available = verifyCommitAvailable(verifiedSourceSha, 'verified source', context);
  if (available) return available.detail;

  const ancestry = runEvidenceGit(
    ['merge-base', '--is-ancestor', verifiedSourceSha, headSha],
    context.repoRoot,
    context.gitRunner,
  );
  if (ancestry.error || ancestry.status === null || ancestry.status > 1) {
    return ancestry.error?.message ||
      String(ancestry.stderr ?? '').trim() ||
      'verified-source ancestry check did not complete';
  }
  return ancestry.status === 0;
}

/**
 * Binds an external required-check receipt to schema-v2 evidence.
 *
 * Two identities are involved and they are deliberately not the same thing:
 *
 *  - **Merge authority** — which commit GitHub actually recorded as the merge.
 *    In a schema-v2 bundle this lives in the explicit `sha_binding.merge_sha`
 *    slot and nowhere else. It is checked against the GitHub merged-PR
 *    attestation, so neither a branch SHA nor the original PR head can satisfy
 *    it, and a missing/incomplete/foreign attestation fails closed.
 *  - **Execution/source identity** — which commit the verification actually ran
 *    on. That is `sha_binding.verified_source_sha`, and it keeps its own
 *    provenance obligation: it must be the attested PR head or an ancestor of
 *    it, i.e. genuinely part of the merged PR.
 *
 * Before UTV2-1776 there was no explicit slot, so merge authority was read off
 * `verified_source_sha`, which forced the two identities to be equal. Under a
 * squash merge they never can be, which is exactly how Post-Merge Lane Close run
 * 33268421913 rejected a valid UTV2-1729 bundle at P10 and R3.
 *
 * When `mergeSlot` is absent the historical behaviour is used unchanged; when it
 * is declared, merge authority is taken from the slot. The slot branch is
 * evaluated *before* the exact-source shortcut on purpose: otherwise a bundle
 * naming the wrong merge SHA would pass unchecked whenever its receipt happened
 * to be the exact source head.
 */
export function verifyExternalVerifierProvenanceBinding(input: {
  receiptSha: string | null | undefined;
  verifiedSourceSha: string | null | undefined;
  context: EvidenceContractContext;
  /** Omit to keep pre-UTV2-1776 semantics. See {@link readEvidenceMergeSlot}. */
  mergeSlot?: EvidenceMergeSlot;
}): ExternalVerifierBindingResult {
  const receiptSha = input.receiptSha?.trim() ?? '';
  const verifiedSourceSha = input.verifiedSourceSha?.trim() ?? '';
  if (!SHA_RE.test(receiptSha)) {
    return {
      valid: false,
      code: 'verifier_receipt_sha_invalid',
      detail: 'external verifier receipt must identify a full 40-character Git SHA',
    };
  }
  if (!SHA_RE.test(verifiedSourceSha)) {
    return {
      valid: false,
      code: 'verifier_source_sha_invalid',
      detail: 'sha_binding.verified_source_sha must be a full 40-character Git SHA',
    };
  }

  // Authoritative merge-slot semantics. Evaluated ahead of the exact-source
  // shortcut so a wrong slot can never ride in on a matching receipt.
  const mergeSlot = input.mergeSlot;
  if (mergeSlot?.declared) {
    if (input.context.gate === 'post-merge-read') {
      return verifyDeclaredMergeSlotBinding(receiptSha, verifiedSourceSha, mergeSlot.value, input.context);
    }
    if (mergeSlot.value !== null) {
      return {
        valid: false,
        code: 'verifier_merge_slot_premature',
        detail: 'pre-merge evidence requires sha_binding.merge_sha to be null; a branch SHA is never merge authority',
      };
    }
    // merge_sha: null at a pre-merge gate is the correct authored shape; fall
    // through to the unchanged exact-source rule below.
  }

  if (receiptSha.toLowerCase() === verifiedSourceSha.toLowerCase()) {
    return {
      valid: true,
      code: 'verifier_provenance_bound_exact_source',
      detail: 'external verifier receipt exactly matches sha_binding.verified_source_sha',
    };
  }
  if (input.context.gate !== 'post-merge-read') {
    return {
      valid: false,
      code: 'verifier_receipt_head_mismatch',
      detail: 'pre-merge external verifier receipt must exactly match sha_binding.verified_source_sha',
    };
  }

  const attestation = input.context.mergedPrAttestation;
  if (!attestation || receiptSha.toLowerCase() !== attestation.head_sha?.toLowerCase()) {
    return {
      valid: false,
      code: 'verifier_receipt_head_mismatch',
      detail: 'external verifier receipt must match the GitHub-attested original PR head',
    };
  }

  const resolution = resolveMergedPrAttestation(verifiedSourceSha, input.context);
  if (resolution.status === 'attestation-mismatch') {
    return {
      valid: false,
      code: 'verifier_merge_attestation_mismatch',
      detail: resolution.detail,
    };
  }
  if (resolution.status === 'unverified') {
    return {
      valid: false,
      code: 'verifier_merge_attestation_unverified',
      detail: resolution.detail,
    };
  }

  return {
    valid: true,
    code: 'verifier_provenance_bound_merged_pr_head',
    detail: `GitHub merged-PR attestation connects original head ${receiptSha} to merge ${verifiedSourceSha}`,
  };
}

/**
 * Historical compatibility for bundles that genuinely predate the reserved
 * `sha_binding.merge_sha` slot.
 *
 * The slot is mandatory. This is the single, deliberately narrow way a bundle
 * may lack it, and it is keyed on proven identity rather than on the bundle's
 * profile. An earlier form of this exemption keyed on `profile !== 'migration'`,
 * which matched the migration receipts it was written for but silently excluded
 * the static/governance receipts of the same vintage and equal authenticity.
 *
 * Three properties this must never give up, each asserted by its own test:
 *  - It never applies at the `pre-merge` gate. A bundle being authored or gated
 *    for merge must carry the slot, explicitly `null`.
 *  - It never lets a branch SHA satisfy merge authority. Eligibility is decided
 *    by `resolveMergedPrAttestation`, which requires `verified_source_sha` to
 *    equal the GitHub-recorded merge SHA of a real merged PR and verifies that
 *    merge's ancestry locally.
 *  - It is fail-closed. A missing repoRoot, a missing or incomplete attestation,
 *    or an attestation belonging to a different PR all resolve to something
 *    other than `pass`, and the slot is then required.
 */
function historicalMergeSlotIsExempt(
  binding: Record<string, unknown>,
  context: EvidenceContractContext,
  profileHint: EvidenceProofProfile | null,
): boolean {
  // Migration receipts are bound by their own older merged-PR attestation
  // contract, verified separately further down this module. Their exemption is
  // left exactly as it was authored, at both gates. Tightening it to require
  // `merge_sha: null` pre-merge is correct and intended, but the only fixture
  // that asserts the current behaviour lives in scripts/ops/truth-check-lib.test.ts,
  // which was released from this lane's file_scope_lock on 2026-08-28. Returned
  // to PM as an out-of-scope defect rather than widened here.
  if (profileHint === 'migration') return true;

  // Authoring/merge-gating never reads history: the slot is always required.
  if (context.gate === 'pre-merge') return false;

  const verifiedSourceSha = binding['verified_source_sha'];
  if (typeof verifiedSourceSha !== 'string' || !SHA_RE.test(verifiedSourceSha)) return false;

  return resolveMergedPrAttestation(verifiedSourceSha, context).status === 'pass';
}

function validateV2Binding(
  bundle: Record<string, unknown>,
  failures: EvidenceContractFailure[],
  context: EvidenceContractContext,
  profileHint: EvidenceProofProfile | null,
): void {
  if (Object.prototype.hasOwnProperty.call(bundle, 'merge_sha')) {
    failures.push({
      code: 'legacy_merge_sha_forbidden',
      field: 'merge_sha',
      message:
        'schema-v2 evidence forbids legacy top-level merge_sha; merge authority lives only at sha_binding.merge_sha',
    });
  }

  const rawBinding = bundle['sha_binding'];
  if (!isPopulatedRecord(rawBinding)) {
    failures.push({
      code: 'sha_binding_missing',
      field: 'sha_binding',
      message: 'schema-v2 evidence requires a populated sha_binding block',
    });
    return;
  }

  const binding = rawBinding;
  if (!Object.prototype.hasOwnProperty.call(binding, 'merge_sha')) {
    if (!historicalMergeSlotIsExempt(binding, context, profileHint)) {
      failures.push({
        code: 'sha_binding_merge_slot_missing',
        field: 'sha_binding.merge_sha',
        message:
          'schema-v2 evidence must declare sha_binding.merge_sha (null before merge, authoritative SHA after merge)',
      });
    }
  } else if (context.gate === 'pre-merge') {
    if (binding['merge_sha'] !== null) {
      failures.push({
        code: 'sha_binding_premature_merge_sha',
        field: 'sha_binding.merge_sha',
        message:
          'pre-merge evidence requires sha_binding.merge_sha to be null; a branch SHA must never be represented as a merge SHA',
      });
    }
  } else if (typeof binding['merge_sha'] !== 'string' || !SHA_RE.test(binding['merge_sha'])) {
    failures.push({
      code: 'sha_binding_invalid',
      field: 'sha_binding.merge_sha',
      message: 'post-merge evidence requires sha_binding.merge_sha to be a full 40-character Git SHA',
    });
  }

  if (typeof binding['verified_source_sha'] !== 'string' || !SHA_RE.test(binding['verified_source_sha'])) {
    failures.push({
      code: 'sha_binding_invalid',
      field: 'sha_binding.verified_source_sha',
      message: 'sha_binding.verified_source_sha must be a full 40-character Git SHA',
    });
  }

  for (const field of ['evidence_commit_sha', 'current_pr_head_sha'] as const) {
    const value = binding[field];
    if (typeof value !== 'string' || value.trim() === '') {
      failures.push({
        code: 'sha_binding_invalid',
        field: `sha_binding.${field}`,
        message: `sha_binding.${field} must be a non-empty CI-resolved value or sentinel`,
      });
    }
  }
}

function validateProfileEvidence(
  profile: EvidenceProofProfile,
  bundle: Record<string, unknown>,
  failures: EvidenceContractFailure[],
  context: EvidenceContractContext,
): void {
  if (profile === 'legacy-v1') return;

  if (!isPopulatedRecord(bundle['static_proof'])) {
    failures.push({
      code: 'static_proof_missing',
      field: 'static_proof',
      message: `${profile} proof requires a populated static_proof block`,
    });
  }

  if (profile === 'static') return;

  const runtimeProof = bundle['runtime_proof'];
  if (!isPopulatedRecord(runtimeProof)) {
    failures.push({
      code: 'runtime_proof_missing',
      field: 'runtime_proof',
      message: `${profile} proof requires a populated runtime_proof block`,
    });
    return;
  }

  if (profile === 'app-runtime') {
    if (!Array.isArray(runtimeProof['queries']) || runtimeProof['queries'].length === 0) {
      failures.push({
        code: 'runtime_queries_missing',
        field: 'runtime_proof.queries',
        message: 'app/runtime proof requires non-empty runtime_proof.queries',
      });
    }
    if (!Array.isArray(runtimeProof['row_counts']) || runtimeProof['row_counts'].length === 0) {
      failures.push({
        code: 'runtime_row_counts_missing',
        field: 'runtime_proof.row_counts',
        message: 'app/runtime proof requires non-empty runtime_proof.row_counts',
      });
    }
    return;
  }

  const receiptHead = runtimeProof['head'];
  if (typeof receiptHead !== 'string' || !SHA_RE.test(receiptHead)) {
    failures.push({
      code: 'migration_head_missing',
      field: 'runtime_proof.head',
      message: 'migration proof requires the exact 40-character source head for its run/job receipts',
    });
  } else {
    const binding = bundle['sha_binding'];
    const verifiedSourceSha = isPopulatedRecord(binding) &&
      typeof binding['verified_source_sha'] === 'string' &&
      SHA_RE.test(binding['verified_source_sha'])
      ? binding['verified_source_sha']
      : null;
    if (verifiedSourceSha) {
      if (context.gate === 'pre-merge' && receiptHead !== verifiedSourceSha) {
        failures.push({
          code: 'migration_receipt_head_mismatch',
          field: 'runtime_proof.head',
          message: 'pre-merge migration receipt head must equal sha_binding.verified_source_sha',
        });
      } else if (context.gate === 'post-merge-read') {
        const ancestry = verifyPostMergeMigrationReceiptBinding(
          receiptHead,
          verifiedSourceSha,
          String(bundle['issue_id'] ?? ''),
          context,
        );
        if (ancestry.status === 'not-ancestor') {
          failures.push({
            code: 'migration_receipt_not_ancestor',
            field: 'runtime_proof.head',
            message: 'migration receipt head is not connected by a proof-only path to the attested PR head or merge SHA',
          });
        } else if (ancestry.status === 'non-proof-delta') {
          failures.push({
            code: 'migration_receipt_non_proof_delta',
            field: 'runtime_proof.head',
            message: `non-proof commits exist between the migration receipt and rebound source: ${ancestry.paths.join(', ')}`,
          });
        } else if (ancestry.status === 'attestation-mismatch') {
          failures.push({
            code: 'migration_receipt_merge_attestation_mismatch',
            field: 'sha_binding.verified_source_sha',
            message: ancestry.detail,
          });
        } else if (ancestry.status === 'unverified') {
          failures.push({
            code: 'migration_receipt_ancestry_unverified',
            field: 'runtime_proof.head',
            message: `migration receipt ancestry could not be mechanically verified: ${ancestry.detail}`,
          });
        }
      }
    }
  }

  const refusal = runtimeProof['precondition_drill'];
  if (!migrationReceiptPass(refusal)) {
    failures.push({
      code: 'migration_refusal_drill_missing',
      field: 'runtime_proof.precondition_drill',
      message: 'migration proof requires a passing refusal drill with exact run and job ids',
    });
  } else {
    const cases = Array.isArray(refusal['cases']) ? refusal['cases'].map(String) : [];
    if (!cases.some((entry) => /empty\s+(scratch|database|schema)|appl(?:y|ies|ied).*empty/i.test(entry))) {
      failures.push({
        code: 'migration_empty_scratch_missing',
        field: 'runtime_proof.precondition_drill.cases',
        message: 'migration refusal proof must also show successful application on an empty scratch target',
      });
    }
  }

  const migrationReceipts: Array<{
    field: string;
    code: EvidenceContractFailure['code'];
    message: string;
  }> = [
    {
      field: 'schema_roundtrip_drill',
      code: 'migration_roundtrip_missing',
      message: 'migration proof requires passing apply/rollback/reapply convergence with exact run and job ids',
    },
    {
      field: 'live_schema_parity',
      code: 'migration_schema_parity_missing',
      message: 'migration proof requires passing live schema parity with exact run and job ids',
    },
    {
      field: 'writable_db_proof_staging',
      code: 'migration_staging_proof_missing',
      message: 'migration proof requires passing staging writable-DB proof with exact run and job ids',
    },
  ];
  for (const receipt of migrationReceipts) {
    if (!migrationReceiptPass(runtimeProof[receipt.field])) {
      failures.push({
        code: receipt.code,
        field: `runtime_proof.${receipt.field}`,
        message: receipt.message,
      });
    }
  }
}

/**
 * Version-aware evidence-bundle contract shared by every pre/post-merge gate.
 *
 * V1 remains a supported legacy read format. V2 always requires SHA binding
 * and an explicit, fail-closed proof profile. The lane manifest is the
 * authoritative profile declaration; an evidence-authored profile may repeat
 * it but cannot select a weaker profile.
 */
export function validateEvidenceBundleContract(
  candidate: unknown,
  context: EvidenceContractContext,
): EvidenceContractResult {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return {
      valid: false,
      schemaVersion: null,
      profile: null,
      profileSource: null,
      failures: [{ code: 'invalid_root', field: 'root', message: 'evidence bundle must be a non-null object' }],
      bundle: null,
    };
  }

  const bundle = candidate as Record<string, unknown>;
  const rawVersion = bundle['schema_version'];
  if (rawVersion !== 1 && rawVersion !== 2) {
    return {
      valid: false,
      schemaVersion: null,
      profile: null,
      profileSource: null,
      failures: [{
        code: 'unsupported_schema_version',
        field: 'schema_version',
        message: `schema_version must be one of 1 or 2, got ${String(rawVersion)}`,
      }],
      bundle,
    };
  }

  if (rawVersion === 1) {
    if (context.gate === 'pre-merge') {
      return {
        valid: false,
        schemaVersion: 1,
        profile: 'legacy-v1',
        profileSource: 'legacy-schema',
        failures: [{
          code: 'legacy_v1_not_allowed_pre_merge',
          field: 'schema_version',
          message: 'schema-v1 evidence is historical read-only and cannot pass a pre-merge authoring gate',
        }],
        bundle,
      };
    }
    return {
      valid: true,
      schemaVersion: 1,
      profile: 'legacy-v1',
      profileSource: 'legacy-schema',
      failures: [],
      bundle,
    };
  }

  const declaredProfile = declaredProfileForLaneType(context.laneType);
  const authoredProfile = bundle['proof_profile'];
  const profileHint = declaredProfile ??
    (typeof authoredProfile === 'string' && AUTHORABLE_PROFILES.has(authoredProfile as EvidenceProofProfile)
      ? authoredProfile as EvidenceProofProfile
      : null);
  const failures: EvidenceContractFailure[] = [];
  validateV2Binding(bundle, failures, context, profileHint);

  let profile: EvidenceProofProfile | null = null;
  let profileSource: EvidenceContractResult['profileSource'] = null;

  if (authoredProfile !== undefined &&
      (typeof authoredProfile !== 'string' || !AUTHORABLE_PROFILES.has(authoredProfile as EvidenceProofProfile))) {
    failures.push({
      code: 'proof_profile_unknown',
      field: 'proof_profile',
      message: `proof_profile must be one of app-runtime, migration, or static; got ${String(authoredProfile)}`,
    });
  } else if (declaredProfile) {
    profile = declaredProfile;
    profileSource = 'manifest-lane-type';
    if (authoredProfile !== undefined && authoredProfile !== declaredProfile) {
      failures.push({
        code: 'proof_profile_mismatch',
        field: 'proof_profile',
        message: `proof_profile ${String(authoredProfile)} conflicts with manifest lane_type ${String(context.laneType)} (${declaredProfile})`,
      });
    }
  } else if (typeof authoredProfile === 'string' && AUTHORABLE_PROFILES.has(authoredProfile as EvidenceProofProfile)) {
    profile = authoredProfile as EvidenceProofProfile;
    profileSource = 'evidence';
  } else {
    failures.push({
      code: 'proof_profile_missing',
      field: 'proof_profile',
      message: context.laneType
        ? `manifest lane_type ${context.laneType} does not declare a recognized proof profile`
        : 'schema-v2 evidence requires proof_profile when no manifest lane_type is supplied',
    });
  }

  const verifier = bundle['verifier'];
  if (isPopulatedRecord(verifier) && typeof verifier['identity'] === 'string' && verifier['identity'].trim()) {
    failures.push({
      code: 'author_verifier_forbidden',
      field: 'verifier.identity',
      message: 'schema-v2 evidence must not carry author-written verifier.identity; exact-head provenance comes from CI',
    });
  }

  if (profile) validateProfileEvidence(profile, bundle, failures, context);

  return {
    valid: failures.length === 0,
    schemaVersion: 2,
    profile,
    profileSource,
    failures,
    bundle,
  };
}

function checkSha(
  failures: ValidationFailure[],
  field: string,
  value: unknown,
  required: boolean,
): void {
  if (value === null || value === undefined) {
    if (required) failures.push({ field, message: `${field} is required but missing` });
    return;
  }
  if (typeof value !== 'string' || !SHA_RE.test(value)) {
    failures.push({ field, message: `${field} must be a 40-char hex SHA, got: ${String(value).slice(0, 12)}` });
  }
}

/**
 * Validate a candidate proof object against the v2 schema.
 *
 * Returns { valid: true } when all required fields are present and
 * well-formed. Returns { valid: false, failures } listing every
 * violation — never throws.
 */
export function validateProofSchema(candidate: unknown): ValidationResult {
  const failures: ValidationFailure[] = [];

  if (candidate === null || typeof candidate !== 'object') {
    return { valid: false, failures: [{ field: 'root', message: 'proof must be a non-null object' }] };
  }

  const p = candidate as Record<string, unknown>;

  if (p['schema_version'] !== PROOF_SCHEMA_VERSION) {
    failures.push({
      field: 'schema_version',
      message: `schema_version must be ${PROOF_SCHEMA_VERSION}, got ${String(p['schema_version'])}`,
    });
  }

  if (typeof p['issue_id'] !== 'string' || !p['issue_id']) {
    failures.push({ field: 'issue_id', message: 'issue_id must be a non-empty string' });
  }

  if (typeof p['pr_number'] !== 'number' || !Number.isInteger(p['pr_number']) || p['pr_number'] <= 0) {
    failures.push({ field: 'pr_number', message: 'pr_number must be a positive integer' });
  }

  checkSha(failures, 'source_sha', p['source_sha'], true);
  checkSha(failures, 'reviewed_head_sha', p['reviewed_head_sha'], true);
  // evidence_commit_sha and merge_sha are allowed null (pre-merge)
  checkSha(failures, 'evidence_commit_sha', p['evidence_commit_sha'], false);
  checkSha(failures, 'merge_sha', p['merge_sha'], false);

  if (!Array.isArray(p['gate_results'])) {
    failures.push({ field: 'gate_results', message: 'gate_results must be an array' });
  } else {
    for (const [i, gr] of (p['gate_results'] as unknown[]).entries()) {
      if (typeof gr !== 'object' || gr === null) {
        failures.push({ field: `gate_results[${i}]`, message: 'each gate result must be an object' });
        continue;
      }
      const g = gr as Record<string, unknown>;
      if (typeof g['gate'] !== 'string' || !g['gate']) {
        failures.push({ field: `gate_results[${i}].gate`, message: 'gate name required' });
      }
      if (!['PASS', 'FAIL', 'SKIP'].includes(g['verdict'] as string)) {
        failures.push({ field: `gate_results[${i}].verdict`, message: 'verdict must be PASS|FAIL|SKIP' });
      }
      if (typeof g['detail'] !== 'string') {
        failures.push({ field: `gate_results[${i}].detail`, message: 'detail must be a string' });
      }
    }
  }

  if (typeof p['generated_at'] !== 'string' || !p['generated_at']) {
    failures.push({ field: 'generated_at', message: 'generated_at must be a non-empty ISO string' });
  }

  return { valid: failures.length === 0, failures };
}

/**
 * Assert proof is stale: source_sha does not match current_head_sha.
 *
 * Returns true (stale) when source_sha != current_head_sha and both
 * are non-null 40-char SHAs. A null current_head_sha is treated as
 * unknown (not stale) — the caller must supply current_head_sha.
 */
export function isProofStale(proof: ProofSchemaV2, currentHeadSha: string): boolean {
  if (!SHA_RE.test(currentHeadSha)) return false;
  if (!SHA_RE.test(proof.source_sha)) return true;
  return proof.source_sha !== currentHeadSha;
}
