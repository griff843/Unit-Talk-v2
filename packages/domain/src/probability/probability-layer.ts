import {
  calculateEdge,
  computeConsensus,
  roundTo,
  type BookOffer,
  type ConsensusResultFail,
  type ConsensusResultOk,
  type DevigMethod,
  PROBABILITY_MODEL_VERSION,
  MIN_BOOKS_FOR_CONSENSUS
} from './devig.js';

export interface UncertaintyFactors {
  booksAvailable: number;
  bookSpread: number;
  dataQualityScore: number;
  hoursToStart: number | null;
  historicalAccuracy: number | null;
  featureCompleteness: number;
}

export interface ExplanationPayload {
  model_version: string;
  p_market_devig: number;
  adjustment_raw: number;
  adjustment_capped: number;
  cap_value: number;
  cap_reason: string;
  uncertainty_final: number;
  confidence_factor: number;
  p_final: number;
  edge_final: number;
  clipped: boolean;
  reason_codes: string[];
  books_used: number;
  book_spread: number;
  feature_completeness: number;
}

export interface SyndicateLayerParams {
  maxDeltaOverride?: number;
  minBooksForCapBoost?: number;
  absoluteMaxCap?: number;
  absoluteMinCap?: number;
}

export interface ProbabilityInput {
  confidenceScore: number;
  bookOffers: BookOffer[];
  side: 'over' | 'under' | 'yes' | 'no';
  entryOdds: number;
  sport: string;
  marketType: string;
  hoursToStart: number | null;
  featureCompleteness: number;
  syndicateParams?: SyndicateLayerParams;
}

export interface ProbabilityOutputOk {
  ok: true;
  pFinal: number;
  uncertaintyFinal: number;
  edgeFinal: number;
  clvForecast: number;
  pMarketDevig: number;
  devigMethod: DevigMethod;
  consensusWeightsJson: Record<string, unknown>;
  probabilityModelVersion: string;
  booksUsed: number;
  explain: ExplanationPayload;
}

export interface ProbabilityOutputFail {
  ok: false;
  reason: ProbabilityFailReason;
  reasonDetail: string;
}

export type ProbabilityFailReason =
  | 'CONSENSUS_FAILED'
  | 'INSUFFICIENT_BOOKS'
  | 'INVALID_INPUT'
  | 'COMPUTATION_ERROR';

export type ProbabilityOutput = ProbabilityOutputOk | ProbabilityOutputFail;

export interface PFinalResult {
  pFinal: number;
  adjustmentRaw: number;
  adjustmentCapped: number;
  clipped: boolean;
}

export const UNCERTAINTY_THRESHOLDS = {
  HARD_MAX: 0.25,
  SOFT_MAX: 0.4,
  MIN_BOOKS_LOW_UNCERTAINTY: 3,
  MAX_BOOK_SPREAD_LOW_UNCERTAINTY: 0.03
} as const;

const MARKET_DELTA_PARAMS = {
  NEUTRAL_CONFIDENCE: 5.0,
  MAX_CONFIDENCE: 10.0,
  MIN_CONFIDENCE: 0.0,
  MAX_DELTA: 0.04
} as const;

const CLV_FORECAST_PARAMS = {
  HIGH_CLV_MARKETS: ['points', 'rebounds', 'assists', 'pts_reb_ast'] as const,
  TIME_DECAY_HOURS: 24
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function confidenceToDelta(confidence: number): number {
  const clamped = clamp(
    confidence,
    MARKET_DELTA_PARAMS.MIN_CONFIDENCE,
    MARKET_DELTA_PARAMS.MAX_CONFIDENCE
  );

  const normalized =
    (clamped - MARKET_DELTA_PARAMS.NEUTRAL_CONFIDENCE) /
    (MARKET_DELTA_PARAMS.MAX_CONFIDENCE -
      MARKET_DELTA_PARAMS.NEUTRAL_CONFIDENCE);

  return roundTo(normalized * MARKET_DELTA_PARAMS.MAX_DELTA, 6);
}

export function computeUncertainty(factors: UncertaintyFactors): number {
  let uncertainty = 0;
  const booksFactor =
    factors.booksAvailable >= 3 ? 0 : (3 - factors.booksAvailable) / 3;
  uncertainty += booksFactor * 0.3;

  const spreadFactor = clamp(factors.bookSpread / 0.1, 0, 1);
  uncertainty += spreadFactor * 0.25;

  const qualityFactor = 1 - clamp(factors.dataQualityScore, 0.3, 1);
  uncertainty += qualityFactor * 0.2;

  if (factors.hoursToStart !== null) {
    uncertainty += clamp(factors.hoursToStart / 24, 0, 1) * 0.15;
  } else {
    uncertainty += 0.1;
  }

  uncertainty += (1 - clamp(factors.featureCompleteness, 0, 1)) * 0.1;

  return roundTo(clamp(uncertainty, 0, 1), 6);
}

export function computeConfidenceFactor(
  booksUsed: number,
  bookSpread: number,
  featureCompleteness: number
): number {
  const bookCountFactor = clamp((booksUsed - 1) / 4, 0.3, 1.0);
  const agreementFactor = clamp(1 - bookSpread / 0.06, 0.4, 1.0);
  const completenessFactor = clamp(featureCompleteness, 0.3, 1.0);

  const factor =
    bookCountFactor * 0.4 +
    agreementFactor * 0.4 +
    completenessFactor * 0.2;

  return roundTo(clamp(factor, 0, 1), 6);
}

export function computeDynamicCap(
  booksUsed: number,
  bookSpread: number,
  params?: SyndicateLayerParams
): { cap: number; reason: string } {
  const baseCap = params?.maxDeltaOverride ?? MARKET_DELTA_PARAMS.MAX_DELTA;
  const minBooksBoost = params?.minBooksForCapBoost ?? 5;
  const absoluteMax = params?.absoluteMaxCap ?? 0.06;
  const absoluteMin = params?.absoluteMinCap ?? 0.01;

  const bookFactor = clamp(booksUsed / minBooksBoost, 0.6, 1.2);
  const agreementFactor = clamp(1 - bookSpread / 0.08, 0.5, 1.0);
  const dynamicCap = baseCap * bookFactor * agreementFactor;
  const finalCap = roundTo(clamp(dynamicCap, absoluteMin, absoluteMax), 6);

  const reasons = [
    `base=${baseCap}`,
    `books=${booksUsed},bookFactor=${roundTo(bookFactor, 2)}`,
    `spread=${roundTo(bookSpread, 4)},agreeFactor=${roundTo(
      agreementFactor,
      2
    )}`
  ];

  if (finalCap === absoluteMax) {
    reasons.push('hit_absolute_max');
  }
  if (finalCap === absoluteMin) {
    reasons.push('hit_absolute_min');
  }

  return { cap: finalCap, reason: reasons.join(';') };
}

export function computePFinal(
  confidenceScore: number,
  pMarketDevig: number,
  uncertainty: number,
  confidenceFactor = 1.0,
  dynamicCap: number = MARKET_DELTA_PARAMS.MAX_DELTA
): PFinalResult {
  const adjustmentRaw = confidenceToDelta(confidenceScore);
  const adjustmentCapped = clamp(adjustmentRaw, -dynamicCap, dynamicCap);
  const effectiveAdjustment =
    adjustmentCapped * confidenceFactor * (1 - uncertainty);
  const pFinalRaw = pMarketDevig + effectiveAdjustment;
  const pFinal = roundTo(clamp(pFinalRaw, 0.01, 0.99), 6);

  return {
    pFinal,
    adjustmentRaw: roundTo(adjustmentRaw, 6),
    adjustmentCapped: roundTo(adjustmentCapped, 6),
    clipped: Math.abs(pFinalRaw - pFinal) > 1e-9
  };
}

export function computeCLVForecast(
  edge: number,
  marketType: string,
  hoursToStart: number | null
): number {
  let forecast = edge * 0.5;
  const normalizedMarket = marketType.toLowerCase().replace(/[^a-z_]/g, '');

  if (
    (CLV_FORECAST_PARAMS.HIGH_CLV_MARKETS as readonly string[]).includes(
      normalizedMarket
    )
  ) {
    forecast *= 1.2;
  }

  if (hoursToStart !== null) {
    forecast *= clamp(
      hoursToStart / CLV_FORECAST_PARAMS.TIME_DECAY_HOURS,
      0.2,
      1
    );
  }

  return roundTo(clamp(forecast, -1, 1), 6);
}

export function computeProbabilityLayer(
  input: ProbabilityInput
): ProbabilityOutput {
  if (!Number.isFinite(input.confidenceScore) || !Number.isFinite(input.entryOdds)) {
    return {
      ok: false,
      reason: 'INVALID_INPUT',
      reasonDetail: 'confidenceScore or entryOdds is not a finite number'
    };
  }

  if (input.bookOffers.length < MIN_BOOKS_FOR_CONSENSUS) {
    return {
      ok: false,
      reason: 'INSUFFICIENT_BOOKS',
      reasonDetail: `Need ${MIN_BOOKS_FOR_CONSENSUS} books for consensus, got ${input.bookOffers.length}. Promotion blocked.`
    };
  }

  const consensus = computeConsensus(input.bookOffers, 'proportional');
  if (!consensus.ok) {
    const fail = consensus as ConsensusResultFail;
    return {
      ok: false,
      reason: 'CONSENSUS_FAILED',
      reasonDetail: `${fail.reason}: ${fail.reasonDetail}`
    };
  }

  const consensusOk = consensus as ConsensusResultOk;
  const pMarketDevig =
    input.side === 'over' || input.side === 'yes'
      ? consensusOk.overConsensus
      : consensusOk.underConsensus;

  let bookSpread = 0;
  if (consensusOk.books.length >= 2) {
    const fairProbs = consensusOk.books.map(book =>
      input.side === 'over' || input.side === 'yes'
        ? book.overFair
        : book.underFair
    );
    bookSpread = Math.max(...fairProbs) - Math.min(...fairProbs);
  }

  const dataQualityScore =
    Object.values(consensusOk.consensusWeights).reduce(
      (sum, weight) => sum + weight.dataQualityWeight,
      0
    ) / consensusOk.booksUsed;

  const uncertaintyFinal = computeUncertainty({
    booksAvailable: consensusOk.booksUsed,
    bookSpread,
    dataQualityScore,
    hoursToStart: input.hoursToStart,
    historicalAccuracy: null,
    featureCompleteness: input.featureCompleteness
  });

  const confidenceFactor = computeConfidenceFactor(
    consensusOk.booksUsed,
    bookSpread,
    input.featureCompleteness
  );

  const { cap: dynamicCap, reason: capReason } = computeDynamicCap(
    consensusOk.booksUsed,
    bookSpread,
    input.syndicateParams
  );

  const pFinalResult = computePFinal(
    input.confidenceScore,
    pMarketDevig,
    uncertaintyFinal,
    confidenceFactor,
    dynamicCap
  );

  const decimalOdds =
    input.entryOdds > 0
      ? input.entryOdds / 100 + 1
      : 100 / Math.abs(input.entryOdds) + 1;
  const { edge } = calculateEdge(
    pFinalResult.pFinal,
    pMarketDevig,
    decimalOdds
  );

  const clvForecast = computeCLVForecast(
    edge,
    input.marketType,
    input.hoursToStart
  );

  if (
    !Number.isFinite(pFinalResult.pFinal) ||
    !Number.isFinite(uncertaintyFinal) ||
    !Number.isFinite(edge)
  ) {
    return {
      ok: false,
      reason: 'COMPUTATION_ERROR',
      reasonDetail: 'Probability computation produced non-finite values'
    };
  }

  const reasonCodes: string[] = [];
  if (pFinalResult.clipped) reasonCodes.push('P_FINAL_CLIPPED');
  if (dynamicCap < MARKET_DELTA_PARAMS.MAX_DELTA) reasonCodes.push('CAP_REDUCED');
  if (dynamicCap > MARKET_DELTA_PARAMS.MAX_DELTA) reasonCodes.push('CAP_BOOSTED');
  if (confidenceFactor < 0.5) reasonCodes.push('LOW_CONFIDENCE_FACTOR');
  if (uncertaintyFinal > UNCERTAINTY_THRESHOLDS.SOFT_MAX) reasonCodes.push('HIGH_UNCERTAINTY');
  if (bookSpread > 0.05) reasonCodes.push('HIGH_BOOK_SPREAD');
  if (Math.abs(edge) > 0.05) reasonCodes.push('LARGE_EDGE');
  if (Math.abs(edge) > 0.08) reasonCodes.push('EDGE_TOO_GOOD_TO_BE_TRUE');

  const explain: ExplanationPayload = {
    model_version: PROBABILITY_MODEL_VERSION,
    p_market_devig: pMarketDevig,
    adjustment_raw: pFinalResult.adjustmentRaw,
    adjustment_capped: pFinalResult.adjustmentCapped,
    cap_value: dynamicCap,
    cap_reason: capReason,
    uncertainty_final: uncertaintyFinal,
    confidence_factor: confidenceFactor,
    p_final: pFinalResult.pFinal,
    edge_final: edge,
    clipped: pFinalResult.clipped,
    reason_codes: reasonCodes,
    books_used: consensusOk.booksUsed,
    book_spread: roundTo(bookSpread, 6),
    feature_completeness: input.featureCompleteness
  };

  return {
    ok: true,
    pFinal: pFinalResult.pFinal,
    uncertaintyFinal,
    edgeFinal: edge,
    clvForecast,
    pMarketDevig,
    devigMethod: consensusOk.devigMethod,
    consensusWeightsJson: consensusOk.consensusWeights,
    probabilityModelVersion: PROBABILITY_MODEL_VERSION,
    booksUsed: consensusOk.booksUsed,
    explain
  };
}
