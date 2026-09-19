import test from 'node:test';
import assert from 'node:assert/strict';

import { isPickAlreadySettled } from './settlement-state.js';

test('a settled lifecycle status is settled', () => {
  assert.equal(isPickAlreadySettled('settled', 0), true);
});

test('a validated pick carrying a settlement record is settled — the Track Only case', () => {
  // This is the defect the module exists for. Five of the six settled governed
  // picks in production sit at `validated`, because a Track Only pick is never
  // `posted` and so can never be advanced to `settled`.
  assert.equal(isPickAlreadySettled('validated', 1), true);
});

test('a validated pick with no settlement record is not settled', () => {
  assert.equal(isPickAlreadySettled('validated', 0), false);
});

test('a posted pick awaiting its result is not settled', () => {
  assert.equal(isPickAlreadySettled('posted', 0), false);
});

test('settlement evidence outweighs an unrecognised lifecycle status', () => {
  // The record is the authority. An status this surface does not know about
  // must not erase a settlement that demonstrably happened.
  assert.equal(isPickAlreadySettled('some-future-status', 2), true);
});

test('an unreadable settlement count never claims a settlement', () => {
  assert.equal(isPickAlreadySettled('validated', Number.NaN), false);
  assert.equal(isPickAlreadySettled('validated', Number.POSITIVE_INFINITY), false);
});

test('a missing lifecycle status is not itself evidence either way', () => {
  assert.equal(isPickAlreadySettled(null, 0), false);
  assert.equal(isPickAlreadySettled(undefined, 1), true);
});

test('no operator surface decides settlement state for itself', async () => {
  // Acceptance 2, enforced mechanically rather than in prose. These two pages
  // had already drifted once: `/settlement` derived the fact and `/picks/[id]`
  // passed a literal `false`. A future edit that hard-codes the prop, or
  // re-derives the predicate inline, fails here instead of silently telling an
  // operator that a settled pick is unsettled.
  const { readFile } = await import('node:fs/promises');
  const surfaces = [
    new URL('../app/picks/[id]/page.tsx', import.meta.url),
    new URL('../app/settlement/page.tsx', import.meta.url),
  ];

  for (const surface of surfaces) {
    const source = await readFile(surface, 'utf8');
    assert.ok(
      source.includes('isPickAlreadySettled'),
      `${surface.pathname} must obtain settlement state from isPickAlreadySettled()`,
    );
    assert.doesNotMatch(
      source,
      /isAlreadySettled=\{(true|false)\}/,
      `${surface.pathname} must not hard-code isAlreadySettled`,
    );
    assert.doesNotMatch(
      source,
      /status === 'settled'\s*\|\|/,
      `${surface.pathname} must not re-derive the settled predicate inline`,
    );
  }
});
