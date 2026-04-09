/**
 * line-movement-detector.test.ts
 *
 * Unit tests for LineMovementDetector and runLineMovementDetection.
 * No live DB required. All tests use stubs.
 *
 * Test runner: node:test + tsx --test
 * Assertions: node:assert/strict
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LineMovementDetector,
  runLineMovementDetection,
  lineMovementEmitter,
} from './line-movement-detector.js';
import type { LineMovement, ILineMovementDetectorRepository } from './line-movement-detector.js';
import type { MarketUniverseRow } from '@unit-talk/db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<MarketUniverseRow> = {}): MarketUniverseRow {
  const now = new Date().toISOString();
  return {
    id: 'universe-1',
    sport_key: 'nba',
    league_key: 'nba',
    event_id: null,
    participant_id: null,
    market_type_id: null,
    canonical_market_key: 'points-all-game-ou',
    provider_key: 'sgo',
    provider_event_id: 'event-abc',
    provider_participant_id: 'player-1',
    provider_market_key: 'points-all-game-ou',
    current_line: 24.5,
    current_over_odds: -110,
    current_under_odds: -110,
    opening_line: 24.5,
    opening_over_odds: -110,
    opening_under_odds: -110,
    closing_line: null,
    closing_over_odds: null,
    closing_under_odds: null,
    fair_over_prob: 0.5,
    fair_under_prob: 0.5,
    is_stale: false,
    last_offer_snapshot_at: now,
    refreshed_at: now,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function makeRepo(rows: MarketUniverseRow[]): ILineMovementDetectorRepository {
  return {
    async listRecentlyRefreshed(_since: string) {
      return rows;
    },
  };
}

// ---------------------------------------------------------------------------
// LineMovementDetector unit tests
// ---------------------------------------------------------------------------

test('detector: returns empty array when no rows provided', () => {
  const detector = new LineMovementDetector();
  const result = detector.detect([]);
  assert.deepEqual(result, []);
});

test('detector: no movement when current equals opening', () => {
  const row = makeRow({
    current_line: 24.5,
    opening_line: 24.5,
    current_over_odds: -110,
    opening_over_odds: -110,
    current_under_odds: -110,
    opening_under_odds: -110,
  });
  const detector = new LineMovementDetector();
  const result = detector.detect([row]);
  assert.deepEqual(result, []);
});

test('detector: detects line movement >= 0.5', () => {
  const row = makeRow({
    current_line: 25.0,
    opening_line: 24.5,
  });
  const detector = new LineMovementDetector();
  const result = detector.detect([row]);

  assert.equal(result.length, 1);
  const m = result[0]!;
  assert.equal(m.movement_type, 'line');
  assert.equal(m.from_value, 24.5);
  assert.equal(m.to_value, 25.0);
  assert.ok(Math.abs(m.delta - 0.5) < 0.0001);
  assert.equal(m.universe_id, 'universe-1');
  assert.equal(m.provider_key, 'sgo');
  assert.equal(m.provider_event_id, 'event-abc');
  assert.equal(m.canonical_market_key, 'points-all-game-ou');
  assert.equal(m.is_stale, false);
  assert.ok(typeof m.detected_at === 'string');
});

test('detector: does NOT flag line movement below threshold (0.4 < 0.5)', () => {
  const row = makeRow({
    current_line: 24.9,
    opening_line: 24.5,
  });
  const detector = new LineMovementDetector();
  const result = detector.detect([row]);
  // 0.4 delta should not trigger
  assert.equal(result.length, 0);
});

test('detector: detects exact threshold boundary (0.5 line move)', () => {
  const row = makeRow({
    current_line: 25.0,   // 0.5 above 24.5
    opening_line: 24.5,
  });
  const detector = new LineMovementDetector();
  const result = detector.detect([row]);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.movement_type, 'line');
});

test('detector: detects negative line movement (line decreases)', () => {
  const row = makeRow({
    current_line: 24.0,
    opening_line: 24.5,
  });
  const detector = new LineMovementDetector();
  const result = detector.detect([row]);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.movement_type, 'line');
  assert.ok(result[0]!.delta < 0);
});

test('detector: detects over_odds movement >= 5', () => {
  const row = makeRow({
    current_over_odds: -115,
    opening_over_odds: -110,
  });
  const detector = new LineMovementDetector();
  const result = detector.detect([row]);

  const odds = result.find(m => m.movement_type === 'over_odds');
  assert.ok(odds !== undefined, 'over_odds movement should be detected');
  assert.equal(odds!.movement_type, 'over_odds');
  assert.equal(odds!.from_value, -110);
  assert.equal(odds!.to_value, -115);
  assert.ok(Math.abs(odds!.delta - (-5)) < 0.0001);
});

test('detector: does NOT flag over_odds movement below threshold (4 < 5)', () => {
  const row = makeRow({
    current_over_odds: -114,
    opening_over_odds: -110,
  });
  const detector = new LineMovementDetector();
  const result = detector.detect([row]);
  const odds = result.find(m => m.movement_type === 'over_odds');
  assert.equal(odds, undefined);
});

test('detector: detects under_odds movement >= 5', () => {
  const row = makeRow({
    current_under_odds: -105,
    opening_under_odds: -110,
  });
  const detector = new LineMovementDetector();
  const result = detector.detect([row]);

  const odds = result.find(m => m.movement_type === 'under_odds');
  assert.ok(odds !== undefined, 'under_odds movement should be detected');
  assert.equal(odds!.movement_type, 'under_odds');
  assert.equal(odds!.from_value, -110);
  assert.equal(odds!.to_value, -105);
});

test('detector: detects multiple movement types on same row', () => {
  const row = makeRow({
    current_line: 25.5,     // +1.0 from 24.5 — triggers
    current_over_odds: -120, // -10 from -110 — triggers
    current_under_odds: -100, // +10 from -110 — triggers
    opening_line: 24.5,
    opening_over_odds: -110,
    opening_under_odds: -110,
  });
  const detector = new LineMovementDetector();
  const result = detector.detect([row]);

  assert.equal(result.length, 3);
  const types = result.map(m => m.movement_type).sort();
  assert.deepEqual(types, ['line', 'over_odds', 'under_odds']);
});

test('detector: skips row with null current_line', () => {
  const row = makeRow({
    current_line: null,
    opening_line: 24.5,
  });
  const detector = new LineMovementDetector();
  const result = detector.detect([row]);
  const lineMovements = result.filter(m => m.movement_type === 'line');
  assert.equal(lineMovements.length, 0);
});

test('detector: skips row with null opening_line', () => {
  const row = makeRow({
    current_line: 25.0,
    opening_line: null,
  });
  const detector = new LineMovementDetector();
  const result = detector.detect([row]);
  const lineMovements = result.filter(m => m.movement_type === 'line');
  assert.equal(lineMovements.length, 0);
});

test('detector: skips row with null opening_over_odds', () => {
  const row = makeRow({
    current_over_odds: -115,
    opening_over_odds: null,
  });
  const detector = new LineMovementDetector();
  const result = detector.detect([row]);
  const oddsMovements = result.filter(m => m.movement_type === 'over_odds');
  assert.equal(oddsMovements.length, 0);
});

test('detector: skips row with null opening_under_odds', () => {
  const row = makeRow({
    current_under_odds: -115,
    opening_under_odds: null,
  });
  const detector = new LineMovementDetector();
  const result = detector.detect([row]);
  const oddsMovements = result.filter(m => m.movement_type === 'under_odds');
  assert.equal(oddsMovements.length, 0);
});

test('detector: handles multiple rows independently', () => {
  const rowA = makeRow({
    id: 'universe-1',
    current_line: 25.0,
    opening_line: 24.5, // +0.5 — triggers
  });
  const rowB = makeRow({
    id: 'universe-2',
    provider_participant_id: 'player-2',
    current_line: 24.5,
    opening_line: 24.5, // no change
  });
  const rowC = makeRow({
    id: 'universe-3',
    provider_participant_id: 'player-3',
    current_over_odds: -120,
    opening_over_odds: -110, // -10 — triggers
  });

  const detector = new LineMovementDetector();
  const result = detector.detect([rowA, rowB, rowC]);

  assert.equal(result.length, 2);
  assert.ok(result.some(m => m.universe_id === 'universe-1' && m.movement_type === 'line'));
  assert.ok(result.some(m => m.universe_id === 'universe-3' && m.movement_type === 'over_odds'));
});

test('detector: is_stale flag is carried through to movement record', () => {
  const row = makeRow({
    current_line: 25.0,
    opening_line: 24.5,
    is_stale: true,
  });
  const detector = new LineMovementDetector();
  const result = detector.detect([row]);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.is_stale, true);
});

test('detector: detected_at is a valid ISO timestamp', () => {
  const row = makeRow({ current_line: 25.0, opening_line: 24.5 });
  const before = Date.now();
  const detector = new LineMovementDetector();
  const result = detector.detect([row]);
  const after = Date.now();

  assert.equal(result.length, 1);
  const detectedMs = new Date(result[0]!.detected_at).getTime();
  assert.ok(detectedMs >= before && detectedMs <= after, 'detected_at should be within test window');
});

// ---------------------------------------------------------------------------
// runLineMovementDetection integration tests
// ---------------------------------------------------------------------------

test('runner: returns zero result when repo returns no rows', async () => {
  const repo = makeRepo([]);
  const result = await runLineMovementDetection(repo);
  assert.equal(result.scanned, 0);
  assert.deepEqual(result.movements, []);
  assert.ok(result.durationMs >= 0);
});

test('runner: returns correct scanned count and movements', async () => {
  const rows = [
    makeRow({ id: 'u1', current_line: 25.0, opening_line: 24.5 }),
    makeRow({ id: 'u2', provider_participant_id: 'player-2', current_line: 24.5, opening_line: 24.5 }),
  ];
  const repo = makeRepo(rows);
  const result = await runLineMovementDetection(repo);

  assert.equal(result.scanned, 2);
  assert.equal(result.movements.length, 1);
  assert.equal(result.movements[0]!.universe_id, 'u1');
});

test('runner: emits movement events on lineMovementEmitter', async () => {
  const rows = [
    makeRow({ id: 'emit-test-1', current_line: 25.0, opening_line: 24.5 }),
  ];
  const repo = makeRepo(rows);

  const emitted: LineMovement[] = [];
  const handler = (m: LineMovement) => emitted.push(m);
  lineMovementEmitter.on('movement', handler);

  try {
    await runLineMovementDetection(repo);
  } finally {
    lineMovementEmitter.off('movement', handler);
  }

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0]!.universe_id, 'emit-test-1');
  assert.equal(emitted[0]!.movement_type, 'line');
});

test('runner: handles repo failure gracefully and returns empty result', async () => {
  const failingRepo: ILineMovementDetectorRepository = {
    async listRecentlyRefreshed() {
      throw new Error('DB connection refused');
    },
  };

  const result = await runLineMovementDetection(failingRepo, {});
  assert.equal(result.scanned, 0);
  assert.deepEqual(result.movements, []);
  assert.ok(result.durationMs >= 0);
});

test('runner: does not throw when logger is not provided', async () => {
  const repo = makeRepo([makeRow({ current_line: 25.0, opening_line: 24.5 })]);
  // Should not throw — logger is optional (omit it entirely)
  await assert.doesNotReject(async () => {
    await runLineMovementDetection(repo, {});
  });
});

test('runner: passes lookbackMinutes to repo via since timestamp', async () => {
  let capturedSince: string | null = null;
  const customRepo: ILineMovementDetectorRepository = {
    async listRecentlyRefreshed(since: string) {
      capturedSince = since;
      return [];
    },
  };

  const beforeRun = Date.now();
  await runLineMovementDetection(customRepo, { lookbackMinutes: 15 });
  const afterRun = Date.now();

  assert.ok(capturedSince !== null, 'listRecentlyRefreshed should have been called');
  const sinceMs = new Date(capturedSince!).getTime();
  // should be ~15 minutes before run time
  const expectedSince = beforeRun - 15 * 60 * 1000;
  assert.ok(
    sinceMs >= expectedSince - 100 && sinceMs <= afterRun,
    `since (${capturedSince}) should be ~15 minutes before run`,
  );
});
