import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { expandEventsForVolume, runSlateReplayHarness } from './slate-replay.js';
import type { ReplayEvent } from './event-store.js';
import { ReplayProofWriter } from './replay-proof-writer.js';

const REPO_ROOT = process.cwd();
const FIXTURE_PATH = join(
  REPO_ROOT,
  'packages',
  'verification',
  'test-fixtures',
  'v2-lifecycle-events.jsonl'
);

test('expandEventsForVolume namespaces pick and event identities for 2x mode', () => {
  const events: ReplayEvent[] = [
    {
      eventId: 'evt-1',
      eventType: 'PICK_SUBMITTED',
      pickId: 'pick-1',
      timestamp: '2026-03-20T19:00:00.000Z',
      sequenceNumber: 1,
      producedAt: '2026-03-20T19:00:00.000Z',
      payload: {
        pick: {
          id: 'pick-1',
          status: 'validated',
        },
      },
    },
  ];

  const expanded = expandEventsForVolume(events, '2x');

  assert.equal(expanded.length, 2);
  assert.equal(expanded[0]?.eventId, 'evt-1::copy-1');
  assert.equal(expanded[1]?.eventId, 'evt-1::copy-2');
  assert.equal(expanded[0]?.pickId, 'pick-1::copy-1');
  assert.equal(expanded[1]?.pickId, 'pick-1::copy-2');
  assert.equal((expanded[1]?.payload['pick'] as { id: string }).id, 'pick-1::copy-2');
});

test('ReplayProofWriter writes supplemental artifacts into the proof bundle', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'verification-proof-writer-'));
  const writer = new ReplayProofWriter(repoRoot);
  const result = {
    runId: 'proof-writer-run',
    mode: 'replay' as const,
    startedAt: '2026-04-29T00:00:00.000Z',
    completedAt: '2026-04-29T00:00:01.000Z',
    durationMs: 1000,
    eventsProcessed: 1,
    eventsSkipped: 0,
    picksCreated: 1,
    lifecycleTrace: [],
    finalPickState: [],
    determinismHash: 'hash-1',
    errors: [],
    runManifest: {
      runId: 'proof-writer-run',
      mode: 'replay' as const,
      clockMode: 'virtual' as const,
      adapters: {
        publish: 'RecordingPublishAdapter',
        notification: 'NullNotificationAdapter',
        feed: 'ReplayFeedAdapter',
        settlement: 'ReplaySettlementAdapter',
        recap: 'NullRecapAdapter',
      },
      initialisedAt: '2026-04-29T00:00:00.000Z',
    },
    clockLog: [],
  };

  const bundleDir = writer.write(result, [], 'hash-1', [
    {
      filename: 'metrics.json',
      format: 'json',
      content: { mode: '1x' },
    },
  ]);

  assert.ok(existsSync(join(bundleDir, 'metrics.json')));
  assert.match(readFileSync(join(bundleDir, 'metrics.json'), 'utf8'), /"mode": "1x"/);
});

test('runSlateReplayHarness produces machine-readable bundle and run history entry', async () => {
  const outRoot = mkdtempSync(join(tmpdir(), 'verification-slate-replay-'));
  const result = await runSlateReplayHarness({
    repoRoot: outRoot,
    runId: 'utv2-796-test-run',
    scenarioId: 'slate-replay',
    fixturePath: FIXTURE_PATH,
    commitHash: 'test-commit',
    volumeMode: '2x',
    freshnessCapture: {
      hookId: 'freshness',
      status: 'captured',
      source: 'fixture',
      capturedAt: '2026-04-29T01:00:00.000Z',
      payload: { verdict: 'HEALTHY' },
    },
    dbMetricsCapture: {
      hookId: 'db-metrics',
      status: 'captured',
      source: 'fixture',
      capturedAt: '2026-04-29T01:00:01.000Z',
      payload: { workerVerdict: 'HEALTHY' },
    },
  });

  assert.equal(result.summary.volumeMode, '2x');
  assert.equal(result.summary.expandedEventCount, 8);
  assert.equal(result.summary.determinismVerified, true);
  assert.ok(existsSync(join(result.bundleDir, 'metrics.json')));
  assert.ok(existsSync(join(result.bundleDir, 'freshness.json')));
  assert.ok(existsSync(join(result.bundleDir, 'db-metrics.json')));

  const runIndex = JSON.parse(
    readFileSync(join(outRoot, 'verification', 'run-index.json'), 'utf8')
  ) as { total: number; byScenario: Record<string, { total: number }> };
  assert.equal(runIndex.total, 1);
  assert.equal(runIndex.byScenario['slate-replay']?.total, 1);
});
