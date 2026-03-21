import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { QueryRunner } from './query.js';
import { RunStore } from './run-store.js';

test('QueryRunner.recent returns recent runs from the store', () => {
  const root = mkdtempSync(join(tmpdir(), 'verification-query-'));
  const store = new RunStore(root);
  store.appendRun({
    runId: 'run-001',
    scenarioId: 'submission-validation',
    mode: 'replay',
    commitHash: 'abc123',
    startedAt: '2026-03-21T12:00:00.000Z',
    completedAt: '2026-03-21T12:00:01.000Z',
    durationMs: 1_000,
    verdict: 'PASS',
    stageResults: [],
    artifactPath: 'artifact-1',
    metadata: {}
  });

  const query = new QueryRunner(store);
  assert.equal(query.recent(1)[0]?.runId, 'run-001');
});

test('QueryRunner.summary returns pass-rate rows by scenario', () => {
  const root = mkdtempSync(join(tmpdir(), 'verification-query-'));
  const store = new RunStore(root);
  store.appendRun({
    runId: 'run-001',
    scenarioId: 'full-lifecycle',
    mode: 'hybrid',
    commitHash: 'abc123',
    startedAt: '2026-03-21T12:00:00.000Z',
    completedAt: '2026-03-21T12:00:01.000Z',
    durationMs: 1_000,
    verdict: 'PASS',
    stageResults: [],
    artifactPath: 'artifact-1',
    metadata: {}
  });
  store.appendRun({
    runId: 'run-002',
    scenarioId: 'full-lifecycle',
    mode: 'hybrid',
    commitHash: 'abc123',
    startedAt: '2026-03-21T12:00:02.000Z',
    completedAt: '2026-03-21T12:00:03.000Z',
    durationMs: 1_000,
    verdict: 'FAIL',
    stageResults: [],
    artifactPath: 'artifact-2',
    metadata: {}
  });

  const summary = new QueryRunner(store).summary();
  assert.equal(summary.totalRuns, 2);
  assert.equal(summary.byScenario[0]?.scenarioId, 'full-lifecycle');
  assert.equal(summary.byScenario[0]?.passRate, 0.5);
});
