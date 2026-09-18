import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderClvSummary, isClvUnresolved, type ClvSummaryInput } from './clv-summary';

test('a measured CLV renders the number and the line verdict', () => {
  assert.equal(
    renderClvSummary({ clvPercent: 2.5, beatsClosingLine: true }),
    '2.50% (beats line)',
  );
  assert.equal(
    renderClvSummary({ clvPercent: -1.125, beatsClosingLine: false }),
    '-1.13% (behind line)',
  );
});

test('a CLV measured against the opening line says so', () => {
  assert.equal(
    renderClvSummary({ clvPercent: 3, beatsClosingLine: true, isOpeningLineFallback: true }),
    '3.00% (beats line via opening fallback)',
  );
});

test('a CLV with no closing-line verdict does not claim one', () => {
  assert.equal(renderClvSummary({ clvPercent: 0, beatsClosingLine: null }), '0.00% (CLV present)');
});

test('zero CLV is a measurement, not an absence', () => {
  // The whole point of the unresolved branch: 0.00% must not read as "missing".
  const zero: ClvSummaryInput = { clvPercent: 0 };
  assert.equal(isClvUnresolved(zero), false);
  assert.notEqual(renderClvSummary(zero), 'missing');
});

test('an absent CLV names its reason rather than rendering a dash', () => {
  assert.equal(
    renderClvSummary({ clvPercent: null, clvUnavailableReason: 'no_closing_line_captured' }),
    'missing (no_closing_line_captured)',
  );
  assert.equal(renderClvSummary({ clvPercent: null, clvStatus: 'pending' }), 'pending');
  assert.equal(renderClvSummary({ clvPercent: null }), 'missing');
  assert.equal(renderClvSummary({ clvPercent: null, hasClv: true }), 'present');
});

test('a missing settlement row is missing, not an empty string', () => {
  assert.equal(renderClvSummary(undefined), 'missing');
  assert.equal(renderClvSummary(null), 'missing');
  assert.equal(isClvUnresolved(undefined), true);
});

test('production shape today: every settled pick is unresolved', () => {
  // All six settled governed picks carry clvPercent null with no reason recorded,
  // because closing-line capture depends on a provider that is deliberately off.
  const productionShape: ClvSummaryInput = {
    clvPercent: null,
    beatsClosingLine: null,
    isOpeningLineFallback: null,
    clvStatus: null,
    clvUnavailableReason: null,
  };
  assert.equal(isClvUnresolved(productionShape), true);
  assert.equal(renderClvSummary(productionShape), 'missing');
});
