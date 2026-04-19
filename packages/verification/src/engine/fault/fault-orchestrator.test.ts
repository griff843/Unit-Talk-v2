import assert from 'node:assert/strict';
import test from 'node:test';

import { VirtualEventClock } from '../clock.js';
import { JournalEventStore } from '../event-store.js';
import { FaultOrchestrator } from './fault-orchestrator.js';
import { InvariantAssertionEngine } from './assertion-engine.js';

import type { ScenarioSetup } from './scenarios/index.js';

function basePick(id: string): Record<string, unknown> {
  return {
    id,
    bet_slip_id: `slip-${id}`,
    status: 'validated',
    posted_to_discord: false,
    promotion_status: null,
    settlement_status: null,
    sport: 'NBA',
    created_at: '2026-01-01T00:00:00.000Z',
    placed_at: '2026-01-01T00:00:00.000Z',
  };
}

function setupWithStore(eventStore: JournalEventStore): ScenarioSetup {
  return {
    scenario: {
      scenarioId: 'T-ORCH',
      name: 'Orchestrator edge case',
      targetStage: 'publish.publish',
      faultType: 'throw',
      expectedBehavior: 'Faults surface and processing continues',
      proofArtifactName: 'fault-proof-test.json',
      assertions: [
        {
          assertionId: 'errors',
          invariant: 'EXPLICIT_FAILURE_SURFACING',
          description: 'Errors are surfaced',
        },
      ],
    },
    eventStore,
    faults: [
      {
        target: 'publish.publish',
        type: 'throw',
        activation: { type: 'on_call_number', callNumber: 1 },
        errorMessage: 'Injected publish failure',
      },
    ],
    assertors: new Map([['errors', InvariantAssertionEngine.errorsContain('errors', 'Injected')]]),
  };
}

test('FaultOrchestrator surfaces a fault before any successful pick publish completes', async () => {
  const store = JournalEventStore.createInMemory();
  store.appendEvent({
    eventId: 'submit',
    eventType: 'PICK_SUBMITTED',
    pickId: 'pick-before',
    timestamp: '2026-01-01T00:00:00.000Z',
    payload: { pick: basePick('pick-before') },
  });
  store.appendEvent({
    eventId: 'grade',
    eventType: 'PICK_GRADED',
    pickId: 'pick-before',
    timestamp: '2026-01-01T00:01:00.000Z',
    payload: {
      gradingData: {
        status: 'queued',
        promotion_status: 'queued',
        promotion_queued_at: '2026-01-01T00:01:00.000Z',
      },
    },
  });
  store.appendEvent({
    eventId: 'publish-fault',
    eventType: 'PICK_POSTED',
    pickId: 'pick-before',
    timestamp: '2026-01-01T00:02:00.000Z',
    payload: { posting: { channel: 'discord:canary' } },
  });

  const result = await new FaultOrchestrator(
    setupWithStore(store),
    new VirtualEventClock(new Date('2025-12-31T23:59:00.000Z')),
    'run-before'
  ).run(setupWithStore(store).assertors);

  assert.equal(result.faultsActivated, 1);
  assert.equal(result.assertionsFailed, 0);
  assert.deepEqual(result.activatedFaults.map(fault => fault.target), ['publish.publish']);
  assert.deepEqual(result.finalPickState.map(pick => pick['id']), ['pick-before']);
});

test('FaultOrchestrator continues processing after a single injected fault', async () => {
  const store = JournalEventStore.createInMemory();
  for (const id of ['first', 'second']) {
    store.appendEvent({
      eventId: `submit-${id}`,
      eventType: 'PICK_SUBMITTED',
      pickId: `pick-${id}`,
      timestamp: `2026-01-01T00:0${id === 'first' ? 0 : 3}:00.000Z`,
      payload: { pick: basePick(`pick-${id}`) },
    });
    store.appendEvent({
      eventId: `grade-${id}`,
      eventType: 'PICK_GRADED',
      pickId: `pick-${id}`,
      timestamp: `2026-01-01T00:0${id === 'first' ? 1 : 4}:00.000Z`,
      payload: {
        gradingData: {
          status: 'queued',
          promotion_status: 'queued',
          promotion_queued_at: '2026-01-01T00:01:00.000Z',
        },
      },
    });
    store.appendEvent({
      eventId: `post-${id}`,
      eventType: 'PICK_POSTED',
      pickId: `pick-${id}`,
      timestamp: `2026-01-01T00:0${id === 'first' ? 2 : 5}:00.000Z`,
      payload: { posting: { channel: 'discord:canary' } },
    });
  }

  const setup = setupWithStore(store);
  const result = await new FaultOrchestrator(
    setup,
    new VirtualEventClock(new Date('2025-12-31T23:59:00.000Z')),
    'run-continue'
  ).run(setup.assertors);

  assert.equal(result.faultsActivated, 1);
  assert.equal(result.errors.length, 1);
  assert.deepEqual(
    result.finalPickState.map(pick => pick['id']).sort(),
    ['pick-first', 'pick-second']
  );
  assert.equal(result.finalPickState.find(pick => pick['id'] === 'pick-second')?.['posted_to_discord'], true);
});
