import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { StrategyProofWriter } from './strategy-proof-writer.js';

import type { StrategyEvaluationResult } from './types.js';

function evaluationResult(): StrategyEvaluationResult {
  return {
    strategyId: 'flat-nba-test',
    strategyConfig: {
      strategyId: 'flat-nba-test',
      description: 'Flat staking NBA test strategy',
      stakingMethod: 'flat',
      initialBankroll: 1000,
      unitSize: 0.01,
      kellyFraction: 0,
      maxStakeCap: 0.05,
      maxDrawdown: 0.2,
      maxDailyExposure: 0.1,
      maxCorrExposure: 0.15,
      pickFilters: { sports: ['NBA'], requirePosted: true },
    },
    runAt: '2026-01-01T00:00:00.000Z',
    totalPicksConsidered: 1,
    betsPlaced: 1,
    betsSkipped: 0,
    betsRejected: 0,
    hitRate: 1,
    roi: 0.91,
    bankrollGrowth: 0.0091,
    finalBankroll: 1009.1,
    initialBankroll: 1000,
    peakBankroll: 1009.1,
    maxDrawdown: 0,
    avgCLV: 12.5,
    avgExecutionQuality: 0.98,
    riskEvents: [],
    correlationEvents: [],
    bankrollCurve: [
      {
        pickId: 'pick-1',
        timestamp: '2026-01-01T00:00:00.000Z',
        sport: 'NBA',
        intendedOdds: -110,
        executedOdds: -110,
        stake: 10,
        settlementResult: 'win',
        pnl: 9.1,
        bankrollBefore: 1000,
        bankrollAfter: 1009.1,
        peakBankroll: 1009.1,
        drawdownFromPeak: 0,
        cumulativeROI: 0.91,
        totalStaked: 10,
        totalPnl: 9.1,
      },
    ],
    simulatedExecutions: [],
  };
}

test('writes a strategy proof bundle with expected artifact schema keys', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'strategy-proof-writer-'));

  try {
    const bundleDir = new StrategyProofWriter(repoRoot).writeEvaluation(evaluationResult());
    const report = JSON.parse(readFileSync(join(bundleDir, 'strategy-report.json'), 'utf8')) as {
      strategyId?: unknown;
      runAt?: unknown;
      summary?: Record<string, unknown>;
    };
    const bankrollCurve = JSON.parse(readFileSync(join(bundleDir, 'bankroll-curve.json'), 'utf8')) as {
      initialBankroll?: unknown;
      finalBankroll?: unknown;
      peakBankroll?: unknown;
      steps?: unknown;
    };
    const checksum = readFileSync(join(bundleDir, 'proof-bundle-checksum.txt'), 'utf8');

    assert.equal(report.strategyId, 'flat-nba-test');
    assert.equal(report.runAt, '2026-01-01T00:00:00.000Z');
    assert.deepEqual(Object.keys(report.summary ?? {}).sort(), [
      'avgCLV',
      'avgExecutionQuality',
      'bankrollGrowth',
      'bankrollGrowthPct',
      'betsPlaced',
      'betsRejected',
      'betsSkipped',
      'correlationEventCount',
      'finalBankroll',
      'haltReason',
      'haltedAt',
      'hitRate',
      'hitRatePct',
      'initialBankroll',
      'maxDrawdown',
      'maxDrawdownPct',
      'peakBankroll',
      'riskEventCount',
      'roi',
      'roiPct',
      'totalPicksConsidered',
    ]);
    assert.deepEqual(Object.keys(bankrollCurve).sort(), [
      'finalBankroll',
      'initialBankroll',
      'peakBankroll',
      'steps',
    ]);
    assert.match(checksum, /^Strategy: flat-nba-test\nSHA-256: [a-f0-9]{64}\nComputed: /);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
