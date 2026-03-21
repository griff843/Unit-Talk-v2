import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { RunStore } from './run-store.js';
import type { UnifiedRunRecord } from './types.js';

function createRecord(overrides: Partial<UnifiedRunRecord> = {}): UnifiedRunRecord {
  return {
    runId: 'run-001',
    scenarioId: 'full-lifecycle',
    mode: 'replay',
    commitHash: 'abc123',
    startedAt: '2026-03-21T12:00:00.000Z',
    completedAt: '2026-03-21T12:00:10.000Z',
    durationMs: 10_000,
    verdict: 'PASS',
    stageResults: [{ stage: 'validated', observed: true, count: 1 }],
    artifactPath: 'out/proof.txt',
    metadata: {},
    ...overrides
  };
}

test('appendRun writes JSONL and updates the index', () => {
  const root = mkdtempSync(join(tmpdir(), 'verification-run-store-'));
  const store = new RunStore(root);
  const record = createRecord();

  store.appendRun(record);

  const runs = readFileSync(join(store.outputDir, 'runs.jsonl'), 'utf8');
  const index = store.getIndex();
  assert.match(runs, /"runId":"run-001"/);
  assert.equal(index.total, 1);
  assert.deepEqual(index.recentRunIds, ['run-001']);
});

test('getRecentRuns returns newest-first limited results', () => {
  const root = mkdtempSync(join(tmpdir(), 'verification-run-store-'));
  const store = new RunStore(root);

  store.appendRun(createRecord({ runId: 'run-001', completedAt: '2026-03-21T12:00:01.000Z' }));
  store.appendRun(createRecord({ runId: 'run-002', completedAt: '2026-03-21T12:00:03.000Z' }));
  store.appendRun(createRecord({ runId: 'run-003', completedAt: '2026-03-21T12:00:02.000Z' }));

  assert.deepEqual(
    store.getRecentRuns(2).map(record => record.runId),
    ['run-002', 'run-003']
  );
});

test('getFailedRuns returns only FAIL and ERROR verdicts', () => {
  const root = mkdtempSync(join(tmpdir(), 'verification-run-store-'));
  const store = new RunStore(root);

  store.appendRun(createRecord({ runId: 'pass-1', verdict: 'PASS', completedAt: '2026-03-21T12:00:01.000Z' }));
  store.appendRun(createRecord({ runId: 'fail-1', verdict: 'FAIL', completedAt: '2026-03-21T12:00:02.000Z' }));
  store.appendRun(createRecord({ runId: 'error-1', verdict: 'ERROR', completedAt: '2026-03-21T12:00:03.000Z' }));

  assert.deepEqual(
    store.getFailedRuns().map(record => record.runId),
    ['error-1', 'fail-1']
  );
});

test('RunIndex.byScenario tallies pass fail counts correctly', () => {
  const root = mkdtempSync(join(tmpdir(), 'verification-run-store-'));
  const store = new RunStore(root);

  store.appendRun(createRecord({ runId: 'pass-1', verdict: 'PASS', scenarioId: 'promotion-routing' }));
  store.appendRun(createRecord({ runId: 'fail-1', verdict: 'FAIL', scenarioId: 'promotion-routing' }));
  store.appendRun(createRecord({ runId: 'error-1', verdict: 'ERROR', scenarioId: 'promotion-routing' }));

  assert.deepEqual(store.getIndex().byScenario['promotion-routing'], {
    total: 3,
    passed: 1,
    failed: 1,
    errorCount: 1
  });
});
