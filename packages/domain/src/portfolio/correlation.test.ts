import assert from 'node:assert/strict';
import test from 'node:test';
import { computePortfolioCorrelation } from './correlation.js';
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

// ─── Empty board ──────────────────────────────────────────────────────────────

test('computePortfolioCorrelation: empty board → no correlation, no penalty', () => {
  const candidate = makeSlot({ pickId: 'c1', participantId: 'player-A' });
  const result = computePortfolioCorrelation([], candidate);

  assert.equal(result.correlatedCount, 0);
  assert.equal(result.maxCorrelation, 0);
  assert.equal(result.portfolioCorrelationPenalty, 1.0);
  assert.deepEqual(result.correlatedPickIds, []);
});

// ─── Same player ──────────────────────────────────────────────────────────────

test('computePortfolioCorrelation: same player on board → high correlation, penalty applied', () => {
  const board = [
    makeSlot({ pickId: 'b1', participantId: 'player-A', teamId: 'LAL' }),
  ];
  const candidate = makeSlot({ pickId: 'c1', participantId: 'player-A', teamId: 'LAL' });

  const result = computePortfolioCorrelation(board, candidate);

  assert.equal(result.correlatedCount, 1);
  assert.equal(result.maxCorrelation, 0.8);
  assert.ok(result.portfolioCorrelationPenalty < 1.0);
  assert.deepEqual(result.correlatedPickIds, ['b1']);
});

// ─── Different sport ──────────────────────────────────────────────────────────

test('computePortfolioCorrelation: different sport → zero correlation coefficient', () => {
  const board = [
    makeSlot({ pickId: 'b1', sport: 'NFL', participantId: 'player-X', teamId: 'NE' }),
  ];
  const candidate = makeSlot({ pickId: 'c1', sport: 'NBA', participantId: 'player-Y', teamId: 'LAL' });

  const result = computePortfolioCorrelation(board, candidate);

  assert.equal(result.maxCorrelation, 0);
  assert.equal(result.correlatedCount, 0);
  assert.equal(result.portfolioCorrelationPenalty, 1.0);
});

// ─── Same sport, same market family ──────────────────────────────────────────

test('computePortfolioCorrelation: same sport + same game-line family → moderate correlation', () => {
  const board = [
    makeSlot({ pickId: 'b1', sport: 'NBA', marketFamily: 'game-line', participantId: null, teamId: 'LAL' }),
  ];
  const candidate = makeSlot({
    pickId: 'c1',
    sport: 'NBA',
    marketFamily: 'game-line',
    participantId: null,
    teamId: 'GSW',
  });

  const result = computePortfolioCorrelation(board, candidate);

  assert.equal(result.maxCorrelation, 0.4);
  assert.equal(result.correlatedCount, 1);
  assert.ok(result.portfolioCorrelationPenalty < 1.0);
});

// ─── Same sport, different market family ─────────────────────────────────────

test('computePortfolioCorrelation: same sport, different market family → low correlation', () => {
  const board = [
    makeSlot({ pickId: 'b1', sport: 'NBA', marketFamily: 'game-line', participantId: null }),
  ];
  const candidate = makeSlot({ pickId: 'c1', sport: 'NBA', marketFamily: 'player-prop', participantId: 'player-Z' });

  const result = computePortfolioCorrelation(board, candidate);

  assert.equal(result.maxCorrelation, 0.2);
  assert.equal(result.correlatedCount, 1);
});

// ─── Same team, same market family ───────────────────────────────────────────

test('computePortfolioCorrelation: same team + same market family → 0.6 coefficient', () => {
  const board = [
    makeSlot({ pickId: 'b1', sport: 'NBA', marketFamily: 'team-prop', participantId: null, teamId: 'LAL' }),
  ];
  const candidate = makeSlot({
    pickId: 'c1',
    sport: 'NBA',
    marketFamily: 'team-prop',
    participantId: null,
    teamId: 'LAL',
  });

  const result = computePortfolioCorrelation(board, candidate);

  assert.equal(result.maxCorrelation, 0.6);
  assert.equal(result.correlatedCount, 1);
  assert.ok(result.portfolioCorrelationPenalty < 1.0);
});

// ─── Multiple correlated picks ────────────────────────────────────────────────

test('computePortfolioCorrelation: multiple correlated picks compound penalty', () => {
  const board = [
    makeSlot({ pickId: 'b1', sport: 'NBA', marketFamily: 'game-line', participantId: null, teamId: 'A' }),
    makeSlot({ pickId: 'b2', sport: 'NBA', marketFamily: 'game-line', participantId: null, teamId: 'B' }),
    makeSlot({ pickId: 'b3', sport: 'NBA', marketFamily: 'game-line', participantId: null, teamId: 'C' }),
    makeSlot({ pickId: 'b4', sport: 'NFL', marketFamily: 'game-line', participantId: null, teamId: 'D' }),
  ];
  const candidate = makeSlot({
    pickId: 'c1',
    sport: 'NBA',
    marketFamily: 'game-line',
    participantId: null,
    teamId: 'E',
  });

  const result = computePortfolioCorrelation(board, candidate);

  // 3 NBA game-line picks correlated at 0.4 each; 1 NFL pick at 0
  assert.equal(result.correlatedCount, 3);
  assert.equal(result.maxCorrelation, 0.4);
  // correlationMass = 3 * 0.4 = 1.2; penaltyAmount = min(0.9, 1.2*0.15) = 0.18
  // penalty factor = 1 - 0.18 = 0.82
  assert.ok(result.portfolioCorrelationPenalty < 1.0);
  assert.equal(result.portfolioCorrelationPenalty, 0.82);
});

// ─── Self-pick exclusion ──────────────────────────────────────────────────────

test('computePortfolioCorrelation: candidate pickId skipped if present in board', () => {
  const board = [
    makeSlot({ pickId: 'c1', participantId: 'player-A' }), // same id as candidate
    makeSlot({ pickId: 'b2', participantId: 'player-B' }),
  ];
  const candidate = makeSlot({ pickId: 'c1', participantId: 'player-A' });

  const result = computePortfolioCorrelation(board, candidate);

  // b2 is different player/sport → same sport, different participant, same market family → 0.3
  assert.ok(!result.correlatedPickIds.includes('c1'));
});

// ─── Penalty floor ────────────────────────────────────────────────────────────

test('computePortfolioCorrelation: portfolioCorrelationPenalty never below 0.1', () => {
  // 7 same-player picks → mass = 7*0.8=5.6 → penaltyAmount = min(0.9, 5.6*0.15=0.84)=0.84
  // penalty factor = max(0.1, 1-0.84) = 0.16
  const board = Array.from({ length: 7 }, (_, i) =>
    makeSlot({ pickId: `b${i}`, participantId: 'player-A', teamId: 'LAL' }),
  );
  const candidate = makeSlot({ pickId: 'c1', participantId: 'player-A', teamId: 'LAL' });

  const result = computePortfolioCorrelation(board, candidate);

  assert.ok(result.portfolioCorrelationPenalty >= 0.1);
});
