import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeRecapOutcome,
  predictRecapDelivery,
  type HumanCapperRecapResult,
} from './human-capper-recap';

test('an absent recap field is not-applicable, never a suppressed recap', () => {
  // A Track Only pick carries no `humanCapperRecap` at all. Reporting that as a
  // suppressed recap would tell the operator members were denied something they
  // were never owed.
  assert.deepEqual(describeRecapOutcome(undefined), { kind: 'not-applicable' });
  assert.deepEqual(describeRecapOutcome(null), { kind: 'not-applicable' });
});

test('a posted recap says members were told', () => {
  const verdict = describeRecapOutcome({ posted: true });
  assert.equal(verdict.kind, 'posted');
  assert.match(verdict.kind === 'posted' ? verdict.headline : '', /members were told/i);
});

test('a kill-switch-suppressed recap is NOT reported as success', () => {
  // This is the exact shape settle-pick-controller.ts returns while the
  // official-picks kill switch is engaged, and the exact case that went
  // unnoticed on canary pick 816a84c7.
  const verdict = describeRecapOutcome({ posted: false, reason: 'kill-switch-engaged' });
  assert.equal(verdict.kind, 'suppressed');
  assert.notEqual(verdict.kind, 'posted');
  if (verdict.kind !== 'suppressed') return;
  assert.match(verdict.headline, /NOT posted/);
  assert.match(verdict.headline, /members were not told/i);
  assert.match(verdict.detail, /kill switch/i);
  assert.match(verdict.detail, /reserved/i);
  assert.equal(verdict.reason, 'kill-switch-engaged');
});

test('an unrecognised refusal reason is passed through verbatim, not flattened', () => {
  const verdict = describeRecapOutcome({ posted: false, reason: 'discord 503 upstream' });
  assert.equal(verdict.kind, 'suppressed');
  if (verdict.kind !== 'suppressed') return;
  assert.match(verdict.detail, /discord 503 upstream/);
  assert.equal(verdict.reason, 'discord 503 upstream');
});

test('a refusal with no reason still reports suppression rather than success', () => {
  for (const recap of [
    { posted: false },
    { posted: false, reason: '' },
    { posted: false, reason: '   ' },
  ] satisfies HumanCapperRecapResult[]) {
    const verdict = describeRecapOutcome(recap);
    assert.equal(verdict.kind, 'suppressed');
    if (verdict.kind !== 'suppressed') continue;
    assert.equal(verdict.reason, 'unspecified');
  }
});

test('prediction mirrors the controller: authorization, delivery, then kill switch', () => {
  assert.equal(
    predictRecapDelivery({
      isHumanCapperDelivery: false,
      officialPicksKilled: false,
      hasSentDelivery: true,
    }).kind,
    'not-applicable',
  );

  assert.equal(
    predictRecapDelivery({
      isHumanCapperDelivery: true,
      officialPicksKilled: false,
      hasSentDelivery: false,
    }).kind,
    'blocked',
  );

  const killed = predictRecapDelivery({
    isHumanCapperDelivery: true,
    officialPicksKilled: true,
    hasSentDelivery: true,
  });
  assert.equal(killed.willPost, false);
  assert.match(killed.summary, /kill switch is engaged/);
  assert.match(killed.summary, /Settlement will still be recorded/);

  const willPost = predictRecapDelivery({
    isHumanCapperDelivery: true,
    officialPicksKilled: false,
    hasSentDelivery: true,
  });
  assert.equal(willPost.willPost, true);
});

test('an unreadable kill switch fails closed — it never promises a recap', () => {
  // Claiming "a recap will post" on an unknown switch state is the one wrong
  // answer that reads as a promise to the operator.
  const verdict = predictRecapDelivery({
    isHumanCapperDelivery: true,
    officialPicksKilled: null,
    hasSentDelivery: true,
  });
  assert.equal(verdict.willPost, false);
  assert.equal(verdict.kind, 'unknown');
  assert.match(verdict.summary, /could not be read/);
});
