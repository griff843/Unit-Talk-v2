import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildEvidenceRef,
  resolveOperatorGradingContext,
} from './operator-grading-context.js';

const VALID = {
  outcomeBasis: 'Final box score, Chiefs covered -2.5 (27-20).',
  resultSourceUrl: 'https://www.nfl.com/games/chiefs-at-broncos-2026',
  observedAt: '2026-09-15T23:40:00.000Z',
};

test('a complete attestation resolves and carries every field through', () => {
  const res = resolveOperatorGradingContext(VALID);
  assert.equal(res.ok, true);
  assert.ok(res.ok);
  assert.deepEqual(res.context, VALID);
});

test('input is trimmed before validation, so whitespace is not an attestation', () => {
  const res = resolveOperatorGradingContext({
    outcomeBasis: '   ',
    resultSourceUrl: VALID.resultSourceUrl,
    observedAt: VALID.observedAt,
  });
  assert.equal(res.ok, false);
  assert.ok(!res.ok);
  assert.deepEqual(res.errors, ['operatorGradingContext.outcomeBasis is required']);
});

// Each field refused individually, and the error names the field. An operator
// told only "invalid context" retries blind, which is the failure this exists
// to prevent.
for (const field of ['outcomeBasis', 'resultSourceUrl', 'observedAt'] as const) {
  test(`a missing ${field} refuses by name, before any network call`, () => {
    const res = resolveOperatorGradingContext({ ...VALID, [field]: '' });
    assert.equal(res.ok, false);
    assert.ok(!res.ok);
    assert.deepEqual(res.errors, [`operatorGradingContext.${field} is required`]);
  });
}

test('observedAt must be a real instant, not merely non-empty', () => {
  const res = resolveOperatorGradingContext({ ...VALID, observedAt: 'last night' });
  assert.equal(res.ok, false);
  assert.ok(!res.ok);
  assert.deepEqual(res.errors, [
    'operatorGradingContext.observedAt must be an ISO-8601 instant',
  ]);
});

test('every missing field is reported at once, not one per retry', () => {
  const res = resolveOperatorGradingContext({
    outcomeBasis: '',
    resultSourceUrl: '',
    observedAt: '',
  });
  assert.equal(res.ok, false);
  assert.ok(!res.ok);
  assert.equal(res.errors.length, 3);
});

// The defect this replaces: `evidenceRef` was the constant 'operator-manual' on
// every settlement AND every correction of one, so a correction record carried
// evidence indistinguishable from what it corrected.
test('two attestations with different sources produce different evidence refs', () => {
  const a = resolveOperatorGradingContext(VALID);
  const b = resolveOperatorGradingContext({
    ...VALID,
    resultSourceUrl: 'https://www.espn.com/nfl/boxscore/_/gameId/401671800',
    observedAt: '2026-09-16T01:05:00.000Z',
  });
  assert.ok(a.ok && b.ok);
  assert.notEqual(a.evidenceRef, b.evidenceRef);
  assert.notEqual(a.evidenceRef, 'operator-manual');
});

test('the evidence ref carries what a later reader needs to re-check the call', () => {
  const ref = buildEvidenceRef(VALID);
  assert.ok(ref.startsWith('operator-manual:'));
  assert.ok(ref.includes(VALID.observedAt));
  assert.ok(ref.includes(VALID.resultSourceUrl));
});
