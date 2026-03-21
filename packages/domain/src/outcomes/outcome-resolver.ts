/**
 * Outcome Resolver — determine WIN/LOSS/PUSH from actual vs line.
 *
 * Ported from unit-talk-production/apps/api/src/analysis/outcomes/outcome-resolver.ts
 * Adapted to V2 naming conventions. Pure computation — no I/O, no DB, no side effects.
 *
 * Shadow scoring always scores the "over" side:
 *   WIN  = actual > line (over hit)
 *   LOSS = actual < line (under hit)
 *   PUSH = actual == line
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type Outcome = 'WIN' | 'LOSS' | 'PUSH';

export interface FlatBetROIResult {
  roi_pct: number;
  total_wagered: number;
  total_profit: number;
}

// ── Functions ───────────────────────────────────────────────────────────────

/**
 * Resolve the outcome for an over bet.
 */
export function resolveOutcome(actualValue: number, line: number): Outcome {
  if (actualValue > line) return 'WIN';
  if (actualValue < line) return 'LOSS';
  return 'PUSH';
}

/**
 * Check if model's directional prediction was correct.
 * p_final > 0.5 means model predicted over.
 * p_final < 0.5 means model predicted under.
 * Returns null for PUSH (no direction to evaluate).
 */
export function isDirectionallyCorrect(
  pFinal: number,
  outcome: Outcome,
): boolean | null {
  if (outcome === 'PUSH') return null;
  const predictedOver = pFinal >= 0.5;
  const actualOver = outcome === 'WIN';
  return predictedOver === actualOver;
}

/**
 * Compute flat-bet ROI for a set of outcomes.
 * Assumes -110 juice: risk $110 to win $100 on every bet.
 * WIN: +$100, LOSS: -$110, PUSH: $0
 */
export function computeFlatBetROI(outcomes: Outcome[]): FlatBetROIResult {
  const nonPush = outcomes.filter((o) => o !== 'PUSH');
  if (nonPush.length === 0)
    return { roi_pct: 0, total_wagered: 0, total_profit: 0 };

  const wagerPerBet = 110;
  const total_wagered = nonPush.length * wagerPerBet;
  let total_profit = 0;

  for (const o of nonPush) {
    if (o === 'WIN') total_profit += 100;
    else total_profit -= 110;
  }

  return {
    roi_pct: (total_profit / total_wagered) * 100,
    total_wagered,
    total_profit,
  };
}
