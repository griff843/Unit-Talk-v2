/**
 * VERIFICATION & SIMULATION CONTROL PLANE — RecordingPublishAdapter
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R1
 *
 * Safe publish adapter for non-production execution modes.
 * Captures publish payloads without emitting to Discord or any external endpoint.
 *
 * Invariants:
 *   - Cannot be instantiated in production mode (throws on construction)
 *   - Never calls any external HTTP endpoint or Discord API
 *   - Returns synthetic receipts with synthetic=true
 *   - Records all attempts for proof inspection
 */

import { randomUUID } from 'crypto';

import type { ExecutionMode, PublishAdapter, PublishReceipt } from '../adapters.js';

/** An individual recorded publish attempt. */
export interface RecordedPublish {
  receiptId: string;
  pickId: string;
  payload: Record<string, unknown>;
  recordedAt: string;
}

/**
 * Non-production publish adapter.
 *
 * Use in replay, shadow, fault, and simulation modes.
 * In shadow mode, the RunController may compare RecordedPublish entries
 * against production receipts to detect divergence.
 */
export class RecordingPublishAdapter implements PublishAdapter {
  readonly mode: ExecutionMode;

  private readonly records: RecordedPublish[] = [];

  constructor(mode: ExecutionMode) {
    if (mode === 'production') {
      throw new Error(
        'RecordingPublishAdapter cannot be used in production mode. ' +
          'Production mode requires DiscordPublishAdapter.'
      );
    }
    this.mode = mode;
  }

  async publish(pickId: string, payload: Record<string, unknown>): Promise<PublishReceipt> {
    const receiptId = `synthetic-${this.mode}-${randomUUID()}`;
    const timestamp = new Date().toISOString();

    this.records.push({
      receiptId,
      pickId,
      payload,
      recordedAt: timestamp,
    });

    return {
      receiptId,
      pickId,
      timestamp,
      mode: this.mode,
      synthetic: true,
    };
  }

  /** Returns all captured publish attempts for proof bundle inspection. */
  getRecords(): ReadonlyArray<RecordedPublish> {
    return this.records;
  }

  /** Number of publish attempts recorded in this run. */
  get recordCount(): number {
    return this.records.length;
  }
}
