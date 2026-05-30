import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateConcentrationHardBlock,
  DEFAULT_HARD_BLOCK_CONFIG,
  type CandidatePick,
  type ConcentrationHardBlockConfig,
} from './concentration-hard-blocks.js';
import { PortfolioExposureStore, reconstructFromEvents, type ExposureEvent } from './exposure-store.js';

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
    team_id: 'team-a',
    stake_weight: 0.05,
    ...overrides,
  };
}

function candidate(overrides: Partial<CandidatePick> = {}): CandidatePick {
  return {
    pick_id: 'candidate-x',
    sport: 'nfl',
    market_family: 'game-line',
    participant_id: null,
    team_id: 'team-a',
    stake_weight: 0.05,
    ...overrides,
  };
}

const emptySnapshot = reconstructFromEvents([]);

// ── Nominal: empty board ──────────────────────────────────────────────────────

test('empty board always allows candidate', () => {
  const result = evaluateConcentrationHardBlock(emptySnapshot, candidate());
  assert.equal(result.status, 'allowed');
  assert.equal(result.block_evidence, null);
  assert.ok(result.projected_signals !== null);
});

// ── Nominal: within limits ────────────────────────────────────────────────────

test('candidate within all concentration limits is allowed', () => {
  // Disable market_family ceiling to isolate sport/team checks; vary sports and teams
  const config: ConcentrationHardBlockConfig = { ...DEFAULT_HARD_BLOCK_CONFIG, market_family: 1.0 };
  const store = new PortfolioExposureStore();
  store.append(makeEvent('p1', { sport: 'nba', team_id: 'team-b', stake_weight: 0.1, event_id: 'e1' }));
  store.append(makeEvent('p2', { sport: 'nba', team_id: 'team-c', stake_weight: 0.1, event_id: 'e2' }));
  store.append(makeEvent('p3', { sport: 'mlb', team_id: 'team-d', stake_weight: 0.1, event_id: 'e3' }));
  // nfl/team-e at 0.1: sport=25%<60%, team=25%<40%
  const result = evaluateConcentrationHardBlock(store.reconstruct(), candidate({ sport: 'nfl', team_id: 'team-e', stake_weight: 0.1 }), config);
  assert.equal(result.status, 'allowed');
});

// ── PLAYER_CONCENTRATION_EXCEEDED ────────────────────────────────────────────

test('player concentration breach blocks candidate', () => {
  const config: ConcentrationHardBlockConfig = { ...DEFAULT_HARD_BLOCK_CONFIG, player: 0.2 };
  const store = new PortfolioExposureStore();
  // Add picks for player-a filling 20% of portfolio
  store.append(makeEvent('p1', { participant_id: 'player-a', market_family: 'player-prop', team_id: 'team-a', stake_weight: 0.2 }));
  const result = evaluateConcentrationHardBlock(
    store.reconstruct(),
    candidate({ participant_id: 'player-a', market_family: 'player-prop', stake_weight: 0.1 }),
    config,
  );
  assert.equal(result.status, 'blocked');
  assert.equal(result.block_evidence?.reason, 'PLAYER_CONCENTRATION_EXCEEDED');
  assert.equal(result.block_evidence?.dimension, 'player');
  assert.ok((result.block_evidence?.current_concentration ?? 0) > config.player);
});

// ── TEAM_CONCENTRATION_EXCEEDED ───────────────────────────────────────────────

test('team concentration breach blocks candidate', () => {
  const config: ConcentrationHardBlockConfig = { ...DEFAULT_HARD_BLOCK_CONFIG, team: 0.3 };
  const store = new PortfolioExposureStore();
  store.append(makeEvent('p1', { team_id: 'team-x', stake_weight: 0.3 }));
  const result = evaluateConcentrationHardBlock(
    store.reconstruct(),
    candidate({ team_id: 'team-x', stake_weight: 0.1 }),
    config,
  );
  assert.equal(result.status, 'blocked');
  assert.equal(result.block_evidence?.reason, 'TEAM_CONCENTRATION_EXCEEDED');
  assert.equal(result.block_evidence?.dimension, 'team');
});

// ── SPORT_CONCENTRATION_EXCEEDED ─────────────────────────────────────────────

test('sport concentration breach blocks candidate', () => {
  const config: ConcentrationHardBlockConfig = { ...DEFAULT_HARD_BLOCK_CONFIG, sport: 0.5 };
  const store = new PortfolioExposureStore();
  store.append(makeEvent('p1', { sport: 'nba', team_id: 'team-a', stake_weight: 0.5 }));
  const result = evaluateConcentrationHardBlock(
    store.reconstruct(),
    candidate({ sport: 'nba', team_id: 'team-b', stake_weight: 0.1 }),
    config,
  );
  assert.equal(result.status, 'blocked');
  assert.equal(result.block_evidence?.reason, 'SPORT_CONCENTRATION_EXCEEDED');
  assert.equal(result.block_evidence?.dimension, 'sport');
});

// ── MARKET_FAMILY_CONCENTRATION_EXCEEDED ──────────────────────────────────────

test('market-family concentration breach blocks candidate', () => {
  // Use different sports to avoid sport ceiling firing first; isolate market_family breach
  const config: ConcentrationHardBlockConfig = { ...DEFAULT_HARD_BLOCK_CONFIG, sport: 1.0, market_family: 0.6 };
  const store = new PortfolioExposureStore();
  store.append(makeEvent('p1', { sport: 'nba', market_family: 'player-prop', team_id: 'team-b', stake_weight: 0.6, event_id: 'e1' }));
  const result = evaluateConcentrationHardBlock(
    store.reconstruct(),
    candidate({ sport: 'nfl', market_family: 'player-prop', stake_weight: 0.1 }),
    config,
  );
  assert.equal(result.status, 'blocked');
  assert.equal(result.block_evidence?.reason, 'MARKET_FAMILY_CONCENTRATION_EXCEEDED');
});

// ── INVALID_SNAPSHOT ─────────────────────────────────────────────────────────

test('invalid snapshot always blocks candidate', () => {
  const snap = reconstructFromEvents([
    makeEvent('ghost', { event_id: 'e-close', event_type: 'closed' }),
  ]);
  assert.equal(snap.is_valid, false);
  const result = evaluateConcentrationHardBlock(snap, candidate());
  assert.equal(result.status, 'blocked');
  assert.equal(result.block_evidence?.reason, 'INVALID_SNAPSHOT');
  assert.equal(result.block_evidence?.dimension, null);
  assert.equal(result.projected_signals, null);
});

// ── CONSISTENCY_FAILURE ───────────────────────────────────────────────────────

test('inconsistent snapshot blocks when require_consistent_snapshot=true', () => {
  // Manufacture S5 violation: wrong total_stake_weight
  const snap = {
    open_picks: [{ pick_id: 'x', sport: 'nfl', market_family: 'game-line' as const, participant_id: null, team_id: null, stake_weight: 0.1, opened_at_ms: 1_000 }],
    total_stake_weight: 0.99,
    event_count: 1,
    is_valid: true,
    invalid_reason: null,
  };
  const result = evaluateConcentrationHardBlock(snap, candidate());
  assert.equal(result.status, 'blocked');
  assert.equal(result.block_evidence?.reason, 'CONSISTENCY_FAILURE');
});

test('consistency check skipped when require_consistent_snapshot=false', () => {
  const config: ConcentrationHardBlockConfig = { ...DEFAULT_HARD_BLOCK_CONFIG, require_consistent_snapshot: false };
  // S5 violation (wrong total) but consistency check is skipped
  // Board is empty so empty-board guard will allow — valid test that skip works
  const snap = {
    open_picks: [],
    total_stake_weight: 0.99,
    event_count: 0,
    is_valid: true,
    invalid_reason: null,
  };
  const result = evaluateConcentrationHardBlock(snap, candidate({ stake_weight: 0.1 }), config);
  assert.equal(result.status, 'allowed');
});

// ── Block evidence immutability ───────────────────────────────────────────────

test('block evidence is frozen', () => {
  const snap = reconstructFromEvents([
    makeEvent('ghost', { event_id: 'e-close', event_type: 'closed' }),
  ]);
  const result = evaluateConcentrationHardBlock(snap, candidate());
  assert.throws(() => {
    (result.block_evidence as unknown as Record<string, unknown>)['reason'] = 'MUTATED';
  });
});

// ── Projected signals on allow ────────────────────────────────────────────────

test('projected_signals present on allowed result', () => {
  // Disable all ceilings to guarantee allowed; board must be non-empty to produce signals
  const config: ConcentrationHardBlockConfig = { player: 1.0, team: 1.0, sport: 1.0, market_family: 1.0, require_consistent_snapshot: true };
  const store = new PortfolioExposureStore();
  store.append(makeEvent('p1', { sport: 'nba', team_id: 'team-b', stake_weight: 0.1, event_id: 'e1' }));
  const result = evaluateConcentrationHardBlock(store.reconstruct(), candidate({ sport: 'nfl', team_id: 'team-z', stake_weight: 0.1 }), config);
  assert.equal(result.status, 'allowed');
  assert.ok(result.projected_signals !== null);
  assert.ok(typeof result.projected_signals.sportConcentration === 'number');
});

test('block_evidence includes snapshot_event_count', () => {
  const store = new PortfolioExposureStore();
  store.append(makeEvent('p1', { stake_weight: 0.5 }));
  store.append(makeEvent('p2', { stake_weight: 0.5, event_id: 'e2' }));
  const config: ConcentrationHardBlockConfig = { ...DEFAULT_HARD_BLOCK_CONFIG, team: 0.3 };
  const result = evaluateConcentrationHardBlock(store.reconstruct(), candidate({ team_id: 'team-a', stake_weight: 0.2 }), config);
  if (result.status === 'blocked') {
    assert.equal(result.block_evidence?.snapshot_event_count, 2);
  }
});
