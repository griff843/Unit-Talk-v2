/**
 * VERIFICATION & SIMULATION CONTROL PLANE — RecordingRecapAdapter
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R2
 *
 * Safe recap adapter for non-production execution modes.
 * Generates recaps but captures output for proof inspection
 * instead of delivering to Discord or Notion.
 *
 * Invariants:
 *   - Cannot be instantiated in production mode (throws on construction)
 *   - Never delivers to any external channel
 *   - Records all generated recaps for proof bundle inspection
 */

import type { ExecutionMode, RecapAdapter, RecapOutput, RecapPeriod } from '../adapters.js';
import type { ClockProvider } from '../clock.js';

/** An individual captured recap generation. */
export interface RecordedRecap {
  period: RecapPeriod;
  output: RecapOutput;
  recordedAt: string; // WALL-CLOCK-ALLOWED: adapter internal audit timestamp, non-lifecycle
}

/**
 * Non-production recap adapter that captures output.
 * Use in replay mode to collect recap results for proof bundle.
 */
export class RecordingRecapAdapter implements RecapAdapter {
  readonly mode: ExecutionMode;

  private readonly records: RecordedRecap[] = [];

  constructor(mode: ExecutionMode) {
    if (mode === 'production') {
      throw new Error(
        'RecordingRecapAdapter cannot be used in production mode. ' +
          'Production mode requires a delivery-capable RecapAdapter.'
      );
    }
    this.mode = mode;
  }

  async generate(period: RecapPeriod, clock: ClockProvider): Promise<RecapOutput> {
    const output: RecapOutput = {
      period,
      generatedAt: clock.now().toISOString(),
      mode: this.mode,
      content: {
        generated: true,
        virtualTime: clock.now().toISOString(),
        period,
      },
      delivered: false,
    };

    this.records.push({
      period,
      output,
      recordedAt: new Date().toISOString(), // WALL-CLOCK-ALLOWED: adapter internal audit timestamp, non-lifecycle
    });

    return output;
  }

  /** Returns all captured recap generations for proof bundle inspection. */
  getRecords(): ReadonlyArray<RecordedRecap> {
    return this.records;
  }

  /** Number of recaps generated in this run. */
  get recordCount(): number {
    return this.records.length;
  }
}
