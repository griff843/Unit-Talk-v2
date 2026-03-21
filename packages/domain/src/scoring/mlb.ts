import type { SportSpecificWeights, TierThresholds, RiskManagementConfig, ScoringConfig } from './types.js';

export const MLB_WEIGHTS: SportSpecificWeights = {
  sport: 'MLB',
  version: '1.0.0',
  description: 'MLB baseball optimized for handedness splits, weather, and bullpen analysis',
  lastUpdated: '2025-01-09',

  expectedValue: 0.18,
  lineMovement: 0.1,
  matchupRating: 0.12,
  playerForm: 0.08,
  injuryImpact: 0.06,
  weatherImpact: 0.05,

  marketIntelligence: 0.13,
  sharpMoney: 0.08,
  volumeProfile: 0.05,
  closingLineValue: 0.1,

  steamDetection: 0.015,
  closingLinePrediction: 0.01,
  optimalTiming: 0.008,
  lineShoppingEdge: 0.012,
  publicVsSharpSplit: 0.015,
  marketTimingAdvantage: 0.008,
  injuryTimingEdge: 0.01,
  crossMarketDiscrepancy: 0.012,

  playerFatigue: 0.015,
  venueAdvantage: 0.025,
  refereeImpact: 0.015,
  paceImpact: 0.02,
  motivationalFactors: 0.015,

  correlationRisk: 0.02,
  volatility: 0.015,
  portfolioImpact: 0.005,

  neuralNetwork: 0.02,
  gradientBoosting: 0.025,
  randomForest: 0.015,
  ensemble: 0.03,

  handednessSplits: 0.08,
  recentTrendAnalysis: 0.02,
  headToHeadHistory: 0.02,
  rosterStabilityScore: 0.015,
  bullpenQualityScore: 0.04,
  advancedSplitAnalysis: 0.035,

  last3Weight: 0.25,
  last7Weight: 0.35,
  last15Weight: 0.25,
  last30Weight: 0.15,
  enhancedWeight: 0.12,

  sportSpecificFactors: {
    parkFactor: 0.04,
    weatherConditions: 0.03,
    platoonAdvantage: 0.035,
    bullpenUsage: 0.025,
    restDays: 0.01,
  },
};

export const MLB_TIERS: TierThresholds = {
  S_TIER: { minScore: 70, minEdge: 20, maxRisk: 4, minPositionSize: 0.045 },
  A_TIER: { minScore: 50, minEdge: 0, maxRisk: 5, minPositionSize: 0.025 },
  B_TIER: { minScore: 40, maxRisk: 6, minPositionSize: 0.012 },
  C_TIER: { minScore: 30, maxRisk: 7, minPositionSize: 0.004 },
  D_TIER: { description: 'Below quality threshold - rejected' },
};

export const MLB_RISK: RiskManagementConfig = {
  maxPositionSize: 0.05,
  kellyMultiplier: 0.22,
  maxDrawdown: 0.2,
  maxCorrelation: 0.7,
  minSharpeRatio: 0.9,
  maxExposurePerSport: 0.3,
  maxExposurePerPlayer: 0.1,
  maxDailyRisk: 0.16,
  stopLossThreshold: 0.15,
  maxVaR: 0.055,
  maxCVaR: 0.085,
};

export const MLB_CONFIG: ScoringConfig = {
  weights: MLB_WEIGHTS,
  tiers: MLB_TIERS,
  risk: MLB_RISK,
};
