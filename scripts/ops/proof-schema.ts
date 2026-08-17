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
    | 'migration_refusal_drill_missing'
    | 'migration_empty_scratch_missing'
    | 'migration_roundtrip_missing'
    | 'migration_schema_parity_missing'
    | 'migration_staging_proof_missing'
    | 'author_verifier_forbidden';
}

export type EvidenceValidationGate = 'pre-merge' | 'post-merge-read';

export interface EvidenceContractContext {
  /** Explicit caller boundary: authoring gates reject v1; historical readers may accept it. */
  gate: EvidenceValidationGate;
  /** Authoritative declaration from the lane manifest. */
  laneType?: string | null;
  tier?: string | null;
  /** Required to mechanically verify a post-merge migration receipt rebind. */
  repoRoot?: string | null;
}

export interface EvidenceContractResult {
  valid: boolean;
  schemaVersion: 1 | 2 | null;
  profile: EvidenceProofProfile | null;
  profileSource: 'legacy-schema' | 'manifest-lane-type' | 'evidence' | null;
  failures: EvidenceContractFailure[];
  bundle: Record<string, unknown> | null;
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

function declaredProfileForLaneType(laneType: string | null | undefined): EvidenceProofProfile | null {
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

type MigrationReceiptBindingResult =
  | { status: 'pass' }
  | { status: 'not-ancestor' }
  | { status: 'non-proof-delta'; paths: string[] }
  | { status: 'unverified'; detail: string };

function verifyProofOnlyMigrationAncestry(
  receiptHead: string,
  verifiedSourceSha: string,
  issueId: string,
  repoRoot: string | null | undefined,
): MigrationReceiptBindingResult {
  if (!repoRoot) {
    return { status: 'unverified', detail: 'post-merge migration receipt ancestry requires repoRoot' };
  }
  if (!/^(?:UTV2|UNI)-\d+$/.test(issueId)) {
    return { status: 'unverified', detail: 'post-merge migration receipt ancestry requires a valid issue_id' };
  }

  const ancestry = spawnSync(
    'git',
    ['merge-base', '--is-ancestor', receiptHead, verifiedSourceSha],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  if (ancestry.error || ancestry.status === null || ancestry.status > 1) {
    return {
      status: 'unverified',
      detail: ancestry.error?.message || String(ancestry.stderr ?? '').trim() || 'git ancestry check did not complete',
    };
  }
  if (ancestry.status === 1) return { status: 'not-ancestor' };

  // Inspect every commit, not just the net tree diff: a non-proof file changed
  // and later reverted is still a substantive delta and must fail closed.
  const changed = spawnSync(
    'git',
    ['log', '-m', '--format=', '--name-only', '--no-renames', `${receiptHead}..${verifiedSourceSha}`],
    { cwd: repoRoot, encoding: 'utf8' },
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
  return nonProof.length > 0 ? { status: 'non-proof-delta', paths: nonProof } : { status: 'pass' };
}

function validateV2Binding(
  bundle: Record<string, unknown>,
  failures: EvidenceContractFailure[],
): void {
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
    if (verifiedSourceSha && receiptHead !== verifiedSourceSha) {
      if (context.gate === 'pre-merge') {
        failures.push({
          code: 'migration_receipt_head_mismatch',
          field: 'runtime_proof.head',
          message: 'pre-merge migration receipt head must equal sha_binding.verified_source_sha',
        });
      } else {
        const ancestry = verifyProofOnlyMigrationAncestry(
          receiptHead,
          verifiedSourceSha,
          String(bundle['issue_id'] ?? ''),
          context.repoRoot,
        );
        if (ancestry.status === 'not-ancestor') {
          failures.push({
            code: 'migration_receipt_not_ancestor',
            field: 'runtime_proof.head',
            message: 'migration receipt head is not an ancestor of sha_binding.verified_source_sha',
          });
        } else if (ancestry.status === 'non-proof-delta') {
          failures.push({
            code: 'migration_receipt_non_proof_delta',
            field: 'runtime_proof.head',
            message: `non-proof commits exist between the migration receipt and rebound source: ${ancestry.paths.join(', ')}`,
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

  const failures: EvidenceContractFailure[] = [];
  validateV2Binding(bundle, failures);

  const declaredProfile = declaredProfileForLaneType(context.laneType);
  const authoredProfile = bundle['proof_profile'];
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
