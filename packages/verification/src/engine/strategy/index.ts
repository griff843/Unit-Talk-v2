/**
 * R5: Strategy evaluation layer
 *
 * Computation engines (BankrollSimulator, ExecutionSimulator, etc.) are in
 * packages/domain/src/. This module provides the proof writer for strategy
 * evaluation artifacts.
 */

export type {
  StrategyConfig,
  ExecutionSimConfig,
  SimulatedExecution,
  BankrollStep,
  RiskEvent,
  StrategyEvaluationResult,
  StrategyComparisonReport,
  StrategyDelta,
  StrategyWinner,
} from './types.js';

export { StrategyProofWriter } from './strategy-proof-writer.js';
