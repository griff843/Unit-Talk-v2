import assert from 'node:assert/strict';
import test from 'node:test';
import { MARKET_KEY_MAP, normalizeMarketKey } from './market-key.js';

test('normalizeMarketKey maps known NBA markets to canonical keys', () => {
  assert.equal(normalizeMarketKey('NBA points'), 'points-all-game-ou');
  assert.equal(normalizeMarketKey('NBA assists'), 'assists-all-game-ou');
  assert.equal(normalizeMarketKey('NBA PRA'), 'pra-all-game-ou');
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

test('MARKET_KEY_MAP includes the full ratified translation table', () => {
  assert.equal(Object.keys(MARKET_KEY_MAP).length, 16);
  assert.equal(MARKET_KEY_MAP['NBA blocks'], 'blocks-all-game-ou');
  assert.equal(MARKET_KEY_MAP['NBA RA'], 'ra-all-game-ou');
  assert.equal(MARKET_KEY_MAP['MLB batting RBI'], 'batting-rbi-all-game-ou');
  assert.equal(MARKET_KEY_MAP['MLB batting walks'], 'batting-walks-all-game-ou');
});
