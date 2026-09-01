/**
 * Attribution Engine — decomposes realized performance into reproducible, auditable components.
 *
 * Pure computation: no I/O, no DB, no HTTP, no env.
 *
 * Decomposition model:
 *   realized_pnl = model_component + execution_component + luck_component
 *
 *   model_component:     EV at bet time — model's predicted edge
 *   execution_component: CLV at close minus CLV at bet — line movement captured after entry
 *   luck_component:      realized_pnl minus (model + execution) — pure variance
 *
 * All values in basis points (bps). Deterministic given the same inputs.
 * Fail closed: records with insufficient data are tagged INSUFFICIENT_DATA and excluded
 * from aggregate decompositions.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** Confidence level for a single attribution record. */
export type AttributionConfidence = 'high' | 'medium' | 'low' | 'insufficient_data';

/** Input required to attribute a single settled pick. */
export interface AttributionInput {
  readonly pick_id: string;
  readonly settled_at: string;
  /** Actual outcome: 'win' | 'loss' | 'push'. Push records contribute 0 bps. */
  readonly result: 'win' | 'loss' | 'push';
  /** Model expected value at bet time, in basis points (e.g., 520 = +5.20% EV). */
  readonly ev_bps: number;
  /** CLV at bet placement, in basis points. */
  readonly clv_at_bet_bps: number;
  /** CLV at market close, in basis points. */
  readonly clv_at_close_bps: number;
  /** Flat-bet stake in units (defaults to 1 if omitted). */
  readonly stake_units?: number;
  /** Whether a feature snapshot was available for this pick. */
  readonly has_feature_snapshot: boolean;
}

/** Per-pick attribution record — all components in basis points. */
export interface AttributionRecord {
  readonly pick_id: string;
  readonly settled_at: string;
  readonly result: 'win' | 'loss' | 'push';
  /** Model contribution: ev_bps (represents the edge predicted by the model). */
  readonly model_component_bps: number;
  /** Execution edge: CLV captured after entry (clv_at_close_bps - clv_at_bet_bps). */
  readonly execution_component_bps: number;
  /** Luck: realized_pnl_bps - (model_component_bps + execution_component_bps). */
  readonly luck_component_bps: number;
  /** Total realized PnL in basis points: +10000 for win, -10000 for loss, 0 for push. */
  readonly realized_pnl_bps: number;
  /** Sum check: model + execution + luck = realized_pnl (within rounding). */
  readonly components_sum_bps: number;
  readonly confidence: AttributionConfidence;
  readonly is_reproducible: boolean;
  /**
   * Provenance of the stake this record was computed with (UTV2-1815). A reader
   * can tell an observed stake from an assumed one without re-deriving it.
   */
  /**
   * UTV2-1815: provenance of the stake this record's units were computed from.
   * Optional only so that records constructed before this field existed still
   * type-check; `attributePick` always populates it. Readers must treat a
   * missing value as NOT canonical -- `status === 'canonical'` is the only
   * assertion that a real stake was observed, and it is false for `undefined`.
   */
  readonly stake_units_status?: StakeUnitsStatus;
}

/** Aggregate decomposition across a set of attribution records. */
export interface AttributionDecomposition {
  readonly total_records: number;
  readonly attributed_records: number;
  readonly excluded_insufficient_data: number;
  readonly total_realized_pnl_bps: number;
  readonly components: {
    readonly model_alpha_bps: number;
    readonly execution_edge_bps: number;
    readonly luck_bps: number;
    readonly sum_check_bps: number;
  };
  readonly by_confidence: Readonly<Record<AttributionConfidence, number>>;
  readonly is_reproducible: boolean;
  readonly version: string;
}

export type AttributeResult =
  | { ok: true; record: AttributionRecord }
  | { ok: false; reason: string };

// ── Constants ─────────────────────────────────────────────────────────────────

const BPS_PER_WIN = 10000;
const ATTRIBUTION_VERSION = '1.0.0';

// ── Stake-units contract (UTV2-1815) ─────────────────────────────────────────
//
// One agreed contract for what a stake of unknown size means, shared by
// settlement, grading and attribution. Before this existed the three paths
// disagreed: settlement failed closed and tagged the record, while grading and
// attribution each silently substituted 1 -- emitting a number that no later
// reader could distinguish from an observed stake. Eleven settlement_records
// carry concrete profitLossUnits values against a NULL stake with no tag, and
// the read-only audit could not determine which path produced them, precisely
// because an assumed value and an observed value looked identical.
//
// The rule: a computation that cannot see a real stake must either refuse, or
// carry a status that names the assumption. It must never return a bare number.

/**
 * Provenance of the stake behind a computation.
 *
 * - `canonical`          the pick carried a real, usable stake.
 * - `assumed_flat`       no stake was supplied at all and the caller's
 *                        documented flat-bet default of 1 unit was applied.
 *                        Legitimate, but it is an ASSUMPTION and says so.
 * - `historical_unknown` a stake was supplied and is unusable (null, NaN,
 *                        infinite, or non-positive). Fail closed.
 */
export type StakeUnitsStatus = 'canonical' | 'assumed_flat' | 'historical_unknown';

/** The outcome of applying the stake-units contract to one raw value. */
export interface StakeUnitsResolution {
  readonly status: StakeUnitsStatus;
  /**
   * The stake to compute with, or null when the contract refuses.
   * Null is the signal to refuse; it is never a licence to substitute.
   */
  readonly stake_units: number | null;
}

/** Error code emitted when a supplied stake cannot be used. */
export const ATTRIBUTION_INVALID_STAKE_UNITS = 'ATTRIBUTION_INVALID_STAKE_UNITS';

/** The flat-bet stake applied when no stake is supplied at all. */
export const ASSUMED_FLAT_STAKE_UNITS = 1;

/**
 * Apply the stake-units contract to a raw value from a pick.
 *
 * `undefined` means the field was never supplied, which is the documented
 * flat-bet case; it resolves to 1 and is tagged `assumed_flat` so the
 * assumption travels with the result. Anything supplied but unusable -- null,
 * NaN, Infinity, zero or negative -- resolves to `historical_unknown` with a
 * null stake, and every caller must refuse rather than pick a number.
 */
export function resolveStakeUnits(
  value: number | null | undefined,
): StakeUnitsResolution {
  if (value === undefined) {
    return { status: 'assumed_flat', stake_units: ASSUMED_FLAT_STAKE_UNITS };
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return { status: 'historical_unknown', stake_units: null };
  }
  return { status: 'canonical', stake_units: value };
}

// ── Core attribution ──────────────────────────────────────────────────────────

/**
 * Attribute a single settled pick.
 * Fail-closed: returns { ok: false } if inputs are invalid or insufficient.
 */
export function attributePick(input: AttributionInput): AttributeResult {
  const errors = validateAttributionInput(input);
  if (errors.length > 0) {
    return { ok: false, reason: errors.join('; ') };
  }

  // UTV2-1815: never `?? 1`. Validation above has already refused an unusable
  // stake, so this resolution is either canonical or the documented flat-bet
  // assumption -- and which one it was travels out on the record.
  const stakeResolution = resolveStakeUnits(input.stake_units);
  const stake = stakeResolution.stake_units ?? ASSUMED_FLAT_STAKE_UNITS;
  const stake_units_status = stakeResolution.status;
  const realized_pnl_bps =
    input.result === 'win'
      ? BPS_PER_WIN * stake
      : input.result === 'loss'
        ? -BPS_PER_WIN * stake
        : 0;

  const confidence = deriveConfidence(input);

  if (confidence === 'insufficient_data') {
    return {
      ok: true,
      record: {
        pick_id: input.pick_id,
        settled_at: input.settled_at,
        result: input.result,
        model_component_bps: 0,
        execution_component_bps: 0,
        luck_component_bps: realized_pnl_bps,
        realized_pnl_bps,
        components_sum_bps: realized_pnl_bps,
        confidence,
        is_reproducible: false,
        stake_units_status,
      },
    };
  }

  const model_component_bps = input.ev_bps * stake;
  const execution_component_bps =
    (input.clv_at_close_bps - input.clv_at_bet_bps) * stake;
  const luck_component_bps =
    realized_pnl_bps - model_component_bps - execution_component_bps;

  return {
    ok: true,
    record: {
      pick_id: input.pick_id,
      settled_at: input.settled_at,
      result: input.result,
      model_component_bps: round4(model_component_bps),
      execution_component_bps: round4(execution_component_bps),
      luck_component_bps: round4(luck_component_bps),
      realized_pnl_bps: round4(realized_pnl_bps),
      components_sum_bps: round4(
        model_component_bps + execution_component_bps + luck_component_bps,
      ),
      confidence,
      is_reproducible: true,
      stake_units_status,
    },
  };
}

/**
 * Decompose realized performance across a set of attribution records.
 * Only attributed records (confidence !== 'insufficient_data') are included
 * in component totals. Fail-closed: empty input returns a zero decomposition.
 */
export function decomposePerformance(
  records: readonly AttributionRecord[],
): AttributionDecomposition {
  const attributed = records.filter((r) => r.confidence !== 'insufficient_data');
  const excluded = records.length - attributed.length;

  const by_confidence: Record<AttributionConfidence, number> = {
    high: 0,
    medium: 0,
    low: 0,
    insufficient_data: 0,
  };
  for (const r of records) {
    by_confidence[r.confidence]++;
  }

  const total_realized_pnl_bps = sum(records.map((r) => r.realized_pnl_bps));
  const model_alpha_bps = sum(attributed.map((r) => r.model_component_bps));
  const execution_edge_bps = sum(attributed.map((r) => r.execution_component_bps));
  const luck_bps = sum(records.map((r) => r.luck_component_bps));

  return {
    total_records: records.length,
    attributed_records: attributed.length,
    excluded_insufficient_data: excluded,
    total_realized_pnl_bps: round4(total_realized_pnl_bps),
    components: {
      model_alpha_bps: round4(model_alpha_bps),
      execution_edge_bps: round4(execution_edge_bps),
      luck_bps: round4(luck_bps),
      sum_check_bps: round4(model_alpha_bps + execution_edge_bps + luck_bps),
    },
    by_confidence,
    is_reproducible: attributed.length > 0,
    version: ATTRIBUTION_VERSION,
  };
}

/**
 * Reconstruct attribution for a pick from stored inputs.
 * Deterministic: same inputs always produce the same attribution.
 */
export function reconstructAttribution(
  storedInput: AttributionInput,
): AttributeResult {
  return attributePick(storedInput);
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateAttributionInput(input: AttributionInput): string[] {
  const errors: string[] = [];

  if (!input.pick_id || input.pick_id.trim() === '') {
    errors.push('ATTRIBUTION_MISSING_PICK_ID');
  }
  if (!input.settled_at || input.settled_at.trim() === '') {
    errors.push('ATTRIBUTION_MISSING_SETTLED_AT');
  }
  if (!['win', 'loss', 'push'].includes(input.result)) {
    errors.push(`ATTRIBUTION_INVALID_RESULT: ${input.result}`);
  }
  if (!isFinite(input.ev_bps)) {
    errors.push('ATTRIBUTION_INVALID_EV_BPS: must be finite');
  }
  if (!isFinite(input.clv_at_bet_bps)) {
    errors.push('ATTRIBUTION_INVALID_CLV_AT_BET_BPS: must be finite');
  }
  if (!isFinite(input.clv_at_close_bps)) {
    errors.push('ATTRIBUTION_INVALID_CLV_AT_CLOSE_BPS: must be finite');
  }
  // UTV2-1815: stake_units was never validated at all, so a NaN slipped past
  // the `??` guard -- which only catches null and undefined -- and propagated
  // into every component of the output as NaN. Omission is still the documented
  // flat-bet case; anything supplied must be usable.
  if (resolveStakeUnits(input.stake_units).status === 'historical_unknown') {
    errors.push(
      `${ATTRIBUTION_INVALID_STAKE_UNITS}: must be a finite number greater than 0`,
    );
  }

  return errors;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function deriveConfidence(input: AttributionInput): AttributionConfidence {
  if (!input.has_feature_snapshot) return 'insufficient_data';
  // High confidence: CLV and EV both available and feature snapshot present
  if (input.clv_at_close_bps !== 0 && input.ev_bps !== 0) return 'high';
  // Medium: at least one CLV signal
  if (input.clv_at_bet_bps !== 0 || input.clv_at_close_bps !== 0) return 'medium';
  return 'low';
}

function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
