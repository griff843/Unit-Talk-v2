/**
 * VERIFICATION & SIMULATION CONTROL PLANE — FaultPublishAdapter
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R4
 *
 * Fault-injecting wrapper around the publish surface.
 * Supports: throw, timeout_then_success.
 *
 * Safety invariants:
 *   - Cannot be constructed in production mode
 *   - Records all successful publishes for proof bundles
 *   - Fault activations are always traceable via FaultInjector
 */

import type { ExecutionMode, PublishAdapter, PublishReceipt } from '../../adapters.js';
import type { FaultInjector } from '../fault-injector.js';

export interface FaultPublishRecord {
  pickId: string;
  receiptId: string;
  recordedAt: string;
}

export class FaultPublishAdapter implements PublishAdapter {
  readonly mode: ExecutionMode;

  private readonly injector: FaultInjector;
  private readonly records: FaultPublishRecord[] = [];
  private callCount = 0;

  constructor(mode: ExecutionMode, injector: FaultInjector) {
    if (mode === 'production') {
      throw new Error('FaultPublishAdapter: cannot be instantiated in production mode');
    }
    this.mode = mode;
    this.injector = injector;
  }

  async publish(pickId: string, _payload: Record<string, unknown>): Promise<PublishReceipt> {
    this.callCount++;
    const fault = this.injector.check('publish.publish', pickId);

    if (fault) {
      this.injector.recordActivation(
        'publish.publish',
        fault.type,
        this.callCount,
        pickId,
        fault.errorMessage
      );

      switch (fault.type) {
        case 'throw':
          throw new Error(
            fault.errorMessage ?? `FaultPublishAdapter: injected error for pick ${pickId}`
          );

        case 'timeout_then_success':
          // Simulate timeout by throwing on this call.
          // The FaultOrchestrator is responsible for retrying if the scenario requires it.
          throw new Error(
            fault.errorMessage ?? `FaultPublishAdapter: simulated timeout for pick ${pickId}`
          );

        default:
          // For unhandled fault types, record and fall through to success
          break;
      }
    }

    // Success path: record and return synthetic receipt
    const receiptId = `fault-receipt-${pickId}-${this.callCount}`;
    this.records.push({
      pickId,
      receiptId,
      recordedAt: new Date().toISOString(), // WALL-CLOCK-ALLOWED: receipt metadata
    });

    return {
      receiptId,
      pickId,
      timestamp: new Date().toISOString(), // WALL-CLOCK-ALLOWED: receipt metadata
      mode: this.mode,
      synthetic: true,
    };
  }

  getRecords(): ReadonlyArray<FaultPublishRecord> {
    return this.records;
  }

  get recordCount(): number {
    return this.records.length;
  }

  get totalCallCount(): number {
    return this.callCount;
  }
}
