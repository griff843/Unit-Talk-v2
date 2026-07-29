import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createSchedulerRegistrationPolicy,
  parseSyndicateMachineMode,
  PRODUCTION_SCHEDULER_IDS,
  SCHEDULER_CLASSIFICATIONS,
  type ProductionSchedulerId,
} from './scheduler-policy.js';

const PARKED_DISABLED_SCHEDULERS: readonly ProductionSchedulerId[] = [
  'board-scan',
  'candidate-scoring',
  'ranked-selection',
  'board-construction',
  'board-pick-writer',
  'candidate-pick-scanner',
];

test('syndicate-machine mode accepts only the two exact declared values', () => {
  assert.equal(parseSyndicateMachineMode('true'), 'active');
  assert.equal(parseSyndicateMachineMode('false'), 'parked');

  for (const invalidValue of [undefined, '', 'TRUE', 'False', ' true ', '0', 'enabled']) {
    assert.throws(
      () => parseSyndicateMachineMode(invalidValue),
      /SYNDICATE_MACHINE_ENABLED must be declared as exactly "true".*"false"/,
    );
  }
});

test('production scheduler inventory explicitly classifies every current scheduler', () => {
  assert.deepEqual(PRODUCTION_SCHEDULER_IDS, [
    'recap',
    'trial-expiry',
    'participant-enrichment',
    'system-pick-scanner',
    'closing-line-recovery',
    'market-universe-materializer',
    'line-movement-detector',
    'board-scan',
    'candidate-scoring',
    'ranked-selection',
    'board-construction',
    'board-pick-writer',
    'candidate-pick-scanner',
    'model-health-scanner',
  ]);
  assert.equal(new Set(PRODUCTION_SCHEDULER_IDS).size, PRODUCTION_SCHEDULER_IDS.length);

  for (const scheduler of PARKED_DISABLED_SCHEDULERS) {
    assert.equal(SCHEDULER_CLASSIFICATIONS[scheduler], 'parked-disabled');
  }
});

test('parked mode registers non-producer services but no syndicate producer stage', () => {
  const policy = createSchedulerRegistrationPolicy('false');
  const registrations: ProductionSchedulerId[] = [];

  for (const scheduler of PRODUCTION_SCHEDULER_IDS) {
    policy.register(scheduler, () => registrations.push(scheduler));
  }

  assert.equal(policy.mode, 'parked');
  assert.deepEqual(
    registrations,
    PRODUCTION_SCHEDULER_IDS.filter(
      (scheduler) => !PARKED_DISABLED_SCHEDULERS.includes(scheduler),
    ),
  );
  assert.deepEqual(
    policy.decisions.filter((decision) => !decision.registered).map((decision) => decision.scheduler),
    PARKED_DISABLED_SCHEDULERS,
  );
});

test('active mode preserves registration of every production scheduler', () => {
  const policy = createSchedulerRegistrationPolicy('true');
  const registrations: ProductionSchedulerId[] = [];

  for (const scheduler of PRODUCTION_SCHEDULER_IDS) {
    policy.register(scheduler, () => registrations.push(scheduler));
  }

  assert.equal(policy.mode, 'active');
  assert.deepEqual(registrations, PRODUCTION_SCHEDULER_IDS);
  assert.ok(policy.decisions.every((decision) => decision.registered));
});

test('board writer cannot override the canonical parked-mode decision', () => {
  const policy = createSchedulerRegistrationPolicy('false');
  let writerStarted = false;

  const registered = policy.register('board-pick-writer', () => {
    writerStarted = true;
  });

  assert.equal(registered, false);
  assert.equal(writerStarted, false);
});
