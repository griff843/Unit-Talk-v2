/**
 * VERIFICATION & SIMULATION CONTROL PLANE — NullNotificationAdapter
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R1
 *
 * No-op notification adapter for non-production execution modes.
 * Swallows all alerts without emitting to any external target.
 *
 * Invariants:
 *   - Cannot be instantiated in production mode (throws on construction)
 *   - Never calls Discord webhooks, emails, or any external alert channel
 *   - Records all suppressed alerts for proof inspection
 */

import type { ExecutionMode, NotificationAdapter, NotificationAlert } from '../adapters.js';

/** An alert that was suppressed by the null adapter. */
export interface SuppressedAlert {
  alert: NotificationAlert;
  suppressedAt: string;
}

/**
 * Non-production notification adapter.
 *
 * Use in replay, fault, and simulation modes.
 * In shadow mode, consider RecordingNotificationAdapter if shadow-specific
 * operator alerts are needed.
 */
export class NullNotificationAdapter implements NotificationAdapter {
  readonly mode: ExecutionMode;

  private readonly suppressed: SuppressedAlert[] = [];

  constructor(mode: ExecutionMode) {
    if (mode === 'production') {
      throw new Error(
        'NullNotificationAdapter cannot be used in production mode. ' +
          'Production mode requires a real notification adapter.'
      );
    }
    this.mode = mode;
  }

  async alert(alert: NotificationAlert): Promise<void> {
    // Swallow — no external side effect.
    this.suppressed.push({
      alert,
      suppressedAt: new Date().toISOString(),
    });
  }

  /** Returns all suppressed alerts for proof bundle inspection. */
  getSuppressed(): ReadonlyArray<SuppressedAlert> {
    return this.suppressed;
  }

  /** Number of alerts suppressed in this run. */
  get suppressedCount(): number {
    return this.suppressed.length;
  }
}
