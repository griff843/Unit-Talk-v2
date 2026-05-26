/**
 * ProofFreshness (UTV2-1103 / INIT-2.2.4)
 *
 * Freshness window enforcement for ProofBundles.
 * Blueprint Section 9.16: each ProofBundle carries a freshness window;
 * stale bundles are invalid for active certification.
 *
 * Invariants:
 * - Stale or expired proof bundles are constitutionally invalid.
 * - Freshness state is replayable (deterministic from createdAt + windowMs).
 * - Stale-proof rejections emit AuditEvents.
 * - No configuration can suppress rejection — fail-closed.
 */

import { randomUUID } from 'node:crypto';
import type { AuditEvent } from './quarantine.js';

// ---------------------------------------------------------------------------
// Freshness windows
// ---------------------------------------------------------------------------

export const FRESHNESS_WINDOWS_MS = {
  governance: 7 * 24 * 60 * 60 * 1000,      // 7 days — governance proofs
  t1: 24 * 60 * 60 * 1000,                   // 24 hours — T1 runtime proofs
  t2: 7 * 24 * 60 * 60 * 1000,               // 7 days — T2 proofs
  t3: 30 * 24 * 60 * 60 * 1000,              // 30 days — T3 proofs
  certification: 90 * 24 * 60 * 60 * 1000,   // 90 days — certification artifacts
} as const;

export type FreshnessClass = keyof typeof FRESHNESS_WINDOWS_MS;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type FreshnessFailureKind =
  | 'missing-created-at'
  | 'invalid-created-at'
  | 'stale-bundle'
  | 'future-created-at';

export interface FreshnessFailure {
  kind: FreshnessFailureKind;
  field: string;
  message: string;
  ageMs: number | null;
  windowMs: number;
}

export interface FreshnessResult {
  valid: boolean;
  fresh: boolean;
  ageMs: number | null;
  windowMs: number;
  freshnessClass: FreshnessClass;
  failures: FreshnessFailure[];
  checkedAt: string;
  auditRef: string;
}

// ---------------------------------------------------------------------------
// Core enforcement
// ---------------------------------------------------------------------------

/**
 * Check whether a ProofBundle's createdAt falls within the allowed freshness window.
 * Returns a structured FreshnessResult with typed failures.
 * Always emits an AuditEvent.
 */
export function checkProofFreshness(
  createdAt: unknown,
  freshnessClass: FreshnessClass = 'governance',
  context: { issueId?: string; bundleId?: string } = {},
): { result: FreshnessResult; auditEvent: AuditEvent } {
  const checkedAt = new Date().toISOString();
  const nowMs = Date.now();
  const windowMs = FRESHNESS_WINDOWS_MS[freshnessClass];
  const auditId = randomUUID();
  const failures: FreshnessFailure[] = [];

  if (createdAt === null || createdAt === undefined) {
    failures.push({
      kind: 'missing-created-at',
      field: 'createdAt',
      message: 'createdAt is null or undefined — bundle has no freshness anchor',
      ageMs: null,
      windowMs,
    });
    return buildResult(null, windowMs, freshnessClass, failures, checkedAt, auditId, context);
  }

  if (typeof createdAt !== 'string' || createdAt.trim() === '') {
    failures.push({
      kind: 'invalid-created-at',
      field: 'createdAt',
      message: `createdAt must be a non-empty ISO-8601 string; got: ${JSON.stringify(createdAt)}`,
      ageMs: null,
      windowMs,
    });
    return buildResult(null, windowMs, freshnessClass, failures, checkedAt, auditId, context);
  }

  const createdAtMs = Date.parse(createdAt);
  if (isNaN(createdAtMs)) {
    failures.push({
      kind: 'invalid-created-at',
      field: 'createdAt',
      message: `createdAt is not a valid ISO-8601 date: ${JSON.stringify(createdAt)}`,
      ageMs: null,
      windowMs,
    });
    return buildResult(null, windowMs, freshnessClass, failures, checkedAt, auditId, context);
  }

  const ageMs = nowMs - createdAtMs;

  if (ageMs < 0) {
    failures.push({
      kind: 'future-created-at',
      field: 'createdAt',
      message: `createdAt is in the future (${Math.abs(ageMs)}ms ahead) — clock skew or tampered timestamp`,
      ageMs,
      windowMs,
    });
    return buildResult(ageMs, windowMs, freshnessClass, failures, checkedAt, auditId, context);
  }

  if (ageMs >= windowMs) {
    const ageDays = (ageMs / (24 * 60 * 60 * 1000)).toFixed(1);
    const windowDays = (windowMs / (24 * 60 * 60 * 1000)).toFixed(1);
    failures.push({
      kind: 'stale-bundle',
      field: 'createdAt',
      message: `bundle is stale: age=${ageDays} days, window=${windowDays} days (class: ${freshnessClass}) — stale proof is constitutionally invalid for active certification`,
      ageMs,
      windowMs,
    });
  }

  return buildResult(ageMs, windowMs, freshnessClass, failures, checkedAt, auditId, context);
}

// ---------------------------------------------------------------------------
// Bundle-level freshness check
// ---------------------------------------------------------------------------

/**
 * Check freshness of a full ProofBundle object (reads createdAt from bundle).
 */
export function checkBundleFreshness(
  bundle: unknown,
  freshnessClass: FreshnessClass = 'governance',
  context: { issueId?: string; bundleId?: string } = {},
): { result: FreshnessResult; auditEvent: AuditEvent } {
  if (typeof bundle !== 'object' || bundle === null || Array.isArray(bundle)) {
    const windowMs = FRESHNESS_WINDOWS_MS[freshnessClass];
    const checkedAt = new Date().toISOString();
    const auditId = randomUUID();
    const failures: FreshnessFailure[] = [{
      kind: 'missing-created-at',
      field: 'bundle',
      message: 'bundle must be a non-null object',
      ageMs: null,
      windowMs,
    }];
    return buildResult(null, windowMs, freshnessClass, failures, checkedAt, auditId, context);
  }

  const b = bundle as Record<string, unknown>;
  const bundleId = typeof b['id'] === 'string' ? b['id'] : undefined;
  return checkProofFreshness(b['createdAt'], freshnessClass, {
    ...context,
    ...(bundleId !== undefined && { bundleId }),
  });
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

export class ProofFreshnessGateError extends Error {
  readonly result: FreshnessResult;

  constructor(result: FreshnessResult) {
    const summary = result.failures.map((f) => f.message).join('; ');
    super(`Proof bundle rejected — stale or invalid: ${summary}`);
    this.name = 'ProofFreshnessGateError';
    this.result = result;
  }
}

/**
 * Assert freshness or throw ProofFreshnessGateError.
 * Use at certification consumption points.
 */
export function requireFreshProof(
  bundle: unknown,
  freshnessClass: FreshnessClass = 'governance',
  context: { issueId?: string; bundleId?: string } = {},
): FreshnessResult {
  const { result } = checkBundleFreshness(bundle, freshnessClass, context);
  if (!result.valid) {
    throw new ProofFreshnessGateError(result);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Result builder
// ---------------------------------------------------------------------------

function buildResult(
  ageMs: number | null,
  windowMs: number,
  freshnessClass: FreshnessClass,
  failures: FreshnessFailure[],
  checkedAt: string,
  auditId: string,
  context: { issueId?: string; bundleId?: string },
): { result: FreshnessResult; auditEvent: AuditEvent } {
  const valid = failures.length === 0;
  const fresh = valid;

  const result: FreshnessResult = {
    valid,
    fresh,
    ageMs,
    windowMs,
    freshnessClass,
    failures,
    checkedAt,
    auditRef: auditId,
  };

  const auditEvent: AuditEvent = Object.freeze({
    id: auditId,
    event_type: 'invariant_violation' as const,
    invariant_id: `proof-freshness:${context.issueId ?? 'unknown'}`,
    severity: 'governance-critical' as const,
    quarantine_behavior: valid ? ('advisory' as const) : ('fail-closed' as const),
    recorded_at: checkedAt,
    payload: Object.freeze({
      entity_type: 'freshness_result',
      action: valid ? 'freshness-verified' : 'freshness-rejected',
      issueId: context.issueId ?? null,
      bundleId: context.bundleId ?? null,
      freshnessClass,
      ageMs,
      windowMs,
      valid,
      failure_count: failures.length,
      failures: failures.map((f) => ({ kind: f.kind, field: f.field })),
    }),
    immutable: true as const,
  });

  return { result, auditEvent };
}
