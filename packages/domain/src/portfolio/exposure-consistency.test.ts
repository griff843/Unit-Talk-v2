import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifySnapshotConsistency,
  verifyEventLogConsistency,
} from './exposure-consistency.js';
import {
  PortfolioExposureStore,
  reconstructFromEvents,
  type ExposureEvent,
  type PortfolioExposureSnapshot,
  type ExposureEntry,
} from './exposure-store.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<ExposureEvent> & { pick_id: string }): ExposureEvent {
  return {
    event_id: `evt-${overrides.pick_id}-${overrides.event_type ?? 'opened'}`,
    event_type: 'opened',
    recorded_at_ms: 1_700_000_000_000,
    sport: 'nfl',
    market_family: 'game-line',
    participant_id: null,
    team_id: 'team-a',
    stake_weight: 0.1,
    ...overrides,
  };
}

function makeEntry(pick_id: string, stake_weight = 0.1): ExposureEntry {
  return {
    pick_id,
    sport: 'nfl',
    market_family: 'game-line',
    participant_id: null,
    team_id: 'team-a',
    stake_weight,
    opened_at_ms: 1_700_000_000_000,
  };
}

function makeSnapshot(overrides: Partial<PortfolioExposureSnapshot> = {}): PortfolioExposureSnapshot {
  const open_picks = overrides.open_picks ?? [];
  const total_stake_weight = overrides.total_stake_weight
    ?? open_picks.reduce((s, p) => s + p.stake_weight, 0);
  return {
    open_picks,
    total_stake_weight,
    event_count: overrides.event_count ?? 0,
    is_valid: overrides.is_valid ?? true,
    invalid_reason: overrides.invalid_reason ?? null,
  };
}

// ── Snapshot consistency — clean cases ───────────────────────────────────────

test('consistent snapshot from reconstructed store passes all rules', () => {
  const store = new PortfolioExposureStore();
  store.append(makeEvent({ pick_id: 'a', stake_weight: 0.2, recorded_at_ms: 1_000 }));
  store.append(makeEvent({ pick_id: 'b', stake_weight: 0.3, recorded_at_ms: 2_000 }));
  const snap = store.reconstruct();
  const result = verifySnapshotConsistency(snap);
  assert.equal(result.is_consistent, true);
  assert.equal(result.violations.length, 0);
});

test('empty valid snapshot is consistent', () => {
  const snap = reconstructFromEvents([]);
  const result = verifySnapshotConsistency(snap);
  assert.equal(result.is_consistent, true);
});

// ── S1 — invalid snapshot ─────────────────────────────────────────────────────

test('S1: invalid snapshot fails immediately', () => {
  const snap = makeSnapshot({ is_valid: false, invalid_reason: 'test reason' });
  const result = verifySnapshotConsistency(snap);
  assert.equal(result.is_consistent, false);
  assert.ok(result.violations.some(v => v.rule === 'S1'));
});

// ── S2 — duplicate pick_id ────────────────────────────────────────────────────

test('S2: duplicate pick_id in open_picks fails', () => {
  const snap = makeSnapshot({
    open_picks: [makeEntry('dup', 0.1), makeEntry('dup', 0.1)],
    total_stake_weight: 0.2,
  });
  const result = verifySnapshotConsistency(snap);
  assert.equal(result.is_consistent, false);
  assert.ok(result.violations.some(v => v.rule === 'S2'));
});

// ── S3 — stake_weight out of range ────────────────────────────────────────────

test('S3: stake_weight > 1 fails', () => {
  const snap = makeSnapshot({ open_picks: [makeEntry('x', 1.5)], total_stake_weight: 1.5 });
  const result = verifySnapshotConsistency(snap);
  assert.equal(result.is_consistent, false);
  assert.ok(result.violations.some(v => v.rule === 'S3'));
});

test('S3: negative stake_weight fails', () => {
  const snap = makeSnapshot({ open_picks: [makeEntry('x', -0.1)], total_stake_weight: -0.1 });
  const result = verifySnapshotConsistency(snap);
  assert.equal(result.is_consistent, false);
  assert.ok(result.violations.some(v => v.rule === 'S3'));
});

// ── S5 — total_stake_weight mismatch ─────────────────────────────────────────

test('S5: total_stake_weight mismatch fails', () => {
  const snap = makeSnapshot({
    open_picks: [makeEntry('a', 0.1), makeEntry('b', 0.2)],
    total_stake_weight: 0.99,  // wrong
  });
  const result = verifySnapshotConsistency(snap);
  assert.equal(result.is_consistent, false);
  assert.ok(result.violations.some(v => v.rule === 'S5'));
});

// ── S6 — sort order ──────────────────────────────────────────────────────────

test('S6: unsorted open_picks fails', () => {
  const snap = makeSnapshot({
    open_picks: [makeEntry('z', 0.1), makeEntry('a', 0.1)],
    total_stake_weight: 0.2,
  });
  const result = verifySnapshotConsistency(snap);
  assert.equal(result.is_consistent, false);
  assert.ok(result.violations.some(v => v.rule === 'S6'));
});

// ── Event log consistency — clean case ───────────────────────────────────────

test('consistent event log passes all rules', () => {
  const events: ExposureEvent[] = [
    makeEvent({ pick_id: 'p1', event_id: 'e1', recorded_at_ms: 1_000 }),
    makeEvent({ pick_id: 'p2', event_id: 'e2', recorded_at_ms: 2_000 }),
  ];
  const result = verifyEventLogConsistency(events);
  assert.equal(result.is_consistent, true);
  assert.equal(result.event_count, 2);
  assert.equal(result.unique_pick_count, 2);
});

test('empty event log is consistent', () => {
  const result = verifyEventLogConsistency([]);
  assert.equal(result.is_consistent, true);
  assert.equal(result.event_count, 0);
});

// ── E1 — duplicate event_id ───────────────────────────────────────────────────

test('E1: duplicate event_id fails', () => {
  const events: ExposureEvent[] = [
    makeEvent({ pick_id: 'p1', event_id: 'same-id' }),
    makeEvent({ pick_id: 'p2', event_id: 'same-id' }),
  ];
  const result = verifyEventLogConsistency(events);
  assert.equal(result.is_consistent, false);
  assert.ok(result.violations.some(v => v.rule === 'E1'));
});

// ── E2 — invalid timestamp ────────────────────────────────────────────────────

test('E2: zero recorded_at_ms fails', () => {
  const result = verifyEventLogConsistency([
    makeEvent({ pick_id: 'p1', recorded_at_ms: 0 }),
  ]);
  assert.equal(result.is_consistent, false);
  assert.ok(result.violations.some(v => v.rule === 'E2'));
});

test('E2: negative recorded_at_ms fails', () => {
  const result = verifyEventLogConsistency([
    makeEvent({ pick_id: 'p1', recorded_at_ms: -1 }),
  ]);
  assert.equal(result.is_consistent, false);
  assert.ok(result.violations.some(v => v.rule === 'E2'));
});

// ── E3 — stake_weight on opened event ────────────────────────────────────────

test('E3: opened event with stake_weight > 1 fails', () => {
  const result = verifyEventLogConsistency([
    makeEvent({ pick_id: 'p1', event_type: 'opened', stake_weight: 2 }),
  ]);
  assert.equal(result.is_consistent, false);
  assert.ok(result.violations.some(v => v.rule === 'E3'));
});

// ── E5 — blank pick_id ───────────────────────────────────────────────────────

test('E5: blank pick_id fails', () => {
  const result = verifyEventLogConsistency([
    makeEvent({ pick_id: '  ' }),
  ]);
  assert.equal(result.is_consistent, false);
  assert.ok(result.violations.some(v => v.rule === 'E5'));
});

// ── unique_pick_count ─────────────────────────────────────────────────────────

test('unique_pick_count counts distinct pick_ids across events', () => {
  const events: ExposureEvent[] = [
    makeEvent({ pick_id: 'p1', event_id: 'e1', event_type: 'opened', recorded_at_ms: 1_000 }),
    makeEvent({ pick_id: 'p1', event_id: 'e2', event_type: 'closed', recorded_at_ms: 2_000 }),
    makeEvent({ pick_id: 'p2', event_id: 'e3', recorded_at_ms: 3_000 }),
  ];
  const result = verifyEventLogConsistency(events);
  assert.equal(result.is_consistent, true);
  assert.equal(result.unique_pick_count, 2);
  assert.equal(result.event_count, 3);
});
