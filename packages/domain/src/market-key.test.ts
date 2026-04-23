import assert from 'node:assert/strict';
import test from 'node:test';
import { MARKET_KEY_MAP, normalizeMarketKey } from './market-key.js';

test('normalizeMarketKey maps known NBA markets to canonical keys', () => {
  assert.equal(normalizeMarketKey('NBA points'), 'points-all-game-ou');
  assert.equal(normalizeMarketKey('NBA assists'), 'assists-all-game-ou');
  assert.equal(normalizeMarketKey('NBA PRA'), 'pra-all-game-ou');
});

test('normalizeMarketKey maps smart-form market ids onto grading-compatible keys', () => {
  assert.equal(normalizeMarketKey('player.points'), 'points-all-game-ou');
  assert.equal(normalizeMarketKey('player.points_assists'), 'pa-all-game-ou');
  assert.equal(normalizeMarketKey('game_total'), 'game_total_ou');
  assert.equal(normalizeMarketKey('totals'), 'game_total_ou');
  assert.equal(normalizeMarketKey('team_total'), 'team_total_ou');
});

test('normalizeMarketKey maps known MLB markets to canonical keys', () => {
  assert.equal(normalizeMarketKey('MLB batting hits'), 'batting-hits-all-game-ou');
  assert.equal(
    normalizeMarketKey('MLB pitching strikeouts'),
    'pitching-strikeouts-all-game-ou',
  );
  assert.equal(
    normalizeMarketKey('MLB pitching innings'),
    'pitching-innings-all-game-ou',
  );
});

test('normalizeMarketKey passes unknown markets through unchanged', () => {
  assert.equal(normalizeMarketKey('Tennis aces'), 'Tennis aces');
});

test('normalizeMarketKey canonicalizes moneyline labels across surfaces', () => {
  assert.equal(normalizeMarketKey('NBA - Moneyline'), 'moneyline');
  assert.equal(normalizeMarketKey('NFL moneyline'), 'moneyline');
});

test('MARKET_KEY_MAP includes legacy labels plus smart-form market ids', () => {
  assert.ok(Object.keys(MARKET_KEY_MAP).length >= 16);
  assert.equal(MARKET_KEY_MAP['NBA blocks'], 'blocks-all-game-ou');
  assert.equal(MARKET_KEY_MAP['NBA RA'], 'ra-all-game-ou');
  assert.equal(MARKET_KEY_MAP['MLB batting RBI'], 'batting-rbi-all-game-ou');
  assert.equal(MARKET_KEY_MAP['MLB batting walks'], 'batting-walks-all-game-ou');
  assert.equal(MARKET_KEY_MAP['player.points'], 'points-all-game-ou');
  assert.equal(MARKET_KEY_MAP['player.points_assists'], 'pa-all-game-ou');
  assert.equal(MARKET_KEY_MAP['game_total'], 'game_total_ou');
  assert.equal(MARKET_KEY_MAP['totals'], 'game_total_ou');
});

// ── UTV2-615: NHL + MLB strikeout entries ─────────────────────────────────────

test('normalizeMarketKey maps NHL player prop keys to canonical grading keys', () => {
  assert.equal(normalizeMarketKey('player.goals'), 'goals-all-game-ou');
  assert.equal(normalizeMarketKey('player.shots'), 'shots-all-game-ou');
  assert.equal(normalizeMarketKey('player.saves'), 'saves-all-game-ou');
  assert.equal(normalizeMarketKey('player.pim'), 'pim-all-game-ou');
});

test('normalizeMarketKey maps NHL display-string aliases to canonical grading keys', () => {
  assert.equal(normalizeMarketKey('NHL goals'), 'goals-all-game-ou');
  assert.equal(normalizeMarketKey('NHL shots on goal'), 'shots-all-game-ou');
  assert.equal(normalizeMarketKey('NHL saves'), 'saves-all-game-ou');
  assert.equal(normalizeMarketKey('NHL penalty minutes'), 'pim-all-game-ou');
});

test('normalizeMarketKey maps MLB batting strikeouts (batter, not pitcher)', () => {
  assert.equal(normalizeMarketKey('player.strikeouts'), 'batting-strikeouts-all-game-ou');
  assert.equal(normalizeMarketKey('MLB batting strikeouts'), 'batting-strikeouts-all-game-ou');
});

test('normalizeMarketKey passes through already-canonical SGO-format keys unchanged', () => {
  assert.equal(normalizeMarketKey('turnovers-all-game-ou'), 'turnovers-all-game-ou');
  assert.equal(normalizeMarketKey('points-all-game-ou'), 'points-all-game-ou');
  assert.equal(normalizeMarketKey('goals-all-game-ou'), 'goals-all-game-ou');
  assert.equal(normalizeMarketKey('saves-all-game-ou'), 'saves-all-game-ou');
  assert.equal(normalizeMarketKey('batting-strikeouts-all-game-ou'), 'batting-strikeouts-all-game-ou');
});
