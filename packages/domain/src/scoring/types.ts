/**
 * Scoring Weight Types
 *
 * Centralized scoring weights types for all sports.
 * Ensures type safety and eliminates magic numbers.
 */

export interface CoreScoringWeights {
  expectedValue: number;
  lineMovement: number;
  matchupRating: number;
  playerForm: number;
  injuryImpact: number;
  weatherImpact: number;

  marketIntelligence: number;
  sharpMoney: number;
  volumeProfile: number;
  closingLineValue: number;

  steamDetection: number;
  closingLinePrediction: number;
  optimalTiming: number;
  lineShoppingEdge: number;
  publicVsSharpSplit: number;
  marketTimingAdvantage: number;
  injuryTimingEdge: number;
  crossMarketDiscrepancy: number;

  playerFatigue: number;
  venueAdvantage: number;
  refereeImpact: number;
  paceImpact: number;
  motivationalFactors: number;

  correlationRisk: number;
  volatility: number;
  portfolioImpact: number;

  neuralNetwork: number;
  gradientBoosting: number;
  randomForest: number;
  ensemble: number;
}

export interface EnhancedScoringWeights {
  handednessSplits: number;
  recentTrendAnalysis: number;
  headToHeadHistory: number;
  rosterStabilityScore: number;
  bullpenQualityScore: number;
  advancedSplitAnalysis: number;

  last3Weight: number;
  last7Weight: number;
  last15Weight: number;
  last30Weight: number;
  enhancedWeight: number;
}

export interface SportSpecificWeights extends CoreScoringWeights, EnhancedScoringWeights {
  sport: string;
  version: string;
  description: string;
  lastUpdated: string;
  sportSpecificFactors?: Record<string, number>;
}

export interface TierThresholds {
  S_TIER: { minScore: number; minEdge: number; maxRisk: number; minPositionSize: number };
  A_TIER: { minScore: number; minEdge: number; maxRisk: number; minPositionSize: number };
  B_TIER: { minScore: number; maxRisk: number; minPositionSize: number };
  C_TIER: { minScore: number; maxRisk: number; minPositionSize: number };
  D_TIER: { description: string };
}

export interface RiskManagementConfig {
  maxPositionSize: number;
  kellyMultiplier: number;
  maxDrawdown: number;
  maxCorrelation: number;
  minSharpeRatio: number;
  maxExposurePerSport: number;
  maxExposurePerPlayer: number;
  maxDailyRisk: number;
  stopLossThreshold: number;
  maxVaR: number;
  maxCVaR: number;
}

export interface ScoringConfig {
  weights: SportSpecificWeights;
  tiers: TierThresholds;
  risk: RiskManagementConfig;
}

/** All 30 scoring weight keys from CoreScoringWeights */
export const CORE_WEIGHT_KEYS: (keyof CoreScoringWeights)[] = [
  'expectedValue',
  'lineMovement',
  'matchupRating',
  'playerForm',
  'injuryImpact',
  'weatherImpact',
  'marketIntelligence',
  'sharpMoney',
  'volumeProfile',
  'closingLineValue',
  'steamDetection',
  'closingLinePrediction',
  'optimalTiming',
  'lineShoppingEdge',
  'publicVsSharpSplit',
  'marketTimingAdvantage',
  'injuryTimingEdge',
  'crossMarketDiscrepancy',
  'playerFatigue',
  'venueAdvantage',
  'refereeImpact',
  'paceImpact',
  'motivationalFactors',
  'correlationRisk',
  'volatility',
  'portfolioImpact',
  'neuralNetwork',
  'gradientBoosting',
  'randomForest',
  'ensemble',
];

/** Enhanced feature keys (scoring weights, NOT time-based recency weights) */
export const ENHANCED_FEATURE_KEYS: (keyof EnhancedScoringWeights)[] = [
  'handednessSplits',
  'recentTrendAnalysis',
  'headToHeadHistory',
  'rosterStabilityScore',
  'bullpenQualityScore',
  'advancedSplitAnalysis',
];

/** Time-based recency weights — separate from scoring weights */
export const TIME_WEIGHT_KEYS: (keyof EnhancedScoringWeights)[] = [
  'last3Weight',
  'last7Weight',
  'last15Weight',
  'last30Weight',
  'enhancedWeight',
];

export interface WeightValidationResult {
  valid: boolean;
  coreTotal: number;
  enhancedTotal: number;
  total: number;
  issues: string[];
}

/**
 * V2 validation — uses explicit key lists to avoid double-counting.
 * Checks that all scoring weights are non-negative and total > 0.
 */
export function validateWeightsV2(weights: SportSpecificWeights): WeightValidationResult {
  const issues: string[] = [];
  let coreTotal = 0;
  let enhancedTotal = 0;

  for (const key of CORE_WEIGHT_KEYS) {
    const v = weights[key];
    if (typeof v !== 'number' || isNaN(v)) {
      issues.push(`Missing or non-number core weight: ${key}`);
      continue;
    }
    if (v < 0) {
      issues.push(`Negative core weight: ${key} = ${v}`);
    }
    coreTotal += v;
  }

  for (const key of ENHANCED_FEATURE_KEYS) {
    const v = weights[key];
    if (typeof v !== 'number' || isNaN(v)) {
      issues.push(`Missing or non-number enhanced weight: ${key}`);
      continue;
    }
    if (v < 0) {
      issues.push(`Negative enhanced weight: ${key} = ${v}`);
    }
    enhancedTotal += v;
  }

  const total = coreTotal + enhancedTotal;

  if (total <= 0) {
    issues.push(`Total scoring weight is ${total}, must be > 0`);
  }

  return { valid: issues.length === 0, coreTotal, enhancedTotal, total, issues };
}
