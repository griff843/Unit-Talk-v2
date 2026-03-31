/**
 * CLV-First Scoring Feedback Loop
 *
 * Uses graded CLV outcomes to evaluate and suggest promotion weight adjustments.
 * Computes per-component correlation between score inputs and CLV outcomes,
 * identifies which components predict CLV and which don't.
 *
 * Pure computation — no DB, no I/O.
 */

export interface ScoredPickOutcome {
  /** The 5 score inputs used at promotion time */
  scoreInputs: {
    edge: number;
    trust: number;
    readiness: number;
    uniqueness: number;
    boardFit: number;
  };
  /** CLV percentage from settlement (positive = beat the line) */
  clvPercent: number;
  /** Whether the pick won */
  won: boolean;
}

export interface WeightEffectivenessReport {
  /** Per-component correlation with CLV */
  componentCorrelations: {
    edge: ComponentCorrelation;
    trust: ComponentCorrelation;
    readiness: ComponentCorrelation;
    uniqueness: ComponentCorrelation;
    boardFit: ComponentCorrelation;
  };
  /** Overall sample size */
  sampleSize: number;
  /** Suggested weight adjustments based on correlations */
  suggestedAdjustments: {
    edge: number;
    trust: number;
    readiness: number;
    uniqueness: number;
    boardFit: number;
  };
  /** Whether the sample is large enough for reliable suggestions */
  confidence: 'high' | 'medium' | 'low' | 'insufficient';
}

export interface ComponentCorrelation {
  /** Pearson correlation coefficient with CLV (-1 to 1) */
  correlation: number;
  /** Whether this component predicts positive CLV */
  predictive: boolean;
  /** Average CLV for picks in the top quartile of this component */
  topQuartileAvgClv: number | null;
  /** Average CLV for picks in the bottom quartile */
  bottomQuartileAvgClv: number | null;
}

/**
 * Analyze how well each promotion score component predicts CLV outcomes.
 */
export function analyzeWeightEffectiveness(
  outcomes: ScoredPickOutcome[],
): WeightEffectivenessReport {
  const sampleSize = outcomes.length;

  let confidence: 'high' | 'medium' | 'low' | 'insufficient' = 'insufficient';
  if (sampleSize >= 100) confidence = 'high';
  else if (sampleSize >= 50) confidence = 'medium';
  else if (sampleSize >= 20) confidence = 'low';

  const components = ['edge', 'trust', 'readiness', 'uniqueness', 'boardFit'] as const;
  const correlations: Record<string, ComponentCorrelation> = {};

  for (const component of components) {
    const values = outcomes.map((o) => o.scoreInputs[component]);
    const clvValues = outcomes.map((o) => o.clvPercent);

    const corr = sampleSize >= 5 ? pearsonCorrelation(values, clvValues) : 0;

    // Quartile analysis
    const sorted = outcomes
      .map((o, i) => ({ score: o.scoreInputs[component], clv: o.clvPercent, idx: i }))
      .sort((a, b) => a.score - b.score);

    const q1Size = Math.floor(sorted.length / 4);
    const topQuartile = sorted.slice(-q1Size);
    const bottomQuartile = sorted.slice(0, q1Size);

    correlations[component] = {
      correlation: Math.round(corr * 1000) / 1000,
      predictive: corr > 0.1,
      topQuartileAvgClv: topQuartile.length > 0
        ? Math.round((topQuartile.reduce((s, p) => s + p.clv, 0) / topQuartile.length) * 100) / 100
        : null,
      bottomQuartileAvgClv: bottomQuartile.length > 0
        ? Math.round((bottomQuartile.reduce((s, p) => s + p.clv, 0) / bottomQuartile.length) * 100) / 100
        : null,
    };
  }

  // Suggest weight adjustments: increase weight for predictive components,
  // decrease for non-predictive. Normalize so they sum to the same total.
  const currentTotal = 5; // 5 components
  const rawAdjustments: Record<string, number> = {};
  for (const component of components) {
    const corr = correlations[component]!.correlation;
    // Scale: highly predictive (corr > 0.3) → +20%, anti-predictive (corr < -0.1) → -20%
    if (corr > 0.3) rawAdjustments[component] = 1.2;
    else if (corr > 0.1) rawAdjustments[component] = 1.1;
    else if (corr > -0.1) rawAdjustments[component] = 1.0;
    else rawAdjustments[component] = 0.8;
  }
  const adjTotal = Object.values(rawAdjustments).reduce((s, v) => s + v, 0);
  const normalizedAdjustments: Record<string, number> = {};
  for (const component of components) {
    normalizedAdjustments[component] = Math.round((rawAdjustments[component]! / adjTotal) * currentTotal * 100) / 100;
  }

  return {
    componentCorrelations: {
      edge: correlations['edge']!,
      trust: correlations['trust']!,
      readiness: correlations['readiness']!,
      uniqueness: correlations['uniqueness']!,
      boardFit: correlations['boardFit']!,
    },
    sampleSize,
    suggestedAdjustments: {
      edge: normalizedAdjustments['edge']!,
      trust: normalizedAdjustments['trust']!,
      readiness: normalizedAdjustments['readiness']!,
      uniqueness: normalizedAdjustments['uniqueness']!,
      boardFit: normalizedAdjustments['boardFit']!,
    },
    confidence,
  };
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n === 0) return 0;

  const sumX = x.reduce((s, v) => s + v, 0);
  const sumY = y.reduce((s, v) => s + v, 0);
  const sumXY = x.reduce((s, v, i) => s + v * y[i]!, 0);
  const sumX2 = x.reduce((s, v) => s + v * v, 0);
  const sumY2 = y.reduce((s, v) => s + v * v, 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  if (denominator === 0) return 0;
  return numerator / denominator;
}
