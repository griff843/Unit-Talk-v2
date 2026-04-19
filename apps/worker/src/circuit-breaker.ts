export interface CircuitBreakerOptions {
  threshold?: number;    // consecutive failures to open (default: 5)
  cooldownMs?: number;   // ms before attempting again (default: 300_000)
}

export interface CircuitState {
  consecutiveFailures: number;
  openedAt: number | null;  // Date.now() when opened, null if closed
}

export class DeliveryCircuitBreaker {
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly state: Map<string, CircuitState> = new Map();

  constructor(options: CircuitBreakerOptions = {}) {
    this.threshold = options.threshold ?? 5;
    this.cooldownMs = options.cooldownMs ?? 300_000;
  }

  /** Returns true if delivery to this target should be skipped. */
  isOpen(target: string): boolean {
    const s = this.state.get(target);
    if (!s || s.openedAt === null) return false;
    // Still cooling down?
    if (Date.now() - s.openedAt < this.cooldownMs) return true;
    // Cooldown expired — auto-reset to allow a probe
    this.reset(target);
    return false;
  }

  /** Call after every delivery failure (retryable or terminal). */
  recordFailure(target: string): void {
    const s = this.state.get(target) ?? { consecutiveFailures: 0, openedAt: null };
    s.consecutiveFailures += 1;
    if (s.consecutiveFailures >= this.threshold && s.openedAt === null) {
      s.openedAt = Date.now();
      // Caller is responsible for logging the open event
    }
    this.state.set(target, s);
  }

  /** Call after every successful delivery. Resets the counter and closes the circuit. */
  recordSuccess(target: string): void {
    this.reset(target);
  }

  /** Restore an open circuit from durable runtime state after a worker restart. */
  restoreOpen(target: string, openedAt: number): void {
    this.state.set(target, {
      consecutiveFailures: this.threshold,
      openedAt,
    });
  }

  /** Returns the estimated resume time (epoch ms) for an open circuit, or null if closed. */
  resumeAt(target: string): number | null {
    const s = this.state.get(target);
    if (!s || s.openedAt === null) return null;
    return s.openedAt + this.cooldownMs;
  }

  /** Returns all currently open targets. */
  openTargets(): string[] {
    return [...this.state.entries()]
      .filter(([, s]) => s.openedAt !== null && Date.now() - s.openedAt < this.cooldownMs)
      .map(([target]) => target);
  }

  private reset(target: string): void {
    this.state.set(target, { consecutiveFailures: 0, openedAt: null });
  }
}
