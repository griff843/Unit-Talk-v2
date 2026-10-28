import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterCommands,
  moveActiveIndex,
  pickIdPrefixRange,
  pickSearchEntry,
  scoreEntry,
  scoreMatch,
  type CommandEntry,
} from './command-palette-model.js';

const ENTRIES: CommandEntry[] = [
  { href: '/', label: 'Executive Overview', group: 'Desk' },
  { href: '/fire-board', label: 'Fire Board', group: 'Desk', keywords: ['hot', 'top picks'] },
  { href: '/intel/line-movement', label: 'Line Movement', group: 'Intel' },
  { href: '/intel/ev-feed', label: 'EV Feed', group: 'Intel', keywords: ['expected value'] },
  { href: '/operations/outbox', label: 'Dispatch / Outbox', group: 'Operations' },
];

test('empty query returns all entries in registry order', () => {
  const results = filterCommands(ENTRIES, '');
  assert.equal(results.length, ENTRIES.length);
  assert.deepEqual(results.map((r) => r.href), ENTRIES.map((e) => e.href));
});

test('exact label match outranks substring match', () => {
  assert.ok(scoreMatch('Fire Board', 'fire board') > scoreMatch('Fireside Board', 'fire boa'));
});

test('prefix match ranks first', () => {
  const results = filterCommands(ENTRIES, 'fire');
  assert.equal(results[0]?.href, '/fire-board');
});

test('word-start match finds mid-label words', () => {
  const results = filterCommands(ENTRIES, 'movement');
  assert.equal(results[0]?.href, '/intel/line-movement');
});

test('keyword match surfaces aliased entries', () => {
  const results = filterCommands(ENTRIES, 'expected value');
  assert.equal(results[0]?.href, '/intel/ev-feed');
});

test('subsequence match catches terse operator typing', () => {
  assert.ok(scoreMatch('line movement', 'lnmv') > 0);
});

test('non-matching entries are dropped', () => {
  const results = filterCommands(ENTRIES, 'zzzzzz');
  assert.equal(results.length, 0);
});

test('scoreEntry never returns negative and query hits href path', () => {
  const entry: CommandEntry = { href: '/operations/outbox', label: 'Dispatch / Outbox', group: 'Operations' };
  assert.ok(scoreEntry(entry, 'outbox') > 0);
  assert.equal(scoreEntry(entry, '☃'), 0);
});

test('moveActiveIndex wraps both directions and handles empty lists', () => {
  assert.equal(moveActiveIndex(0, 1, 3), 1);
  assert.equal(moveActiveIndex(2, 1, 3), 0);
  assert.equal(moveActiveIndex(0, -1, 3), 2);
  assert.equal(moveActiveIndex(5, 1, 0), 0);
});

test('pickSearchEntry jumps to the picks explorer for an id fragment only', () => {
  const entry = pickSearchEntry(' 706B136B ');
  assert.equal(entry?.href, '/picks?q=706b136b');
  assert.equal(entry?.group, 'Picks');
  assert.equal(pickSearchEntry('dfcd9486-12')?.href, '/picks?q=dfcd9486-12');
  assert.equal(pickSearchEntry('abc12'), null);
  assert.equal(pickSearchEntry('settlement'), null);
  assert.equal(pickSearchEntry(''), null);
});

test('pickIdPrefixRange bounds every uuid that starts with the fragment', () => {
  assert.deepEqual(pickIdPrefixRange('FA5E1DD2-43'), {
    from: 'fa5e1dd2-4300-0000-0000-000000000000',
    to: 'fa5e1dd2-43ff-ffff-ffff-ffffffffffff',
  });
  const full = 'fa5e1dd2-4330-4fe5-978c-f4f168dca531';
  assert.deepEqual(pickIdPrefixRange(full), { from: full, to: full });
  assert.equal(pickIdPrefixRange('fa5e1'), null);
  assert.equal(pickIdPrefixRange('kingro623'), null);
});
