import type { Logger } from '@unit-talk/observability';

// ---------------------------------------------------------------------------
// Delivery Alerting
//
// Operational concern only — no business logic. Emits structured alert-level
// log events so operators can detect dead-letter conditions, repeated failures,
// and degraded delivery states without manual polling.
// ---------------------------------------------------------------------------

/** Configuration for the delivery alert monitor. */
export interface DeliveryAlertConfig {
  /** Consecutive failure count before emitting a repeated-failure alert. Default: 3. */
  consecutiveFailureThreshold: number;
  /** Time window (ms) for computing failure rate. Default: 300_000 (5 min). */
  degradedWindowMs: number;
  /** Failure rate (0-1) within the window that triggers a degraded alert. Default: 0.5. */
  degradedRateThreshold: number;
}

export const DEFAULT_ALERT_CONFIG: DeliveryAlertConfig = {
  consecutiveFailureThreshold: 3,
  degradedWindowMs: 300_000,
  degradedRateThreshold: 0.5,
};

/** Structured payload emitted with every alert log. */
export interface DeliveryAlertEvent {
  alertType: 'dead-letter' | 'repeated-failure' | 'degraded-delivery';
  target: string;
  outboxId?: string;
  reason?: string;
  consecutiveFailures?: number;
  failureRate?: number;
  windowMs?: number;
  totalInWindow?: number;
  failuresInWindow?: number;
}

interface OutcomeEntry {
  timestamp: number;
  success: boolean;
}

interface TargetState {
  consecutiveFailures: number;
  outcomes: OutcomeEntry[];
}

/**
 * Monitors delivery outcomes per target and emits structured alert-level logs.
 *
 * Usage:
 * - Call `onDeadLetter()` when an outbox row transitions to dead_letter.
 * - Call `onDeliveryFailure()` on every retryable or terminal failure.
 * - Call `onDeliverySuccess()` on every successful delivery.
 *
 * The monitor is stateful per target and should live for the lifetime of the
 * worker process. It does NOT contain business logic — it is purely an
 * operational observability concern.
 */
export class DeliveryAlertMonitor {
  private readonly config: DeliveryAlertConfig;
  private readonly logger: Logger;
  private readonly state = new Map<string, TargetState>();
  private readonly _emittedAlerts: DeliveryAlertEvent[] = [];

  constructor(logger: Logger, config?: Partial<DeliveryAlertConfig>) {
    this.config = { ...DEFAULT_ALERT_CONFIG, ...config };
    this.logger = logger;
  }

  /** Read-only access to emitted alerts (useful for testing). */
  get emittedAlerts(): readonly DeliveryAlertEvent[] {
    return this._emittedAlerts;
  }

  /**
   * Call when an outbox row transitions to dead_letter state.
   * Always emits an alert — dead-letter is a terminal condition.
   */
  onDeadLetter(target: string, outboxId: string, reason: string): void {
    const alert: DeliveryAlertEvent = {
      alertType: 'dead-letter',
      target,
      outboxId,
      reason,
    };
    this.emit(alert);
  }

  /**
   * Call on every delivery failure (retryable or terminal).
   * Tracks consecutive failures and failure rate, emitting alerts
   * when thresholds are exceeded.
   */
  onDeliveryFailure(target: string, outboxId?: string, reason?: string): void {
    const state = this.getOrCreateState(target);
    state.consecutiveFailures += 1;
    state.outcomes.push({ timestamp: Date.now(), success: false });

    if (state.consecutiveFailures >= this.config.consecutiveFailureThreshold) {
      const alert: DeliveryAlertEvent = {
        alertType: 'repeated-failure',
        target,
        consecutiveFailures: state.consecutiveFailures,
        ...(outboxId !== undefined ? { outboxId } : {}),
        ...(reason !== undefined ? { reason } : {}),
      };
      this.emit(alert);
    }

    this.checkDegradedState(target, state);
  }

  /**
   * Call on every successful delivery. Resets consecutive failure counter.
   */
  onDeliverySuccess(target: string): void {
    const state = this.getOrCreateState(target);
    state.consecutiveFailures = 0;
    state.outcomes.push({ timestamp: Date.now(), success: true });
  }

  private getOrCreateState(target: string): TargetState {
    let state = this.state.get(target);
    if (!state) {
      state = { consecutiveFailures: 0, outcomes: [] };
      this.state.set(target, state);
    }
    return state;
  }

  private checkDegradedState(target: string, state: TargetState): void {
    const cutoff = Date.now() - this.config.degradedWindowMs;
    const recentOutcomes = state.outcomes.filter((o) => o.timestamp >= cutoff);

    if (recentOutcomes.length === 0) return;

    const failures = recentOutcomes.filter((o) => !o.success).length;
    const rate = failures / recentOutcomes.length;

    if (rate >= this.config.degradedRateThreshold) {
      const alert: DeliveryAlertEvent = {
        alertType: 'degraded-delivery',
        target,
        failureRate: Math.round(rate * 1000) / 1000,
        windowMs: this.config.degradedWindowMs,
        totalInWindow: recentOutcomes.length,
        failuresInWindow: failures,
      };
      this.emit(alert);
    }

    // Prune old entries to prevent unbounded memory growth
    state.outcomes = recentOutcomes;
  }

  private emit(alert: DeliveryAlertEvent): void {
    this._emittedAlerts.push(alert);
    this.logger.error(`delivery-alert: ${alert.alertType}`, undefined, {
      alertType: alert.alertType,
      target: alert.target,
      ...(alert.outboxId !== undefined ? { outboxId: alert.outboxId } : {}),
      ...(alert.reason !== undefined ? { reason: alert.reason } : {}),
      ...(alert.consecutiveFailures !== undefined ? { consecutiveFailures: alert.consecutiveFailures } : {}),
      ...(alert.failureRate !== undefined ? { failureRate: alert.failureRate } : {}),
      ...(alert.windowMs !== undefined ? { windowMs: alert.windowMs } : {}),
      ...(alert.totalInWindow !== undefined ? { totalInWindow: alert.totalInWindow } : {}),
      ...(alert.failuresInWindow !== undefined ? { failuresInWindow: alert.failuresInWindow } : {}),
    });
  }
}
