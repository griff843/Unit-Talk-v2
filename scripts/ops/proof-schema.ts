/**
 * Canonical proof schema v2 for Workflow Runtime v2.
 *
 * Single source of truth for proof shape across:
 *   proof-binding-validator, proof-auditor, runtime-verifier,
 *   truth-check / lane-close, PM gate, and proof-check.
 *
 * Why schema_version=2: v1 (EvidenceBundleV1 in shared.ts) mixed
 * static fields with runtime fields and had no reviewer/PM verdict
 * slots. v2 is a clean forward-only schema; v1 is retained in
 * truth-check-lib.ts for backward-read compat only.
 */

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
