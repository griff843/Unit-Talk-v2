import type { SportSpecificWeights, TierThresholds, RiskManagementConfig, ScoringConfig } from './types.js';

export const NBA_WEIGHTS: SportSpecificWeights = {
  sport: 'NBA',
  version: '1.0.0',
  description: 'NBA basketball optimized for player props with rest, pace, and matchup focus',
  lastUpdated: '2025-01-09',

  expectedValue: 0.2,
  lineMovement: 0.12,
  matchupRating: 0.15,
  playerForm: 0.1,
  injuryImpact: 0.08,
  weatherImpact: 0.0,

  marketIntelligence: 0.14,
  sharpMoney: 0.09,
  volumeProfile: 0.06,
  closingLineValue: 0.11,

  steamDetection: 0.02,
  closingLinePrediction: 0.015,
  optimalTiming: 0.01,
  lineShoppingEdge: 0.015,
  publicVsSharpSplit: 0.02,
  marketTimingAdvantage: 0.01,
  injuryTimingEdge: 0.015,
  crossMarketDiscrepancy: 0.012,

  playerFatigue: 0.03,
  venueAdvantage: 0.015,
  refereeImpact: 0.02,
  paceImpact: 0.04,
  motivationalFactors: 0.025,

  correlationRisk: 0.02,
  volatility: 0.015,
  portfolioImpact: 0.005,

  neuralNetwork: 0.025,
  gradientBoosting: 0.03,
  randomForest: 0.02,
  ensemble: 0.035,

  handednessSplits: 0.01,
  recentTrendAnalysis: 0.025,
  headToHeadHistory: 0.015,
  rosterStabilityScore: 0.02,
  bullpenQualityScore: 0.0,
  advancedSplitAnalysis: 0.03,

  last3Weight: 0.35,
  last7Weight: 0.3,
  last15Weight: 0.2,
  last30Weight: 0.15,
  enhancedWeight: 0.08,

  sportSpecificFactors: {
    backToBackFatigue: 0.03,
    restDaysAdvantage: 0.02,
    minutesLoad: 0.025,
    paceMatchup: 0.015,
    playoffAdjustment: 0.01,
  },
};

export const NBA_TIERS: TierThresholds = {
  S_TIER: { minScore: 75, minEdge: 25, maxRisk: 3, minPositionSize: 0.05 },
  A_TIER: { minScore: 55, minEdge: 5, maxRisk: 4, minPositionSize: 0.03 },
  B_TIER: { minScore: 45, maxRisk: 5, minPositionSize: 0.015 },
  C_TIER: { minScore: 35, maxRisk: 6, minPositionSize: 0.005 },
  D_TIER: { description: 'Below quality threshold - rejected' },
};

export const NBA_RISK: RiskManagementConfig = {
  maxPositionSize: 0.05,
  kellyMultiplier: 0.25,
  maxDrawdown: 0.18,
  maxCorrelation: 0.65,
  minSharpeRatio: 1.2,
  maxExposurePerSport: 0.3,
  maxExposurePerPlayer: 0.1,
  maxDailyRisk: 0.15,
  stopLossThreshold: 0.12,
  maxVaR: 0.05,
  maxCVaR: 0.08,
};

export const NBA_CONFIG: ScoringConfig = {
  weights: NBA_WEIGHTS,
  tiers: NBA_TIERS,
  risk: NBA_RISK,
};
