import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runEvidenceTruthworthiness } from './run-scoring.js';

function fixtureData(nowIso: string) {
  const createdAt = new Date(new Date(nowIso).getTime() - 60_000).toISOString();
  return {
    picks: [
      {
        id: 'pick-1',
        created_at: createdAt,
        status: 'settled',
        source: 'board-construction',
        sport_id: 'NBA',
        market: 'player_points',
        market_type_id: 'market-type-1',
        metadata: { model_id: 'model-1' },
        stake_units: 1,
        submission_id: null,
        posted_at: createdAt,
        settled_at: createdAt,
      },
    ],
    settlements: [
      {
        id: 'settlement-1',
        pick_id: 'pick-1',
        status: 'settled',
        result: 'win',
        corrects_id: null,
        settled_at: createdAt,
      },
    ],
    outbox: [
      {
        id: 'outbox-1',
        pick_id: 'pick-1',
        status: 'sent',
        created_at: new Date(new Date(createdAt).getTime() + 10_000).toISOString(),
      },
    ],
    receipts: [
      {
        outbox_id: 'outbox-1',
        status: 'sent',
        recorded_at: new Date(new Date(createdAt).getTime() + 20_000).toISOString(),
      },
    ],
    candidates: [
      {
        pick_id: 'pick-1',
        scan_run_id: 'scan-1',
        provenance: {},
        updated_at: createdAt,
      },
    ],
    governed: [
      {
        pick_id: 'pick-1',
        board_run_id: 'board-1',
        candidate_id: 'candidate-1',
        universe_id: 'universe-1',
        provider_market_key: 'player_points',
        sport_key: 'NBA',
        market: 'player_points',
        model_tier: null,
      },
    ],
    closingOffers: [
      {
        provider_market_key: 'player_points',
        sport_key: 'NBA',
        is_closing: true,
        snapshot_at: createdAt,
      },
    ],
    marketUniverse: [
      {
        id: 'universe-1',
        canonical_market_key: 'player_points',
        provider_market_key: 'player_points',
        market_type_id: 'market-type-1',
        sport_key: 'NBA',
      },
    ],
    modelIds: ['model-1'],
    systemRuns: [
      { run_type: 'worker.heartbeat', created_at: createdAt },
      { run_type: 'scheduler.board', created_at: createdAt },
    ],
    latestProviderSnapshotAt: createdAt,
    latestCandidateUpdatedAt: createdAt,
    latestBoardPickAt: createdAt,
    strandedQueueCount: 0,
    schemaNotes: ['fixture'],
  };
}

test('evidence truthworthiness scoring writes required artifacts with schema version 1', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-847-'));
  const now = new Date('2026-05-07T12:00:00.000Z');

  const summary = await runEvidenceTruthworthiness({
    days: 30,
    now,
    outDir,
    data: fixtureData(now.toISOString()),
  });

  const requiredFiles = [
    'truthworthiness-summary.json',
    'truthworthiness-by-dimension.csv',
    'truthworthiness-by-sport.csv',
    'truthworthiness-by-market-family.csv',
    'truthworthiness-by-source-type.csv',
    'truthworthiness-exclusions.csv',
    'README.md',
  ];
  for (const file of requiredFiles) {
    assert.equal(fs.existsSync(path.join(outDir, file)), true, `${file} should exist`);
  }

  const summaryFromDisk = JSON.parse(
    fs.readFileSync(path.join(outDir, 'truthworthiness-summary.json'), 'utf8'),
  ) as Record<string, unknown>;
  assert.equal(summary['schema_version'], 1);
  assert.equal(summaryFromDisk['schema_version'], 1);
  assert.ok(summaryFromDisk['evaluation_window']);
  assert.ok(summaryFromDisk['system_dimensions']);
  assert.ok(summaryFromDisk['row_counts']);
  assert.ok(summaryFromDisk['dimension_pass_rates']);
  assert.ok(summaryFromDisk['latency']);
  assert.ok(summaryFromDisk['exclusion_counts']);
  assert.deepEqual(Object.keys(summaryFromDisk['sample_verdicts'] as Record<string, unknown>).sort(), [
    'trusted_clv_sample',
    'trusted_model_edge_sample',
    'trusted_production_readiness_sample',
    'trusted_roi_sample',
    'trusted_syndicate_readiness_sample',
  ]);

  const exclusions = fs.readFileSync(path.join(outDir, 'truthworthiness-exclusions.csv'), 'utf8');
  assert.equal(
    exclusions.split(/\r?\n/)[0],
    'pick_id,exclusion_reason,dimension,dimension_value,sport,market_key,source_type,created_at',
  );

  for (const file of requiredFiles) {
    const text = fs.readFileSync(path.join(outDir, file), 'utf8').toLowerCase();
    assert.equal(text.includes('model has edge'), false, `${file} must not claim model edge`);
    assert.equal(text.includes('model is bad'), false, `${file} must not judge model quality`);
  }
});

