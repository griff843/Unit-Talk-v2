/**
 * VERIFICATION & SIMULATION CONTROL PLANE — Clock Abstraction
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R1
 *
 * ClockProvider: canonical time interface for the governed pipeline.
 * All lifecycle-critical timestamps MUST flow through this abstraction.
 *
 * Design law:
 *   - Production code uses RealClockProvider (delegates to Date)
 *   - Replay/Shadow/Fault code uses VirtualEventClock (deterministic)
 *   - Pipeline functions receive ClockProvider — they never call Date.now() directly
 *   - resolveNow() is the sole safe time-resolution helper for governed code
 */

// ─────────────────────────────────────────────────────────────
// INTERFACES
// ─────────────────────────────────────────────────────────────

/**
 * Abstract time source. Implemented by RealClockProvider (production)
 * and VirtualEventClock (replay/simulation).
 */
export interface ClockProvider {
  /** Current time in the execution context. */
  now(): Date;

  /** Clock mode identifier. */
  readonly mode: 'real' | 'virtual';
}

/**
 * Extended interface for clocks that support deterministic advancement.
 * Only implemented by VirtualEventClock.
 */
export interface MutableClockProvider extends ClockProvider {
  /**
   * Advance clock to an absolute point in time.
   * Throws if target < current (clock cannot move backward).
   */
  advanceTo(timestamp: Date): void;

  /**
   * Advance clock by a relative duration in milliseconds.
   * ms must be non-negative.
   */
  advanceBy(ms: number): void;

  /**
   * Retrieve the immutable advancement log for auditing.
   */
  getAdvancementLog(): ReadonlyArray<ClockAdvancement>;
}

/** Record of a single clock advancement step. */
export interface ClockAdvancement {
  /** ISO timestamp before advancement. */
  from: string;
  /** ISO timestamp after advancement. */
  to: string;
  /** Milliseconds advanced. */
  deltaMs: number;
  /**
   * Real wall time when advancement was recorded (audit only).
   * This is the only wall-clock read permitted inside this file.
   */
  wallTimeMs: number;
}

// ─────────────────────────────────────────────────────────────
// PRODUCTION CLOCK
// ─────────────────────────────────────────────────────────────

/**
 * Production clock: delegates to the system wall clock.
 *
 * This is the ONLY location in the governed pipeline where Date() may be
 * called directly for lifecycle-critical time resolution. All other governed
 * code must call resolveNow(clock) or clock.now().
 */
export class RealClockProvider implements ClockProvider {
  readonly mode = 'real' as const;

  now(): Date {
    // Sole authorised wall-clock call for lifecycle timestamps.
    return new Date();
  }
}

// ─────────────────────────────────────────────────────────────
// VIRTUAL CLOCK (Replay / Shadow / Fault / Simulation)
// ─────────────────────────────────────────────────────────────

/**
 * Deterministic virtual clock for non-production execution modes.
 *
 * Guarantees:
 *   - Time never moves backward (throws VirtualClockError on regression)
 *   - Every advancement is logged with before/after timestamps
 *   - now() returns a defensive copy (caller mutation cannot corrupt state)
 *   - Suitable for deterministic replay: same advancement sequence = same output
 */
export class VirtualEventClock implements MutableClockProvider {
  readonly mode = 'virtual' as const;

  private current: Date;
  private readonly advancements: ClockAdvancement[] = [];

  constructor(startTime: Date) {
    if (isNaN(startTime.getTime())) {
      throw new Error('VirtualEventClock: startTime is not a valid Date');
    }
    this.current = new Date(startTime.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime()); // defensive copy
  }

  advanceTo(timestamp: Date): void {
    if (isNaN(timestamp.getTime())) {
      throw new Error('VirtualEventClock.advanceTo: timestamp is not a valid Date');
    }

    const targetMs = timestamp.getTime();
    const currentMs = this.current.getTime();

    if (targetMs < currentMs) {
      throw new Error(
        `VirtualEventClock: time cannot move backward. ` +
          `current=${this.current.toISOString()}, requested=${timestamp.toISOString()}`
      );
    }

    if (targetMs === currentMs) return; // no-op — already at target

    const from = this.current.toISOString();
    const deltaMs = targetMs - currentMs;
    this.current = new Date(targetMs);

    this.advancements.push({
      from,
      to: this.current.toISOString(),
      deltaMs,
      wallTimeMs: Date.now(), // wall time recorded for audit purposes ONLY
    });
  }

  advanceBy(ms: number): void {
    if (ms < 0) {
      throw new Error(`VirtualEventClock: advanceBy requires non-negative ms, got ${ms}`);
    }
    if (ms === 0) return;
    this.advanceTo(new Date(this.current.getTime() + ms));
  }

  getAdvancementLog(): ReadonlyArray<ClockAdvancement> {
    return this.advancements;
  }
}

// ─────────────────────────────────────────────────────────────
// UTILITY — Clock resolution with production fallback
// ─────────────────────────────────────────────────────────────

/**
 * Resolve the current time from a ClockProvider, falling back to the system
 * wall clock when no provider is supplied.
 *
 * This is the canonical time-resolution pattern for governed pipeline code:
 *
 *   const now = resolveNow(context.clock);
 *
 * Direct `new Date()` / `Date.now()` calls are FORBIDDEN in governed pipeline
 * files outside this file and the explicit fallback below.
 *
 * @param clock Optional clock provider. When absent, defaults to wall clock
 *              (backward-compatible with callers that predate clock injection).
 */
export function resolveNow(clock?: ClockProvider): Date {
  if (clock) return clock.now();
  // Production fallback: wall clock used only when no provider is injected.
  return new Date();
}
