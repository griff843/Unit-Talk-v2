import type { OutboxRecord, RepositoryBundle } from '@unit-talk/db';

export const MAX_AUTO_RECOVERY_ATTEMPTS = 3;
const AUTO_RECOVERY_SCAN_LIMIT = 20;

// Explicitly allowlisted exception classes for dead-letter recovery.
// Recovery is deny-by-default: only these classes permit automatic recovery.
export const RECOVERY_EXCEPTION_CLASSES = {
  NETWORK_FETCH: 'network_fetch',
  NETWORK_RESET: 'network_reset',
  CONNECTION_REFUSED: 'connection_refused',
  TIMEOUT: 'timeout',
  DNS_FAILURE: 'dns_failure',
  HTTP_RATE_LIMIT: 'http_rate_limit',
  HTTP_GATEWAY: 'http_gateway',
  HTML_RESPONSE: 'html_response',
} as const;

export type RecoveryExceptionClass =
  (typeof RECOVERY_EXCEPTION_CLASSES)[keyof typeof RECOVERY_EXCEPTION_CLASSES];

// These patterns BLOCK recovery regardless of other error content.
// Denylist is checked first — any match refuses recovery.
const RECOVERY_DENYLIST_PATTERNS = [
  'schema drift',
  'foreign key',
  'fk violation',
  'lifecycle invariant',
  'invalidtransitionerror',
  'invalid transition',
  'settlement mismatch',
  'proof failure',
  'business rule',
  'check constraint',
  'unique constraint',
  'duplicate key',
  'violates',
] as const;

// Explicit mapping from exception class to matching error patterns.
// Unknown errors matching no class are denied (fail closed).
const EXCEPTION_CLASS_PATTERNS: Array<{
  cls: RecoveryExceptionClass;
  patterns: readonly string[];
}> = [
  {
    cls: RECOVERY_EXCEPTION_CLASSES.NETWORK_FETCH,
    patterns: ['fetch failed', 'TypeError: fetch'],
  },
  { cls: RECOVERY_EXCEPTION_CLASSES.NETWORK_RESET, patterns: ['ECONNRESET'] },
  { cls: RECOVERY_EXCEPTION_CLASSES.CONNECTION_REFUSED, patterns: ['ECONNREFUSED'] },
  { cls: RECOVERY_EXCEPTION_CLASSES.TIMEOUT, patterns: ['ETIMEDOUT'] },
  { cls: RECOVERY_EXCEPTION_CLASSES.DNS_FAILURE, patterns: ['ENOTFOUND'] },
  { cls: RECOVERY_EXCEPTION_CLASSES.HTTP_RATE_LIMIT, patterns: ['429'] },
  {
    cls: RECOVERY_EXCEPTION_CLASSES.HTTP_GATEWAY,
    patterns: ['502', '503', '504', '521', 'Bad gateway', 'Service Unavailable', 'Web server is down'],
  },
  { cls: RECOVERY_EXCEPTION_CLASSES.HTML_RESPONSE, patterns: ['<!DOCTYPE'] },
];

export interface ExceptionClassification {
  allowed: boolean;
  exceptionClass: RecoveryExceptionClass | 'denylist' | 'unknown' | 'no_error';
}

/**
 * Classifies an error string into a recovery exception class.
 * Deny-by-default: null, unknown, and denylist-matched errors return allowed=false.
 * Every classification result is replay-visible via the recovery_exception_gated audit event.
 */
export function classifyException(error: string | null): ExceptionClassification {
  if (!error) {
    return { allowed: false, exceptionClass: 'no_error' };
  }

  const lower = error.toLowerCase();

  // Denylist wins — hard business/lifecycle errors must never auto-recover
  if (RECOVERY_DENYLIST_PATTERNS.some((p) => lower.includes(p.toLowerCase()))) {
    return { allowed: false, exceptionClass: 'denylist' };
  }

  // Match against explicitly allowlisted exception classes
  for (const { cls, patterns } of EXCEPTION_CLASS_PATTERNS) {
    if (patterns.some((p) => error.includes(p))) {
      return { allowed: true, exceptionClass: cls };
    }
  }

  // Unknown exception type — fail closed
  return { allowed: false, exceptionClass: 'unknown' };
}

export function isRecoveryEnabled(): boolean {
  return process.env['AUTOMATED_RECOVERY_ENABLED'] === 'true';
}

export function isEligibleForAutoRecovery(row: OutboxRecord): boolean {
  if (row.status !== 'failed' && row.status !== 'dead_letter') return false;
  if (row.attempt_count >= MAX_AUTO_RECOVERY_ATTEMPTS) return false;
  return classifyException(row.last_error).allowed;
}

export interface AutoRecoveryResult {
  recovered: number;
  skipped: number;
  errors: string[];
  correlationId: string;
}

export async function runAutoRecoverySweep(
  repositories: RepositoryBundle,
  correlationId: string,
  isEnabled: () => boolean = isRecoveryEnabled,
): Promise<AutoRecoveryResult> {
  if (!isEnabled()) {
    return { recovered: 0, skipped: 0, errors: [], correlationId };
  }

  const rows = await repositories.outbox.listForAutoRecovery(
    MAX_AUTO_RECOVERY_ATTEMPTS,
    AUTO_RECOVERY_SCAN_LIMIT,
  );

  let recovered = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of rows) {
    // Kill-switch: check before each row so mid-sweep disable halts safely
    if (!isEnabled()) {
      skipped += rows.length - recovered - skipped - errors.length;
      break;
    }

    if (row.status !== 'failed' && row.status !== 'dead_letter') {
      skipped++;
      continue;
    }

    const classification = classifyException(row.last_error);

    if (!classification.allowed) {
      // Every denied recovery decision is recorded for replay visibility
      try {
        await repositories.audit.record({
          entityType: 'distribution_outbox',
          entityId: row.id,
          entityRef: row.pick_id,
          action: 'distribution.recovery_exception_gated',
          actor: 'system.automated-recovery',
          payload: {
            correlationId,
            decision: 'denied',
            exceptionClass: classification.exceptionClass,
            lastError: row.last_error,
            attemptCount: row.attempt_count,
            status: row.status,
          },
        });
      } catch (auditErr) {
        errors.push(
          `Failed to record denial audit for outbox ${row.id}: ${auditErr instanceof Error ? auditErr.message : String(auditErr)}`,
        );
      }
      skipped++;
      continue;
    }

    try {
      const originalFailureReason = row.last_error;
      const previousStatus = row.status;
      const attemptCountBefore = row.attempt_count;

      const updated = await repositories.outbox.resetForAutoRecovery(row.id, previousStatus);
      if (!updated) {
        // Conditional update matched no rows — already recovered by another cycle
        skipped++;
        continue;
      }

      // Record approved gating decision (replay-visible before the reset is acted on)
      await repositories.audit.record({
        entityType: 'distribution_outbox',
        entityId: row.id,
        entityRef: row.pick_id,
        action: 'distribution.recovery_exception_gated',
        actor: 'system.automated-recovery',
        payload: {
          correlationId,
          decision: 'approved',
          exceptionClass: classification.exceptionClass,
          lastError: originalFailureReason,
          attemptCount: attemptCountBefore,
          status: previousStatus,
        },
      });

      // Record recovery outcome
      await repositories.audit.record({
        entityType: 'distribution_outbox',
        entityId: row.id,
        entityRef: row.pick_id,
        action: 'distribution.auto_recovered',
        actor: 'system.automated-recovery',
        payload: {
          correlationId,
          recoveryReason: 'transient_infrastructure_failure',
          originalFailureReason,
          replayTarget: row.target,
          recoveredAt: new Date().toISOString(),
          recoveryOutcome: 'reset_to_pending',
          attemptCountBefore,
          previousStatus,
          exceptionClass: classification.exceptionClass,
        },
      });

      recovered++;
    } catch (err) {
      errors.push(
        `Failed to recover outbox ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { recovered, skipped, errors, correlationId };
}
