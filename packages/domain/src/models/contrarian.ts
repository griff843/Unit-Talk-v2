/**
 * Contrarian Pick Classification
 *
 * Classifies picks where the model strongly disagrees with market consensus.
 * Pure domain — no I/O, no DB, no side effects.
 *
 * Issue: UTV2-636
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type Contrarianism =
  | 'strongly-contrarian'  // model diverges > 8pp, against the market
  | 'mildly-contrarian'    // model diverges 4–8pp, against the market
  | 'aligned'              // model within 4pp of market
  | 'consensus-fade';      // model diverges > 8pp, with (not against) the market

export interface ContrarySignal {
  contrarianism: Contrarianism;
  /** |model_prob - market_prob| — always non-negative */
  divergence: number;
  /** Whether the model agrees or disagrees with the market direction */
  direction: 'with-market' | 'against-market';
  /** Source of the market probability used for classification */
  marketSource: string;
  /** Which threshold triggered the classification (0 = aligned) */
  threshold: number;
}

// ── Thresholds ───────────────────────────────────────────────────────────────

/**
 * Classification thresholds.
 *
 * strong: |divergence| > 8pp = strongly-contrarian or consensus-fade
 * mild:   |divergence| > 4pp = mildly-contrarian
 * aligned: below mild threshold
 */
export const CONTRARIAN_THRESHOLDS = {
  strong: 0.08,
  mild: 0.04,
} as const;

// ── Classification ───────────────────────────────────────────────────────────

/**
 * Classify a pick's contrarianism based on the model probability vs market probability.
 *
 * - modelProbability > marketProbability → model is 'against-market' (bullish vs market)
 * - modelProbability < marketProbability → model is 'with-market' (fading vs market)
 *
 * Contrarianism:
 * - 'strongly-contrarian':  divergence >= 8pp AND model is against-market
 * - 'consensus-fade':       divergence >= 8pp AND model is with-market
 * - 'mildly-contrarian':    divergence >= 4pp (regardless of direction)
 * - 'aligned':              divergence < 4pp
 */
export function classifyContrarianism(
  modelProbability: number,
  marketProbability: number,
  marketSource: string,
): ContrarySignal {
  // Round to 6dp to match the precision of realEdge in RealEdgeResult
  const divergence = Math.round(Math.abs(modelProbability - marketProbability) * 1e6) / 1e6;
  const direction: 'against-market' | 'with-market' =
    modelProbability > marketProbability ? 'against-market' : 'with-market';

  let contrarianism: Contrarianism;
  let threshold: number;

  if (divergence >= CONTRARIAN_THRESHOLDS.strong) {
    contrarianism = direction === 'against-market' ? 'strongly-contrarian' : 'consensus-fade';
    threshold = CONTRARIAN_THRESHOLDS.strong;
  } else if (divergence >= CONTRARIAN_THRESHOLDS.mild) {
    contrarianism = 'mildly-contrarian';
    threshold = CONTRARIAN_THRESHOLDS.mild;
  } else {
    contrarianism = 'aligned';
    threshold = 0;
  }

  return { contrarianism, divergence, direction, marketSource, threshold };
}

// ── Verdict ──────────────────────────────────────────────────────────────────

/**
 * Post-settlement evaluation of whether the contrarian call was justified.
 *
 * 'justified':      model disagreed with market AND was vindicated (positive CLV + WIN)
 * 'overconfident':  model strongly disagreed AND was wrong (negative CLV + LOSS)
 * 'inconclusive':   insufficient data (null CLV, null outcome, PUSH, or mixed signals)
 */
export type ContraryVerdict = 'justified' | 'overconfident' | 'inconclusive';

export function evaluateContraryVerdict(
  signal: ContrarySignal,
  clvPercent: number | null,
  outcome: 'WIN' | 'LOSS' | 'PUSH' | null,
): ContraryVerdict {
  if (clvPercent === null || clvPercent === undefined) return 'inconclusive';
  if (outcome === null || outcome === undefined || outcome === 'PUSH') return 'inconclusive';

  // Justified: beat the closing line AND won
  if (clvPercent > 0 && outcome === 'WIN') return 'justified';

  // Overconfident: strongly disagree with market AND negative CLV AND lost
  if (
    signal.contrarianism === 'strongly-contrarian' &&
    clvPercent < 0 &&
    outcome === 'LOSS'
  ) return 'overconfident';

  return 'inconclusive';
}
