import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeSuppression, NO_REASON_RECORDED } from './suppression';

// The contract requirement these tests encode:
//   Review queue | Suppressed picks with suppressionReason rendered (non-null, non-blank)
// Each test names a row shape that must NOT be reported as satisfying it.

test('a suppressed pick with a real reason reports that reason and no defect', () => {
  const d = describeSuppression('suppressed', 'exposure-cap-daily');
  assert.equal(d.suppressed, true);
  assert.equal(d.reason, 'exposure-cap-daily');
  assert.equal(d.missingReason, false);
});

test('not_eligible also owes a reason', () => {
  const d = describeSuppression('not_eligible', 'below-score-floor');
  assert.equal(d.suppressed, true);
  assert.equal(d.reason, 'below-score-floor');
  assert.equal(d.missingReason, false);
});

test('a suppressed pick with a null reason is a defect, not a blank', () => {
  const d = describeSuppression('suppressed', null);
  assert.equal(d.suppressed, true);
  assert.equal(d.reason, null);
  assert.equal(
    d.missingReason,
    true,
    'a suppressed pick with no reason must be reported as missing, not rendered as an em dash',
  );
});

test('a whitespace-only reason is blank, which is what "non-blank" in the contract means', () => {
  // This is the case a naive `reason != null` check passes and an operator learns nothing from.
  const d = describeSuppression('suppressed', '   ');
  assert.equal(d.reason, null);
  assert.equal(d.missingReason, true);
});

test('an empty-string reason is treated the same as a missing one', () => {
  const d = describeSuppression('suppressed', '');
  assert.equal(d.reason, null);
  assert.equal(d.missingReason, true);
});

test('a non-suppressed pick owes no reason even when it has none', () => {
  const d = describeSuppression('promoted', null);
  assert.equal(d.suppressed, false);
  assert.equal(d.missingReason, false);
});

test('a non-suppressed pick that happens to carry a reason still does not report a defect', () => {
  const d = describeSuppression('promoted', 'routed to official-picks');
  assert.equal(d.suppressed, false);
  assert.equal(d.reason, 'routed to official-picks');
  assert.equal(d.missingReason, false);
});

test('status matching is case- and whitespace-insensitive', () => {
  assert.equal(describeSuppression('  Suppressed  ', null).suppressed, true);
  assert.equal(describeSuppression('NOT_ELIGIBLE', null).suppressed, true);
});

test('a missing or non-string status is not silently treated as suppressed', () => {
  // Fail-open here is correct: inventing a suppression the row does not claim would put a red
  // "no reason recorded" defect on every pick whose status failed to load.
  assert.equal(describeSuppression(null, null).suppressed, false);
  assert.equal(describeSuppression(undefined, null).suppressed, false);
  assert.equal(describeSuppression(undefined, undefined).missingReason, false);
});

test('a non-string reason does not leak into the rendered label', () => {
  const d = describeSuppression('suppressed', undefined);
  assert.equal(d.reason, null);
  assert.equal(d.missingReason, true);
});

test('the missing-reason label is a stated defect, not a placeholder glyph', () => {
  assert.equal(NO_REASON_RECORDED, 'no reason recorded');
  assert.notEqual(NO_REASON_RECORDED, '—');
});
