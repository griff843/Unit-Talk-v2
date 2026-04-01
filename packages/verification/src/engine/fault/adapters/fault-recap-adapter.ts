/**
 * VERIFICATION & SIMULATION CONTROL PLANE — FaultRecapAdapter
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R4
 *
 * Fault-injecting wrapper around the recap generation surface.
 * Records all generated recaps for proof bundle inspection.
 */

import { RecordingRecapAdapter } from '../../adapters/recording-recap.js';

import type { ExecutionMode, RecapAdapter, RecapOutput, RecapPeriod } from '../../adapters.js';
import type { ClockProvider } from '../../clock.js';
import type { FaultInjector } from '../fault-injector.js';

export interface FaultRecapRecord {
  period: RecapPeriod;
  output: RecapOutput;
  recordedAt: string;
}

export class FaultRecapAdapter implements RecapAdapter {
  readonly mode: ExecutionMode;

  private readonly base: RecordingRecapAdapter;
  private readonly injector: FaultInjector;
  private readonly records: FaultRecapRecord[] = [];
  private callCount = 0;

  constructor(mode: ExecutionMode, injector: FaultInjector) {
    if (mode === 'production') {
      throw new Error('FaultRecapAdapter: cannot be instantiated in production mode');
    }
    this.mode = mode;
    this.base = new RecordingRecapAdapter(mode);
    this.injector = injector;
  }

  async generate(period: RecapPeriod, clock: ClockProvider): Promise<RecapOutput> {
    this.callCount++;
    const fault = this.injector.check('recap.generate');

    if (fault) {
      this.injector.recordActivation(
        'recap.generate',
        fault.type,
        this.callCount,
        undefined,
        fault.errorMessage
      );

      if (fault.type === 'throw') {
        throw new Error(fault.errorMessage ?? 'FaultRecapAdapter: injected recap error');
      }
    }

    const output = await this.base.generate(period, clock);
    this.records.push({
      period,
      output,
      recordedAt: new Date().toISOString(), // WALL-CLOCK-ALLOWED: recap metadata
    });
    return output;
  }

  getRecords(): ReadonlyArray<FaultRecapRecord> {
    return this.records;
  }

  get recordCount(): number {
    return this.records.length;
  }
}
