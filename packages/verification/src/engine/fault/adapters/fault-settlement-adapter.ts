/**
 * VERIFICATION & SIMULATION CONTROL PLANE — FaultSettlementAdapter
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R4
 *
 * Fault-injecting wrapper around the settlement resolution surface.
 * Supports: throw, return_null (missing settlement data).
 */

import { ReplaySettlementAdapter } from '../../adapters/replay-settlement.js';

import type { ExecutionMode, SettlementAdapter, SettlementData } from '../../adapters.js';
import type { ClockProvider } from '../../clock.js';
import type { JournalEventStore } from '../../event-store.js';
import type { FaultInjector } from '../fault-injector.js';

export class FaultSettlementAdapter implements SettlementAdapter {
  readonly mode: ExecutionMode;

  private readonly base: ReplaySettlementAdapter;
  private readonly injector: FaultInjector;
  private callCount = 0;

  constructor(mode: ExecutionMode, store: JournalEventStore, injector: FaultInjector) {
    if (mode === 'production') {
      throw new Error('FaultSettlementAdapter: cannot be instantiated in production mode');
    }
    this.mode = mode;
    this.base = new ReplaySettlementAdapter(mode, store);
    this.injector = injector;
  }

  async checkSettlement(pickId: string, clock: ClockProvider): Promise<SettlementData | null> {
    this.callCount++;
    const fault = this.injector.check('settlement.checkSettlement', pickId);

    if (fault) {
      this.injector.recordActivation(
        'settlement.checkSettlement',
        fault.type,
        this.callCount,
        pickId,
        fault.errorMessage
      );

      switch (fault.type) {
        case 'throw':
          throw new Error(
            fault.errorMessage ?? `FaultSettlementAdapter: injected error for pick ${pickId}`
          );

        case 'return_null':
          // Simulates missing settlement source data
          return null;

        default:
          break;
      }
    }

    return this.base.checkSettlement(pickId, clock);
  }

  get totalCallCount(): number {
    return this.callCount;
  }
}
