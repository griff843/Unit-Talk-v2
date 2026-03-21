import type { SportSpecificWeights, TierThresholds, RiskManagementConfig, ScoringConfig } from './types.js';

export const NFL_WEIGHTS: SportSpecificWeights = {
  sport: 'NFL',
  version: '1.0.0',
  description: 'NFL football optimized for weather impact, injuries, and situational factors',
  lastUpdated: '2025-01-09',

  expectedValue: 0.22,
  lineMovement: 0.14,
  matchupRating: 0.13,
  playerForm: 0.1,
  injuryImpact: 0.09,
  weatherImpact: 0.04,

  marketIntelligence: 0.15,
  sharpMoney: 0.11,
  volumeProfile: 0.07,
  closingLineValue: 0.12,

  steamDetection: 0.03,
  closingLinePrediction: 0.025,
  optimalTiming: 0.02,
  lineShoppingEdge: 0.018,
  publicVsSharpSplit: 0.025,
  marketTimingAdvantage: 0.015,
  injuryTimingEdge: 0.02,
  crossMarketDiscrepancy: 0.015,

  playerFatigue: 0.02,
  venueAdvantage: 0.025,
  refereeImpact: 0.025,
  paceImpact: 0.03,
  motivationalFactors: 0.04,

  correlationRisk: 0.02,
  volatility: 0.02,
  portfolioImpact: 0.005,

  neuralNetwork: 0.025,
  gradientBoosting: 0.03,
  randomForest: 0.02,
  ensemble: 0.035,

  handednessSplits: 0.0,
  recentTrendAnalysis: 0.015,
  headToHeadHistory: 0.01,
  rosterStabilityScore: 0.02,
  bullpenQualityScore: 0.0,
  advancedSplitAnalysis: 0.025,

  last3Weight: 0.5,
  last7Weight: 0.3,
  last15Weight: 0.15,
  last30Weight: 0.05,
  enhancedWeight: 0.06,

  sportSpecificFactors: {
    weatherConditions: 0.035,
    primeTimeBonus: 0.02,
    playoffImplications: 0.03,
    divisionRivalry: 0.015,
    restAdvantage: 0.01,
  },
};

export const NFL_TIERS: TierThresholds = {
  S_TIER: { minScore: 72, minEdge: 22, maxRisk: 3, minPositionSize: 0.05 },
  A_TIER: { minScore: 52, minEdge: 2, maxRisk: 4, minPositionSize: 0.03 },
  B_TIER: { minScore: 42, maxRisk: 5, minPositionSize: 0.015 },
  C_TIER: { minScore: 32, maxRisk: 6, minPositionSize: 0.005 },
  D_TIER: { description: 'Below quality threshold - rejected' },
};

export const NFL_RISK: RiskManagementConfig = {
  maxPositionSize: 0.05,
  kellyMultiplier: 0.25,
  maxDrawdown: 0.2,
  maxCorrelation: 0.7,
  minSharpeRatio: 1.0,
  maxExposurePerSport: 0.3,
  maxExposurePerPlayer: 0.1,
  maxDailyRisk: 0.15,
  stopLossThreshold: 0.15,
  maxVaR: 0.05,
  maxCVaR: 0.08,
};

export const NFL_CONFIG: ScoringConfig = {
  weights: NFL_WEIGHTS,
  tiers: NFL_TIERS,
  risk: NFL_RISK,
};
