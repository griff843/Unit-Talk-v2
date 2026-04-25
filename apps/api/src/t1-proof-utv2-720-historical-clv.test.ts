import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

test('UTV2-720 historical SGO CLV proof has sufficient live open/close and scoring samples', async () => {
  const scriptPath = path.join(
    process.cwd(),
    'scripts',
    'proof',
    'utv2-720-historical-sgo-clv-validation.ts',
  );
  const { stdout } = await execFileAsync(
    process.execPath,
    ['--import', 'tsx', scriptPath, '--json'],
    { cwd: process.cwd(), maxBuffer: 1024 * 1024 },
  );

  const report = JSON.parse(stdout) as {
    verdict: string;
    marketCoverage: Array<{
      sport: string;
      withOpenAndClose: number;
      openCloseCoveragePct: number;
    }>;
    settlements: {
      computedClv: number;
      scoredOutcomeSample: number;
    };
    candidateReplay: {
      total: number;
      shadowModePct: number;
    };
    futureLeakage: {
      sampledRows: number;
      violations: number;
    };
    weightEffectiveness: {
      sampleSize: number;
      confidence: string;
    };
  };

  assert.equal(report.verdict, 'pass');
  assert.deepEqual(
    report.marketCoverage.map((row) => row.sport).sort(),
    ['MLB', 'NBA', 'NHL'],
  );
  for (const row of report.marketCoverage) {
    assert.ok(row.withOpenAndClose >= 1_000, `${row.sport} should have open+close rows`);
    assert.ok(row.openCloseCoveragePct >= 70, `${row.sport} open+close coverage should be >=70%`);
  }
  assert.ok(report.settlements.computedClv >= 20);
  assert.ok(report.settlements.scoredOutcomeSample >= 20);
  assert.ok(report.candidateReplay.total >= 1_000);
  assert.ok(report.candidateReplay.shadowModePct >= 99);
  assert.ok(report.futureLeakage.sampledRows > 0);
  assert.equal(report.futureLeakage.violations, 0);
  assert.ok(report.weightEffectiveness.sampleSize >= 20);
  assert.notEqual(report.weightEffectiveness.confidence, 'insufficient');
});
