import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deliveryAudienceLabel,
  STAFF_CANARY_LABEL,
  UNRECOGNIZED_AUDIENCE_LABEL,
} from './delivery-audience-label';

const pick = (audience: unknown) => ({ deliveryAuthorization: { audience } });
const payload = (audience: unknown) => ({ deliveryDestination: { audience } });

test('members and legacy absence add no label', () => {
  for (const metadata of [undefined, null, {}, pick(undefined), pick('members')]) {
    assert.equal(deliveryAudienceLabel(metadata), null);
    assert.equal(deliveryAudienceLabel(metadata, [undefined, null, {}, payload('members')]), null);
  }
});

test('staff-canary on the pick only, outbox only, and both gets the canary label', () => {
  assert.equal(deliveryAudienceLabel(pick('staff-canary')), STAFF_CANARY_LABEL);
  assert.equal(deliveryAudienceLabel({}, [payload('staff-canary')]), STAFF_CANARY_LABEL);
  assert.equal(deliveryAudienceLabel(pick('staff-canary'), [payload('staff-canary')]), STAFF_CANARY_LABEL);
  assert.equal(deliveryAudienceLabel(pick('staff-canary'), [{}, payload('staff-canary')]), STAFF_CANARY_LABEL);
});

test('unknown and non-string pins fail closed in either source', () => {
  for (const audience of ['future-audience', '', null, false, 42, {}, []]) {
    assert.equal(deliveryAudienceLabel(pick(audience)), UNRECOGNIZED_AUDIENCE_LABEL);
    assert.equal(deliveryAudienceLabel({}, [payload(audience)]), UNRECOGNIZED_AUDIENCE_LABEL);
    assert.equal(deliveryAudienceLabel(pick('staff-canary'), [payload(audience)]), UNRECOGNIZED_AUDIENCE_LABEL);
  }
});

test('explicit pick/outbox and outbox/outbox disagreements fail closed', () => {
  assert.equal(deliveryAudienceLabel(pick('members'), [payload('staff-canary')]), UNRECOGNIZED_AUDIENCE_LABEL);
  assert.equal(deliveryAudienceLabel(pick('staff-canary'), [payload('members')]), UNRECOGNIZED_AUDIENCE_LABEL);
  assert.equal(deliveryAudienceLabel({}, [payload('members'), payload('staff-canary')]), UNRECOGNIZED_AUDIENCE_LABEL);
});

test('malformed containers fail closed rather than becoming legacy absence', () => {
  for (const block of [null, false, [], 'staff-canary']) {
    assert.equal(deliveryAudienceLabel({ deliveryAuthorization: block }), UNRECOGNIZED_AUDIENCE_LABEL);
    assert.equal(deliveryAudienceLabel({}, [{ deliveryDestination: block }]), UNRECOGNIZED_AUDIENCE_LABEL);
  }
  assert.equal(deliveryAudienceLabel(false), UNRECOGNIZED_AUDIENCE_LABEL);
  assert.equal(deliveryAudienceLabel({}, [false]), UNRECOGNIZED_AUDIENCE_LABEL);
});
