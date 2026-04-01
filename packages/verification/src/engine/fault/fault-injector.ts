/**
 * VERIFICATION & SIMULATION CONTROL PLANE — FaultInjector
 * Sprint: SPRINT-VERIFICATION-SIMULATION-LAYER-R4
 *
 * Stateful fault activation engine.
 *
 * Design law:
 *   - Faults are registered before a scenario run
 *   - Adapters query the injector before each call
 *   - All activations are recorded for proof bundles
 *   - Production mode: fault adapters refuse instantiation, so this class
 *     is never reachable from production code paths
 */

import type {
  FaultDefinition,
  FaultTarget,
  FaultType,
  FaultActivationRecord,
  ActivationRule,
} from './types.js';

export class FaultInjector {
  private readonly definitions = new Map<FaultTarget, FaultDefinition[]>();
  /** Per-target:pickId call counters (key: "<target>:<pickId|*>"). */
  private readonly counters = new Map<string, number>();
  private readonly log: FaultActivationRecord[] = [];

  /** Register a fault to fire at a given target. Multiple faults per target are supported. */
  register(fault: FaultDefinition): void {
    const existing = this.definitions.get(fault.target) ?? [];
    existing.push(fault);
    this.definitions.set(fault.target, existing);
  }

  /**
   * Check whether a fault should fire for this call.
   * Increments the call counter regardless of whether a fault fires.
   * Returns the matching FaultDefinition, or null if no fault fires.
   */
  check(target: FaultTarget, pickId?: string): FaultDefinition | null {
    const globalKey = `${target}:*`;
    const pickKey = pickId ? `${target}:${pickId}` : globalKey;

    const globalCount = (this.counters.get(globalKey) ?? 0) + 1;
    const pickCount = pickId ? (this.counters.get(pickKey) ?? 0) + 1 : globalCount;

    this.counters.set(globalKey, globalCount);
    if (pickId) this.counters.set(pickKey, pickCount);

    const faults = this.definitions.get(target);
    if (!faults || faults.length === 0) return null;

    for (const fault of faults) {
      if (this.matches(fault.activation, globalCount, pickId)) {
        return fault;
      }
    }
    return null;
  }

  /** Record an activation event (called by adapter wrappers after deciding to fire). */
  recordActivation(
    target: FaultTarget,
    faultType: FaultType,
    callNumber: number,
    pickId?: string,
    errorThrown?: string
  ): void {
    this.log.push({
      target,
      faultType,
      activatedAt: new Date().toISOString(), // WALL-CLOCK-ALLOWED: fault metadata
      callNumber,
      pickId,
      errorThrown,
    });
  }

  /** All recorded activation events. */
  getActivationLog(): ReadonlyArray<FaultActivationRecord> {
    return this.log;
  }

  /** Reset all state. Use between scenario runs. */
  reset(): void {
    this.definitions.clear();
    this.counters.clear();
    this.log.length = 0;
  }

  // ─────────────────────────────────────────────────────────────
  // PRIVATE
  // ─────────────────────────────────────────────────────────────

  private matches(rule: ActivationRule, globalCount: number, pickId?: string): boolean {
    switch (rule.type) {
      case 'always':
        return true;
      case 'on_call_number':
        return globalCount === rule.callNumber;
      case 'on_pick_id':
        return pickId === rule.pickId;
      case 'after_call_number':
        return globalCount > rule.afterCallNumber;
      default:
        return false;
    }
  }
}
