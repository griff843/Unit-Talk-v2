import assert from 'node:assert/strict';
import test from 'node:test';

import { JournalEventStore } from './event-store.js';

test('JournalEventStore stores and retrieves zero events without sentinel values', () => {
  const store = JournalEventStore.createInMemory();

  assert.equal(store.size, 0);
  assert.deepEqual([...store.getAllEvents()], []);
  assert.deepEqual(
    [...store.getEventsBetween(new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-02T00:00:00.000Z'))],
    []
  );
  assert.deepEqual([...store.getEventsForReplay('missing-run')], []);
});

test('JournalEventStore preserves append order under concurrent write scheduling', async () => {
  const store = JournalEventStore.createInMemory();
  const writes = Array.from({ length: 5 }, (_, index) =>
    Promise.resolve().then(() =>
      store.appendEvent({
        eventId: `event-${index + 1}`,
        eventType: 'PICK_SUBMITTED',
        pickId: `pick-${index + 1}`,
        timestamp: '2026-01-01T00:00:00.000Z',
        payload: { runId: 'concurrent-run' },
      })
    )
  );

  await Promise.all(writes);

  assert.deepEqual(
    store.getAllEvents().map(event => event.eventId),
    ['event-1', 'event-2', 'event-3', 'event-4', 'event-5']
  );
  assert.deepEqual(
    store.getEventsForReplay('concurrent-run').map(event => event.sequenceNumber),
    [1, 2, 3, 4, 5]
  );
});
