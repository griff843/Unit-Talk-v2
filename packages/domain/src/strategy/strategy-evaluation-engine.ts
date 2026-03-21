/**
 * StrategyEvaluationEngine
 *
 * Orchestrates strategy evaluation from replay outputs through to
 * bankroll simulation and report generation.
 *
 * Design law:
 *   - Consumes finalPickState as source truth
 *   - Settlement results are historical — never fabricated
 *   - Execution simulation is optional; does not alter settlement outcomes
 */

import { BankrollSimulator, normalizePick } from './bankroll-simulator.js';
import { ExecutionSimulator } from './execution-simulator.js';

import type { NormalizedPick } from './bankroll-simulator.js';
import type { StrategyConfig, StrategyEvaluationResult, SimulatedExecution } from './types.js';

/**
 * Minimal replay result interface.
 * Only the fields needed for strategy evaluation.
 */
export interface ReplayPickState {
  readonly finalPickState: ReadonlyArray<Record<string, unknown>>;
}

// ─────────────────────────────────────────────────────────────
// ENGINE
// ─────────────────────────────────────────────────────────────

export class StrategyEvaluationEngine {
  /**
   * Evaluate a strategy over a replay run's output.
   *
   * @param replayResult  Result containing finalPickState array
   * @param config        Strategy configuration to evaluate
   * @param timestamp     Optional ISO timestamp (defaults to epoch for determinism)
   */
  run(
    replayResult: ReplayPickState,
    config: StrategyConfig,
    timestamp: string = new Date(0).toISOString(),
  ): StrategyEvaluationResult {
    const runAt = timestamp;

    // 1. Normalize picks from replay final state
    const allPicks = replayResult.finalPickState.map((raw) =>
      normalizePick(raw as Record<string, unknown>),
    );

    // 2. Sort by placed_at timestamp (chronological)
    const sortedPicks = [...allPicks].sort(
      (a, b) => new Date(a.placedAt).getTime() - new Date(b.placedAt).getTime(),
    );

    // 3. Apply execution simulation if configured
    const executionMap = new Map<string, SimulatedExecution>();
    const simulatedExecutions: SimulatedExecution[] = [];

    if (config.executionSimConfig) {
      const simulator = new ExecutionSimulator(config.executionSimConfig);

      for (const pick of sortedPicks) {
        // Only simulate picks that would be eligible (skip obviously ineligible)
        if (!pick.settlementResult) continue;

        // Calculate a preliminary stake to pass to simulator
        const prelimStake = config.initialBankroll * config.unitSize;

        const exec = simulator.simulate(pick.id, pick.line, pick.odds, prelimStake, {
          ...(pick.sport !== undefined ? { sport: pick.sport } : {}),
          ...(pick.playerName !== undefined ? { playerName: pick.playerName } : {}),
        });

        executionMap.set(pick.id, exec);
        simulatedExecutions.push(exec);
      }
    }

    // 4. Run bankroll simulation
    const bankrollSim = new BankrollSimulator(config);
    const simOutput = bankrollSim.simulate(sortedPicks, executionMap);

    // 5. Compute summary statistics
    const settledBets = simOutput.steps.filter(
      (s) => s.stake > 0 && (s.settlementResult === 'win' || s.settlementResult === 'loss'),
    );
    const wonBets = settledBets.filter((s) => s.settlementResult === 'win');
    const hitRate = settledBets.length > 0 ? wonBets.length / settledBets.length : 0;

    const roi = simOutput.totalStaked > 0 ? simOutput.totalPnl / simOutput.totalStaked : 0;
    const bankrollGrowth =
      (simOutput.finalBankroll - config.initialBankroll) / config.initialBankroll;

    // Average CLV (only from executions with friction)
    const clvValues = simulatedExecutions.map((e) => e.impliedCLV);
    const avgCLV =
      clvValues.length > 0 ? clvValues.reduce((a, b) => a + b, 0) / clvValues.length : 0;

    // Average execution quality
    const qValues = simulatedExecutions.filter((e) => !e.rejected).map((e) => e.executionQuality);
    const avgExecutionQuality =
      qValues.length > 0 ? qValues.reduce((a, b) => a + b, 0) / qValues.length : 1.0; // Perfect quality when no friction applied

    return {
      strategyId: config.strategyId,
      strategyConfig: config,
      runAt,
      totalPicksConsidered: sortedPicks.length,
      betsPlaced: simOutput.betsPlaced,
      betsSkipped: simOutput.betsSkipped,
      betsRejected: simOutput.betsRejected,
      hitRate: Math.round(hitRate * 10000) / 10000,
      roi: Math.round(roi * 10000) / 10000,
      bankrollGrowth: Math.round(bankrollGrowth * 10000) / 10000,
      finalBankroll: simOutput.finalBankroll,
      initialBankroll: config.initialBankroll,
      peakBankroll: simOutput.peakBankroll,
      maxDrawdown: Math.round(simOutput.maxDrawdown * 10000) / 10000,
      avgCLV: Math.round(avgCLV * 100) / 100,
      avgExecutionQuality: Math.round(avgExecutionQuality * 10000) / 10000,
      riskEvents: simOutput.riskEvents,
      correlationEvents: simOutput.correlationEvents,
      bankrollCurve: simOutput.steps,
      simulatedExecutions,
      ...(simOutput.haltedAt !== undefined ? { haltedAt: simOutput.haltedAt } : {}),
      ...(simOutput.haltReason !== undefined ? { haltReason: simOutput.haltReason } : {}),
    };
  }
}

// ─────────────────────────────────────────────────────────────
// PREDEFINED STRATEGIES
// ─────────────────────────────────────────────────────────────

/**
 * Built-in named strategy configurations for convenience.
 * All configurations are safe for simulation — no production side effects.
 */
export const PREDEFINED_STRATEGIES: Record<string, StrategyConfig> = {
  'flat-unit': {
    strategyId: 'flat-unit',
    description: 'Flat 1% unit staking, no execution friction, loose risk limits',
    stakingMethod: 'flat',
    initialBankroll: 10000,
    unitSize: 0.01, // 1% of bankroll per bet
    kellyFraction: 0.25, // not used for flat
    maxStakeCap: 0.05, // max 5% per bet
    maxDrawdown: 0.5, // halt at 50% drawdown
    maxDailyExposure: 0.3,
    maxCorrExposure: 0.4,
    pickFilters: { requirePosted: true },
  },

  'flat-unit-friction': {
    strategyId: 'flat-unit-friction',
    description: 'Flat 1% unit staking with realistic execution friction',
    stakingMethod: 'flat',
    initialBankroll: 10000,
    unitSize: 0.01,
    kellyFraction: 0.25,
    maxStakeCap: 0.05,
    maxDrawdown: 0.5,
    maxDailyExposure: 0.3,
    maxCorrExposure: 0.4,
    pickFilters: { requirePosted: true },
    executionSimConfig: {
      lineMovementModel: 'stochastic',
      latencyModel: 'constant',
      slippageModel: 'proportional',
      liquidityModel: 'unlimited',
      rejectionModel: 'probabilistic',
      constantLatencyMs: 250,
      slippageBps: 5,
      lineMovementBps: 10,
      rejectionRate: 0.05,
      randomSeed: 42,
    },
  },

  'kelly-025': {
    strategyId: 'kelly-025',
    description: '25% fractional Kelly with 10% stake cap and 15% sport correlation limit',
    stakingMethod: 'fractional_kelly',
    initialBankroll: 10000,
    unitSize: 0.01, // fallback for flat
    kellyFraction: 0.25,
    maxStakeCap: 0.1, // cap at 10% of bankroll
    maxDrawdown: 0.4, // halt at 40% drawdown (tighter)
    maxDailyExposure: 0.3,
    maxCorrExposure: 0.15, // tighter: 15% per sport
    maxExposurePerSport: 0.15,
    pickFilters: { requirePosted: true, minTier: 'A' },
  },

  'kelly-010': {
    strategyId: 'kelly-010',
    description: '10% fractional Kelly — conservative Kelly with loose limits',
    stakingMethod: 'fractional_kelly',
    initialBankroll: 10000,
    unitSize: 0.01,
    kellyFraction: 0.1,
    maxStakeCap: 0.05,
    maxDrawdown: 0.5,
    maxDailyExposure: 0.3,
    maxCorrExposure: 0.4,
    pickFilters: { requirePosted: true },
  },
};

/**
 * Resolve a strategy config by ID or return undefined.
 */
export function resolveStrategy(strategyId: string): StrategyConfig | undefined {
  return PREDEFINED_STRATEGIES[strategyId];
}

/**
 * Normalize picks for display/debugging (exported helper).
 */
export function normalizePicks(
  finalPickState: ReadonlyArray<Record<string, unknown>>,
): NormalizedPick[] {
  return finalPickState.map((raw) => normalizePick(raw));
}
