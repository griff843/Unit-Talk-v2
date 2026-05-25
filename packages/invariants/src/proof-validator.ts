/**
 * ProofValidator (UTV2-1101 / INIT-2.2.2)
 *
 * Mechanically validates ProofBundle instances — verifies completeness,
 * SHA binding, freshness, and reproducibility hash. Replaces CI string-match
 * validation on markdown documents (gap #8 validator component).
 *
 * Invariants:
 * - Incomplete, mis-bound, or stale bundles are rejected (fail-closed).
 * - Certification consumption halts on a rejected bundle.
 * - Validation results emit AuditEvents (auditable by design).
 * - No configuration can suppress rejection — immutable enforcement.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { AuditEvent } from './quarantine.js';
import type { ProofArtifact } from './proof-bundle.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ProofValidationFailureKind =
  | 'missing-field'
  | 'invalid-merge-sha'
  | 'stale-bundle'
  | 'hash-mismatch'
  | 'empty-artifacts'
  | 'invalid-artifact'
  | 'invalid-schema-version';

export interface ProofValidationFailure {
  kind: ProofValidationFailureKind;
  field: string;
  message: string;
}

export interface ProofValidationResult {
  valid: boolean;
  bundleId: string | null;
  issueId: string | null;
  failures: ProofValidationFailure[];
  validatedAt: string;
  auditRef: string;
}

export interface ProofValidatorOptions {
  maxAgeMs?: number;
}

const MERGE_SHA_REGEX = /^[0-9a-f]{40}$/i;
const SENTINEL_STRINGS = new Set(['set-by-ci', 'set_by_ci', '']);

const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function computeValidationHash(artifacts: ProofArtifact[]): string {
  const sortedShas = artifacts.map((a) => a.sha).sort();
  return createHash('sha256').update(sortedShas.join(',')).digest('hex');
}

function isSentinel(value: unknown): boolean {
  return typeof value !== 'string' || SENTINEL_STRINGS.has(value.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Core validator
// ---------------------------------------------------------------------------

export function validateProofBundle(
  bundle: unknown,
  options: ProofValidatorOptions = {},
): { result: ProofValidationResult; auditEvent: AuditEvent } {
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const validatedAt = new Date().toISOString();
  const failures: ProofValidationFailure[] = [];
  const auditId = randomUUID();

  if (typeof bundle !== 'object' || bundle === null || Array.isArray(bundle)) {
    failures.push({
      kind: 'missing-field',
      field: 'bundle',
      message: 'bundle must be a non-null object',
    });
    return buildResult(null, null, failures, validatedAt, auditId);
  }

  const b = bundle as Record<string, unknown>;
  const bundleId = typeof b['id'] === 'string' ? b['id'] : null;
  const issueId = typeof b['issueId'] === 'string' ? b['issueId'] : null;

  // schemaVersion
  if (b['schemaVersion'] !== 1) {
    failures.push({
      kind: 'invalid-schema-version',
      field: 'schemaVersion',
      message: `schemaVersion must be 1; got: ${JSON.stringify(b['schemaVersion'])}`,
    });
  }

  // id
  if (!bundleId || bundleId.trim() === '') {
    failures.push({ kind: 'missing-field', field: 'id', message: 'id must be a non-empty string' });
  }

  // issueId
  if (!issueId || issueId.trim() === '') {
    failures.push({ kind: 'missing-field', field: 'issueId', message: 'issueId must be a non-empty string' });
  }

  // mergeSha — sentinel strings and short SHAs are rejected
  const mergeSha = b['mergeSha'];
  if (isSentinel(mergeSha) || (typeof mergeSha === 'string' && !MERGE_SHA_REGEX.test(mergeSha))) {
    failures.push({
      kind: 'invalid-merge-sha',
      field: 'mergeSha',
      message: `mergeSha must be exactly 40 hex chars (a real merge SHA); got: ${JSON.stringify(mergeSha)}`,
    });
  }

  // artifacts
  const artifacts = b['artifacts'];
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    failures.push({
      kind: 'empty-artifacts',
      field: 'artifacts',
      message: 'artifacts must be a non-empty array',
    });
  } else {
    for (let i = 0; i < artifacts.length; i++) {
      const art = artifacts[i] as Record<string, unknown>;
      if (!art['sha'] || typeof art['sha'] !== 'string' || (art['sha'] as string).trim() === '') {
        failures.push({
          kind: 'invalid-artifact',
          field: `artifacts[${i}].sha`,
          message: `artifacts[${i}].sha must be a non-empty string`,
        });
      }
      if (!art['kind'] || typeof art['kind'] !== 'string' || (art['kind'] as string).trim() === '') {
        failures.push({
          kind: 'invalid-artifact',
          field: `artifacts[${i}].kind`,
          message: `artifacts[${i}].kind must be a non-empty string`,
        });
      }
      if (!art['path'] || typeof art['path'] !== 'string' || (art['path'] as string).trim() === '') {
        failures.push({
          kind: 'invalid-artifact',
          field: `artifacts[${i}].path`,
          message: `artifacts[${i}].path must be a non-empty string`,
        });
      }
      if (!art['generatedAt'] || typeof art['generatedAt'] !== 'string') {
        failures.push({
          kind: 'invalid-artifact',
          field: `artifacts[${i}].generatedAt`,
          message: `artifacts[${i}].generatedAt must be a non-empty ISO-8601 string`,
        });
      }
      if (typeof art['reproducible'] !== 'boolean') {
        failures.push({
          kind: 'invalid-artifact',
          field: `artifacts[${i}].reproducible`,
          message: `artifacts[${i}].reproducible must be a boolean`,
        });
      }
    }

    // validationHash — recompute and compare
    if (failures.filter((f) => f.kind === 'invalid-artifact').length === 0) {
      const stored = b['validationHash'];
      if (typeof stored !== 'string' || stored.trim() === '') {
        failures.push({
          kind: 'missing-field',
          field: 'validationHash',
          message: 'validationHash must be a non-empty string',
        });
      } else {
        const recomputed = computeValidationHash(artifacts as unknown as ProofArtifact[]);
        if (recomputed !== stored) {
          failures.push({
            kind: 'hash-mismatch',
            field: 'validationHash',
            message: `validationHash mismatch: stored=${stored}, recomputed=${recomputed} — bundle may be tampered`,
          });
        }
      }
    }
  }

  // createdAt — freshness check
  const createdAt = b['createdAt'];
  if (!createdAt || typeof createdAt !== 'string' || createdAt.trim() === '') {
    failures.push({
      kind: 'missing-field',
      field: 'createdAt',
      message: 'createdAt must be a non-empty ISO-8601 string',
    });
  } else {
    const createdAtMs = Date.parse(createdAt);
    if (isNaN(createdAtMs)) {
      failures.push({
        kind: 'missing-field',
        field: 'createdAt',
        message: `createdAt is not a valid ISO-8601 date: ${JSON.stringify(createdAt)}`,
      });
    } else {
      const ageMs = Date.now() - createdAtMs;
      if (ageMs >= maxAgeMs) {
        failures.push({
          kind: 'stale-bundle',
          field: 'createdAt',
          message: `bundle is stale: created ${Math.round(ageMs / 1000)}s ago, max allowed is ${Math.round(maxAgeMs / 1000)}s`,
        });
      }
    }
  }

  // auditRef
  if (!b['auditRef'] || typeof b['auditRef'] !== 'string' || (b['auditRef'] as string).trim() === '') {
    failures.push({
      kind: 'missing-field',
      field: 'auditRef',
      message: 'auditRef must be a non-empty string',
    });
  }

  return buildResult(bundleId, issueId, failures, validatedAt, auditId);
}

// ---------------------------------------------------------------------------
// Result builder
// ---------------------------------------------------------------------------

function buildResult(
  bundleId: string | null,
  issueId: string | null,
  failures: ProofValidationFailure[],
  validatedAt: string,
  auditId: string,
): { result: ProofValidationResult; auditEvent: AuditEvent } {
  const valid = failures.length === 0;

  const result: ProofValidationResult = {
    valid,
    bundleId,
    issueId,
    failures,
    validatedAt,
    auditRef: auditId,
  };

  const auditEvent: AuditEvent = Object.freeze({
    id: auditId,
    event_type: 'invariant_violation' as const,
    invariant_id: `proof-validator:${issueId ?? 'unknown'}`,
    severity: 'governance-critical' as const,
    quarantine_behavior: valid ? ('advisory' as const) : ('fail-closed' as const),
    recorded_at: validatedAt,
    payload: Object.freeze({
      entity_type: 'proof_validation_result',
      action: valid ? 'validated' : 'rejected',
      bundle_id: bundleId,
      issueId,
      valid,
      failure_count: failures.length,
      failures: failures.map((f) => ({ kind: f.kind, field: f.field })),
    }),
    immutable: true as const,
  });

  return { result, auditEvent };
}

// ---------------------------------------------------------------------------
// Certification gate
// ---------------------------------------------------------------------------

export class ProofValidatorCertificationGate {
  private readonly options: ProofValidatorOptions;

  constructor(options: ProofValidatorOptions = {}) {
    this.options = options;
  }

  /**
   * Assert that a bundle is valid before certification proceeds.
   * Throws ProofValidationGateError if the bundle is rejected.
   */
  assertValid(bundle: unknown): ProofValidationResult {
    const { result } = validateProofBundle(bundle, this.options);
    if (!result.valid) {
      throw new ProofValidationGateError(result);
    }
    return result;
  }
}

export class ProofValidationGateError extends Error {
  readonly result: ProofValidationResult;

  constructor(result: ProofValidationResult) {
    const summary = result.failures.map((f) => `${f.field}: ${f.message}`).join('; ');
    super(`Proof bundle rejected — certification halted: ${summary}`);
    this.name = 'ProofValidationGateError';
    this.result = result;
  }
}
