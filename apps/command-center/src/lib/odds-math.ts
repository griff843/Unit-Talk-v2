/**
 * Pure odds math for Intelligence-zone pages. No I/O.
 *
 * ODDS FORMAT ASSUMPTION (verified against live provider_offer_current on
 * 2026-07-06): `over_odds` / `under_odds` are AMERICAN odds (integer values
 * like -110, +125, ranges observed roughly -100000..+90818). They are never
 * decimal odds. All functions below are explicit about which format they
 * take: parameters named `american` take American odds; parameters named
 * `decimal`/`*Dec` take decimal odds (> 1.0).
 */

/** Convert American odds to decimal odds. Throws on 0 or non-finite input. */
export function americanToDecimal(american: number): number {
  if (!Number.isFinite(american) || american === 0) {
    throw new Error(`Invalid American odds: ${american}`);
  }
  return american > 0 ? 1 + american / 100 : 1 + 100 / -american;
}

/** Convert decimal odds (> 1.0) back to American odds (rounded to integer). */
export function decimalToAmerican(decimal: number): number {
  if (!Number.isFinite(decimal) || decimal <= 1) {
    throw new Error(`Invalid decimal odds: ${decimal}`);
  }
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}

/** Implied probability (vig included) of American odds. Returns value in (0,1). */
export function impliedProbability(american: number): number {
  return 1 / americanToDecimal(american);
}

/**
 * Proportional (multiplicative) de-vig of a two-way market quoted in
 * American odds. Returns fair probabilities that sum to 1.
 */
export function devigTwoWay(
  overAmerican: number,
  underAmerican: number,
): { overProb: number; underProb: number; overround: number } {
  const rawOver = impliedProbability(overAmerican);
  const rawUnder = impliedProbability(underAmerican);
  const total = rawOver + rawUnder;
  if (total <= 0) throw new Error('Degenerate two-way market');
  return { overProb: rawOver / total, underProb: rawUnder / total, overround: total };
}

export interface TwoWayQuote {
  overOdds: number; // American
  underOdds: number; // American
}

/**
 * Consensus fair probability: average of per-book de-vigged probabilities
 * across all books quoting BOTH sides of the same identity. Books missing a
 * side are skipped (cannot de-vig one-sided quotes proportionally).
 */
export function consensusFairProbability(
  quotes: Array<Partial<TwoWayQuote>>,
): { overProb: number; underProb: number; bookCount: number } | null {
  let sumOver = 0;
  let n = 0;
  for (const q of quotes) {
    if (typeof q.overOdds !== 'number' || typeof q.underOdds !== 'number') continue;
    if (q.overOdds === 0 || q.underOdds === 0) continue;
    sumOver += devigTwoWay(q.overOdds, q.underOdds).overProb;
    n += 1;
  }
  if (n === 0) return null;
  const overProb = sumOver / n;
  return { overProb, underProb: 1 - overProb, bookCount: n };
}

/**
 * Expected value in percent of stake for an offer at `offerDecimal` decimal
 * odds when the fair win probability is `fairProb`.
 * EV% = (decimal * fairProb - 1) * 100.
 */
export function evPercent(offerDecimal: number, fairProb: number): number {
  if (!Number.isFinite(offerDecimal) || offerDecimal <= 1) {
    throw new Error(`Invalid decimal odds: ${offerDecimal}`);
  }
  if (!(fairProb > 0 && fairProb < 1)) {
    throw new Error(`Invalid fair probability: ${fairProb}`);
  }
  return (offerDecimal * fairProb - 1) * 100;
}

/**
 * Two-way arbitrage margin in percent, given best over decimal odds at one
 * book and best under decimal odds at another. Positive => arbitrage
 * (combined implied probability < 1).
 */
export function arbPercent(overDec: number, underDec: number): number {
  if (overDec <= 1 || underDec <= 1) throw new Error('Decimal odds must exceed 1');
  return (1 - (1 / overDec + 1 / underDec)) * 100;
}

/**
 * Split a total bankroll across two legs (decimal odds) so both outcomes
 * return the same amount. Returns stakes and the guaranteed return.
 */
export function arbStakeSplit(
  total: number,
  decA: number,
  decB: number,
): { stakeA: number; stakeB: number; guaranteedReturn: number } {
  if (total <= 0) throw new Error('Total stake must be positive');
  if (decA <= 1 || decB <= 1) throw new Error('Decimal odds must exceed 1');
  const invA = 1 / decA;
  const invB = 1 / decB;
  const stakeA = (total * invA) / (invA + invB);
  const stakeB = total - stakeA;
  return { stakeA, stakeB, guaranteedReturn: stakeA * decA };
}

/**
 * Middle window between two lines on the same market: betting over at the
 * lower line and under at the higher line, results strictly between the two
 * lines win both legs. Returns null when the lines do not differ.
 */
export function middleWindow(
  lineA: number,
  lineB: number,
): { low: number; high: number; width: number } | null {
  if (!Number.isFinite(lineA) || !Number.isFinite(lineB)) return null;
  const low = Math.min(lineA, lineB);
  const high = Math.max(lineA, lineB);
  if (high - low <= 0) return null;
  return { low, high, width: high - low };
}
