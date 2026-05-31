/**
 * Performance Cohort — deterministic, replay-safe grouping of attribution records.
 *
 * Pure computation: no I/O, no DB, no HTTP, no env.
 *
 * A cohort is a time-windowed slice of settled picks. Cohorts are the unit of
 * analysis for consecutive-period significance testing (e.g. edge-decay detection).
 *
 * Reproducibility guarantee: given the same CohortInput (pick inputs + window),
 * buildPerformanceCohort always returns the same PerformanceCohort. Stored
 * CohortInput is the canonical replay artifact.
 *
 * Fail closed: returns { ok: false } when inputs are invalid, ambiguous, or
 * insufficient. Never silently degrades to an empty or partial cohort.
 */

import {
  attributePick,
  decomposePerformance,
  type AttributionDecomposition,
  type AttributionInput,
  type AttributionRecord,
} from '../attribution/attribution-engine.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Inclusive time window for a cohort. Both bounds are ISO-8601 timestamps. */
export interface CohortWindow {
  /** Inclusive lower bound. */
  readonly from: string;
  /** Inclusive upper bound. */
  readonly to: string;
  /** Optional human-readable label (e.g. "2026-W22"). Not used in computation. */
  readonly label?: string;
}

/** All inputs required to build or replay a performance cohort. */
export interface CohortInput {
  readonly cohort_id: string;
  readonly window: CohortWindow;
  /** Raw attribution inputs for every pick in this cohort. Stored for replay. */
  readonly picks: readonly AttributionInput[];
}

/** A fully constructed, replay-safe performance cohort. */
export interface PerformanceCohort {
  readonly cohort_id: string;
  readonly window: CohortWindow;
  readonly pick_count: number;
  readonly attribution_records: readonly AttributionRecord[];
  readonly decomposition: AttributionDecomposition;
  /** True when all attribution records are individually reproducible. */
  readonly is_reproducible: boolean;
  readonly version: string;
}

export type BuildCohortResult =
  | { ok: true; cohort: PerformanceCohort }
  | { ok: false; reason: string };

// ── Constants ─────────────────────────────────────────────────────────────────

const COHORT_VERSION = '1.0.0';

// ── Core construction ─────────────────────────────────────────────────────────

/**
 * Build a performance cohort from raw attribution inputs.
 * Fail-closed: returns { ok: false } on any validation error.
 * Deterministic: same inputs always produce the same cohort.
 */
export function buildPerformanceCohort(input: CohortInput): BuildCohortResult {
  const errors = validateCohortInput(input);
  if (errors.length > 0) {
    return { ok: false, reason: errors.join('; ') };
  }

  const records: AttributionRecord[] = [];
  const attributionErrors: string[] = [];

  for (const pick of input.picks) {
    const result = attributePick(pick);
    if (!result.ok) {
      attributionErrors.push(`pick ${pick.pick_id}: ${result.reason}`);
    } else {
      records.push(result.record);
    }
  }

  if (attributionErrors.length > 0) {
    return { ok: false, reason: `Attribution failed: ${attributionErrors.join('; ')}` };
  }

  // Enforce window membership: every pick's settled_at must fall within the window.
  const windowErrors = records.filter(
    (r) => r.settled_at < input.window.from || r.settled_at > input.window.to,
  );
  if (windowErrors.length > 0) {
    return {
      ok: false,
      reason: `COHORT_PICKS_OUTSIDE_WINDOW: ${windowErrors.map((r) => r.pick_id).join(', ')}`,
    };
  }

  const decomposition = decomposePerformance(records);
  const is_reproducible = records.every((r) => r.is_reproducible);

  return {
    ok: true,
    cohort: {
      cohort_id: input.cohort_id,
      window: input.window,
      pick_count: records.length,
      attribution_records: records,
      decomposition,
      is_reproducible,
      version: COHORT_VERSION,
    },
  };
}

/**
 * Reconstruct a cohort from stored CohortInput.
 * Deterministic: identical to buildPerformanceCohort — same inputs, same output.
 * Use for replay-safe verification and audit trails.
 */
export function reconstructCohort(stored: CohortInput): BuildCohortResult {
  return buildPerformanceCohort(stored);
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateCohortInput(input: CohortInput): string[] {
  const errors: string[] = [];

  if (!input.cohort_id || input.cohort_id.trim() === '') {
    errors.push('COHORT_MISSING_ID');
  }
  if (!input.window) {
    errors.push('COHORT_MISSING_WINDOW');
    return errors;
  }
  if (!input.window.from || input.window.from.trim() === '') {
    errors.push('COHORT_MISSING_WINDOW_FROM');
  }
  if (!input.window.to || input.window.to.trim() === '') {
    errors.push('COHORT_MISSING_WINDOW_TO');
  }
  if (
    input.window.from &&
    input.window.to &&
    input.window.from > input.window.to
  ) {
    errors.push('COHORT_WINDOW_FROM_AFTER_TO');
  }
  if (!input.picks) {
    errors.push('COHORT_MISSING_PICKS');
    return errors;
  }
  if (!Array.isArray(input.picks)) {
    errors.push('COHORT_PICKS_NOT_ARRAY');
    return errors;
  }
  if (input.picks.length === 0) {
    errors.push('COHORT_EMPTY_PICKS');
  }

  // Enforce pick_id uniqueness within cohort.
  const ids = input.picks.map((p) => p.pick_id);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (duplicates.length > 0) {
    errors.push(`COHORT_DUPLICATE_PICK_IDS: ${[...new Set(duplicates)].join(', ')}`);
  }

  return errors;
}
