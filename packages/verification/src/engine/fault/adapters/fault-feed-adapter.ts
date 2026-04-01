/**
 * VERIFICATION & SIMULATION CONTROL PLANE — FaultFeedAdapter
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R4
 *
 * Fault-injecting wrapper around the feed polling surface.
 * Supports: throw, return_null, return_stale, return_degraded.
 *
 * For fault scenarios, events are typically pre-built in the scenario's
 * event store rather than injected via this adapter. This adapter supports
 * feed-level fault injection when needed (F4, F8).
 */

import { ReplayFeedAdapter } from '../../adapters/replay-feed.js';

import type { ExecutionMode, FeedAdapter, FeedEvent } from '../../adapters.js';
import type { ClockProvider } from '../../clock.js';
import type { JournalEventStore } from '../../event-store.js';
import type { FaultInjector } from '../fault-injector.js';

export class FaultFeedAdapter implements FeedAdapter {
  readonly mode: ExecutionMode;

  private readonly base: ReplayFeedAdapter;
  private readonly injector: FaultInjector;
  private callCount = 0;

  constructor(mode: ExecutionMode, store: JournalEventStore, injector: FaultInjector) {
    if (mode === 'production') {
      throw new Error('FaultFeedAdapter: cannot be instantiated in production mode');
    }
    this.mode = mode;
    this.base = new ReplayFeedAdapter(mode, store);
    this.injector = injector;
  }

  async poll(clock: ClockProvider): Promise<FeedEvent[]> {
    this.callCount++;
    const fault = this.injector.check('feed.poll');

    if (fault) {
      this.injector.recordActivation(
        'feed.poll',
        fault.type,
        this.callCount,
        undefined,
        fault.errorMessage
      );

      switch (fault.type) {
        case 'throw':
          throw new Error(fault.errorMessage ?? 'FaultFeedAdapter: injected feed error');

        case 'return_null':
          return [];

        case 'return_stale': {
          const events = await this.base.poll(clock);
          return events.map(e => ({
            ...e,
            payload: {
              ...e.payload,
              marketTimestamp:
                fault.stalePayload?.['marketTimestamp'] ?? '2020-01-01T00:00:00.000Z',
              dataQuality: 'stale',
              isStale: true,
            },
          }));
        }

        case 'return_degraded': {
          const events = await this.base.poll(clock);
          return events.map(e => ({
            ...e,
            payload: {
              ...e.payload,
              dataQuality: 'degraded',
              qualityScore: fault.degradedPayload?.['qualityScore'] ?? 0.2,
              isStale: false,
            },
          }));
        }

        default:
          break;
      }
    }

    return this.base.poll(clock);
  }

  reset(): void {
    this.base.reset();
    this.callCount = 0;
  }
}
