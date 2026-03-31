/**
 * Generic circuit breaker for wrapping async functions.
 *
 * States:
 *   closed   — normal operation, calls pass through
 *   open     — circuit tripped after consecutive failures, calls return fallback
 *   half-open — cooldown expired, next call is a probe; success closes, failure re-opens
 *
 * Fail-open: when the circuit is open, the wrapped function is NOT called and the
 * configured fallback value is returned instead (graceful degradation).
 */

export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Consecutive failures required to open the circuit (default: 3). */
  failureThreshold?: number;
  /** Milliseconds before an open circuit transitions to half-open (default: 60_000). */
  cooldownMs?: number;
  /** Optional clock override for testing. */
  now?: () => number;
}

export interface CircuitBreakerSnapshot {
  state: CircuitBreakerState;
  consecutiveFailures: number;
  openedAt: number | null;
  lastFailureAt: number | null;
  totalFailures: number;
  totalSuccesses: number;
  totalFallbacks: number;
}

export class CircuitBreaker<T> {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private lastFailureAt: number | null = null;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private totalFallbacks = 0;

  constructor(
    private readonly fn: () => Promise<T>,
    private readonly fallback: T,
    options: CircuitBreakerOptions = {},
  ) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.cooldownMs = options.cooldownMs ?? 60_000;
    this.now = options.now ?? (() => Date.now());
  }

  get state(): CircuitBreakerState {
    if (this.openedAt === null) {
      return 'closed';
    }
    if (this.now() - this.openedAt >= this.cooldownMs) {
      return 'half-open';
    }
    return 'open';
  }

  snapshot(): CircuitBreakerSnapshot {
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      openedAt: this.openedAt,
      lastFailureAt: this.lastFailureAt,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      totalFallbacks: this.totalFallbacks,
    };
  }

  async call(): Promise<T> {
    const currentState = this.state;

    if (currentState === 'open') {
      this.totalFallbacks += 1;
      return this.fallback;
    }

    // closed or half-open — attempt the call
    try {
      const result = await this.fn();
      this.onSuccess();
      return result;
    } catch (error: unknown) {
      this.onFailure();
      // In half-open, the probe failed — circuit stays open, return fallback
      if (currentState === 'half-open') {
        this.totalFallbacks += 1;
        return this.fallback;
      }
      // In closed state, if we just opened the circuit return fallback;
      // otherwise propagate the error so the caller sees transient failures.
      if (this.state === 'open') {
        this.totalFallbacks += 1;
        return this.fallback;
      }
      throw error;
    }
  }

  /** Manually reset to closed state. */
  reset(): void {
    this.consecutiveFailures = 0;
    this.openedAt = null;
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.totalSuccesses += 1;
  }

  private onFailure(): void {
    const timestamp = this.now();
    this.consecutiveFailures += 1;
    this.lastFailureAt = timestamp;
    this.totalFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.openedAt = timestamp;
    }
  }
}
