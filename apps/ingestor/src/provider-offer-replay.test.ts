import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createInMemoryIngestorRepositoryBundle } from '@unit-talk/db';

import {
  captureProviderOfferReplayPack,
  loadProviderOfferReplayPack,
  runProviderOfferReplay,
} from './provider-offer-replay.js';

test('provider offer replay capture writes a real pack and replay reproduces zero-offer failure taxonomy', async () => {
  const captureRepositories = createInMemoryIngestorRepositoryBundle();
  const replayRepositories = createInMemoryIngestorRepositoryBundle();
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'provider-offer-replay-'));

  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-ratelimit-limit': '100',
        'x-ratelimit-remaining': '99',
      },
    });

  const capture = await captureProviderOfferReplayPack(captureRepositories, {
    rootDir,
    providerKey: 'sgo',
    league: 'NBA',
    apiKey: 'test-key',
    snapshotAt: '2026-04-29T12:00:00.000Z',
    freshnessMaxAgeMs: 30 * 60 * 1000,
    fetchImpl,
    logger: console,
  });

  const manifest = await loadProviderOfferReplayPack(capture.packDir);
  assert.equal(manifest.providerKey, 'sgo');
  assert.equal(manifest.league, 'NBA');
  assert.equal(manifest.requests.length, 2);
  assert.equal(manifest.ingestConfig.skipResults, false);
  for (const request of manifest.requests) {
    assert.ok(
      fs.existsSync(path.join(capture.packDir, request.payloadPath)),
      `expected payload file for ${request.requestId}`,
    );
  }
  assert.equal(manifest.cycleStatus?.failure_category, 'zero_offers');

  const replay = await runProviderOfferReplay(replayRepositories, {
    packDir: capture.packDir,
    mode: '1x',
    apiKey: 'different-test-key',
    league: 'NBA',
    sleep: async () => undefined,
    logger: console,
  });

  assert.ok(fs.existsSync(replay.reportPath));
  assert.equal(replay.manifest.requests.length, 2);
  assert.equal(replay.requestMetrics.length, 2);
  assert.equal(replay.replayCycleStatus?.failure_category, 'zero_offers');

  const report = JSON.parse(
    fs.readFileSync(replay.reportPath, 'utf8'),
  ) as {
    failureTaxonomy: {
      source: { category: string | null };
      replay: { category: string | null };
    };
    notes: string[];
  };
  assert.equal(report.failureTaxonomy.source.category, 'zero_offers');
  assert.equal(report.failureTaxonomy.replay.category, 'zero_offers');
  assert.ok(
    report.notes.some((note) => note.includes('No fake payload duplication')),
  );
});

test('provider offer replay 2x compresses request timing instead of duplicating payloads', async () => {
  const captureRepositories = createInMemoryIngestorRepositoryBundle();
  const replayRepositories = createInMemoryIngestorRepositoryBundle();
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'provider-offer-replay-2x-'));

  let requestCount = 0;
  const fetchImpl: typeof fetch = async () => {
    requestCount += 1;
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const capture = await captureProviderOfferReplayPack(captureRepositories, {
    rootDir,
    providerKey: 'sgo',
    league: 'NBA',
    apiKey: 'test-key',
    snapshotAt: '2026-04-29T12:00:00.000Z',
    freshnessMaxAgeMs: 30 * 60 * 1000,
    fetchImpl,
    skipResults: true,
  });

  const replay = await runProviderOfferReplay(replayRepositories, {
    packDir: capture.packDir,
    mode: '2x',
    apiKey: 'test-key',
    league: 'NBA',
    sleep: async () => undefined,
  });

  assert.equal(replay.manifest.requests.length, requestCount);
  assert.equal(replay.requestMetrics.length, requestCount);
  assert.equal(replay.manifest.ingestConfig.skipResults, true);
  assert.ok(
    replay.requestMetrics.every(
      (metric) =>
        metric.scheduledDurationMs <=
        replay.manifest.requests.find(
          (request) => request.requestId === metric.requestId,
        )!.durationMs,
    ),
  );
});
