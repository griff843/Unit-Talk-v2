/**
 * VERIFICATION & SIMULATION CONTROL PLANE — ReplayFeedAdapter
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R2
 *
 * FeedAdapter implementation for replay mode.
 * Sources events from a JournalEventStore filtered to the current virtual clock window.
 *
 * Invariants:
 *   - Cannot be instantiated in production mode (throws on construction)
 *   - Never calls any live sports data API
 *   - Returns only events whose timestamp <= clock.now()
 *   - Events are returned in deterministic sequence order
 */

import type { FeedAdapter, FeedEvent, ExecutionMode } from '../adapters.js';
import type { ClockProvider } from '../clock.js';
import type { JournalEventStore, ReplayEvent } from '../event-store.js';

/**
 * Non-production feed adapter that sources FeedEvents from the EventStore.
 *
 * poll(clock) returns all undelivered events with timestamp <= clock.now(),
 * ordered by sequenceNumber (deterministic). Marks them as consumed so
 * subsequent polls do not return the same events.
 *
 * Used by ReplayOrchestrator to drive ingest from historical event streams.
 */
export class ReplayFeedAdapter implements FeedAdapter {
  readonly mode: ExecutionMode;

  private readonly store: JournalEventStore;
  private cursor: number = 0; // highest sequenceNumber consumed

  constructor(mode: ExecutionMode, store: JournalEventStore) {
    if (mode === 'production') {
      throw new Error(
        'ReplayFeedAdapter cannot be used in production mode. ' +
          'Production mode requires LiveFeedAdapter.'
      );
    }
    this.mode = mode;
    this.store = store;
  }

  /**
   * Returns all unconsumed events with timestamp <= clock.now().
   * Events are ordered by sequenceNumber for deterministic replay.
   * Advances the internal cursor after delivery.
   */
  async poll(clock: ClockProvider): Promise<FeedEvent[]> {
    const now = clock.now();
    const all = this.store.getAllEvents();

    const eligible = all.filter(
      e => e.sequenceNumber > this.cursor && new Date(e.timestamp).getTime() <= now.getTime()
    );

    if (eligible.length === 0) return [];

    // Advance cursor past all returned events
    const maxSeq = Math.max(...eligible.map(e => e.sequenceNumber));
    this.cursor = maxSeq;

    return eligible.map(e => replayEventToFeedEvent(e));
  }

  /** Reset the cursor so the same event stream can be polled again (determinism test). */
  reset(): void {
    this.cursor = 0;
  }

  /** Peek at how many events remain undelivered at or before the given time. */
  remainingAt(clock: ClockProvider): number {
    const now = clock.now();
    return this.store
      .getAllEvents()
      .filter(
        e => e.sequenceNumber > this.cursor && new Date(e.timestamp).getTime() <= now.getTime()
      ).length;
  }
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function replayEventToFeedEvent(e: ReplayEvent): FeedEvent {
  return {
    eventId: e.eventId,
    eventType: e.eventType,
    timestamp: e.timestamp,
    payload: e.payload,
    sequenceNumber: e.sequenceNumber,
    sourceHash: undefined,
  };
}
