/**
 * ProofBundle (UTV2-1100 / INIT-2.2.1)
 *
 * Runtime entity representing a cryptographically-bound proof of completion.
 * Replaces the previous pattern of markdown documents checked by CI string-match.
 *
 * - All required fields validated on creation — throws ProofBundleValidationError if any missing/invalid.
 * - validationHash computed deterministically: sha256(sorted artifact SHAs joined by ',').
 * - Emits an AuditEvent when created.
 * - Pure data structure: no I/O, no Supabase, no HTTP.
 * - mergeSha must be exactly 40 hex chars — sentinel strings like "set-by-ci" are rejected.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { AuditEvent } from './quarantine.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ProofArtifactKind =
  | 'test-output'
  | 'type-check'
  | 'lint'
  | 'build'
  | 'runtime-db'
  | 'r-level'
  | 'sha-binding';

export interface ProofArtifact {
  kind: ProofArtifactKind;   // required
  path: string;               // required — file path or descriptor
  sha: string;                // required — SHA of artifact content
  generatedAt: string;        // required — ISO-8601
  reproducible: boolean;      // required — can re-running reproduce same SHA?
  lineage: string;            // required — what process generated this
}

export interface ProofBundle {
  id: string;                 // auto-generated
  schemaVersion: 1;           // always 1
  issueId: string;            // required — e.g. "UTV2-1100"
  mergeSha: string;           // required — 40-char hex, NOT a branch HEAD
  artifacts: ProofArtifact[]; // required — at least 1
  validationHash: string;     // required — deterministic hash of sorted artifact SHAs
  createdAt: string;          // required — ISO-8601
  auditRef: string;           // required — reference to AuditEvent id
}

export interface ProofBundleInput {
  issueId: string;
  mergeSha: string;
  artifacts: ProofArtifact[];
  auditRef: string;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class ProofBundleValidationError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = 'ProofBundleValidationError';
    this.field = field;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const MERGE_SHA_REGEX = /^[0-9a-f]{40}$/i;

/**
 * Compute a deterministic validation hash from a set of artifacts.
 * Sort artifact SHAs alphabetically, join with ',', then sha256.
 */
function computeValidationHash(artifacts: ProofArtifact[]): string {
  const sortedShas = artifacts.map((a) => a.sha).sort();
  return createHash('sha256').update(sortedShas.join(',')).digest('hex');
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateInput(input: ProofBundleInput): void {
  if (!input.issueId || typeof input.issueId !== 'string' || input.issueId.trim() === '') {
    throw new ProofBundleValidationError('issueId', 'issueId must be a non-empty string');
  }

  if (!input.mergeSha || typeof input.mergeSha !== 'string' || input.mergeSha.trim() === '') {
    throw new ProofBundleValidationError('mergeSha', 'mergeSha must be a non-empty string');
  }
  if (!MERGE_SHA_REGEX.test(input.mergeSha)) {
    throw new ProofBundleValidationError(
      'mergeSha',
      `mergeSha must be exactly 40 hex chars (a real merge SHA); got: ${JSON.stringify(input.mergeSha)}`,
    );
  }

  if (!Array.isArray(input.artifacts) || input.artifacts.length === 0) {
    throw new ProofBundleValidationError(
      'artifacts',
      'artifacts must be a non-empty array (at least 1 artifact required)',
    );
  }

  for (const [i, artifact] of input.artifacts.entries()) {
    const prefix = `artifacts[${i}]`;

    if (!artifact.kind || typeof artifact.kind !== 'string' || artifact.kind.trim() === '') {
      throw new ProofBundleValidationError(
        `${prefix}.kind`,
        `${prefix}.kind must be a non-empty string`,
      );
    }

    if (!artifact.path || typeof artifact.path !== 'string' || artifact.path.trim() === '') {
      throw new ProofBundleValidationError(
        `${prefix}.path`,
        `${prefix}.path must be a non-empty string`,
      );
    }

    if (!artifact.sha || typeof artifact.sha !== 'string' || artifact.sha.trim() === '') {
      throw new ProofBundleValidationError(
        `${prefix}.sha`,
        `${prefix}.sha must be a non-empty string`,
      );
    }

    if (!artifact.generatedAt || typeof artifact.generatedAt !== 'string' || artifact.generatedAt.trim() === '') {
      throw new ProofBundleValidationError(
        `${prefix}.generatedAt`,
        `${prefix}.generatedAt must be a non-empty ISO-8601 string`,
      );
    }

    if (typeof artifact.reproducible !== 'boolean') {
      throw new ProofBundleValidationError(
        `${prefix}.reproducible`,
        `${prefix}.reproducible must be a boolean`,
      );
    }

    if (!artifact.lineage || typeof artifact.lineage !== 'string' || artifact.lineage.trim() === '') {
      throw new ProofBundleValidationError(
        `${prefix}.lineage`,
        `${prefix}.lineage must be a non-empty string`,
      );
    }
  }

  if (!input.auditRef || typeof input.auditRef !== 'string' || input.auditRef.trim() === '') {
    throw new ProofBundleValidationError('auditRef', 'auditRef must be a non-empty string');
  }
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Create a ProofBundle from validated input.
 * Throws ProofBundleValidationError for each validation failure.
 * Returns { bundle, auditEvent }.
 */
export function createProofBundle(input: ProofBundleInput): {
  bundle: ProofBundle;
  auditEvent: AuditEvent;
} {
  validateInput(input);

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const validationHash = computeValidationHash(input.artifacts);

  const bundle: ProofBundle = {
    id,
    schemaVersion: 1,
    issueId: input.issueId,
    mergeSha: input.mergeSha,
    artifacts: input.artifacts,
    validationHash,
    createdAt,
    auditRef: input.auditRef,
  };

  const auditEvent: AuditEvent = Object.freeze({
    id: randomUUID(),
    event_type: 'invariant_violation' as const, // semantic: proof creation is a governed event
    invariant_id: `proof-bundle:${input.issueId}`,
    severity: 'governance-critical' as const,
    quarantine_behavior: 'fail-closed' as const,
    recorded_at: createdAt,
    payload: Object.freeze({
      entity_type: 'proof_bundle',
      action: 'created',
      bundle_id: id,
      issueId: input.issueId,
      mergeSha: input.mergeSha,
      artifact_count: input.artifacts.length,
      validationHash,
      auditRef: input.auditRef,
    }),
    immutable: true as const,
  });

  return { bundle, auditEvent };
}

// ---------------------------------------------------------------------------
// Validation function
// ---------------------------------------------------------------------------

export interface ProofBundleValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate an existing ProofBundle.
 * Recomputes validationHash from artifacts and checks it matches the stored value.
 * Returns { valid, errors }.
 */
export function validateProofBundle(bundle: unknown): ProofBundleValidationResult {
  const errors: string[] = [];

  if (typeof bundle !== 'object' || bundle === null || Array.isArray(bundle)) {
    errors.push('bundle must be a non-null object');
    return { valid: false, errors };
  }

  const b = bundle as Record<string, unknown>;

  // Check mergeSha
  if (typeof b['mergeSha'] !== 'string' || !MERGE_SHA_REGEX.test(b['mergeSha'])) {
    errors.push(
      `mergeSha must be exactly 40 hex chars; got: ${JSON.stringify(b['mergeSha'])}`,
    );
  }

  // Check artifacts
  if (!Array.isArray(b['artifacts']) || (b['artifacts'] as unknown[]).length === 0) {
    errors.push('artifacts must be a non-empty array');
  } else {
    // Check each artifact has a sha
    const artifacts = b['artifacts'] as Array<Record<string, unknown>>;
    for (const [i, artifact] of artifacts.entries()) {
      if (!artifact['sha'] || typeof artifact['sha'] !== 'string' || (artifact['sha'] as string).trim() === '') {
        errors.push(`artifacts[${i}].sha must be a non-empty string`);
      }
    }

    // Recompute validationHash if no sha errors
    if (errors.length === 0 && typeof b['validationHash'] === 'string') {
      const recomputed = computeValidationHash(
        artifacts as unknown as ProofArtifact[],
      );
      if (recomputed !== b['validationHash']) {
        errors.push(
          `validationHash mismatch: stored=${b['validationHash']}, recomputed=${recomputed}`,
        );
      }
    } else if (typeof b['validationHash'] !== 'string') {
      errors.push('validationHash must be a string');
    }
  }

  return { valid: errors.length === 0, errors };
}
