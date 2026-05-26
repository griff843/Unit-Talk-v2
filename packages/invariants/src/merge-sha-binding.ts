/**
 * MergeShaBinding (UTV2-1102 / INIT-2.2.3)
 *
 * Cryptographic binding of ProofBundle to a merge SHA, not a branch HEAD.
 * Blueprint Section 7.13: proof bound to a branch HEAD is invalid.
 *
 * Invariants:
 * - Branch-HEAD-bound bundles (short SHA, sentinel, non-merge SHA) are rejected.
 * - SHA binding is verifiable on replay.
 * - SHA-binding failures emit AuditEvents.
 * - No configuration can suppress rejection — fail-closed by design.
 */

import { randomUUID } from 'node:crypto';
import type { AuditEvent } from './quarantine.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ShaBindingFailureKind =
  | 'sentinel-sha'
  | 'short-sha'
  | 'invalid-format'
  | 'missing-sha'
  | 'branch-head-pattern';

export interface ShaBindingFailure {
  kind: ShaBindingFailureKind;
  field: string;
  message: string;
  provided: string | null;
}

export interface ShaBindingResult {
  valid: boolean;
  mergeSha: string | null;
  failures: ShaBindingFailure[];
  checkedAt: string;
  auditRef: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MERGE_SHA_REGEX = /^[0-9a-f]{40}$/i;

const SENTINEL_VALUES = new Set([
  'set-by-ci',
  'set_by_ci',
  'pending',
  'tbd',
  'unknown',
  'null',
  'undefined',
  '',
]);

const SHORT_SHA_REGEX = /^[0-9a-f]{1,39}$/i;

// ---------------------------------------------------------------------------
// Core assertion
// ---------------------------------------------------------------------------

/**
 * Assert that a mergeSha is a valid, full-length merge SHA.
 * Rejects sentinels, short SHAs (branch HEAD abbreviations), and malformed values.
 * Returns a structured ShaBindingResult with typed failures.
 * Always emits an AuditEvent.
 */
export function assertMergeShaBinding(
  mergeSha: unknown,
  context: { issueId?: string; bundleId?: string } = {},
): { result: ShaBindingResult; auditEvent: AuditEvent } {
  const checkedAt = new Date().toISOString();
  const auditId = randomUUID();
  const failures: ShaBindingFailure[] = [];

  if (mergeSha === null || mergeSha === undefined) {
    failures.push({
      kind: 'missing-sha',
      field: 'mergeSha',
      message: 'mergeSha is null or undefined — proof has no SHA binding',
      provided: null,
    });
    return buildResult(null, failures, checkedAt, auditId, context);
  }

  const sha = String(mergeSha);

  if (SENTINEL_VALUES.has(sha.trim().toLowerCase())) {
    failures.push({
      kind: 'sentinel-sha',
      field: 'mergeSha',
      message: `mergeSha is a sentinel placeholder: ${JSON.stringify(sha)} — proof is not bound to a real merge SHA`,
      provided: sha,
    });
    return buildResult(sha, failures, checkedAt, auditId, context);
  }

  if (SHORT_SHA_REGEX.test(sha)) {
    failures.push({
      kind: 'short-sha',
      field: 'mergeSha',
      message: `mergeSha is a short SHA (${sha.length} chars): ${JSON.stringify(sha)} — branch HEAD abbreviations are not accepted; provide the full 40-char merge SHA`,
      provided: sha,
    });
    return buildResult(sha, failures, checkedAt, auditId, context);
  }

  if (!MERGE_SHA_REGEX.test(sha)) {
    failures.push({
      kind: 'invalid-format',
      field: 'mergeSha',
      message: `mergeSha has invalid format: ${JSON.stringify(sha)} — must be exactly 40 lowercase hex chars`,
      provided: sha,
    });
    return buildResult(sha, failures, checkedAt, auditId, context);
  }

  return buildResult(sha, failures, checkedAt, auditId, context);
}

// ---------------------------------------------------------------------------
// Batch assertion (for validating a full bundle's sha_binding block)
// ---------------------------------------------------------------------------

export interface ShaBindingBlock {
  merge_sha?: unknown;
  verified_source_sha?: unknown;
  evidence_commit_sha?: unknown;
}

/**
 * Assert that all SHAs in a proof's sha_binding block are valid merge SHAs.
 * merge_sha is required; verified_source_sha and evidence_commit_sha are validated
 * if present (they may be set-by-ci before merge, which is acceptable pre-merge).
 */
export function assertShaBindingBlock(
  block: unknown,
  context: { issueId?: string } = {},
): { result: ShaBindingResult; auditEvent: AuditEvent } {
  const checkedAt = new Date().toISOString();
  const auditId = randomUUID();
  const failures: ShaBindingFailure[] = [];

  if (typeof block !== 'object' || block === null || Array.isArray(block)) {
    failures.push({
      kind: 'missing-sha',
      field: 'sha_binding',
      message: 'sha_binding block must be a non-null object',
      provided: null,
    });
    return buildResult(null, failures, checkedAt, auditId, context);
  }

  const b = block as ShaBindingBlock;

  // merge_sha is required and must be a full merge SHA
  const { result: mergeShaResult } = assertMergeShaBinding(b.merge_sha, context);
  if (!mergeShaResult.valid) {
    failures.push(...mergeShaResult.failures);
  }

  const mergeSha = mergeShaResult.valid ? (b.merge_sha as string) : null;
  return buildResult(mergeSha, failures, checkedAt, auditId, context);
}

// ---------------------------------------------------------------------------
// Result builder
// ---------------------------------------------------------------------------

function buildResult(
  mergeSha: string | null,
  failures: ShaBindingFailure[],
  checkedAt: string,
  auditId: string,
  context: { issueId?: string; bundleId?: string },
): { result: ShaBindingResult; auditEvent: AuditEvent } {
  const valid = failures.length === 0;

  const result: ShaBindingResult = {
    valid,
    mergeSha,
    failures,
    checkedAt,
    auditRef: auditId,
  };

  const auditEvent: AuditEvent = Object.freeze({
    id: auditId,
    event_type: 'invariant_violation' as const,
    invariant_id: `merge-sha-binding:${context.issueId ?? 'unknown'}`,
    severity: 'governance-critical' as const,
    quarantine_behavior: valid ? ('advisory' as const) : ('fail-closed' as const),
    recorded_at: checkedAt,
    payload: Object.freeze({
      entity_type: 'sha_binding_result',
      action: valid ? 'binding-verified' : 'binding-rejected',
      issueId: context.issueId ?? null,
      bundleId: context.bundleId ?? null,
      mergeSha,
      valid,
      failure_count: failures.length,
      failures: failures.map((f) => ({ kind: f.kind, field: f.field })),
    }),
    immutable: true as const,
  });

  return { result, auditEvent };
}

// ---------------------------------------------------------------------------
// Gate error
// ---------------------------------------------------------------------------

export class ShaBindingGateError extends Error {
  readonly result: ShaBindingResult;

  constructor(result: ShaBindingResult) {
    const summary = result.failures.map((f) => `${f.field}: ${f.message}`).join('; ');
    super(`Merge-SHA binding rejected — proof is invalid: ${summary}`);
    this.name = 'ShaBindingGateError';
    this.result = result;
  }
}

/**
 * Assert valid SHA binding or throw ShaBindingGateError.
 * Use this at certification consumption points to halt on invalid binding.
 */
export function requireMergeShaBinding(
  mergeSha: unknown,
  context: { issueId?: string; bundleId?: string } = {},
): string {
  const { result } = assertMergeShaBinding(mergeSha, context);
  if (!result.valid) {
    throw new ShaBindingGateError(result);
  }
  return result.mergeSha!;
}
