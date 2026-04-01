/**
 * VERIFICATION & SIMULATION CONTROL PLANE — NullRecapAdapter
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R2
 *
 * Safe recap adapter for non-production execution modes.
 * Swallows all recap generation requests without emitting to Discord or Notion.
 *
 * Invariants:
 *   - Cannot be instantiated in production mode (throws on construction)
 *   - Never delivers recap output to any external channel
 *   - Returns a delivered=false RecapOutput
 */

import type { ExecutionMode, RecapAdapter, RecapOutput, RecapPeriod } from '../adapters.js';
import type { ClockProvider } from '../clock.js';

/**
 * Non-production recap adapter.
 * Use in replay, shadow, fault, and simulation modes where recap
 * delivery to Discord/Notion must be suppressed.
 */
export class NullRecapAdapter implements RecapAdapter {
  readonly mode: ExecutionMode;

  constructor(mode: ExecutionMode) {
    if (mode === 'production') {
      throw new Error(
        'NullRecapAdapter cannot be used in production mode. ' +
          'Production mode requires a delivery-capable RecapAdapter.'
      );
    }
    this.mode = mode;
  }

  async generate(period: RecapPeriod, clock: ClockProvider): Promise<RecapOutput> {
    return {
      period,
      generatedAt: clock.now().toISOString(),
      mode: this.mode,
      content: { suppressed: true },
      delivered: false,
    };
  }
}
