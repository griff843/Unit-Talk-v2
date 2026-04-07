/**
 * VERIFICATION & SIMULATION CONTROL PLANE — Simulation Adapter Factory
 * Sprint: UTV2-320 NBA Baseline Simulation
 *
 * Creates a complete AdapterManifest for replay/simulation runs using
 * the existing non-production adapter implementations.
 *
 * All adapters operate in 'replay' mode (in-memory, no external side effects).
 * Settlement results are resolved from PICK_SETTLED events in the store.
 */

import { NullNotificationAdapter } from './adapters/null-notification.js';
import { NullRecapAdapter } from './adapters/null-recap.js';
import { RecordingPublishAdapter } from './adapters/recording-publish.js';
import { ReplayFeedAdapter } from './adapters/replay-feed.js';
import { ReplaySettlementAdapter } from './adapters/replay-settlement.js';

import type { AdapterManifest } from './adapters.js';
import type { JournalEventStore } from './event-store.js';

/**
 * Creates a fully in-memory AdapterManifest for replay/simulation runs.
 *
 * The settlement adapter reads outcomes from PICK_SETTLED events in the
 * provided store — callers must populate those events before running the
 * orchestrator. No live data sources are contacted.
 *
 * @param store  The JournalEventStore that drives the simulation.
 */
export function createReplaySimulationManifest(store: JournalEventStore): AdapterManifest {
  return {
    mode: 'replay',
    publish: new RecordingPublishAdapter('replay'),
    notification: new NullNotificationAdapter('replay'),
    feed: new ReplayFeedAdapter('replay', store),
    settlement: new ReplaySettlementAdapter('replay', store),
    recap: new NullRecapAdapter('replay'),
  };
}
