import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeConcentrationSignals,
  computeConcentrationPenalty,
  CONCENTRATION_LIMITS,
} from './concentration.js';
import type { PortfolioSlot } from './concentration.js';

function makeSlot(overrides: Partial<PortfolioSlot> & { pickId: string }): PortfolioSlot {
  return {
    sport: 'NBA',
    marketFamily: 'player-prop',
    participantId: null,
    teamId: null,
    modelProbability: 0.55,
    edge: 0.05,
    stake: 0.02,
    ...overrides,
  };
}

// ─── computeConcentrationSignals ────────────────────────────────────────────

test('computeConcentrationSignals: empty board, no concentration', () => {
  const candidate = makeSlot({ pickId: 'c1', participantId: 'player-A', teamId: 'LAL', stake: 0.02 });
  const signals = computeConcentrationSignals([], candidate);

  // Only the candidate in the "all" set → 100% player, team, sport, marketFamily
  assert.equal(signals.playerConcentration, 1.0);
  assert.equal(signals.teamConcentration, 1.0);
  assert.equal(signals.sportConcentration, 1.0);
  assert.equal(signals.marketFamilyConcentration, 1.0);
  assert.equal(signals.maxSlotWeight, 1.0);
});

test('computeConcentrationSignals: same player on board raises playerConcentration', () => {
  const board = [
    makeSlot({ pickId: 'b1', participantId: 'player-A', teamId: 'LAL', stake: 0.02 }),
    makeSlot({ pickId: 'b2', participantId: 'player-B', teamId: 'BOS', stake: 0.02 }),
    makeSlot({ pickId: 'b3', participantId: 'player-C', teamId: 'GSW', stake: 0.02 }),
  ];
  const candidate = makeSlot({ pickId: 'c1', participantId: 'player-A', teamId: 'LAL', stake: 0.02 });

  const signals = computeConcentrationSignals(board, candidate);
  const total = 4 * 0.02; // 4 picks × 0.02
  const expected = (2 * 0.02) / total; // 2 picks on player-A

  assert.equal(signals.playerConcentration, expected); // 0.5
  assert.ok(signals.playerConcentration > CONCENTRATION_LIMITS.player);
});

test('computeConcentrationSignals: diverse players → low playerConcentration', () => {
  const board = [
    makeSlot({ pickId: 'b1', participantId: 'player-A', teamId: 'LAL', stake: 0.02 }),
    makeSlot({ pickId: 'b2', participantId: 'player-B', teamId: 'BOS', stake: 0.02 }),
    makeSlot({ pickId: 'b3', participantId: 'player-C', teamId: 'GSW', stake: 0.02 }),
  ];
  const candidate = makeSlot({ pickId: 'c1', participantId: 'player-D', teamId: 'MIA', stake: 0.02 });

  const signals = computeConcentrationSignals(board, candidate);
  // candidate player-D appears once out of 4 picks → 0.25 (exactly at limit, not over)
  assert.equal(signals.playerConcentration, 0.25);
  assert.ok(signals.playerConcentration <= CONCENTRATION_LIMITS.player);
});

test('computeConcentrationSignals: no participantId → playerConcentration is 0', () => {
  const board = [
    makeSlot({ pickId: 'b1', participantId: null, teamId: 'LAL', marketFamily: 'game-line', stake: 0.02 }),
  ];
  const candidate = makeSlot({ pickId: 'c1', participantId: null, teamId: 'LAL', marketFamily: 'game-line', stake: 0.02 });

  const signals = computeConcentrationSignals(board, candidate);
  assert.equal(signals.playerConcentration, 0);
});

test('computeConcentrationSignals: sport concentration computed correctly', () => {
  const board = [
    makeSlot({ pickId: 'b1', sport: 'NBA', participantId: null, teamId: null, stake: 0.02 }),
    makeSlot({ pickId: 'b2', sport: 'NBA', participantId: null, teamId: null, stake: 0.02 }),
    makeSlot({ pickId: 'b3', sport: 'NFL', participantId: null, teamId: null, stake: 0.02 }),
  ];
  const candidate = makeSlot({ pickId: 'c1', sport: 'NBA', participantId: null, teamId: null, stake: 0.02 });

  const signals = computeConcentrationSignals(board, candidate);
  // 3 NBA out of 4 total = 0.75
  assert.equal(signals.sportConcentration, 0.75);
  assert.ok(signals.sportConcentration > CONCENTRATION_LIMITS.sport);
});

// ─── computeConcentrationPenalty ────────────────────────────────────────────

test('computeConcentrationPenalty: no breach → penaltyFactor is 1.0', () => {
  const signals = {
    playerConcentration: 0.1,
    teamConcentration: 0.2,
    sportConcentration: 0.3,
    marketFamilyConcentration: 0.4,
    maxSlotWeight: 0.1,
  };
  const result = computeConcentrationPenalty(signals);
  assert.equal(result.penaltyFactor, 1.0);
  assert.deepEqual(result.reason, []);
});

test('computeConcentrationPenalty: player breach → penalty applied', () => {
  const signals = {
    playerConcentration: 0.50,  // 25% over limit
    teamConcentration: 0.10,
    sportConcentration: 0.30,
    marketFamilyConcentration: 0.40,
    maxSlotWeight: 0.15,
  };
  const result = computeConcentrationPenalty(signals);
  // penaltyFactor = 1 - (0.50 - 0.25) = 1 - 0.25 = 0.75
  assert.equal(result.penaltyFactor, 0.75);
  assert.ok(result.reason.some(r => r.includes('player_concentration')));
});

test('computeConcentrationPenalty: team breach → half-rate penalty applied', () => {
  const signals = {
    playerConcentration: 0.10,
    teamConcentration: 0.60,   // 20% over limit of 0.40
    sportConcentration: 0.30,
    marketFamilyConcentration: 0.40,
    maxSlotWeight: 0.15,
  };
  const result = computeConcentrationPenalty(signals);
  // penaltyFactor = 1 - (0.60 - 0.40) * 0.5 = 1 - 0.10 = 0.90
  assert.equal(result.penaltyFactor, 0.9);
  assert.ok(result.reason.some(r => r.includes('team_concentration')));
});

test('computeConcentrationPenalty: sport breach → flat 5% reduction', () => {
  const signals = {
    playerConcentration: 0.10,
    teamConcentration: 0.20,
    sportConcentration: 0.70,   // over 0.60 limit
    marketFamilyConcentration: 0.40,
    maxSlotWeight: 0.15,
  };
  const result = computeConcentrationPenalty(signals);
  assert.equal(result.penaltyFactor, 0.95);
  assert.ok(result.reason.some(r => r.includes('sport_concentration')));
});

test('computeConcentrationPenalty: clamps penaltyFactor to minimum of 0.1', () => {
  // Extreme over-concentration on player (200% → penalty = 1 - 1.75 = deeply negative)
  const signals = {
    playerConcentration: 2.0,  // pathological
    teamConcentration: 2.0,
    sportConcentration: 2.0,
    marketFamilyConcentration: 1.0,
    maxSlotWeight: 1.0,
  };
  const result = computeConcentrationPenalty(signals);
  assert.ok(result.penaltyFactor >= 0.1);
});

test('computeConcentrationPenalty: clamps penaltyFactor to maximum of 1.0', () => {
  const signals = {
    playerConcentration: 0.0,
    teamConcentration: 0.0,
    sportConcentration: 0.0,
    marketFamilyConcentration: 0.0,
    maxSlotWeight: 0.0,
  };
  const result = computeConcentrationPenalty(signals);
  assert.ok(result.penaltyFactor <= 1.0);
  assert.equal(result.penaltyFactor, 1.0);
});

test('computeConcentrationPenalty: multiple breaches compound penalties', () => {
  const signals = {
    playerConcentration: 0.40,  // breach: excess 0.15
    teamConcentration: 0.55,    // breach: excess 0.15
    sportConcentration: 0.70,   // breach
    marketFamilyConcentration: 0.80,
    maxSlotWeight: 0.25,
  };
  const result = computeConcentrationPenalty(signals);
  // player: * (1 - 0.15) = * 0.85
  // team:   * (1 - 0.15*0.5) = * 0.925
  // sport:  * 0.95
  // combined: 0.85 * 0.925 * 0.95 ≈ 0.747
  assert.ok(result.penaltyFactor < 0.85);
  assert.ok(result.penaltyFactor >= 0.1);
  assert.equal(result.reason.length, 3);
});
