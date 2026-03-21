import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  americanToDecimal,
  decimalToAmerican,
  americanToImpliedProb,
  ExecutionSimulator,
} from './execution-simulator.js';
import { BankrollSimulator, normalizePick } from './bankroll-simulator.js';
import type { NormalizedPick } from './bankroll-simulator.js';
import {
  StrategyEvaluationEngine,
  PREDEFINED_STRATEGIES,
  resolveStrategy,
  normalizePicks,
} from './strategy-evaluation-engine.js';
import type { ReplayPickState } from './strategy-evaluation-engine.js';
import { StrategyComparator } from './strategy-comparator.js';
import type { StrategyConfig, SimulatedExecution, ExecutionSimConfig } from './types.js';

// ── Test Helpers ─────────────────────────────────────────────────────────────

function makePick(overrides: Partial<NormalizedPick> = {}): NormalizedPick {
  return {
    id: `pick-${Math.random().toString(36).slice(2, 8)}`,
    odds: -110,
    line: 7.5,
    placedAt: '2026-01-15T12:00:00Z',
    postedToDiscord: true,
    settlementResult: 'win',
    ...overrides,
  };
}

function makeConfig(overrides: Partial<StrategyConfig> = {}): StrategyConfig {
  return {
    strategyId: 'test-flat',
    stakingMethod: 'flat',
    initialBankroll: 10000,
    unitSize: 0.01,
    kellyFraction: 0.25,
    maxStakeCap: 0.05,
    maxDrawdown: 0.5,
    maxDailyExposure: 0.3,
    maxCorrExposure: 0.4,
    pickFilters: { requirePosted: true },
    ...overrides,
  };
}

// ============================================================================
// Execution Simulator — odds helpers
// ============================================================================

describe('execution-simulator odds helpers', () => {
  it('americanToDecimal converts positive odds', () => {
    assert.equal(americanToDecimal(150), 2.5);
    assert.equal(americanToDecimal(100), 2.0);
  });

  it('americanToDecimal converts negative odds', () => {
    assert.ok(Math.abs(americanToDecimal(-110) - 1.909) < 0.001);
    assert.equal(americanToDecimal(-200), 1.5);
  });

  it('decimalToAmerican converts back correctly', () => {
    assert.equal(decimalToAmerican(2.5), 150);
    assert.equal(decimalToAmerican(1.5), -200);
  });

  it('americanToImpliedProb computes correct probabilities', () => {
    assert.ok(Math.abs(americanToImpliedProb(-110) - 0.5238) < 0.001);
    assert.equal(americanToImpliedProb(100), 0.5);
    assert.ok(Math.abs(americanToImpliedProb(200) - 0.3333) < 0.001);
  });
});

// ============================================================================
// Execution Simulator — simulation
// ============================================================================

describe('ExecutionSimulator', () => {
  it('produces deterministic output with same seed', () => {
    const config: ExecutionSimConfig = {
      lineMovementModel: 'stochastic',
      latencyModel: 'distribution',
      slippageModel: 'proportional',
      liquidityModel: 'unlimited',
      rejectionModel: 'none',
      slippageBps: 5,
      lineMovementBps: 10,
      randomSeed: 42,
    };

    const sim1 = new ExecutionSimulator(config);
    const sim2 = new ExecutionSimulator(config);

    const r1 = sim1.simulate('pick-1', 7.5, -110, 100);
    const r2 = sim2.simulate('pick-1', 7.5, -110, 100);

    assert.deepStrictEqual(r1, r2);
  });

  it('static line movement preserves line', () => {
    const sim = new ExecutionSimulator({
      lineMovementModel: 'static',
      latencyModel: 'constant',
      slippageModel: 'none',
      liquidityModel: 'unlimited',
      rejectionModel: 'none',
      constantLatencyMs: 100,
    });

    const result = sim.simulate('pick-1', 7.5, -110, 100);
    assert.equal(result.executedLine, 7.5);
    assert.equal(result.slippageBps, 0);
    assert.equal(result.fillRate, 1.0);
    assert.equal(result.rejected, false);
  });

  it('proportional slippage applies negative bps', () => {
    const sim = new ExecutionSimulator({
      lineMovementModel: 'static',
      latencyModel: 'constant',
      slippageModel: 'proportional',
      liquidityModel: 'unlimited',
      rejectionModel: 'none',
      constantLatencyMs: 100,
      slippageBps: 10,
    });

    const result = sim.simulate('pick-1', 7.5, -110, 100);
    assert.equal(result.slippageBps, -10);
  });

  it('probabilistic rejection with seed produces consistent results', () => {
    const sim = new ExecutionSimulator({
      lineMovementModel: 'static',
      latencyModel: 'constant',
      slippageModel: 'none',
      liquidityModel: 'unlimited',
      rejectionModel: 'probabilistic',
      rejectionRate: 1.0, // 100% rejection rate
      randomSeed: 42,
    });

    const result = sim.simulate('pick-1', 7.5, -110, 100);
    assert.equal(result.rejected, true);
    assert.equal(result.executedStake, 0);
    assert.equal(result.executionQuality, 0);
  });

  it('rule-based rejection blocks oversized stakes', () => {
    const sim = new ExecutionSimulator({
      lineMovementModel: 'static',
      latencyModel: 'constant',
      slippageModel: 'none',
      liquidityModel: 'unlimited',
      rejectionModel: 'rule-based',
      rejectionMaxStake: 50,
    });

    const small = sim.simulate('pick-1', 7.5, -110, 40);
    assert.equal(small.rejected, false);

    const big = sim.simulate('pick-2', 7.5, -110, 100);
    assert.equal(big.rejected, true);
  });

  it('tiered liquidity reduces fill rate for large stakes', () => {
    const sim = new ExecutionSimulator({
      lineMovementModel: 'static',
      latencyModel: 'constant',
      slippageModel: 'none',
      liquidityModel: 'tiered',
      rejectionModel: 'none',
      liquidityTiers: [
        { maxStake: 100, fillRate: 1.0 },
        { maxStake: 500, fillRate: 0.8 },
        { maxStake: Infinity, fillRate: 0.5 },
      ],
    });

    const small = sim.simulate('pick-1', 7.5, -110, 50);
    assert.equal(small.fillRate, 1.0);

    const medium = sim.simulate('pick-2', 7.5, -110, 200);
    assert.equal(medium.fillRate, 0.8);

    const large = sim.simulate('pick-3', 7.5, -110, 1000);
    assert.equal(large.fillRate, 0.5);
  });

  it('execution quality is between 0 and 1', () => {
    const sim = new ExecutionSimulator({
      lineMovementModel: 'static',
      latencyModel: 'constant',
      slippageModel: 'proportional',
      liquidityModel: 'unlimited',
      rejectionModel: 'none',
      constantLatencyMs: 200,
      slippageBps: 5,
    });

    const result = sim.simulate('pick-1', 7.5, -110, 100);
    assert.ok(result.executionQuality >= 0);
    assert.ok(result.executionQuality <= 1);
  });
});

// ============================================================================
// Bankroll Simulator
// ============================================================================

describe('BankrollSimulator', () => {
  it('flat staking produces correct bankroll curve', () => {
    const config = makeConfig();
    const sim = new BankrollSimulator(config);

    const picks = [
      makePick({ id: 'p1', odds: 100, settlementResult: 'win' }),
      makePick({ id: 'p2', odds: -110, settlementResult: 'loss' }),
    ];

    const result = sim.simulate(picks, new Map());

    assert.equal(result.betsPlaced, 2);
    assert.equal(result.steps.length, 2);
    assert.ok(result.finalBankroll !== config.initialBankroll);
  });

  it('skips unposted picks by default', () => {
    const config = makeConfig();
    const sim = new BankrollSimulator(config);

    const picks = [
      makePick({ id: 'p1', postedToDiscord: false }),
      makePick({ id: 'p2', postedToDiscord: true }),
    ];

    const result = sim.simulate(picks, new Map());
    assert.equal(result.betsPlaced, 1);
    assert.equal(result.betsSkipped, 1);
  });

  it('skips unsettled picks', () => {
    const config = makeConfig();
    const sim = new BankrollSimulator(config);

    const picks: NormalizedPick[] = [{
      id: 'p1',
      odds: -110,
      line: 7.5,
      placedAt: '2026-01-15T12:00:00Z',
      postedToDiscord: true,
      // No settlementResult — simulates unsettled
    }];

    const result = sim.simulate(picks, new Map());
    assert.equal(result.betsSkipped, 1);
    assert.equal(result.betsPlaced, 0);
  });

  it('halts on max drawdown', () => {
    const config = makeConfig({ maxDrawdown: 0.01 }); // very tight
    const sim = new BankrollSimulator(config);

    // Lots of losses to trigger drawdown
    const picks = [
      makePick({ id: 'p1', odds: -110, settlementResult: 'loss' }),
      makePick({ id: 'p2', odds: -110, settlementResult: 'loss' }),
      makePick({ id: 'p3', odds: -110, settlementResult: 'loss' }),
    ];

    const result = sim.simulate(picks, new Map());
    assert.ok(result.haltedAt !== undefined || result.betsSkipped > 0);
  });

  it('enforces daily exposure limit', () => {
    const config = makeConfig({ maxDailyExposure: 0.01 }); // very tight: 1% of $10000 = $100
    const sim = new BankrollSimulator(config);

    // All same day, each stake is $100 (1% of $10000)
    const picks = [
      makePick({ id: 'p1', placedAt: '2026-01-15T10:00:00Z', settlementResult: 'win' }),
      makePick({ id: 'p2', placedAt: '2026-01-15T11:00:00Z', settlementResult: 'win' }),
    ];

    const result = sim.simulate(picks, new Map());
    // First bet should go through, second should be blocked
    assert.equal(result.betsPlaced, 1);
    assert.equal(result.betsSkipped, 1);
  });

  it('handles push outcome with zero PnL', () => {
    const config = makeConfig();
    const sim = new BankrollSimulator(config);

    const picks = [makePick({ id: 'p1', settlementResult: 'push' })];
    const result = sim.simulate(picks, new Map());

    assert.equal(result.betsPlaced, 1);
    assert.equal(result.totalPnl, 0);
    assert.equal(result.finalBankroll, config.initialBankroll);
  });

  it('tracks cumulative ROI correctly', () => {
    const config = makeConfig();
    const sim = new BankrollSimulator(config);

    const picks = [
      makePick({ id: 'p1', odds: 100, settlementResult: 'win' }),
      makePick({ id: 'p2', odds: 100, settlementResult: 'win' }),
    ];

    const result = sim.simulate(picks, new Map());
    assert.ok(result.totalPnl > 0);
    assert.ok(result.steps[1]!.cumulativeROI > 0);
  });

  it('applies execution simulation when provided', () => {
    const config = makeConfig();
    const sim = new BankrollSimulator(config);

    const pick = makePick({ id: 'p1', odds: -110, settlementResult: 'win' });
    const exec: SimulatedExecution = {
      pickId: 'p1',
      intendedLine: 7.5,
      intendedOdds: -110,
      intendedStake: 100,
      executedLine: 7.5,
      executedOdds: -115, // worse odds
      executedStake: 95,
      latencyMs: 200,
      slippageBps: -5,
      fillRate: 0.95,
      rejected: false,
      impliedCLV: -2,
      executionQuality: 0.85,
    };

    const execMap = new Map<string, SimulatedExecution>([['p1', exec]]);
    const result = sim.simulate([pick], execMap);

    assert.equal(result.betsPlaced, 1);
    // Should use executed odds, not intended
    assert.equal(result.steps[0]!.executedOdds, -115);
  });
});

// ============================================================================
// normalizePick
// ============================================================================

describe('normalizePick', () => {
  it('extracts fields from raw record', () => {
    const raw = {
      id: 'pick-123',
      sport: 'NBA',
      player_name: 'LeBron James',
      odds: -110,
      line: 25.5,
      placed_at: '2026-01-15T12:00:00Z',
      settlement_result: 'win',
      settlement_status: 'settled',
      posted_to_discord: true,
      meta: { tier: 'A', confidence: 0.72 },
    };

    const pick = normalizePick(raw);

    assert.equal(pick.id, 'pick-123');
    assert.equal(pick.sport, 'NBA');
    assert.equal(pick.playerName, 'LeBron James');
    assert.equal(pick.odds, -110);
    assert.equal(pick.line, 25.5);
    assert.equal(pick.placedAt, '2026-01-15T12:00:00Z');
    assert.equal(pick.settlementResult, 'win');
    assert.equal(pick.postedToDiscord, true);
    assert.equal(pick.tier, 'A');
    assert.equal(pick.confidence, 0.72);
  });

  it('applies defaults for missing fields', () => {
    const raw = { id: 'pick-minimal' };
    const pick = normalizePick(raw);

    assert.equal(pick.id, 'pick-minimal');
    assert.equal(pick.odds, -110);
    assert.equal(pick.line, 0);
    assert.equal(pick.postedToDiscord, false);
    assert.equal(pick.placedAt, new Date(0).toISOString());
  });
});

// ============================================================================
// StrategyEvaluationEngine
// ============================================================================

describe('StrategyEvaluationEngine', () => {
  it('evaluates flat strategy over replay picks', () => {
    const engine = new StrategyEvaluationEngine();
    const replayResult: ReplayPickState = {
      finalPickState: [
        {
          id: 'p1',
          odds: -110,
          line: 7.5,
          placed_at: '2026-01-15T10:00:00Z',
          settlement_result: 'win',
          posted_to_discord: true,
        },
        {
          id: 'p2',
          odds: -110,
          line: 8.5,
          placed_at: '2026-01-15T11:00:00Z',
          settlement_result: 'loss',
          posted_to_discord: true,
        },
      ],
    };

    const config = makeConfig();
    const result = engine.run(replayResult, config, '2026-01-15T00:00:00Z');

    assert.equal(result.strategyId, 'test-flat');
    assert.equal(result.totalPicksConsidered, 2);
    assert.equal(result.betsPlaced, 2);
    assert.equal(result.runAt, '2026-01-15T00:00:00Z');
    assert.ok(result.hitRate >= 0 && result.hitRate <= 1);
    assert.ok(result.bankrollCurve.length > 0);
  });

  it('is deterministic with same inputs', () => {
    const engine = new StrategyEvaluationEngine();
    const replayResult: ReplayPickState = {
      finalPickState: [
        {
          id: 'p1',
          odds: 100,
          line: 7.5,
          placed_at: '2026-01-15T10:00:00Z',
          settlement_result: 'win',
          posted_to_discord: true,
        },
      ],
    };

    const config = makeConfig();
    const ts = '2026-01-15T00:00:00Z';
    const r1 = engine.run(replayResult, config, ts);
    const r2 = engine.run(replayResult, config, ts);

    assert.equal(r1.roi, r2.roi);
    assert.equal(r1.finalBankroll, r2.finalBankroll);
    assert.equal(r1.hitRate, r2.hitRate);
  });

  it('applies execution friction when configured', () => {
    const engine = new StrategyEvaluationEngine();
    const replayResult: ReplayPickState = {
      finalPickState: [
        {
          id: 'p1',
          odds: -110,
          line: 7.5,
          placed_at: '2026-01-15T10:00:00Z',
          settlement_result: 'win',
          posted_to_discord: true,
        },
      ],
    };

    const config = makeConfig({
      executionSimConfig: {
        lineMovementModel: 'static',
        latencyModel: 'constant',
        slippageModel: 'proportional',
        liquidityModel: 'unlimited',
        rejectionModel: 'none',
        constantLatencyMs: 100,
        slippageBps: 5,
        randomSeed: 42,
      },
    });

    const result = engine.run(replayResult, config, '2026-01-15T00:00:00Z');
    assert.ok(result.simulatedExecutions.length > 0);
    assert.ok(result.avgExecutionQuality > 0);
    assert.ok(result.avgExecutionQuality <= 1);
  });
});

// ============================================================================
// Predefined strategies
// ============================================================================

describe('PREDEFINED_STRATEGIES', () => {
  it('has 4 predefined strategies', () => {
    assert.equal(Object.keys(PREDEFINED_STRATEGIES).length, 4);
  });

  it('flat-unit has correct defaults', () => {
    const strat = PREDEFINED_STRATEGIES['flat-unit']!;
    assert.equal(strat.stakingMethod, 'flat');
    assert.equal(strat.initialBankroll, 10000);
    assert.equal(strat.unitSize, 0.01);
  });

  it('kelly-025 uses fractional_kelly method', () => {
    const strat = PREDEFINED_STRATEGIES['kelly-025']!;
    assert.equal(strat.stakingMethod, 'fractional_kelly');
    assert.equal(strat.kellyFraction, 0.25);
  });

  it('resolveStrategy returns config by ID', () => {
    const config = resolveStrategy('flat-unit');
    assert.ok(config !== undefined);
    assert.equal(config.strategyId, 'flat-unit');
  });

  it('resolveStrategy returns undefined for unknown ID', () => {
    assert.equal(resolveStrategy('nonexistent'), undefined);
  });
});

// ============================================================================
// normalizePicks helper
// ============================================================================

describe('normalizePicks', () => {
  it('normalizes an array of raw picks', () => {
    const raw = [
      { id: 'p1', odds: -110, posted_to_discord: true },
      { id: 'p2', odds: 150, posted_to_discord: false },
    ];

    const picks = normalizePicks(raw);
    assert.equal(picks.length, 2);
    assert.equal(picks[0]!.id, 'p1');
    assert.equal(picks[1]!.odds, 150);
  });
});

// ============================================================================
// StrategyComparator
// ============================================================================

describe('StrategyComparator', () => {
  function makeEvalResult(
    overrides: Partial<import('./types.js').StrategyEvaluationResult> = {},
  ): import('./types.js').StrategyEvaluationResult {
    return {
      strategyId: 'test',
      strategyConfig: makeConfig(),
      runAt: '2026-01-15T00:00:00Z',
      totalPicksConsidered: 10,
      betsPlaced: 8,
      betsSkipped: 2,
      betsRejected: 0,
      hitRate: 0.625,
      roi: 0.05,
      bankrollGrowth: 0.04,
      finalBankroll: 10400,
      initialBankroll: 10000,
      peakBankroll: 10500,
      maxDrawdown: 0.02,
      avgCLV: 0,
      avgExecutionQuality: 1.0,
      riskEvents: [],
      correlationEvents: [],
      bankrollCurve: [],
      simulatedExecutions: [],
      ...overrides,
    };
  }

  it('computes delta as A minus B', () => {
    const comp = new StrategyComparator();
    const a = makeEvalResult({ strategyId: 'A', roi: 0.10 });
    const b = makeEvalResult({ strategyId: 'B', roi: 0.05 });

    const report = comp.compare(a, b, '2026-01-15T00:00:00Z');
    assert.ok(report.delta.roi > 0);
    assert.equal(report.winner.roi, 'A');
  });

  it('declares tie when within threshold', () => {
    const comp = new StrategyComparator();
    const a = makeEvalResult({ strategyId: 'A', roi: 0.05 });
    const b = makeEvalResult({ strategyId: 'B', roi: 0.0505 });

    const report = comp.compare(a, b, '2026-01-15T00:00:00Z');
    assert.equal(report.winner.roi, 'tie');
  });

  it('lower drawdown wins for maxDrawdown metric', () => {
    const comp = new StrategyComparator();
    const a = makeEvalResult({ strategyId: 'A', maxDrawdown: 0.05 });
    const b = makeEvalResult({ strategyId: 'B', maxDrawdown: 0.15 });

    const report = comp.compare(a, b, '2026-01-15T00:00:00Z');
    assert.equal(report.winner.maxDrawdown, 'A');
  });

  it('produces comparison summary string', () => {
    const comp = new StrategyComparator();
    const a = makeEvalResult({ strategyId: 'strat-A', roi: 0.10, finalBankroll: 11000 });
    const b = makeEvalResult({ strategyId: 'strat-B', roi: 0.03, finalBankroll: 10300 });

    const report = comp.compare(a, b, '2026-01-15T00:00:00Z');
    assert.ok(report.summary.includes('strat-A'));
    assert.ok(report.summary.includes('strat-B'));
    assert.ok(report.summary.includes('ROI'));
  });

  it('uses provided timestamp', () => {
    const comp = new StrategyComparator();
    const a = makeEvalResult({ strategyId: 'A' });
    const b = makeEvalResult({ strategyId: 'B' });

    const report = comp.compare(a, b, '2026-03-21T12:00:00Z');
    assert.equal(report.generatedAt, '2026-03-21T12:00:00Z');
  });

  it('comparisonId combines strategy IDs', () => {
    const comp = new StrategyComparator();
    const a = makeEvalResult({ strategyId: 'flat-unit' });
    const b = makeEvalResult({ strategyId: 'kelly-025' });

    const report = comp.compare(a, b, '2026-01-15T00:00:00Z');
    assert.equal(report.comparisonId, 'cmp-flat-unit-vs-kelly-025');
  });
});
