import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runRegistryReport } from './run-registry-report.js';

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
        market_type_id: 'player_points_ou',
      },
      {
        id: 'pick-board',
        created_at: createdAt,
        source: 'board-construction',
        sport_id: 'NBA',
        market: 'player_rebounds',
        market_key: 'player_rebounds',
        market_type_id: 'player_rebounds_ou',
      },
      {
        id: 'pick-manual',
        created_at: createdAt,
        source: 'smart-form',
        sport_id: 'MLB',
        market: 'moneyline',
        market_key: 'moneyline',
        market_type_id: 'moneyline',
      },
    ],
    candidates: [
      {
        id: 'candidate-scanner',
        pick_id: 'pick-scanner',
        provenance: {},
        model_score: 70,
        model_tier: 'A',
        model_confidence: 0.7,
      },
      {
        id: 'candidate-board',
        pick_id: 'pick-board',
        provenance: {},
        model_score: 71,
        model_tier: 'A',
        model_confidence: 0.71,
      },
    ],
    allCandidates: [
      {
        id: 'candidate-scanner',
        pick_id: 'pick-scanner',
        provenance: {},
        model_score: 70,
        model_tier: 'A',
        model_confidence: 0.7,
      },
      {
        id: 'candidate-board',
        pick_id: 'pick-board',
        provenance: {},
        model_score: 71,
        model_tier: 'A',
        model_confidence: 0.71,
      },
    ],
    registry: [
      {
        id: 'model-1',
        model_name: 'baseline-nba-player-prop',
        version: 'v0.1',
        sport: 'NBA',
        market_family: 'player_prop',
        status: 'champion',
        champion_since: createdAt,
        created_at: createdAt,
        updated_at: createdAt,
        metadata: {
          provisional: true,
        },
      },
    ],
    distinctSources: [
      { source: 'system-pick-scanner', count: 1 },
      { source: 'board-construction', count: 1 },
      { source: 'smart-form', count: 1 },
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
      ]),
      pick_candidates: schemaTable([
        'id',
        'pick_id',
        'provenance',
        'model_score',
        'model_tier',
        'model_confidence',
      ]),
      model_registry: schemaTable([
        'id',
        'model_name',
        'version',
        'sport',
        'market_family',
        'status',
        'champion_since',
        'created_at',
        'updated_at',
        'metadata',
      ]),
      candidateModelColumns: ['model_score', 'model_tier', 'model_confidence'],
      candidateRegistryColumns: [],
      registryColumnsVerified: [
        'id',
        'model_name',
        'version',
        'sport',
        'market_family',
        'status',
        'champion_since',
        'created_at',
        'updated_at',
        'metadata',
      ],
      registryLinkedToCandidatesByMigration: false,
      provenanceModelReferenceKeys: [],
      provenanceRowsSampled: 2,
      provenanceModelReferenceRows: 0,
    },
  };
}

test('model registry report writes artifacts and does not fabricate ownership', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-850-'));
  const now = new Date('2026-05-07T12:00:00.000Z');

  const summary = await runRegistryReport({
    days: 30,
    now,
    outDir,
    data: fixtureData(now.toISOString()),
  });

  const requiredFiles = [
    'model-registry-summary.json',
    'model-registry-entries.csv',
    'model-attribution-coverage.csv',
    'model-performance-readiness.csv',
    'champion-challenger-status.csv',
    'model-attribution-gaps.csv',
    'schema-gaps.json',
    'README.md',
    'evidence.json',
  ];

  for (const file of requiredFiles) {
    assert.equal(fs.existsSync(path.join(outDir, file)), true, `${file} should exist`);
  }

  const summaryFromDisk = JSON.parse(
    fs.readFileSync(path.join(outDir, 'model-registry-summary.json'), 'utf8'),
  ) as Record<string, unknown>;
  assert.equal(summary['schema_version'], 1);
  assert.equal(summaryFromDisk['schema_version'], 1);
  assert.ok(summaryFromDisk['evaluation_window']);
  assert.ok(summaryFromDisk['registry_state']);
  assert.ok(summaryFromDisk['attribution_coverage']);
  assert.ok(summaryFromDisk['model_edge_eligibility']);
  assert.ok(summaryFromDisk['schema_findings']);
  assert.ok(summaryFromDisk['required_future_changes']);
  assert.equal((summaryFromDisk['attribution_coverage'] as Record<string, unknown>)['model_attributed_pct'], 0);

  assert.equal(
    fs.readFileSync(path.join(outDir, 'model-attribution-coverage.csv'), 'utf8').split(/\r?\n/)[0],
    'source_value,entity_type,pick_count,model_attributed_count,model_attributed_pct,registry_fk_present,model_edge_eligible',
  );
  assert.equal(
    fs.readFileSync(path.join(outDir, 'model-attribution-gaps.csv'), 'utf8').split(/\r?\n/)[0],
    'picks_source_value,pick_count,gap_type,gap_description,resolution_required',
  );

  const coverage = fs.readFileSync(path.join(outDir, 'model-attribution-coverage.csv'), 'utf8');
  assert.match(coverage, /system-pick-scanner,heuristic_system/);
  assert.doesNotMatch(coverage, /system-pick-scanner,champion_model/);

  for (const file of requiredFiles) {
    const text = fs.readFileSync(path.join(outDir, file), 'utf8').toLowerCase();
    assert.equal(text.includes('model has edge'), false, `${file} must not claim model edge`);
  }
});
