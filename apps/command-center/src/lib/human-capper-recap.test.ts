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
  assert.equal(killed.willAttempt, false);
  assert.match(killed.summary, /kill switch is engaged/);
  assert.match(killed.summary, /Settlement will still be recorded/);

  const willAttempt = predictRecapDelivery({
    isHumanCapperDelivery: true,
    officialPicksKilled: false,
    hasSentDelivery: true,
  });
  assert.equal(willAttempt.willAttempt, true);
});

test('an unreadable kill switch fails closed — it never promises a recap', () => {
  // Claiming "a recap will post" on an unknown switch state is the one wrong
  // answer that reads as a promise to the operator.
  const verdict = predictRecapDelivery({
    isHumanCapperDelivery: true,
    officialPicksKilled: null,
    hasSentDelivery: true,
  });
  assert.equal(verdict.willAttempt, false);
  assert.equal(verdict.kind, 'unknown');
  assert.match(verdict.summary, /could not be read/);
});

test('a lost recap response never claims members were not told', () => {
  const verdict = describeRecapOutcome({ posted: false, reason: 'recap_request_outcome_unknown' });
  assert.equal(verdict.kind, 'unresolved');
  if (verdict.kind !== 'unresolved') return;
  assert.match(verdict.detail, /may already have received/);
  assert.doesNotMatch(verdict.headline, /NOT posted|members were not told/);
});

test('member and legacy recap copy stays byte-identical', () => {
  assert.deepEqual(describeRecapOutcome({ posted: true }, true), {
    kind: 'posted', headline: 'Recap posted — members were told.',
  });
  assert.deepEqual(describeRecapOutcome({ posted: false, reason: 'no-sent-delivery' }, true), {
    kind: 'suppressed',
    headline: 'Recap NOT posted — members were not told.',
    detail: 'This pick has no confirmed delivery, so there is no audience to recap to. A pick that never reached members correctly gets no recap.',
    reason: 'no-sent-delivery',
  });
});

test('canary and fail-closed audiences name the private staff destination for every recap outcome', async () => {
  const { isMemberVisibleDeliveryAudience } = await import('@unit-talk/contracts');
  const payload = (audience: unknown) => ({ deliveryDestination: { audience } });
  const pick = (audience: unknown) => ({ deliveryAuthorization: { audience } });
  const cases = [
    { metadata: pick('staff-canary'), payloads: [] },
    { metadata: {}, payloads: [payload('staff-canary')] },
    { metadata: pick('staff-canary'), payloads: [payload('staff-canary')] },
    { metadata: pick('unknown'), payloads: [] },
    { metadata: {}, payloads: [payload(42)] },
    { metadata: pick('members'), payloads: [payload('staff-canary')] },
    { metadata: pick('staff-canary'), payloads: [payload('members')] },
  ];
  for (const { metadata, payloads } of cases) {
    const memberVisible = isMemberVisibleDeliveryAudience(metadata, payloads);
    assert.equal(memberVisible, false);
    for (const recap of [
      { posted: true },
      { posted: false, reason: 'no-sent-delivery' },
      { posted: false, reason: 'kill-switch-engaged' },
      { posted: false, reason: 'recap_request_outcome_unknown' },
      { posted: false, reason: 'unknown-refusal' },
    ]) {
      const verdict = describeRecapOutcome(recap, memberVisible);
      assert.match(JSON.stringify(verdict), /the private staff destination/);
      assert.doesNotMatch(JSON.stringify(verdict), /members/);
    }
    assert.deepEqual(describeRecapOutcome(null, memberVisible), { kind: 'not-applicable' });
  }
});
