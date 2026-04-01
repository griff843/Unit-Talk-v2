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

// ── Walk-forward backtesting ──────────────────────────────────────────────────

export interface WalkForwardWindow {
  /** Index range [start, end) in the input array */
  trainStart: number;
  trainEnd: number;
  testStart: number;
  testEnd: number;
  /** Correlation computed on training window */
  trainCorrelation: Record<string, number>;
  /** Correlation computed on out-of-sample test window */
  testCorrelation: Record<string, number>;
  /** How stable is the edge component: |train_edge - test_edge| */
  edgeStabilityDelta: number;
}

export interface WalkForwardBacktestResult {
  windows: WalkForwardWindow[];
  /** Mean test-window correlation per component across all windows */
  meanTestCorrelation: Record<string, number>;
  /** Std dev of test-window correlation per component (lower = more stable) */
  stdTestCorrelation: Record<string, number>;
  /** True when edge component is stable (stdDev < 0.15) across windows */
  edgeIsStable: boolean;
  /** Minimum window count required for the result to be reliable */
  windowCount: number;
}

/**
 * Walk-forward backtest of scoring weight effectiveness.
 *
 * Slides a training window of `trainSize` picks and validates on the next
 * `testSize` picks. Returns per-window and aggregated correlations.
 *
 * Pure computation — no I/O.
 */
export function runWalkForwardBacktest(
  outcomes: ScoredPickOutcome[],
  options: { trainSize?: number; testSize?: number } = {},
): WalkForwardBacktestResult {
  const trainSize = options.trainSize ?? 50;
  const testSize = options.testSize ?? 20;
  const components = ['edge', 'trust', 'readiness', 'uniqueness', 'boardFit'] as const;

  const windows: WalkForwardWindow[] = [];
  let cursor = 0;

  while (cursor + trainSize + testSize <= outcomes.length) {
    const trainSlice = outcomes.slice(cursor, cursor + trainSize);
    const testSlice = outcomes.slice(cursor + trainSize, cursor + trainSize + testSize);

    const trainCorrelation: Record<string, number> = {};
    const testCorrelation: Record<string, number> = {};

    for (const component of components) {
      trainCorrelation[component] = pearsonCorrelation(
        trainSlice.map((o) => o.scoreInputs[component]),
        trainSlice.map((o) => o.clvPercent),
      );
      testCorrelation[component] = pearsonCorrelation(
        testSlice.map((o) => o.scoreInputs[component]),
        testSlice.map((o) => o.clvPercent),
      );
    }

    windows.push({
      trainStart: cursor,
      trainEnd: cursor + trainSize,
      testStart: cursor + trainSize,
      testEnd: cursor + trainSize + testSize,
      trainCorrelation,
      testCorrelation,
      edgeStabilityDelta: Math.abs(
        (trainCorrelation['edge'] ?? 0) - (testCorrelation['edge'] ?? 0),
      ),
    });

    cursor += testSize;
  }

  if (windows.length === 0) {
    return {
      windows: [],
      meanTestCorrelation: Object.fromEntries(components.map((c) => [c, 0])),
      stdTestCorrelation: Object.fromEntries(components.map((c) => [c, 0])),
      edgeIsStable: false,
      windowCount: 0,
    };
  }

  const meanTestCorrelation: Record<string, number> = {};
  const stdTestCorrelation: Record<string, number> = {};

  for (const component of components) {
    const values = windows.map((w) => w.testCorrelation[component] ?? 0);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance =
      values.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(values.length - 1, 1);
    meanTestCorrelation[component] = Math.round(mean * 1000) / 1000;
    stdTestCorrelation[component] = Math.round(Math.sqrt(variance) * 1000) / 1000;
  }

  const edgeStd = stdTestCorrelation['edge'] ?? 0;

  return {
    windows,
    meanTestCorrelation,
    stdTestCorrelation,
    edgeIsStable: edgeStd < 0.15,
    windowCount: windows.length,
  };
}

// ── Significance testing ──────────────────────────────────────────────────────

export interface SignificanceTestResult {
  component: string;
  /** Observed Pearson correlation */
  observedCorrelation: number;
  /** p-value approximation via t-distribution (two-tailed) */
  pValue: number;
  /** True when p < alpha */
  significant: boolean;
  /** Alpha threshold used */
  alpha: number;
  sampleSize: number;
}

/**
 * Test whether a component's correlation with CLV is statistically significant.
 *
 * Uses a t-test approximation: t = r * sqrt(n-2) / sqrt(1-r²),
 * then approximates p via the incomplete beta function.
 *
 * Pure computation — no I/O.
 */
export function testComponentSignificance(
  outcomes: ScoredPickOutcome[],
  component: keyof ScoredPickOutcome['scoreInputs'],
  alpha = 0.05,
): SignificanceTestResult {
  const n = outcomes.length;
  const r = n >= 3
    ? pearsonCorrelation(
        outcomes.map((o) => o.scoreInputs[component]),
        outcomes.map((o) => o.clvPercent),
      )
    : 0;

  const pValue = n >= 3 ? approximatePValue(r, n) : 1;

  return {
    component,
    observedCorrelation: Math.round(r * 1000) / 1000,
    pValue: Math.round(pValue * 10000) / 10000,
    significant: pValue < alpha,
    alpha,
    sampleSize: n,
  };
}

/**
 * Run significance tests for all five components.
 */
export function testAllComponentSignificance(
  outcomes: ScoredPickOutcome[],
  alpha = 0.05,
): SignificanceTestResult[] {
  const components = ['edge', 'trust', 'readiness', 'uniqueness', 'boardFit'] as const;
  return components.map((component) => testComponentSignificance(outcomes, component, alpha));
}

/**
 * Two-tailed p-value approximation for Pearson t-test via regularized incomplete beta.
 * df = n - 2.
 */
function approximatePValue(r: number, n: number): number {
  if (n <= 2) return 1;
  const df = n - 2;
  const tStat = (r * Math.sqrt(df)) / Math.sqrt(Math.max(1 - r * r, 1e-10));
  // Approximate using normal distribution for large df; for small df use t-dist approximation
  const abst = Math.abs(tStat);
  if (df >= 30) {
    // Approximate t with standard normal for large df
    return 2 * (1 - normalCdf(abst));
  }
  // Approximation via regularized incomplete beta: B(df/(df+t²), df/2, 0.5)
  const x = df / (df + tStat * tStat);
  return incompleteBetaApprox(x, df / 2, 0.5);
}

function normalCdf(z: number): number {
  // Abramowitz & Stegun approximation (error < 7.5e-8)
  const t = 1 / (1 + 0.2316419 * z);
  const poly =
    t * (0.319381530 +
      t * (-0.356563782 +
        t * (1.781477937 +
          t * (-1.821255978 + t * 1.330274429))));
  return 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z) * poly;
}

/**
 * Approximation of the regularized incomplete beta function B(x; a, b) using
 * a continued fraction expansion (Lentz method, truncated at 100 iterations).
 * Sufficient for p-value approximation purposes.
 */
function incompleteBetaApprox(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const lbeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const prefix = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta) / a;

  // Continued fraction (betacf)
  let h = 1;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  h = d;

  for (let m = 1; m <= 100; m++) {
    // Even step
    let aa = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + aa * d;
    c = 1 + aa / c;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    h *= d * c;

    // Odd step
    aa = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + aa * d;
    c = 1 + aa / c;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-7) break;
  }

  return prefix * h;
}

function logGamma(z: number): number {
  // Stirling approximation for log-gamma, sufficient for large z
  // For small z use recursion: log Γ(z) = log Γ(z+1) - log(z)
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  z -= 1;
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  let x = c[0]!;
  for (let i = 1; i < g + 2; i++) {
    x += c[i]! / (z + i);
  }
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
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
