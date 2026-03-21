/**
 * KellySizer — Pure-function Kelly criterion sizing with bankroll context
 *
 * Computes fractional Kelly bet sizing given:
 *   - True win probability (from scoring pipeline)
 *   - Decimal odds (from market)
 *   - Bankroll config (total capital, fraction multiplier, caps)
 *
 * FAIL-CLOSED: Returns zero sizing on invalid/missing inputs.
 * DETERMINISTIC: Same inputs always produce same output.
 */

export interface BankrollConfig {
  /** Total bankroll in units (e.g., 1000 = $1000) */
  total_bankroll: number;
  /** Fractional Kelly multiplier (0.25 = quarter Kelly). Range: 0-1. */
  kelly_multiplier: number;
  /** Maximum single-bet size as fraction of bankroll (e.g., 0.05 = 5%) */
  max_bet_fraction: number;
  /** Minimum bet size in units (e.g., 1.0 = $1) */
  min_bet_units: number;
  /** Maximum daily loss as fraction of bankroll before freeze (e.g., 0.10 = 10%) */
  daily_loss_limit: number;
}

export const DEFAULT_BANKROLL_CONFIG: BankrollConfig = {
  total_bankroll: 1000,
  kelly_multiplier: 0.25,
  max_bet_fraction: 0.05,
  min_bet_units: 1.0,
  daily_loss_limit: 0.1,
};

export interface KellySizingResult {
  /** Raw Kelly fraction: (bp - q) / b. Can be negative (no edge). */
  raw_kelly: number;
  /** Fractional Kelly: raw_kelly * kelly_multiplier. Always >= 0. */
  fractional_kelly: number;
  /** Recommended bet size in units, capped by bankroll limits. */
  recommended_units: number;
  /** Recommended bet as fraction of bankroll. */
  recommended_fraction: number;
  /** Whether sizing was capped by any limit. */
  capped: boolean;
  /** Which cap was applied, if any. */
  cap_reason: string | null;
  /** Whether the edge is positive (kelly > 0). */
  has_edge: boolean;
}

/**
 * Compute Kelly-optimal bet size given probability, odds, and bankroll context.
 *
 * Kelly criterion: f* = (b*p - q) / b
 *   where b = decimal_odds - 1, p = win probability, q = 1 - p
 *
 * FAIL-CLOSED: Returns zero sizing for:
 *   - Invalid probability (not in 0-1 exclusive)
 *   - Invalid odds (not > 1)
 *   - Negative edge (no bet)
 *   - Invalid bankroll (zero or negative)
 */
export function computeKellySize(
  winProbability: number,
  decimalOdds: number,
  bankroll: BankrollConfig,
): KellySizingResult {
  // Validate inputs — fail-closed on anything invalid
  if (!isValidProbability(winProbability) || !isValidOdds(decimalOdds)) {
    return zeroSizing('invalid_inputs');
  }

  if (!isValidBankroll(bankroll)) {
    return zeroSizing('invalid_bankroll');
  }

  // Kelly formula: f* = (b*p - q) / b
  const b = decimalOdds - 1;
  const p = winProbability;
  const q = 1 - p;
  const rawKelly = (b * p - q) / b;

  // No edge → no bet
  if (rawKelly <= 0) {
    return {
      raw_kelly: round(rawKelly, 6),
      fractional_kelly: 0,
      recommended_units: 0,
      recommended_fraction: 0,
      capped: false,
      cap_reason: null,
      has_edge: false,
    };
  }

  // Apply fractional Kelly
  const fractionalKelly = rawKelly * bankroll.kelly_multiplier;

  // Compute recommended fraction (capped by max_bet_fraction)
  let recommendedFraction = fractionalKelly;
  let capped = false;
  let capReason: string | null = null;

  if (recommendedFraction > bankroll.max_bet_fraction) {
    recommendedFraction = bankroll.max_bet_fraction;
    capped = true;
    capReason = 'max_bet_fraction';
  }

  // Convert to units
  let recommendedUnits = recommendedFraction * bankroll.total_bankroll;

  // Apply minimum bet floor
  if (recommendedUnits > 0 && recommendedUnits < bankroll.min_bet_units) {
    recommendedUnits = bankroll.min_bet_units;
    recommendedFraction = recommendedUnits / bankroll.total_bankroll;
    capped = true;
    capReason = 'min_bet_floor';
  }

  return {
    raw_kelly: round(rawKelly, 6),
    fractional_kelly: round(fractionalKelly, 6),
    recommended_units: round(recommendedUnits, 2),
    recommended_fraction: round(recommendedFraction, 6),
    capped,
    cap_reason: capReason,
    has_edge: true,
  };
}

/**
 * Compute raw Kelly fraction without bankroll context.
 *
 * Returns the fractional Kelly value (raw * multiplier), capped at max_fraction.
 * FAIL-CLOSED: Returns 0 on invalid inputs.
 */
export function computeKellyFraction(
  winProbability: number,
  decimalOdds: number,
  kellyMultiplier: number = DEFAULT_BANKROLL_CONFIG.kelly_multiplier,
  maxFraction: number = DEFAULT_BANKROLL_CONFIG.max_bet_fraction,
): number {
  if (!isValidProbability(winProbability) || !isValidOdds(decimalOdds)) {
    return 0;
  }

  if (kellyMultiplier <= 0 || kellyMultiplier > 1) {
    return 0;
  }

  const b = decimalOdds - 1;
  const p = winProbability;
  const q = 1 - p;
  const rawKelly = (b * p - q) / b;

  if (rawKelly <= 0) return 0;

  const fractional = rawKelly * kellyMultiplier;
  return round(Math.min(fractional, maxFraction), 6);
}

/**
 * Convert American odds to decimal odds.
 * +150 → 2.50, -200 → 1.50
 */
export function americanToDecimal(americanOdds: number): number {
  if (americanOdds > 0) {
    return americanOdds / 100 + 1;
  } else if (americanOdds < 0) {
    return 100 / Math.abs(americanOdds) + 1;
  }
  return 1; // Even odds edge case
}

// ─── Validators ─────────────────────────────────────────────────────────────

function isValidProbability(p: number): boolean {
  return typeof p === 'number' && isFinite(p) && p > 0 && p < 1;
}

function isValidOdds(odds: number): boolean {
  return typeof odds === 'number' && isFinite(odds) && odds > 1;
}

function isValidBankroll(config: BankrollConfig): boolean {
  return (
    typeof config.total_bankroll === 'number' &&
    isFinite(config.total_bankroll) &&
    config.total_bankroll > 0 &&
    typeof config.kelly_multiplier === 'number' &&
    config.kelly_multiplier > 0 &&
    config.kelly_multiplier <= 1 &&
    typeof config.max_bet_fraction === 'number' &&
    config.max_bet_fraction > 0 &&
    config.max_bet_fraction <= 1
  );
}

function zeroSizing(reason: string): KellySizingResult {
  return {
    raw_kelly: 0,
    fractional_kelly: 0,
    recommended_units: 0,
    recommended_fraction: 0,
    capped: true,
    cap_reason: reason,
    has_edge: false,
  };
}

function round(n: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}
