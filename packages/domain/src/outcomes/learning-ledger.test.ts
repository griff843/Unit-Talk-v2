import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyMiss,
  summarizeLedger,
  type LedgerEntry,
} from './learning-ledger.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides?: Partial<LedgerEntry>): LedgerEntry {
  return {
    pickId: 'pick-001',
    sport: 'NBA',
    marketFamily: 'player-prop',
    modelProbability: 0.58,
    marketProbability: 0.52,
    statAlpha: 0.06,
    clvPercent: 1.5,
    clvStatus: 'computed',
    isOpeningLineFallback: false,
    outcome: 'WIN',
    pnlUnits: 0.91,
    missCategory: null,
    missReason: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// classifyMiss — non-loss
// ---------------------------------------------------------------------------

test('classifyMiss: returns unknown for WIN outcome', () => {
  const result = classifyMiss(makeEntry({ outcome: 'WIN' }));
  assert.equal(result.category, 'unknown');
  assert.equal(result.reason, 'not_a_loss');
});

test('classifyMiss: returns unknown for PUSH outcome', () => {
  const result = classifyMiss(makeEntry({ outcome: 'PUSH' }));
  assert.equal(result.category, 'unknown');
  assert.equal(result.reason, 'not_a_loss');
});

test('classifyMiss: returns unknown for null outcome', () => {
  const result = classifyMiss(makeEntry({ outcome: null }));
  assert.equal(result.category, 'unknown');
  assert.equal(result.reason, 'not_a_loss');
});

// ---------------------------------------------------------------------------
// classifyMiss — stale_line
// ---------------------------------------------------------------------------

test('classifyMiss: returns stale_line when opening line fallback used (even with CLV)', () => {
  const result = classifyMiss(
    makeEntry({ outcome: 'LOSS', isOpeningLineFallback: true, clvPercent: 1.5 }),
  );
  assert.equal(result.category, 'stale_line');
  assert.equal(result.reason, 'opening_line_fallback_used');
});

// ---------------------------------------------------------------------------
// classifyMiss — bad_price
// ---------------------------------------------------------------------------

test('classifyMiss: returns bad_price when CLV < -2%', () => {
  const result = classifyMiss(makeEntry({ outcome: 'LOSS', clvPercent: -3.5 }));
  assert.equal(result.category, 'bad_price');
  assert.ok(result.reason.startsWith('clv_'), `unexpected reason: ${result.reason}`);
});

test('classifyMiss: does not return bad_price when CLV is exactly -2%', () => {
  const result = classifyMiss(makeEntry({ outcome: 'LOSS', clvPercent: -2.0 }));
  // -2.0 is NOT < -2.0, so should not be bad_price
  assert.notEqual(result.category, 'bad_price');
});

// ---------------------------------------------------------------------------
// classifyMiss — thin_data
// ---------------------------------------------------------------------------

test('classifyMiss: returns thin_data when CLV is null', () => {
  const result = classifyMiss(
    makeEntry({ outcome: 'LOSS', clvPercent: null, clvStatus: 'missing_closing_line' }),
  );
  assert.equal(result.category, 'thin_data');
  assert.equal(result.reason, 'clv_missing_closing_line');
});

test('classifyMiss: thin_data reason falls back to "missing" when clvStatus is null', () => {
  const result = classifyMiss(
    makeEntry({ outcome: 'LOSS', clvPercent: null, clvStatus: null }),
  );
  assert.equal(result.category, 'thin_data');
  assert.equal(result.reason, 'clv_missing');
});

// ---------------------------------------------------------------------------
// classifyMiss — wrong_matchup_read
// ---------------------------------------------------------------------------

test('classifyMiss: returns wrong_matchup_read when statAlpha > 0.08 and CLV is available', () => {
  const result = classifyMiss(
    makeEntry({ outcome: 'LOSS', clvPercent: 0.5, statAlpha: 0.12 }),
  );
  assert.equal(result.category, 'wrong_matchup_read');
  assert.ok(result.reason.startsWith('stat_alpha_'));
});

test('classifyMiss: does not return wrong_matchup_read when statAlpha <= 0.08', () => {
  const result = classifyMiss(
    makeEntry({ outcome: 'LOSS', clvPercent: 0.5, statAlpha: 0.08 }),
  );
  assert.notEqual(result.category, 'wrong_matchup_read');
});

// ---------------------------------------------------------------------------
// classifyMiss — noise
// ---------------------------------------------------------------------------

test('classifyMiss: returns noise when no identifiable cause found', () => {
  const result = classifyMiss(
    makeEntry({ outcome: 'LOSS', clvPercent: 0.8, statAlpha: 0.03 }),
  );
  assert.equal(result.category, 'noise');
  assert.equal(result.reason, 'no_systematic_cause');
});

// ---------------------------------------------------------------------------
// summarizeLedger — basic metrics
// ---------------------------------------------------------------------------

test('summarizeLedger: computes winRate correctly', () => {
  const entries = [
    makeEntry({ outcome: 'WIN' }),
    makeEntry({ outcome: 'WIN' }),
    makeEntry({ outcome: 'LOSS' }),
    makeEntry({ outcome: 'PUSH' }),  // excluded from settled
  ];

  const summary = summarizeLedger(entries);

  assert.equal(summary.totalPicks, 4);
  assert.equal(summary.settledPicks, 3);          // WIN+WIN+LOSS
  assert.ok(Math.abs((summary.winRate ?? 0) - 2 / 3) < 1e-9);
});

test('summarizeLedger: winRate is null when no settled picks', () => {
  const entries = [
    makeEntry({ outcome: 'PUSH' }),
    makeEntry({ outcome: null }),
  ];

  const summary = summarizeLedger(entries);
  assert.equal(summary.winRate, null);
  assert.equal(summary.settledPicks, 0);
});

test('summarizeLedger: computes avgCLVPercent correctly', () => {
  const entries = [
    makeEntry({ clvPercent: 2.0 }),
    makeEntry({ clvPercent: -1.0 }),
    makeEntry({ clvPercent: null }),
  ];

  const summary = summarizeLedger(entries);
  assert.equal(summary.avgCLVPercent, 0.5);
});

test('summarizeLedger: avgCLVPercent is null when all CLV values are null', () => {
  const entries = [
    makeEntry({ clvPercent: null }),
    makeEntry({ clvPercent: null }),
  ];

  const summary = summarizeLedger(entries);
  assert.equal(summary.avgCLVPercent, null);
});

test('summarizeLedger: computes clvCoverageRate correctly', () => {
  const entries = [
    makeEntry({ clvPercent: 1.5 }),
    makeEntry({ clvPercent: null }),
    makeEntry({ clvPercent: null }),
    makeEntry({ clvPercent: 2.0 }),
  ];

  const summary = summarizeLedger(entries);
  assert.equal(summary.clvCoverageRate, 0.5);
});

test('summarizeLedger: clvCoverageRate is 0 on empty entries', () => {
  const summary = summarizeLedger([]);
  assert.equal(summary.clvCoverageRate, 0);
});

// ---------------------------------------------------------------------------
// summarizeLedger — miss taxonomy
// ---------------------------------------------------------------------------

test('summarizeLedger: topMissCategory reflects highest-count actionable category', () => {
  const entries = [
    makeEntry({ missCategory: 'bad_price' }),
    makeEntry({ missCategory: 'bad_price' }),
    makeEntry({ missCategory: 'stale_line' }),
    makeEntry({ missCategory: 'noise' }),   // excluded from top
    makeEntry({ missCategory: 'unknown' }), // excluded from top
  ];

  const summary = summarizeLedger(entries);
  assert.equal(summary.topMissCategory, 'bad_price');
  assert.equal(summary.topMissCount, 2);
});

test('summarizeLedger: topMissCategory is null when only noise and unknown', () => {
  const entries = [
    makeEntry({ missCategory: 'noise' }),
    makeEntry({ missCategory: 'unknown' }),
  ];

  const summary = summarizeLedger(entries);
  assert.equal(summary.topMissCategory, null);
  assert.equal(summary.topMissCount, 0);
});

test('summarizeLedger: missCategoryBreakdown contains all expected keys', () => {
  const entries = [makeEntry({ missCategory: 'stale_line' })];
  const summary = summarizeLedger(entries);

  const expectedKeys = [
    'bad_price', 'wrong_matchup_read', 'bad_injury_assumption',
    'stale_line', 'thin_data', 'noise', 'unknown',
  ];
  for (const key of expectedKeys) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(summary.missCategoryBreakdown, key),
      `Missing key: ${key}`,
    );
  }
  assert.equal(summary.missCategoryBreakdown.stale_line, 1);
  assert.equal(summary.missCategoryBreakdown.bad_price, 0);
});
