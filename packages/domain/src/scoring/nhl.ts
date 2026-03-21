import type { SportSpecificWeights, TierThresholds, RiskManagementConfig, ScoringConfig } from './types.js';

export const NHL_WEIGHTS: SportSpecificWeights = {
  sport: 'NHL',
  version: '1.0.0',
  description: 'NHL hockey optimized for goaltending, special teams, and game flow',
  lastUpdated: '2025-01-09',

  expectedValue: 0.19,
  lineMovement: 0.11,
  matchupRating: 0.14,
  playerForm: 0.09,
  injuryImpact: 0.07,
  weatherImpact: 0.0,

  marketIntelligence: 0.13,
  sharpMoney: 0.08,
  volumeProfile: 0.06,
  closingLineValue: 0.11,

  steamDetection: 0.02,
  closingLinePrediction: 0.015,
  optimalTiming: 0.012,
  lineShoppingEdge: 0.015,
  publicVsSharpSplit: 0.018,
  marketTimingAdvantage: 0.01,
  injuryTimingEdge: 0.013,
  crossMarketDiscrepancy: 0.012,

  playerFatigue: 0.025,
  venueAdvantage: 0.02,
  refereeImpact: 0.03,
  paceImpact: 0.035,
  motivationalFactors: 0.02,

  correlationRisk: 0.018,
  volatility: 0.015,
  portfolioImpact: 0.007,

  neuralNetwork: 0.022,
  gradientBoosting: 0.028,
  randomForest: 0.018,
  ensemble: 0.032,

  handednessSplits: 0.01,
  recentTrendAnalysis: 0.02,
  headToHeadHistory: 0.015,
  rosterStabilityScore: 0.015,
  bullpenQualityScore: 0.0,
  advancedSplitAnalysis: 0.025,

  last3Weight: 0.4,
  last7Weight: 0.3,
  last15Weight: 0.2,
  last30Weight: 0.1,
  enhancedWeight: 0.07,

  sportSpecificFactors: {
    goalieMatchup: 0.04,
    specialTeamsEdge: 0.03,
    restAdvantage: 0.02,
    lineChemistry: 0.015,
    seasonalTrend: 0.01,
  },
};

export const NHL_TIERS: TierThresholds = {
  S_TIER: { minScore: 71, minEdge: 21, maxRisk: 4, minPositionSize: 0.045 },
  A_TIER: { minScore: 51, minEdge: 1, maxRisk: 5, minPositionSize: 0.028 },
  B_TIER: { minScore: 41, maxRisk: 6, minPositionSize: 0.014 },
  C_TIER: { minScore: 31, maxRisk: 7, minPositionSize: 0.005 },
  D_TIER: { description: 'Below quality threshold - rejected' },
};

export const NHL_RISK: RiskManagementConfig = {
  maxPositionSize: 0.05,
  kellyMultiplier: 0.24,
  maxDrawdown: 0.19,
  maxCorrelation: 0.68,
  minSharpeRatio: 1.1,
  maxExposurePerSport: 0.3,
  maxExposurePerPlayer: 0.1,
  maxDailyRisk: 0.15,
  stopLossThreshold: 0.14,
  maxVaR: 0.048,
  maxCVaR: 0.075,
};

export const NHL_CONFIG: ScoringConfig = {
  weights: NHL_WEIGHTS,
  tiers: NHL_TIERS,
  risk: NHL_RISK,
};
