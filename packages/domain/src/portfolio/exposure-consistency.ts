/**
 * Serializable Exposure Consistency — INIT-3.5.2
 *
 * Validates that a PortfolioExposureSnapshot is internally consistent and
 * that an ExposureEvent log is free of structural integrity violations.
 *
 * Constitutional guarantees:
 *  1. Consistency checks are pure and deterministic — same inputs, same verdict.
 *  2. Fail closed: any ambiguity or violation yields is_consistent=false.
 *  3. No mutations to the snapshot or event log.
 *  4. No capital, treasury, or scaling runtime is activated here.
 *  5. No DB access.
 *
 * Pure — no I/O, no DB, no env reads.
 */

import type { ExposureEvent, PortfolioExposureSnapshot } from './exposure-store.js';

// ── Result types ──────────────────────────────────────────────────────────────

export interface ConsistencyViolation {
  readonly rule: string;
  readonly detail: string;
}

export interface SnapshotConsistencyResult {
  readonly is_consistent: boolean;
  readonly violations: readonly ConsistencyViolation[];
}

export interface EventLogConsistencyResult {
  readonly is_consistent: boolean;
  readonly violations: readonly ConsistencyViolation[];
  readonly event_count: number;
  readonly unique_pick_count: number;
}

// ── Snapshot consistency ──────────────────────────────────────────────────────

/**
 * Verify that a reconstructed snapshot is internally consistent.
 *
 * Rules checked:
 *  S1 — Snapshot must be valid (is_valid === true).
 *  S2 — No duplicate pick_id in open_picks.
 *  S3 — Each open pick's stake_weight is in [0, 1].
 *  S4 — Each open pick has a non-empty pick_id.
 *  S5 — total_stake_weight equals sum of individual stake weights (within epsilon).
 *  S6 — open_picks is sorted by pick_id (replay stability invariant).
 */
export function verifySnapshotConsistency(
  snapshot: PortfolioExposureSnapshot,
): SnapshotConsistencyResult {
  const violations: ConsistencyViolation[] = [];

  // S1 — must be valid
  if (!snapshot.is_valid) {
    violations.push({
      rule: 'S1',
      detail: `Snapshot is invalid: ${snapshot.invalid_reason ?? 'unknown reason'}`,
    });
    // Short-circuit: remaining checks are meaningless on an invalid snapshot.
    return { is_consistent: false, violations };
  }

  const picks = snapshot.open_picks;
  const seenIds = new Set<string>();

  for (let i = 0; i < picks.length; i++) {
    const pick = picks[i]!;

    // S4 — non-empty pick_id
    if (!pick.pick_id || pick.pick_id.trim() === '') {
      violations.push({ rule: 'S4', detail: `open_picks[${i}] has blank pick_id` });
    }

    // S2 — no duplicates
    if (seenIds.has(pick.pick_id)) {
      violations.push({ rule: 'S2', detail: `Duplicate pick_id in snapshot: ${pick.pick_id}` });
    }
    seenIds.add(pick.pick_id);

    // S3 — stake_weight in range
    if (pick.stake_weight < 0 || pick.stake_weight > 1) {
      violations.push({
        rule: 'S3',
        detail: `pick ${pick.pick_id} stake_weight=${pick.stake_weight} out of [0,1]`,
      });
    }
  }

  // S5 — total_stake_weight matches sum
  const computedTotal = picks.reduce((sum, p) => sum + p.stake_weight, 0);
  if (Math.abs(computedTotal - snapshot.total_stake_weight) > 1e-9) {
    violations.push({
      rule: 'S5',
      detail: `total_stake_weight=${snapshot.total_stake_weight} but sum of picks=${computedTotal}`,
    });
  }

  // S6 — sorted by pick_id
  for (let i = 1; i < picks.length; i++) {
    if (picks[i - 1]!.pick_id > picks[i]!.pick_id) {
      violations.push({
        rule: 'S6',
        detail: `open_picks not sorted: ${picks[i - 1]!.pick_id} > ${picks[i]!.pick_id}`,
      });
    }
  }

  return { is_consistent: violations.length === 0, violations };
}

// ── Event log consistency ─────────────────────────────────────────────────────

/**
 * Verify that an event log is structurally consistent prior to reconstruction.
 *
 * Rules checked:
 *  E1 — No duplicate event_id values.
 *  E2 — All recorded_at_ms values are positive finite numbers.
 *  E3 — All stake_weight values on 'opened' events are in [0, 1].
 *  E4 — All event_type values are valid ('opened' | 'closed' | 'voided').
 *  E5 — All pick_id values are non-empty strings.
 */
export function verifyEventLogConsistency(
  events: readonly ExposureEvent[],
): EventLogConsistencyResult {
  const violations: ConsistencyViolation[] = [];
  const seenEventIds = new Set<string>();
  const pickIds = new Set<string>();
  const validTypes = new Set(['opened', 'closed', 'voided']);

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;

    // E5 — pick_id non-empty
    if (!e.pick_id || e.pick_id.trim() === '') {
      violations.push({ rule: 'E5', detail: `events[${i}] has blank pick_id` });
    } else {
      pickIds.add(e.pick_id);
    }

    // E1 — unique event_id
    if (seenEventIds.has(e.event_id)) {
      violations.push({ rule: 'E1', detail: `Duplicate event_id: ${e.event_id}` });
    }
    seenEventIds.add(e.event_id);

    // E2 — valid timestamp
    if (typeof e.recorded_at_ms !== 'number' || !isFinite(e.recorded_at_ms) || e.recorded_at_ms <= 0) {
      violations.push({
        rule: 'E2',
        detail: `events[${i}] recorded_at_ms=${e.recorded_at_ms} is not a positive finite number`,
      });
    }

    // E4 — valid event_type
    if (!validTypes.has(e.event_type)) {
      violations.push({ rule: 'E4', detail: `events[${i}] unknown event_type=${e.event_type}` });
    }

    // E3 — stake_weight on opened events
    if (e.event_type === 'opened') {
      if (typeof e.stake_weight !== 'number' || e.stake_weight < 0 || e.stake_weight > 1) {
        violations.push({
          rule: 'E3',
          detail: `events[${i}] opened event stake_weight=${e.stake_weight} out of [0,1]`,
        });
      }
    }
  }

  return {
    is_consistent: violations.length === 0,
    violations,
    event_count: events.length,
    unique_pick_count: pickIds.size,
  };
}
