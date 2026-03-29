/**
 * In-process circuit breaker for Discord delivery targets.
 *
 * States:
 * - closed: normal operation — delivery proceeds
 * - open: paused — delivery skipped until cooldown expires
 *
 * The circuit opens after `threshold` consecutive delivery failures for a target.
 * It closes automatically once `cooldownMs` milliseconds have passed since opening.
 *
 * State is in-process only — not persisted to DB. Resets on worker restart.
 */

export interface CircuitBreakerOptions {
  /** Consecutive failures before the circuit opens. Default: 5 */
  threshold?: number;
  /** Cooldown window after opening before the circuit re-closes (ms). Default: 300000 */
  cooldownMs?: number;
  /** Injectable clock for testability. Default: Date.now */
  now?: () => number;
}

interface CircuitState {
  consecutiveFailures: number;
  openedAt: number | null; // timestamp when circuit opened, null when closed
}

export class DeliveryCircuitBreaker {
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly states = new Map<string, CircuitState>();

  constructor(options: CircuitBreakerOptions = {}) {
    this.threshold = options.threshold ?? 5;
    this.cooldownMs = options.cooldownMs ?? 300_000;
    this.now = options.now ?? (() => Date.now());
  }

  private getState(target: string): CircuitState {
    let state = this.states.get(target);
    if (!state) {
      state = { consecutiveFailures: 0, openedAt: null };
      this.states.set(target, state);
    }
    return state;
  }

  /**
   * Returns true if the circuit for this target is currently open (delivery should be skipped).
   * Auto-closes an open circuit if the cooldown window has expired.
   */
  isOpen(target: string): boolean {
    const state = this.getState(target);
    if (state.openedAt === null) return false;

    // Auto-close after cooldown
    if (this.now() - state.openedAt >= this.cooldownMs) {
      state.openedAt = null;
      state.consecutiveFailures = 0;
      return false;
    }

    return true;
  }

  /**
   * Records a delivery failure. Opens the circuit if threshold is reached.
   * Returns true if the circuit just opened (caller should record system_runs row).
   */
  recordFailure(target: string): boolean {
    const state = this.getState(target);
    if (state.openedAt !== null) return false; // already open

    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= this.threshold) {
      state.openedAt = this.now();
      return true; // circuit just opened
    }
    return false;
  }

  /**
   * Records a successful delivery. Resets the failure counter.
   * Returns true if the circuit was open and is now closing (caller should complete system_runs row).
   */
  recordSuccess(target: string): boolean {
    const state = this.getState(target);
    const wasOpen = state.openedAt !== null;
    state.consecutiveFailures = 0;
    state.openedAt = null;
    return wasOpen;
  }

  /**
   * Returns the timestamp (ms) when the circuit will auto-close, or null if closed.
   */
  resumeAt(target: string): number | null {
    const state = this.getState(target);
    if (state.openedAt === null) return null;
    return state.openedAt + this.cooldownMs;
  }

  /**
   * Returns all targets whose circuit is currently open.
   */
  openTargets(): string[] {
    const open: string[] = [];
    for (const [target] of this.states) {
      if (this.isOpen(target)) {
        open.push(target);
      }
    }
    return open;
  }
}

export function createCircuitBreakerFromEnv(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): DeliveryCircuitBreaker {
  const threshold = parseInt(env['UNIT_TALK_WORKER_CIRCUIT_BREAKER_THRESHOLD'] ?? '5', 10);
  const cooldownMs = parseInt(env['UNIT_TALK_WORKER_CIRCUIT_BREAKER_COOLDOWN_MS'] ?? '300000', 10);
  return new DeliveryCircuitBreaker({
    threshold: Number.isFinite(threshold) && threshold > 0 ? threshold : 5,
    cooldownMs: Number.isFinite(cooldownMs) && cooldownMs > 0 ? cooldownMs : 300_000,
  });
}
