/**
 * UTV2-623: Tests for market-family-aware promotion weight modifiers.
 *
 * Uses node:test + node:assert/strict per project conventions.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyMarketFamily,
  isSupportedSport,
  applyPromotionModifiers,
  MARKET_FAMILY_PROMOTION_MODIFIERS,
  UNSUPPORTED_SPORT_SCORE_CAP,
} from './promotion-weight-profiles.js';

// ─── classifyMarketFamily ─────────────────────────────────────────────────────

test('classifyMarketFamily: moneyline → game-line', () => {
  assert.equal(classifyMarketFamily('moneyline'), 'game-line');
});

test('classifyMarketFamily: spread → game-line', () => {
  assert.equal(classifyMarketFamily('spread'), 'game-line');
});

test('classifyMarketFamily: game_total → game-line', () => {
  assert.equal(classifyMarketFamily('game_total'), 'game-line');
});

test('classifyMarketFamily: game-total → game-line', () => {
  assert.equal(classifyMarketFamily('game-total'), 'game-line');
});

test('classifyMarketFamily: total → game-line', () => {
  assert.equal(classifyMarketFamily('total'), 'game-line');
});

test('classifyMarketFamily: game_total_ou (canonical normalized) → game-line', () => {
  assert.equal(classifyMarketFamily('game_total_ou'), 'game-line');
});

test('classifyMarketFamily: points-all-game-ou → player-prop', () => {
  assert.equal(classifyMarketFamily('points-all-game-ou'), 'player-prop');
});

test('classifyMarketFamily: assists-all-game-ou → player-prop', () => {
  assert.equal(classifyMarketFamily('assists-all-game-ou'), 'player-prop');
});

test('classifyMarketFamily: batting-hits-all-game-ou → player-prop', () => {
  assert.equal(classifyMarketFamily('batting-hits-all-game-ou'), 'player-prop');
});

test('classifyMarketFamily: pitching-strikeouts-all-game-ou → player-prop', () => {
  assert.equal(classifyMarketFamily('pitching-strikeouts-all-game-ou'), 'player-prop');
});

test('classifyMarketFamily: player.points → player-prop', () => {
  assert.equal(classifyMarketFamily('player.points'), 'player-prop');
});

test('classifyMarketFamily: player.rebounds → player-prop', () => {
  assert.equal(classifyMarketFamily('player.rebounds'), 'player-prop');
});

test('classifyMarketFamily: team_total_ou → team-prop', () => {
  assert.equal(classifyMarketFamily('team_total_ou'), 'team-prop');
});

test('classifyMarketFamily: team_total → team-prop', () => {
  assert.equal(classifyMarketFamily('team_total'), 'team-prop');
});

test('classifyMarketFamily: empty string → unknown', () => {
  assert.equal(classifyMarketFamily(''), 'unknown');
});

test('classifyMarketFamily: unrecognized key → unknown', () => {
  assert.equal(classifyMarketFamily('some-exotic-futures-market'), 'unknown');
});

test('classifyMarketFamily: case-insensitive for moneyline', () => {
  assert.equal(classifyMarketFamily('Moneyline'), 'game-line');
  assert.equal(classifyMarketFamily('MONEYLINE'), 'game-line');
});

// ─── MARKET_FAMILY_PROMOTION_MODIFIERS caps ───────────────────────────────────

test('unknown market family maxScoreCap is 72', () => {
  assert.equal(MARKET_FAMILY_PROMOTION_MODIFIERS['unknown'].maxScoreCap, 72);
});

test('game-line maxScoreCap is 100', () => {
  assert.equal(MARKET_FAMILY_PROMOTION_MODIFIERS['game-line'].maxScoreCap, 100);
});

test('player-prop maxScoreCap is 100', () => {
  assert.equal(MARKET_FAMILY_PROMOTION_MODIFIERS['player-prop'].maxScoreCap, 100);
});

test('team-prop maxScoreCap is 100', () => {
  assert.equal(MARKET_FAMILY_PROMOTION_MODIFIERS['team-prop'].maxScoreCap, 100);
});

// ─── isSupportedSport ────────────────────────────────────────────────────────

test('isSupportedSport: NBA is supported', () => {
  assert.equal(isSupportedSport('NBA'), true);
});

test('isSupportedSport: NFL is supported', () => {
  assert.equal(isSupportedSport('NFL'), true);
});

test('isSupportedSport: MLB is supported', () => {
  assert.equal(isSupportedSport('MLB'), true);
});

test('isSupportedSport: NHL is supported', () => {
  assert.equal(isSupportedSport('NHL'), true);
});

test('isSupportedSport: lowercase nba is supported (case-insensitive)', () => {
  assert.equal(isSupportedSport('nba'), true);
});

test('isSupportedSport: MMA is not supported', () => {
  assert.equal(isSupportedSport('MMA'), false);
});

test('isSupportedSport: null/undefined returns false', () => {
  assert.equal(isSupportedSport(null), false);
  assert.equal(isSupportedSport(undefined), false);
  assert.equal(isSupportedSport(''), false);
});

// ─── applyPromotionModifiers: unsupported sport cap ──────────────────────────

test('unsupported sport gets score capped at UNSUPPORTED_SPORT_SCORE_CAP', () => {
  // weighted components that would sum well above 60
  const weighted = { edge: 30, trust: 25, readiness: 20, uniqueness: 10, boardFit: 10 };
  // raw total = 95, expected cap = 60 (UNSUPPORTED_SPORT_SCORE_CAP)
  const result = applyPromotionModifiers(weighted, 'moneyline', 'MMA');

  assert.equal(result.provenance.unsupportedSlice, true);
  assert.equal(result.provenance.capApplied, true);
  assert.equal(result.provenance.capValue, UNSUPPORTED_SPORT_SCORE_CAP);
  assert.ok(result.total <= UNSUPPORTED_SPORT_SCORE_CAP, `total ${result.total} should be ≤ ${UNSUPPORTED_SPORT_SCORE_CAP}`);
});

// ─── applyPromotionModifiers: supported sport + known market family ───────────

test('supported sport + known market family does NOT get score capped', () => {
  // weighted components summing to ~75 — below any cap concern
  const weighted = { edge: 26, trust: 18, readiness: 15, uniqueness: 8, boardFit: 8 };
  const result = applyPromotionModifiers(weighted, 'moneyline', 'NBA');

  assert.equal(result.provenance.unsupportedSlice, false);
  assert.equal(result.provenance.capApplied, false);
  assert.equal(result.provenance.capValue, null);
  assert.equal(result.provenance.marketFamily, 'game-line');
});

// ─── applyPromotionModifiers: unknown market family cap ──────────────────────

test('unknown market family caps score at 72 even for supported sport', () => {
  // weighted sum above 72 — cap should apply
  const weighted = { edge: 30, trust: 25, readiness: 20, uniqueness: 10, boardFit: 10 };
  // After 0.85 multipliers: ~95 * 0.85 ≈ 80.75 → should be capped to 72
  const result = applyPromotionModifiers(weighted, 'some-exotic-market', 'NBA');

  assert.equal(result.provenance.marketFamily, 'unknown');
  assert.equal(result.provenance.unsupportedSlice, false);
  assert.equal(result.provenance.capApplied, true);
  assert.equal(result.provenance.capValue, 72);
  assert.ok(result.total <= 72, `total ${result.total} should be ≤ 72`);
});

// ─── applyPromotionModifiers: provenance tracking ────────────────────────────

test('provenance always has modifiersApplied=true', () => {
  const weighted = { edge: 10, trust: 10, readiness: 10, uniqueness: 5, boardFit: 5 };
  const result = applyPromotionModifiers(weighted, 'spread', 'NFL');
  assert.equal(result.provenance.modifiersApplied, true);
});

test('provenance sport field reflects input sport string', () => {
  const weighted = { edge: 10, trust: 10, readiness: 10, uniqueness: 5, boardFit: 5 };
  const result = applyPromotionModifiers(weighted, 'moneyline', 'MLB');
  assert.equal(result.provenance.sport, 'MLB');
});

test('provenance sport field is empty string when sport is null', () => {
  const weighted = { edge: 10, trust: 10, readiness: 10, uniqueness: 5, boardFit: 5 };
  const result = applyPromotionModifiers(weighted, 'moneyline', null);
  assert.equal(result.provenance.sport, '');
  assert.equal(result.provenance.unsupportedSlice, true);
});

// ─── applyPromotionModifiers: player-prop multipliers ────────────────────────

test('player-prop trust multiplier 1.1 increases trust component', () => {
  const weighted = { edge: 10, trust: 20, readiness: 10, uniqueness: 5, boardFit: 5 };
  const result = applyPromotionModifiers(weighted, 'points-all-game-ou', 'NBA');
  // trust should be 20 * 1.1 = 22
  assert.equal(result.trust, 22);
});

// ─── applyPromotionModifiers: game-line edge multiplier ──────────────────────

test('game-line edge multiplier 1.1 increases edge component', () => {
  const weighted = { edge: 20, trust: 10, readiness: 10, uniqueness: 5, boardFit: 5 };
  const result = applyPromotionModifiers(weighted, 'moneyline', 'NFL');
  // edge should be 20 * 1.1 = 22
  assert.equal(result.edge, 22);
});

// ─── UNSUPPORTED_SPORT_SCORE_CAP constant ────────────────────────────────────

test('UNSUPPORTED_SPORT_SCORE_CAP is 60', () => {
  assert.equal(UNSUPPORTED_SPORT_SCORE_CAP, 60);
});
