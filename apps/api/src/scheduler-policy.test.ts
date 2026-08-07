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
  assert.deepEqual(parseSyndicateMachineMode('true'), {
    mode: 'active',
    requestedValue: 'true',
  });
  assert.deepEqual(parseSyndicateMachineMode('false'), {
    mode: 'parked',
    requestedValue: 'false',
  });

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
    policy.register(scheduler, () => {
      registrations.push(scheduler);
      return { started: true };
    });
  }

  assert.equal(policy.mode, 'parked');
  assert.equal(policy.requestedValue, 'false');
  assert.deepEqual(
    registrations,
    PRODUCTION_SCHEDULER_IDS.filter(
      (scheduler) => !PARKED_DISABLED_SCHEDULERS.includes(scheduler),
    ),
  );
  assert.deepEqual(
    policy.decisions.filter((decision) => !decision.eligible).map((decision) => decision.scheduler),
    PARKED_DISABLED_SCHEDULERS,
  );
  assert.deepEqual(
    policy.outcomes
      .filter((outcome) => outcome.status === 'suppressed_by_mode')
      .map((outcome) => outcome.scheduler),
    PARKED_DISABLED_SCHEDULERS,
  );
});

test('active mode preserves registration of every production scheduler', () => {
  const policy = createSchedulerRegistrationPolicy('true');
  const registrations: ProductionSchedulerId[] = [];

  for (const scheduler of PRODUCTION_SCHEDULER_IDS) {
    policy.register(scheduler, () => {
      registrations.push(scheduler);
      return { started: true };
    });
  }

  assert.equal(policy.mode, 'active');
  assert.equal(policy.requestedValue, 'true');
  assert.deepEqual(registrations, PRODUCTION_SCHEDULER_IDS);
  assert.ok(policy.decisions.every((decision) => decision.eligible));
  assert.ok(policy.outcomes.every((outcome) => outcome.status === 'started'));
});

test('board writer cannot override the canonical parked-mode decision', () => {
  const policy = createSchedulerRegistrationPolicy('false');
  let writerStarted = false;

  const outcome = policy.register('board-pick-writer', () => {
    writerStarted = true;
    return { started: true };
  });

  assert.equal(outcome.started, false);
  assert.equal(outcome.status, 'suppressed_by_mode');
  assert.equal(writerStarted, false);
});

test('runtime outcome distinguishes policy eligibility from an actual skipped start', () => {
  const policy = createSchedulerRegistrationPolicy('true');

  const outcome = policy.register('system-pick-scanner', () => ({
    started: false,
    reason: 'SYSTEM_PICK_SCANNER_ENABLED=false',
  }));

  assert.equal(outcome.eligible, true);
  assert.equal(outcome.started, false);
  assert.equal(outcome.status, 'skipped_by_runtime_condition');
  assert.equal(outcome.reason, 'SYSTEM_PICK_SCANNER_ENABLED=false');
  assert.deepEqual(policy.outcomes, [outcome]);
});
