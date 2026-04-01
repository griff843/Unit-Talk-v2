import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLogger, type LogLevel, type StructuredLogEntry } from '@unit-talk/observability';
import { DeliveryAlertMonitor, DEFAULT_ALERT_CONFIG } from './delivery-alerting.js';

function createTestLogger() {
  const entries: Array<{ level: LogLevel; entry: StructuredLogEntry }> = [];
  const logger = createLogger({
    service: 'worker-test',
    now: () => '2026-04-01T00:00:00.000Z',
    writer: {
      write(level: LogLevel, entry: StructuredLogEntry) {
        entries.push({ level, entry });
      },
    },
  });
  return { logger, entries };
}

// ---------------------------------------------------------------------------
// Dead-letter alerts
// ---------------------------------------------------------------------------

describe('DeliveryAlertMonitor dead-letter alerts', () => {
  it('emits alert on dead-letter event', () => {
    const { logger, entries } = createTestLogger();
    const monitor = new DeliveryAlertMonitor(logger);

    monitor.onDeadLetter('discord:canary', 'outbox-1', 'terminal failure');

    assert.equal(monitor.emittedAlerts.length, 1);
    assert.equal(monitor.emittedAlerts[0]?.alertType, 'dead-letter');
    assert.equal(monitor.emittedAlerts[0]?.target, 'discord:canary');
    assert.equal(monitor.emittedAlerts[0]?.outboxId, 'outbox-1');
    assert.equal(monitor.emittedAlerts[0]?.reason, 'terminal failure');

    // Verify structured log was emitted at error level
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.level, 'error');
    assert.equal(entries[0]?.entry.alertType, 'dead-letter');
    assert.equal(entries[0]?.entry.target, 'discord:canary');
  });

  it('emits separate alerts for each dead-letter event', () => {
    const { logger } = createTestLogger();
    const monitor = new DeliveryAlertMonitor(logger);

    monitor.onDeadLetter('discord:canary', 'outbox-1', 'reason-1');
    monitor.onDeadLetter('discord:best-bets', 'outbox-2', 'reason-2');

    assert.equal(monitor.emittedAlerts.length, 2);
    assert.equal(monitor.emittedAlerts[0]?.target, 'discord:canary');
    assert.equal(monitor.emittedAlerts[1]?.target, 'discord:best-bets');
  });
});

// ---------------------------------------------------------------------------
// Repeated failure alerts
// ---------------------------------------------------------------------------

describe('DeliveryAlertMonitor repeated failure alerts', () => {
  it('does not alert below consecutive failure threshold', () => {
    const { logger } = createTestLogger();
    const monitor = new DeliveryAlertMonitor(logger, {
      consecutiveFailureThreshold: 3,
      degradedRateThreshold: 1.0, // disable degraded alerts for this test
    });

    monitor.onDeliveryFailure('discord:canary', 'outbox-1', 'timeout');
    monitor.onDeliveryFailure('discord:canary', 'outbox-2', 'timeout');

    // Only degraded alerts would fire if threshold was met, but we set it to 1.0
    const repeatedAlerts = monitor.emittedAlerts.filter(
      (a) => a.alertType === 'repeated-failure',
    );
    assert.equal(repeatedAlerts.length, 0);
  });

  it('alerts when consecutive failures reach threshold', () => {
    const { logger } = createTestLogger();
    const monitor = new DeliveryAlertMonitor(logger, {
      consecutiveFailureThreshold: 3,
      degradedRateThreshold: 1.0,
    });

    monitor.onDeliveryFailure('discord:canary', 'outbox-1', 'timeout');
    monitor.onDeliveryFailure('discord:canary', 'outbox-2', 'timeout');
    monitor.onDeliveryFailure('discord:canary', 'outbox-3', 'timeout');

    const repeatedAlerts = monitor.emittedAlerts.filter(
      (a) => a.alertType === 'repeated-failure',
    );
    assert.equal(repeatedAlerts.length, 1);
    assert.equal(repeatedAlerts[0]?.consecutiveFailures, 3);
  });

  it('continues alerting on each subsequent failure after threshold', () => {
    const { logger } = createTestLogger();
    const monitor = new DeliveryAlertMonitor(logger, {
      consecutiveFailureThreshold: 2,
      degradedRateThreshold: 1.0,
    });

    monitor.onDeliveryFailure('discord:canary');
    monitor.onDeliveryFailure('discord:canary');
    monitor.onDeliveryFailure('discord:canary');

    const repeatedAlerts = monitor.emittedAlerts.filter(
      (a) => a.alertType === 'repeated-failure',
    );
    assert.equal(repeatedAlerts.length, 2);
    assert.equal(repeatedAlerts[0]?.consecutiveFailures, 2);
    assert.equal(repeatedAlerts[1]?.consecutiveFailures, 3);
  });

  it('resets consecutive counter on success', () => {
    const { logger } = createTestLogger();
    const monitor = new DeliveryAlertMonitor(logger, {
      consecutiveFailureThreshold: 3,
      degradedRateThreshold: 1.0,
    });

    monitor.onDeliveryFailure('discord:canary');
    monitor.onDeliveryFailure('discord:canary');
    monitor.onDeliverySuccess('discord:canary');
    monitor.onDeliveryFailure('discord:canary');
    monitor.onDeliveryFailure('discord:canary');

    const repeatedAlerts = monitor.emittedAlerts.filter(
      (a) => a.alertType === 'repeated-failure',
    );
    assert.equal(repeatedAlerts.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Degraded delivery alerts
// ---------------------------------------------------------------------------

describe('DeliveryAlertMonitor degraded delivery alerts', () => {
  it('alerts when failure rate exceeds threshold in window', () => {
    const { logger } = createTestLogger();
    const monitor = new DeliveryAlertMonitor(logger, {
      consecutiveFailureThreshold: 100, // disable repeated-failure for this test
      degradedWindowMs: 600_000,
      degradedRateThreshold: 0.5,
    });

    // 3 failures, 1 success = 75% failure rate over the window.
    // Degraded check runs on each failure call, so the first alert fires
    // once the rate crosses 0.5 (at 2nd failure: 1 success + 2 failures = 66%).
    monitor.onDeliverySuccess('discord:canary');
    monitor.onDeliveryFailure('discord:canary');
    monitor.onDeliveryFailure('discord:canary');
    monitor.onDeliveryFailure('discord:canary');

    const degradedAlerts = monitor.emittedAlerts.filter(
      (a) => a.alertType === 'degraded-delivery',
    );
    assert.ok(degradedAlerts.length >= 1, 'expected at least one degraded alert');
    assert.equal(degradedAlerts[0]?.target, 'discord:canary');
    assert.ok(
      (degradedAlerts[0]?.failureRate ?? 0) >= 0.5,
      `failure rate ${degradedAlerts[0]?.failureRate} should be >= 0.5`,
    );
    // The last degraded alert has the full window state
    const lastAlert = degradedAlerts[degradedAlerts.length - 1]!;
    assert.equal(lastAlert.totalInWindow, 4);
    assert.equal(lastAlert.failuresInWindow, 3);
  });

  it('does not alert when failure rate is below threshold', () => {
    const { logger } = createTestLogger();
    const monitor = new DeliveryAlertMonitor(logger, {
      consecutiveFailureThreshold: 100,
      degradedWindowMs: 600_000,
      degradedRateThreshold: 0.8,
    });

    // 1 failure, 3 successes = 25% failure rate
    monitor.onDeliverySuccess('discord:canary');
    monitor.onDeliverySuccess('discord:canary');
    monitor.onDeliverySuccess('discord:canary');
    monitor.onDeliveryFailure('discord:canary');

    const degradedAlerts = monitor.emittedAlerts.filter(
      (a) => a.alertType === 'degraded-delivery',
    );
    assert.equal(degradedAlerts.length, 0);
  });

  it('tracks targets independently', () => {
    const { logger } = createTestLogger();
    const monitor = new DeliveryAlertMonitor(logger, {
      consecutiveFailureThreshold: 2,
      degradedRateThreshold: 1.0,
    });

    monitor.onDeliveryFailure('discord:canary');
    monitor.onDeliveryFailure('discord:best-bets');
    monitor.onDeliveryFailure('discord:canary');

    const repeatedAlerts = monitor.emittedAlerts.filter(
      (a) => a.alertType === 'repeated-failure',
    );
    assert.equal(repeatedAlerts.length, 1);
    assert.equal(repeatedAlerts[0]?.target, 'discord:canary');
  });
});

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

describe('DeliveryAlertMonitor default config', () => {
  it('uses default thresholds', () => {
    assert.equal(DEFAULT_ALERT_CONFIG.consecutiveFailureThreshold, 3);
    assert.equal(DEFAULT_ALERT_CONFIG.degradedWindowMs, 300_000);
    assert.equal(DEFAULT_ALERT_CONFIG.degradedRateThreshold, 0.5);
  });

  it('partial config overrides merge with defaults', () => {
    const { logger } = createTestLogger();
    const monitor = new DeliveryAlertMonitor(logger, {
      consecutiveFailureThreshold: 5,
    });

    // Should use 5 for threshold but keep defaults for window/rate
    for (let i = 0; i < 4; i++) {
      monitor.onDeliveryFailure('discord:canary');
    }
    const repeatedAlerts = monitor.emittedAlerts.filter(
      (a) => a.alertType === 'repeated-failure',
    );
    assert.equal(repeatedAlerts.length, 0, 'should not alert below custom threshold of 5');

    monitor.onDeliveryFailure('discord:canary');
    const afterFifth = monitor.emittedAlerts.filter(
      (a) => a.alertType === 'repeated-failure',
    );
    assert.equal(afterFifth.length, 1, 'should alert at custom threshold of 5');
  });
});

// ---------------------------------------------------------------------------
// Combined scenario: dead-letter + repeated failure
// ---------------------------------------------------------------------------

describe('DeliveryAlertMonitor combined scenarios', () => {
  it('emits both dead-letter and repeated-failure alerts when both conditions met', () => {
    const { logger, entries } = createTestLogger();
    const monitor = new DeliveryAlertMonitor(logger, {
      consecutiveFailureThreshold: 2,
      degradedRateThreshold: 1.0,
    });

    monitor.onDeliveryFailure('discord:canary', 'outbox-1', 'retryable');
    monitor.onDeliveryFailure('discord:canary', 'outbox-1', 'retryable');
    monitor.onDeadLetter('discord:canary', 'outbox-1', 'max retries exceeded');

    const deadLetterAlerts = monitor.emittedAlerts.filter((a) => a.alertType === 'dead-letter');
    const repeatedAlerts = monitor.emittedAlerts.filter((a) => a.alertType === 'repeated-failure');

    assert.equal(deadLetterAlerts.length, 1);
    assert.equal(repeatedAlerts.length, 1);

    // All alerts logged at error level
    assert.ok(entries.every((e) => e.level === 'error'));
  });
});
