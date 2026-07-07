import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESPONSIBLE_FOOTER,
  buildDiscordPreview,
  formatAmericanOdds,
  formatSelectionLine,
  tierAccentColor,
} from './discord-preview-model.js';

test('formatAmericanOdds signs positive odds', () => {
  assert.equal(formatAmericanOdds(120), '+120');
  assert.equal(formatAmericanOdds(-110), '-110');
});

test('formatSelectionLine composes selection, line, odds and tolerates gaps', () => {
  assert.equal(formatSelectionLine('Over', 8.5, -110), 'Over 8.5 (-110)');
  assert.equal(formatSelectionLine('Over', null, -110), 'Over (-110)');
  assert.equal(formatSelectionLine(null, null, 150), '(+150)');
  assert.equal(formatSelectionLine('ML', null, null), 'ML');
});

test('tierAccentColor maps known tiers and falls back for unknown/null', () => {
  assert.equal(tierAccentColor('gold'), '#eab308');
  assert.equal(tierAccentColor('GOLD'), '#eab308');
  assert.equal(tierAccentColor('mystery'), '#64748b');
  assert.equal(tierAccentColor(null), '#64748b');
});

test('buildDiscordPreview pulls tier/book/risk/reasoning from metadata and flags missing', () => {
  const p = buildDiscordPreview({
    market: 'total_runs',
    selection: 'Over',
    line: 8.5,
    odds: -110,
    eventName: 'NYY @ BOS',
    metadata: { tierDestination: 'gold', book: 'DK', thesis: 'edge', riskRating: 'low' },
  });
  assert.equal(p.title, 'NYY @ BOS');
  assert.equal(p.tierDestination, 'gold');
  assert.equal(p.book, 'DK');
  assert.equal(p.reasoning, 'edge');
  assert.deepEqual(p.missing, []);
  assert.equal(p.footer, RESPONSIBLE_FOOTER);
  assert.equal(p.accentColor, '#eab308');
});

test('buildDiscordPreview marks absent fields Data Missing', () => {
  const p = buildDiscordPreview({ market: 'spread', selection: null, metadata: null });
  assert.equal(p.title, 'spread');
  assert.ok(p.missing.includes('Selection'));
  assert.ok(p.missing.includes('Book'));
  assert.ok(p.missing.includes('Tier'));
  assert.ok(p.missing.includes('Reasoning'));
  assert.ok(!p.missing.includes('Market'));
});
