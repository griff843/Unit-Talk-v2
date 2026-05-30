import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PortfolioExposureStore,
  reconstructFromEvents,
  type ExposureEvent,
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

// ── Empty store ───────────────────────────────────────────────────────────────

test('empty store reconstructs to valid zero-exposure snapshot', () => {
  const store = new PortfolioExposureStore();
  const snap = store.reconstruct();
  assert.equal(snap.is_valid, true);
  assert.equal(snap.open_picks.length, 0);
  assert.equal(snap.total_stake_weight, 0);
  assert.equal(snap.event_count, 0);
  assert.equal(snap.invalid_reason, null);
});

// ── Basic open/close lifecycle ─────────────────────────────────────────────────

test('opened pick appears in snapshot', () => {
  const store = new PortfolioExposureStore();
  store.append(makeEvent({ pick_id: 'pick-1', stake_weight: 0.2 }));
  const snap = store.reconstruct();
  assert.equal(snap.is_valid, true);
  assert.equal(snap.open_picks.length, 1);
  assert.equal(snap.open_picks[0]?.pick_id, 'pick-1');
  assert.equal(snap.open_picks[0]?.stake_weight, 0.2);
  assert.equal(snap.total_stake_weight, 0.2);
});

test('closed pick is removed from snapshot', () => {
  const store = new PortfolioExposureStore();
  store.append(makeEvent({ pick_id: 'pick-1', event_type: 'opened', recorded_at_ms: 1_000 }));
  store.append(makeEvent({ pick_id: 'pick-1', event_id: 'evt-close', event_type: 'closed', recorded_at_ms: 2_000 }));
  const snap = store.reconstruct();
  assert.equal(snap.is_valid, true);
  assert.equal(snap.open_picks.length, 0);
  assert.equal(snap.total_stake_weight, 0);
});

test('voided pick is removed from snapshot', () => {
  const store = new PortfolioExposureStore();
  store.append(makeEvent({ pick_id: 'pick-v', event_type: 'opened', recorded_at_ms: 1_000 }));
  store.append(makeEvent({ pick_id: 'pick-v', event_id: 'evt-void', event_type: 'voided', recorded_at_ms: 2_000 }));
  const snap = store.reconstruct();
  assert.equal(snap.is_valid, true);
  assert.equal(snap.open_picks.length, 0);
});

// ── Multi-pick board ──────────────────────────────────────────────────────────

test('multiple open picks accumulate total stake weight', () => {
  const store = new PortfolioExposureStore();
  store.append(makeEvent({ pick_id: 'pick-a', stake_weight: 0.15, recorded_at_ms: 1_000 }));
  store.append(makeEvent({ pick_id: 'pick-b', stake_weight: 0.20, recorded_at_ms: 2_000 }));
  store.append(makeEvent({ pick_id: 'pick-c', stake_weight: 0.10, recorded_at_ms: 3_000 }));
  const snap = store.reconstruct();
  assert.equal(snap.open_picks.length, 3);
  assert.ok(Math.abs(snap.total_stake_weight - 0.45) < 1e-10);
});

// ── Replay determinism ────────────────────────────────────────────────────────

test('reconstruction is deterministic regardless of append order', () => {
  const events: ExposureEvent[] = [
    makeEvent({ pick_id: 'pick-z', stake_weight: 0.1, recorded_at_ms: 3_000 }),
    makeEvent({ pick_id: 'pick-a', stake_weight: 0.2, recorded_at_ms: 1_000 }),
    makeEvent({ pick_id: 'pick-m', stake_weight: 0.15, recorded_at_ms: 2_000 }),
  ];
  const snap1 = reconstructFromEvents(events);
  const snap2 = reconstructFromEvents([...events].reverse());
  // Both must produce the same open_picks in the same deterministic order.
  assert.deepEqual(snap1.open_picks, snap2.open_picks);
  assert.equal(snap1.total_stake_weight, snap2.total_stake_weight);
  assert.equal(snap1.is_valid, snap2.is_valid);
});

test('open picks are sorted by pick_id for replay stability', () => {
  const store = new PortfolioExposureStore();
  store.append(makeEvent({ pick_id: 'pick-z', recorded_at_ms: 1_000 }));
  store.append(makeEvent({ pick_id: 'pick-a', recorded_at_ms: 2_000 }));
  store.append(makeEvent({ pick_id: 'pick-m', recorded_at_ms: 3_000 }));
  const snap = store.reconstruct();
  const ids = snap.open_picks.map(p => p.pick_id);
  assert.deepEqual(ids, ['pick-a', 'pick-m', 'pick-z']);
});

// ── Adversarial: fail-closed paths ───────────────────────────────────────────

test('closing a never-opened pick fails closed', () => {
  const snap = reconstructFromEvents([
    makeEvent({ pick_id: 'ghost', event_id: 'evt-close', event_type: 'closed', recorded_at_ms: 1_000 }),
  ]);
  assert.equal(snap.is_valid, false);
  assert.ok(snap.invalid_reason?.includes('ghost'));
  assert.equal(snap.open_picks.length, 0);
  assert.equal(snap.total_stake_weight, 0);
});

test('re-opening a closed pick fails closed', () => {
  const snap = reconstructFromEvents([
    makeEvent({ pick_id: 'pick-x', event_type: 'opened', recorded_at_ms: 1_000 }),
    makeEvent({ pick_id: 'pick-x', event_id: 'evt-close', event_type: 'closed', recorded_at_ms: 2_000 }),
    makeEvent({ pick_id: 'pick-x', event_id: 'evt-reopen', event_type: 'opened', recorded_at_ms: 3_000 }),
  ]);
  assert.equal(snap.is_valid, false);
  assert.ok(snap.invalid_reason?.includes('pick-x'));
});

test('voiding a never-opened pick fails closed', () => {
  const snap = reconstructFromEvents([
    makeEvent({ pick_id: 'phantom', event_id: 'evt-void', event_type: 'voided', recorded_at_ms: 1_000 }),
  ]);
  assert.equal(snap.is_valid, false);
  assert.equal(snap.open_picks.length, 0);
});

test('append rejects event with blank pick_id', () => {
  const store = new PortfolioExposureStore();
  assert.throws(() => {
    store.append(makeEvent({ pick_id: '  ', event_type: 'opened' }));
  }, /invalid event/);
});

test('append rejects event with stake_weight out of range', () => {
  const store = new PortfolioExposureStore();
  assert.throws(() => {
    store.append(makeEvent({ pick_id: 'bad', event_type: 'opened', stake_weight: 1.5 }));
  }, /invalid event/);
  assert.throws(() => {
    store.append(makeEvent({ pick_id: 'neg', event_type: 'opened', stake_weight: -0.1 }));
  }, /invalid event/);
});

test('append rejects event with invalid recorded_at_ms', () => {
  const store = new PortfolioExposureStore();
  assert.throws(() => {
    store.append(makeEvent({ pick_id: 'ts', event_type: 'opened', recorded_at_ms: 0 }));
  }, /invalid event/);
});

// ── Stale/open pick adversarial ───────────────────────────────────────────────

test('stale open pick (no close event) remains in exposure — no phantom removal', () => {
  const store = new PortfolioExposureStore();
  store.append(makeEvent({ pick_id: 'stale-pick', stake_weight: 0.25, recorded_at_ms: 1_000 }));
  // No close event — pick stays open (exposure is NOT silently removed).
  const snap = store.reconstruct();
  assert.equal(snap.is_valid, true);
  assert.equal(snap.open_picks.length, 1);
  assert.equal(snap.open_picks[0]?.pick_id, 'stale-pick');
});

test('events array is immutable after append', () => {
  const store = new PortfolioExposureStore();
  store.append(makeEvent({ pick_id: 'pick-1' }));
  const events = store.events;
  // Attempting to push to the readonly reference should throw in strict mode.
  assert.throws(() => {
    (events as ExposureEvent[]).push(makeEvent({ pick_id: 'injected' }));
  });
});
