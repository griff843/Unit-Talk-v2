import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FaultInjector } from './fault-injector.js';

import type { FaultDefinition } from './types.js';

const publishFault: FaultDefinition = {
  target: 'publish.publish',
  type: 'throw',
  activation: { type: 'always' },
  errorMessage: 'Injected publish failure',
};

test('registers a fault and returns it for an active target', () => {
  const injector = new FaultInjector();

  injector.register(publishFault);

  assert.equal(injector.getActivationLog().length, 0);
  assert.deepEqual(injector.check('publish.publish', 'pick-1'), publishFault);
});

test('increments call counters used by call-number activation rules', () => {
  const injector = new FaultInjector();
  const secondCallFault: FaultDefinition = {
    target: 'feed.poll',
    type: 'return_null',
    activation: { type: 'on_call_number', callNumber: 2 },
  };

  injector.register(secondCallFault);

  assert.equal(injector.check('feed.poll'), null);
  assert.deepEqual(injector.check('feed.poll'), secondCallFault);
});

test('records activations and reset deactivates registered faults', () => {
  const injector = new FaultInjector();

  injector.register(publishFault);
  assert.deepEqual(injector.check('publish.publish', 'pick-1'), publishFault);

  injector.recordActivation('publish.publish', 'throw', 1, 'pick-1', publishFault.errorMessage);
  assert.equal(injector.getActivationLog().length, 1);

  injector.reset();

  assert.equal(injector.check('publish.publish', 'pick-1'), null);
  assert.equal(injector.getActivationLog().length, 0);
});
