import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runProvenanceReport } from './run-provenance-report.js';

function schemaTable(columns: string[]): {
  exists: boolean;
  columns: Record<string, boolean>;
  error: null;
} {
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
        id: 'pick-1',
        created_at: createdAt,
        source: 'board-construction',
        sport_id: 'NBA',
        market: 'player_points',
        market_key: 'player_points',
        market_type_id: 'points',
        metadata: {},
        stake_units: 1,
        submission_id: null,
        posted_at: createdAt,
        settled_at: createdAt,
      },
      {
        id: 'pick-2',
        created_at: createdAt,
        source: null,
        sport_id: 'NBA',
        market: 'player_rebounds',
        market_key: 'player_rebounds',
        market_type_id: 'rebounds',
        metadata: {},
        stake_units: null,
        submission_id: null,
        posted_at: null,
        settled_at: null,
      },
    ],
    candidates: [
      {
        id: 'candidate-1',
        pick_id: 'pick-1',
        scan_run_id: 'scan-1',
        universe_id: 'universe-1',
        provenance: { model_id: 'model-1' },
        model_score: 71,
        model_tier: 'A',
        model_confidence: 0.71,
        shadow_mode: false,
        is_board_candidate: true,
        sport_key: 'NBA',
        market_key: 'player_points',
        created_at: createdAt,
      },
    ],
    allCandidates: [
      {
        id: 'candidate-1',
        pick_id: 'pick-1',
        scan_run_id: 'scan-1',
        universe_id: 'universe-1',
        provenance: { model_id: 'model-1' },
        model_score: 71,
        model_tier: 'A',
        model_confidence: 0.71,
        shadow_mode: false,
        is_board_candidate: true,
        sport_key: 'NBA',
        market_key: 'player_points',
        created_at: createdAt,
      },
      {
        id: 'candidate-2',
        pick_id: null,
        scan_run_id: 'scan-2',
        universe_id: null,
        provenance: {},
        model_score: null,
        model_tier: null,
        model_confidence: null,
        shadow_mode: false,
        is_board_candidate: false,
        sport_key: 'NBA',
        market_key: 'player_assists',
        created_at: createdAt,
      },
    ],
    marketUniverse: [
      {
        id: 'universe-1',
        canonical_market_key: 'player_points',
        provider_market_key: 'player_points',
        market_type_id: 'points',
        market_family_id: 'player-prop',
        sport_key: 'NBA',
      },
    ],
    modelRegistry: [
      {
        id: 'model-1',
        model_name: 'fixture-model',
        version: '1',
        sport: 'NBA',
        market_family: 'player-prop',
        status: 'champion',
      },
    ],
    distinctSources: [
      { source: 'board-construction', count: 1 },
      { source: 'null', count: 1 },
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
        'stake_units',
        'submission_id',
        'posted_at',
        'settled_at',
      ]),
      pick_candidates: schemaTable([
        'id',
        'pick_id',
        'scan_run_id',
        'universe_id',
        'provenance',
        'model_score',
        'model_tier',
        'model_confidence',
        'shadow_mode',
        'is_board_candidate',
        'sport_key',
        'market_key',
        'created_at',
      ]),
      model_registry: schemaTable([
        'id',
        'model_name',
        'version',
        'sport',
        'market_family',
        'status',
      ]),
      market_universe: schemaTable([
        'id',
        'canonical_market_key',
        'provider_market_key',
        'market_type_id',
        'market_family_id',
        'sport_key',
      ]),
      modelReferenceKeysFound: ['model_id'],
      modelReferenceRows: 1,
      sampledProvenanceRows: 2,
      modelRegistryLinkedToCandidates: false,
      fkJoinPath: 'no FK or direct join path from pick_candidates to model_registry found',
      directFieldsOnPicks: ['source_type', 'submission_id', 'stake_units', 'posted_at', 'settled_at'],
      joinOnlyFields: [
        'candidate_id',
        'market_universe_id',
        'scan_run_id',
        'score_snapshot',
        'board_run_flag',
        'shadow_mode_flag',
      ],
      missingFields: ['model_or_heuristic_id'],
    },
  };
}

test('provenance report writes all required artifacts and summary fields', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-848-'));
  const now = new Date('2026-05-07T12:00:00.000Z');

  const summary = await runProvenanceReport({
    days: 30,
    now,
    outDir,
    data: fixtureData(now.toISOString()),
  });

  const requiredFiles = [
    'evidence.json',
    'provenance-summary.json',
    'provenance-by-source-type.csv',
    'provenance-by-sport.csv',
    'provenance-by-market-family.csv',
    'provenance-exclusions.csv',
    'provenance-unknowns.csv',
    'schema-gaps.json',
    'README.md',
  ];

  for (const file of requiredFiles) {
    assert.equal(fs.existsSync(path.join(outDir, file)), true, `${file} should exist`);
  }

  const summaryFromDisk = JSON.parse(
    fs.readFileSync(path.join(outDir, 'provenance-summary.json'), 'utf8'),
  ) as Record<string, unknown>;
  assert.equal(summary['schema_version'], 1);
  assert.equal(summaryFromDisk['schema_version'], 1);
  assert.ok(summaryFromDisk['evaluation_window']);
  assert.ok(summaryFromDisk['row_counts']);
  assert.ok(summaryFromDisk['provenance_metrics']);
  assert.ok(summaryFromDisk['exclusion_counts']);
  assert.ok(summaryFromDisk['schema_gaps']);

  const gaps = JSON.parse(
    fs.readFileSync(path.join(outDir, 'schema-gaps.json'), 'utf8'),
  ) as Record<string, unknown>;
  assert.ok(gaps['required_schema_questions']);
  assert.ok(gaps['runtime_enforcement_gaps']);

  assert.equal(
    fs.readFileSync(path.join(outDir, 'provenance-exclusions.csv'), 'utf8').split(/\r?\n/)[0],
    'pick_id,exclusion_reason,source_type,sport,market_key,candidate_id,scan_run_id,created_at',
  );
  assert.equal(
    fs.readFileSync(path.join(outDir, 'provenance-unknowns.csv'), 'utf8').split(/\r?\n/)[0],
    'pick_id,source_type,has_submission_id,has_candidate_link,created_at,age_days',
  );

  for (const file of requiredFiles) {
    const text = fs.readFileSync(path.join(outDir, file), 'utf8').toLowerCase();
    assert.equal(
      text.includes('model_has_edge') || text.includes('model has edge: true'),
      false,
      `${file} must not claim model edge`,
    );
    assert.equal(
      text.includes('model attribution fabricated'),
      false,
      `${file} must not fabricate model attribution`,
    );
  }
});
