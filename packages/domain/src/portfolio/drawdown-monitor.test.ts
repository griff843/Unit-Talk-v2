import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateDrawdown,
  DEFAULT_DRAWDOWN_THRESHOLDS,
  type DrawdownThresholds,
} from './drawdown-monitor.js';
import { PortfolioExposureStore, reconstructFromEvents, type ExposureEvent } from './exposure-store.js';

const NOW = 1_700_000_000_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent(pick_id: string, overrides: Partial<ExposureEvent> = {}): ExposureEvent {
  return {
    event_id: `evt-${pick_id}`,
    event_type: 'opened',
    pick_id,
    recorded_at_ms: 1_000,
    sport: 'nfl',
    market_family: 'game-line',
    participant_id: null,
    team_id: null,
    stake_weight: 0.1,
    ...overrides,
  };
}

function makeStore(...stakes: number[]): ReturnType<PortfolioExposureStore['reconstruct']> {
  const store = new PortfolioExposureStore();
  stakes.forEach((s, i) => store.append(makeEvent(`pick-${i}`, { stake_weight: s, event_id: `e-${i}` })));
  return store.reconstruct();
}

// ── Nominal cases ─────────────────────────────────────────────────────────────

test('empty portfolio is nominal', () => {
  const snap = reconstructFromEvents([]);
  const result = evaluateDrawdown(snap, DEFAULT_DRAWDOWN_THRESHOLDS, NOW);
  assert.equal(result.status, 'nominal');
  assert.equal(result.halt_evidence, null);
  assert.equal(result.reading?.total_stake_weight, 0);
});

test('portfolio within all thresholds is nominal', () => {
  const snap = makeStore(0.1, 0.2, 0.15);
  const result = evaluateDrawdown(snap, DEFAULT_DRAWDOWN_THRESHOLDS, NOW);
  assert.equal(result.status, 'nominal');
  assert.ok(result.reading !== null);
  assert.ok(Math.abs(result.reading.total_stake_weight - 0.45) < 1e-10);
});

// ── STAKE_EXPOSURE_EXCEEDED ───────────────────────────────────────────────────

test('stake weight exceeding max triggers halt', () => {
  const snap = makeStore(0.5, 0.6);  // 1.1 > 1.0
  const result = evaluateDrawdown(snap, DEFAULT_DRAWDOWN_THRESHOLDS, NOW);
  assert.equal(result.status, 'halted');
  assert.equal(result.halt_evidence?.reason, 'STAKE_EXPOSURE_EXCEEDED');
  assert.ok(result.halt_evidence?.detail.includes('1.1'));
});

test('stake_utilization > 1 when threshold exceeded', () => {
  const snap = makeStore(0.6, 0.6);
  const result = evaluateDrawdown(snap, DEFAULT_DRAWDOWN_THRESHOLDS, NOW);
  assert.equal(result.status, 'halted');
  assert.ok(result.halt_evidence?.reading?.stake_utilization ?? 0 > 1);
});

test('custom max_total_stake_weight threshold respected', () => {
  const thresholds: DrawdownThresholds = { ...DEFAULT_DRAWDOWN_THRESHOLDS, max_total_stake_weight: 0.3 };
  const snap = makeStore(0.2, 0.2);  // 0.4 > 0.3
  const result = evaluateDrawdown(snap, thresholds, NOW);
  assert.equal(result.status, 'halted');
  assert.equal(result.halt_evidence?.reason, 'STAKE_EXPOSURE_EXCEEDED');
});

test('exactly at max stake threshold is nominal', () => {
  const thresholds: DrawdownThresholds = { ...DEFAULT_DRAWDOWN_THRESHOLDS, max_total_stake_weight: 0.3 };
  const snap = makeStore(0.15, 0.15);  // exactly 0.3
  const result = evaluateDrawdown(snap, thresholds, NOW);
  assert.equal(result.status, 'nominal');
});

// ── PICK_COUNT_EXCEEDED ───────────────────────────────────────────────────────

test('exceeding max_open_picks triggers halt', () => {
  const thresholds: DrawdownThresholds = { ...DEFAULT_DRAWDOWN_THRESHOLDS, max_open_picks: 2 };
  const snap = makeStore(0.05, 0.05, 0.05);  // 3 picks > 2
  const result = evaluateDrawdown(snap, thresholds, NOW);
  assert.equal(result.status, 'halted');
  assert.equal(result.halt_evidence?.reason, 'PICK_COUNT_EXCEEDED');
});

test('exactly at max_open_picks is nominal', () => {
  const thresholds: DrawdownThresholds = { ...DEFAULT_DRAWDOWN_THRESHOLDS, max_open_picks: 3 };
  const snap = makeStore(0.1, 0.1, 0.1);
  const result = evaluateDrawdown(snap, thresholds, NOW);
  assert.equal(result.status, 'nominal');
});

// ── INVALID_SNAPSHOT ─────────────────────────────────────────────────────────

test('invalid snapshot triggers INVALID_SNAPSHOT halt immediately', () => {
  // Force an invalid snapshot by passing close-without-open
  const snap = reconstructFromEvents([
    makeEvent('ghost', { event_id: 'e-close', event_type: 'closed' }),
  ]);
  assert.equal(snap.is_valid, false);
  const result = evaluateDrawdown(snap, DEFAULT_DRAWDOWN_THRESHOLDS, NOW);
  assert.equal(result.status, 'halted');
  assert.equal(result.halt_evidence?.reason, 'INVALID_SNAPSHOT');
  assert.equal(result.reading, null);
});

// ── CONSISTENCY_FAILURE ───────────────────────────────────────────────────────

test('inconsistent snapshot triggers CONSISTENCY_FAILURE halt', () => {
  // Manufacture a snapshot with total_stake_weight mismatch (S5 violation)
  const snap = {
    open_picks: [{ pick_id: 'a', sport: 'nfl', market_family: 'game-line' as const, participant_id: null, team_id: null, stake_weight: 0.1, opened_at_ms: 1_000 }],
    total_stake_weight: 0.99,  // wrong — triggers S5
    event_count: 1,
    is_valid: true,
    invalid_reason: null,
  };
  const result = evaluateDrawdown(snap, DEFAULT_DRAWDOWN_THRESHOLDS, NOW);
  assert.equal(result.status, 'halted');
  assert.equal(result.halt_evidence?.reason, 'CONSISTENCY_FAILURE');
});

test('consistency check skipped when require_consistent_snapshot=false', () => {
  const thresholds: DrawdownThresholds = { ...DEFAULT_DRAWDOWN_THRESHOLDS, require_consistent_snapshot: false };
  // Unsorted snapshot (S6 violation) — should not halt when consistency not required
  const snap = {
    open_picks: [
      { pick_id: 'z', sport: 'nfl', market_family: 'game-line' as const, participant_id: null, team_id: null, stake_weight: 0.1, opened_at_ms: 1_000 },
      { pick_id: 'a', sport: 'nfl', market_family: 'game-line' as const, participant_id: null, team_id: null, stake_weight: 0.1, opened_at_ms: 1_000 },
    ],
    total_stake_weight: 0.2,
    event_count: 2,
    is_valid: true,
    invalid_reason: null,
  };
  const result = evaluateDrawdown(snap, thresholds, NOW);
  // Nominal because consistency check is skipped — even with sort order violation
  assert.equal(result.status, 'nominal');
});

// ── Halt evidence immutability ────────────────────────────────────────────────

test('halt evidence is frozen', () => {
  const snap = makeStore(0.6, 0.6);  // triggers halt
  const result = evaluateDrawdown(snap, DEFAULT_DRAWDOWN_THRESHOLDS, NOW);
  assert.equal(result.status, 'halted');
  assert.throws(() => {
    (result.halt_evidence as unknown as Record<string, unknown>)['reason'] = 'MUTATED';
  });
});

// ── Reading fields ────────────────────────────────────────────────────────────

test('reading includes utilization ratios', () => {
  const thresholds: DrawdownThresholds = { ...DEFAULT_DRAWDOWN_THRESHOLDS, max_total_stake_weight: 0.5, max_open_picks: 10 };
  const snap = makeStore(0.1, 0.1);  // 0.2 stake, 2 picks
  const result = evaluateDrawdown(snap, thresholds, NOW);
  assert.equal(result.status, 'nominal');
  assert.ok(Math.abs((result.reading?.stake_utilization ?? 0) - 0.4) < 1e-10);
  assert.ok(Math.abs((result.reading?.pick_utilization ?? 0) - 0.2) < 1e-10);
});

test('halt_evidence includes halted_at_ms', () => {
  const snap = makeStore(0.6, 0.6);
  const result = evaluateDrawdown(snap, DEFAULT_DRAWDOWN_THRESHOLDS, NOW);
  assert.equal(result.halt_evidence?.halted_at_ms, NOW);
});

test('halt_evidence includes snapshot_event_count', () => {
  const snap = makeStore(0.6, 0.6);
  const result = evaluateDrawdown(snap, DEFAULT_DRAWDOWN_THRESHOLDS, NOW);
  assert.equal(result.halt_evidence?.snapshot_event_count, 2);
});
