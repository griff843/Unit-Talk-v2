/**
 * Drawdown Monitor and Atomic Halt — INIT-3.5.3
 *
 * Monitors portfolio drawdown against configurable thresholds and emits
 * an atomic halt signal when a threshold is breached.
 *
 * Constitutional guarantees:
 *  1. Halt decisions are deterministic and replay-safe from the same inputs.
 *  2. Fail closed: missing or inconsistent exposure state always produces a halt.
 *  3. No capital deployment, treasury, or scaling operations are performed here.
 *  4. No Program 4 activation.
 *  5. Halt evidence is immutable once produced.
 *  6. No DB access.
 *
 * Depends on UTV2-1128 (PortfolioExposureSnapshot) and UTV2-1129 (consistency).
 *
 * Pure — no I/O, no DB, no env reads.
 */

import type { PortfolioExposureSnapshot } from './exposure-store.js';
import { verifySnapshotConsistency } from './exposure-consistency.js';

// ── Configuration ─────────────────────────────────────────────────────────────

export interface DrawdownThresholds {
  /**
   * Maximum fraction of bankroll exposed at any time (0–1).
   * Breach triggers STAKE_EXPOSURE_EXCEEDED halt.
   */
  readonly max_total_stake_weight: number;
  /**
   * Maximum number of simultaneous open picks.
   * Breach triggers PICK_COUNT_EXCEEDED halt.
   */
  readonly max_open_picks: number;
  /**
   * Minimum required snapshot consistency before any exposure decision.
   * When false, an inconsistent snapshot triggers CONSISTENCY_FAILURE halt.
   */
  readonly require_consistent_snapshot: boolean;
}

export const DEFAULT_DRAWDOWN_THRESHOLDS: DrawdownThresholds = {
  max_total_stake_weight: 1.0,
  max_open_picks: 20,
  require_consistent_snapshot: true,
} as const;

// ── Halt types ─────────────────────────────────────────────────────────────────

export type HaltReason =
  | 'STAKE_EXPOSURE_EXCEEDED'
  | 'PICK_COUNT_EXCEEDED'
  | 'CONSISTENCY_FAILURE'
  | 'INVALID_SNAPSHOT';

export type DrawdownStatus = 'nominal' | 'halted';

// ── Result types ──────────────────────────────────────────────────────────────

export interface DrawdownReading {
  readonly total_stake_weight: number;
  readonly open_pick_count: number;
  readonly max_total_stake_weight: number;
  readonly max_open_picks: number;
  /** Fraction of the stake threshold consumed (0–1+). */
  readonly stake_utilization: number;
  /** Fraction of the pick-count threshold consumed (0–1+). */
  readonly pick_utilization: number;
}

export interface HaltEvidence {
  readonly reason: HaltReason;
  readonly detail: string;
  readonly reading: DrawdownReading | null;
  readonly snapshot_event_count: number;
  /** Immutable once created. */
  readonly halted_at_ms: number;
}

export interface DrawdownMonitorResult {
  readonly status: DrawdownStatus;
  readonly reading: DrawdownReading | null;
  /** Present only when status === 'halted'. */
  readonly halt_evidence: HaltEvidence | null;
}

// ── Monitor function ──────────────────────────────────────────────────────────

/**
 * Evaluate a portfolio exposure snapshot against drawdown thresholds.
 *
 * Fails closed on any structural problem:
 *  - Invalid snapshot → INVALID_SNAPSHOT halt
 *  - Inconsistent snapshot (when required) → CONSISTENCY_FAILURE halt
 *  - Total stake weight breach → STAKE_EXPOSURE_EXCEEDED halt
 *  - Open pick count breach → PICK_COUNT_EXCEEDED halt
 *
 * @param snapshot   Reconstructed portfolio exposure snapshot.
 * @param thresholds Drawdown configuration (defaults to DEFAULT_DRAWDOWN_THRESHOLDS).
 * @param nowMs      Current timestamp in ms (required for deterministic evidence).
 */
export function evaluateDrawdown(
  snapshot: PortfolioExposureSnapshot,
  thresholds: DrawdownThresholds = DEFAULT_DRAWDOWN_THRESHOLDS,
  nowMs: number,
): DrawdownMonitorResult {
  // Fail closed on invalid snapshot — do not proceed.
  if (!snapshot.is_valid) {
    return halt('INVALID_SNAPSHOT', `Snapshot is invalid: ${snapshot.invalid_reason ?? 'unknown'}`, null, snapshot.event_count, nowMs);
  }

  // Consistency gate (when required).
  if (thresholds.require_consistent_snapshot) {
    const consistency = verifySnapshotConsistency(snapshot);
    if (!consistency.is_consistent) {
      const firstViolation = consistency.violations[0];
      return halt(
        'CONSISTENCY_FAILURE',
        `Snapshot consistency failure: ${firstViolation?.detail ?? 'unknown violation'}`,
        null,
        snapshot.event_count,
        nowMs,
      );
    }
  }

  const reading: DrawdownReading = {
    total_stake_weight: snapshot.total_stake_weight,
    open_pick_count: snapshot.open_picks.length,
    max_total_stake_weight: thresholds.max_total_stake_weight,
    max_open_picks: thresholds.max_open_picks,
    stake_utilization: thresholds.max_total_stake_weight > 0
      ? snapshot.total_stake_weight / thresholds.max_total_stake_weight
      : Infinity,
    pick_utilization: thresholds.max_open_picks > 0
      ? snapshot.open_picks.length / thresholds.max_open_picks
      : Infinity,
  };

  // Stake threshold breach.
  if (snapshot.total_stake_weight > thresholds.max_total_stake_weight) {
    return halt(
      'STAKE_EXPOSURE_EXCEEDED',
      `total_stake_weight=${snapshot.total_stake_weight} exceeds max=${thresholds.max_total_stake_weight}`,
      reading,
      snapshot.event_count,
      nowMs,
    );
  }

  // Pick count threshold breach.
  if (snapshot.open_picks.length > thresholds.max_open_picks) {
    return halt(
      'PICK_COUNT_EXCEEDED',
      `open_picks=${snapshot.open_picks.length} exceeds max=${thresholds.max_open_picks}`,
      reading,
      snapshot.event_count,
      nowMs,
    );
  }

  return { status: 'nominal', reading, halt_evidence: null };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function halt(
  reason: HaltReason,
  detail: string,
  reading: DrawdownReading | null,
  event_count: number,
  nowMs: number,
): DrawdownMonitorResult {
  return {
    status: 'halted',
    reading,
    halt_evidence: Object.freeze({
      reason,
      detail,
      reading,
      snapshot_event_count: event_count,
      halted_at_ms: nowMs,
    }),
  };
}
