// Addition to scripts/ops/track-only-report.ts -- UTV2-1889.
//
// The report answers "is this one pick correct?". It has no aggregate, so it cannot
// answer "what is the record?", which is the last leg of the operator journey and
// Milestone 2 condition 4.
//
// The whole risk in this file is a number that looks finished and is wrong. plan.md
// records the exact failure mode: a predicate that quietly averages CI fixtures into a
// capper's ROI "would look finished and be worthless, and it would be discovered by a
// member rather than by a test". So every rule below errs toward refusing to count
// rather than toward producing a tidy figure, and anything uncountable is named in
// `excluded` instead of being absorbed as a zero.

export type SettlementOutcome = 'win' | 'loss' | 'push' | 'void' | 'cancelled';

export interface StatsInputPick {
  pickId: string;
  /** American odds as persisted on the pick. */
  odds: number | null;
  stakeUnits: number | null;
  /** Latest settlement first -- callers pass `settlements[0]`, the correction winner. */
  latestSettlement: {
    result: string | null;
    stakeUnits: number | null;
  } | null;
}

export interface TrackOnlyStats {
  cohortSize: number;
  /** Outcomes that are real decisions and belong in a win/loss record. */
  record: { win: number; loss: number; push: number; decided: number };
  /** Not decisions. Deliberately kept out of the record and out of ROI. */
  nonDecisions: { void: number; cancelled: number };
  /** No settlement row yet, or one whose result is still null. */
  pending: number;
  units: {
    staked: number | null;
    /** Net profit in units. Negative is a loss. */
    net: number | null;
    /** net / staked. `null` whenever it would be undefined or unmeasured. */
    roi: number | null;
    /**
     * How many decided picks the unit figures actually cover. When this is below
     * `record.decided`, the ROI describes a subset and the caller must say so.
     */
    measuredOver: number;
  };
  /** Decided picks that could not be priced, each with the reason. Never silent. */
  excluded: Array<{ pickId: string; reason: string }>;
}

const DECISION_RESULTS = new Set(['win', 'loss', 'push']);
const NON_DECISION_RESULTS = new Set(['void', 'cancelled']);

// `null` means genuinely no verdict yet. `'unknown'` means a verdict this code does
// not understand -- which is NOT the same thing and must not be folded into pending.
// Pending shrinks silently as picks settle; an unrecognised result would sit in that
// bucket forever looking like ordinary backlog.
function normalizeResult(
  value: string | null,
): SettlementOutcome | 'unknown' | null {
  if (value === null) return null;
  const v = value.trim().toLowerCase();
  if (v === '') return null;
  if (DECISION_RESULTS.has(v) || NON_DECISION_RESULTS.has(v)) {
    return v as SettlementOutcome;
  }
  return 'unknown';
}

/**
 * Profit in units for a decided pick, from American odds.
 * Returns null when the inputs cannot express a price.
 */
export function profitUnits(
  result: 'win' | 'loss' | 'push',
  odds: number,
  stakeUnits: number,
): number | null {
  if (!Number.isFinite(odds) || !Number.isFinite(stakeUnits)) return null;
  if (stakeUnits <= 0) return null;
  // American odds have no value in (-100, 100) exclusive of 0's neighbourhood; a 0
  // would imply an infinite or undefined payout. Refuse rather than coerce.
  if (odds > -100 && odds < 100) return null;
  if (result === 'push') return 0;
  if (result === 'loss') return -stakeUnits;
  return odds > 0
    ? stakeUnits * (odds / 100)
    : stakeUnits * (100 / Math.abs(odds));
}

export function computeTrackOnlyStats(
  picks: readonly StatsInputPick[],
): TrackOnlyStats {
  const record = { win: 0, loss: 0, push: 0, decided: 0 };
  const nonDecisions = { void: 0, cancelled: 0 };
  const excluded: Array<{ pickId: string; reason: string }> = [];
  let pending = 0;
  let staked = 0;
  let net = 0;
  let measuredOver = 0;

  for (const pick of picks) {
    const result = normalizeResult(pick.latestSettlement?.result ?? null);

    if (result === null) {
      pending += 1;
      continue;
    }

    if (result === 'unknown') {
      excluded.push({
        pickId: pick.pickId,
        reason: `settlement result ${JSON.stringify(pick.latestSettlement?.result)} is not a recognised outcome -- counted in neither the record nor pending`,
      });
      continue;
    }

    if (result === 'void' || result === 'cancelled') {
      nonDecisions[result] += 1;
      continue;
    }

    record[result] += 1;
    record.decided += 1;

    // The settlement's own stake is authoritative when present: it is what was
    // actually settled. The pick's stake is the fallback, not the preference.
    const stake = pick.latestSettlement?.stakeUnits ?? pick.stakeUnits;
    if (stake === null || !Number.isFinite(stake) || stake <= 0) {
      excluded.push({
        pickId: pick.pickId,
        reason: `decided as ${result} but stake_units is ${String(stake)} -- not priceable`,
      });
      continue;
    }
    if (pick.odds === null) {
      excluded.push({
        pickId: pick.pickId,
        reason: `decided as ${result} but odds are null -- not priceable`,
      });
      continue;
    }

    const profit = profitUnits(result, pick.odds, stake);
    if (profit === null) {
      excluded.push({
        pickId: pick.pickId,
        reason: `decided as ${result} but odds ${pick.odds} / stake ${stake} do not express a price`,
      });
      continue;
    }

    staked += stake;
    net += profit;
    measuredOver += 1;
  }

  // Never report 0% ROI for "we measured nothing" -- that is the reassuring direction,
  // and a reader cannot tell it apart from a genuine break-even.
  const hasUnits = measuredOver > 0 && staked > 0;

  return {
    cohortSize: picks.length,
    record,
    nonDecisions,
    pending,
    units: {
      staked: hasUnits ? round4(staked) : null,
      net: hasUnits ? round4(net) : null,
      roi: hasUnits ? round4(net / staked) : null,
      measuredOver,
    },
    excluded,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Structural view of `TrackOnlyPickReport`. Declared by shape rather than imported so
 * the mapping can be tested without the report's database client, and so the real
 * interface still satisfies it.
 */
export interface StatsSourceReport {
  pickId: string;
  odds: number | null;
  stakeUnits: number | null;
  settlement: {
    rows: number;
    result: string | null;
    stakeUnits: number | null;
  };
}

/**
 * A named function rather than an inline `.map`, because the mapping is exactly where a
 * wrong field silently becomes a wrong number and there is nothing to see afterwards.
 */
export function toStatsInput(report: StatsSourceReport): StatsInputPick {
  return {
    pickId: report.pickId,
    odds: report.odds,
    stakeUnits: report.stakeUnits,
    // `rows === 0` is the pending test, NOT `result === null`. A settlement row that
    // exists with a null result is a settlement in progress; both land in `pending`,
    // but only one of them can later carry a correction.
    latestSettlement:
      report.settlement.rows === 0
        ? null
        : {
            result: report.settlement.result,
            stakeUnits: report.settlement.stakeUnits,
          },
  };
}
