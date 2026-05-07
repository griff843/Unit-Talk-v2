import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runSourceLedgerReport } from './run-source-ledger-report.js';

function schemaTable(columns: string[]) {
  return {
    exists: true,
    columns: Object.fromEntries(columns.map((column) => [column, true])),
    error: null,
  };
}

function fixtureData(nowIso: string) {
  const createdAt = new Date(new Date(nowIso).getTime() - 60_000).toISOString();
  return {
    picks: [
      {
        id: 'pick-scanner',
        created_at: createdAt,
        source: 'system-pick-scanner',
        sport_id: 'NBA',
        market: 'player_points',
        market_key: 'player_points',
        market_type_id: 'points',
        metadata: {},
        submission_id: null,
      },
      {
        id: 'pick-board',
        created_at: createdAt,
        source: 'board-construction',
        sport_id: 'NBA',
        market: 'player_rebounds',
        market_key: 'player_rebounds',
        market_type_id: 'rebounds',
        metadata: {},
        submission_id: null,
      },
      {
        id: 'pick-manual',
        created_at: createdAt,
        source: 'smart-form',
        sport_id: 'MLB',
        market: 'moneyline',
        market_key: 'moneyline',
        market_type_id: 'moneyline',
        metadata: {},
        submission_id: 'submission-1',
      },
      {
        id: 'pick-unknown',
        created_at: createdAt,
        source: null,
        sport_id: 'NFL',
        market: 'unknown-market',
        market_key: 'unknown-market',
        market_type_id: 'unknown-market',
        metadata: {},
        submission_id: null,
      },
    ],
    candidates: [
      {
        id: 'candidate-scanner',
        pick_id: 'pick-scanner',
        scan_run_id: 'scan-1',
        universe_id: 'universe-points',
        provenance: {},
        shadow_mode: false,
        is_board_candidate: false,
        model_score: 70,
        model_tier: 'A',
        model_confidence: 0.7,
        sport_key: 'NBA',
        market_key: 'player_points',
      },
      {
        id: 'candidate-board',
        pick_id: 'pick-board',
        scan_run_id: 'scan-2',
        universe_id: 'universe-rebounds',
        provenance: {},
        shadow_mode: false,
        is_board_candidate: true,
        model_score: 71,
        model_tier: 'A',
        model_confidence: 0.71,
        sport_key: 'NBA',
        market_key: 'player_rebounds',
      },
    ],
    marketUniverse: [
      {
        id: 'universe-points',
        canonical_market_key: 'player_points',
        provider_market_key: 'player_points',
        market_type_id: 'points',
        sport_key: 'NBA',
      },
      {
        id: 'universe-rebounds',
        canonical_market_key: 'player_rebounds',
        provider_market_key: 'player_rebounds',
        market_type_id: 'rebounds',
        sport_key: 'NBA',
      },
      {
        id: 'universe-moneyline',
        canonical_market_key: 'moneyline',
        provider_market_key: 'moneyline',
        market_type_id: 'moneyline',
        sport_key: 'MLB',
      },
    ],
    modelRegistry: [
      {
        id: 'model-1',
      },
    ],
    distinctSources: [
      { source: 'system-pick-scanner', count: 1 },
      { source: 'board-construction', count: 1 },
      { source: 'smart-form', count: 1 },
      { source: null, count: 1 },
    ],
    schema: {
      picks: schemaTable([
        'id',
        'created_at',
        'source',
        'sport_id',
        'market',
        'market_key',
        'market_type_id',
        'metadata',
        'submission_id',
      ]),
      pick_candidates: schemaTable([
        'id',
        'pick_id',
        'scan_run_id',
        'universe_id',
        'provenance',
        'shadow_mode',
        'is_board_candidate',
        'model_score',
        'model_tier',
        'model_confidence',
        'sport_key',
        'market_key',
      ]),
      market_universe: schemaTable([
        'id',
        'canonical_market_key',
        'provider_market_key',
        'market_type_id',
        'sport_key',
      ]),
      model_registry: schemaTable(['id']),
      sourceHasCheckConstraint: false,
      candidateModelColumns: ['model_score', 'model_tier', 'model_confidence'],
    },
  };
}

test('source ledger report writes required artifacts and preserves no-fabrication semantics', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-849-'));
  const now = new Date('2026-05-07T12:00:00.000Z');

  const summary = await runSourceLedgerReport({
    days: 30,
    now,
    outDir,
    data: fixtureData(now.toISOString()),
  });

  const requiredFiles = [
    'source-ledger-summary.json',
    'source-ledger-by-type.csv',
    'source-ledger-contamination.csv',
    'source-ledger-exclusions.csv',
    'source-ledger-by-sport.csv',
    'source-ledger-by-market-family.csv',
    'README.md',
    'evidence.json',
  ];

  for (const file of requiredFiles) {
    assert.equal(fs.existsSync(path.join(outDir, file)), true, `${file} should exist`);
  }

  const summaryFromDisk = JSON.parse(
    fs.readFileSync(path.join(outDir, 'source-ledger-summary.json'), 'utf8'),
  ) as Record<string, unknown>;
  assert.equal(summary['schema_version'], 1);
  assert.equal(summaryFromDisk['schema_version'], 1);
  assert.ok(summaryFromDisk['evaluation_window']);
  assert.ok(summaryFromDisk['row_counts']);
  assert.ok(summaryFromDisk['source_class_counts']);
  assert.ok(summaryFromDisk['source_metrics']);
  assert.ok(summaryFromDisk['contamination_summary']);
  assert.ok(summaryFromDisk['exclusion_counts']);
  assert.ok(summaryFromDisk['schema_findings']);
  assert.equal((summaryFromDisk['reporting_findings'] as Record<string, unknown>)['any_model_generated_today'], false);

  assert.equal(
    fs.readFileSync(path.join(outDir, 'source-ledger-contamination.csv'), 'utf8').split(/\r?\n/)[0],
    'sample_type,intended_source_class,contaminating_source_class,contamination_count,contamination_pct,severity',
  );
  assert.equal(
    fs.readFileSync(path.join(outDir, 'source-ledger-exclusions.csv'), 'utf8').split(/\r?\n/)[0],
    'pick_id,raw_source_value,assigned_source_class,exclusion_reason,excluded_from,sport,market_key,created_at',
  );

  const byType = fs.readFileSync(path.join(outDir, 'source-ledger-by-type.csv'), 'utf8');
  assert.match(byType, /heuristic,system-pick-scanner/);
  assert.match(byType, /heuristic,board-construction/);
  assert.doesNotMatch(byType, /model_generated,system-pick-scanner/);
  assert.doesNotMatch(byType, /model_generated,board-construction/);

  for (const file of requiredFiles) {
    const text = fs.readFileSync(path.join(outDir, file), 'utf8').toLowerCase();
    assert.equal(
      text.includes('model has edge: true') || text.includes('model_has_edge'),
      false,
      `${file} must not claim model edge`,
    );
  }
});
