/**
 * VERIFICATION & SIMULATION CONTROL PLANE — ReplaySettlementAdapter
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R2
 *
 * SettlementAdapter implementation for replay mode.
 * Returns historical settlement outcomes from the EventStore.
 *
 * Invariants:
 *   - Cannot be instantiated in production mode (throws on construction)
 *   - Never calls any live odds or data provider API
 *   - Returns null when no recorded settlement exists for a pickId
 *   - Marks synthetic=true on all returned SettlementData
 *   - Settlement results are immutable (replay never fabricates outcomes)
 */

import type { SettlementAdapter, SettlementData, ExecutionMode } from '../adapters.js';
import type { ClockProvider } from '../clock.js';
import type { JournalEventStore } from '../event-store.js';

/**
 * Non-production settlement adapter that resolves picks against
 * historical outcomes stored in the EventStore.
 *
 * Use in replay and fault modes. In simulation, override with synthetic outcomes.
 */
export class ReplaySettlementAdapter implements SettlementAdapter {
  readonly mode: ExecutionMode;

  private readonly store: JournalEventStore;

  constructor(mode: ExecutionMode, store: JournalEventStore) {
    if (mode === 'production') {
      throw new Error(
        'ReplaySettlementAdapter cannot be used in production mode. ' +
          'Production mode requires LiveSettlementAdapter.'
      );
    }
    this.mode = mode;
    this.store = store;
  }

  /**
   * Looks up historical settlement for a pick by scanning PICK_SETTLED events.
   * Returns null if no settlement has been recorded for this pick yet
   * (at the current virtual clock position).
   *
   * The clock parameter is accepted for interface compliance but settlement
   * outcomes are indexed by pickId — they are available regardless of virtual time.
   */
  async checkSettlement(pickId: string, _clock: ClockProvider): Promise<SettlementData | null> {
    const settled = this.store
      .getAllEvents()
      .find(e => e.eventType === 'PICK_SETTLED' && e.pickId === pickId);

    if (!settled) return null;

    const payload = settled.payload as {
      result: 'win' | 'loss' | 'push' | 'void';
      source?: string;
    };

    return {
      pickId,
      result: payload.result,
      settledAt: settled.timestamp,
      source: payload.source ?? 'historical-event-store',
      synthetic: true,
    };
  }
}
