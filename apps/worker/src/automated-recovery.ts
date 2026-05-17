import type { OutboxRecord, RepositoryBundle } from '@unit-talk/db';

export const MAX_AUTO_RECOVERY_ATTEMPTS = 3;
const AUTO_RECOVERY_SCAN_LIMIT = 20;

// These patterns BLOCK recovery regardless of other error content.
// Checked first — any match refuses recovery.
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

// Only these transient infrastructure patterns are eligible for auto-recovery.
// Unknown errors that match neither list are NOT recoverable (fail closed).
const TRANSIENT_RECOVERY_PATTERNS = [
  'fetch failed',
  'TypeError: fetch',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  '502',
  '503',
  '504',
  '521',
  '429',
  'Bad gateway',
  'Service Unavailable',
  'Web server is down',
  '<!DOCTYPE',
] as const;

export function isRecoveryEnabled(): boolean {
  return process.env['AUTOMATED_RECOVERY_ENABLED'] === 'true';
}

export function isEligibleForAutoRecovery(row: OutboxRecord): boolean {
  if (row.status !== 'failed' && row.status !== 'dead_letter') return false;
  if (row.attempt_count >= MAX_AUTO_RECOVERY_ATTEMPTS) return false;
  if (!row.last_error) return false;

  const err = row.last_error;
  const lower = err.toLowerCase();

  // Denylist first — any match blocks recovery
  if (RECOVERY_DENYLIST_PATTERNS.some((p) => lower.includes(p.toLowerCase()))) return false;

  // Must match at least one allowlist pattern — unknown errors are not recoverable
  return TRANSIENT_RECOVERY_PATTERNS.some((p) => err.includes(p));
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

    if (!isEligibleForAutoRecovery(row)) {
      skipped++;
      continue;
    }

    try {
      // Capture mutable fields before reset — InMemory repos mutate the same object
      const originalFailureReason = row.last_error;
      const previousStatus = row.status;
      const attemptCountBefore = row.attempt_count;

      const updated = await repositories.outbox.resetForAutoRecovery(row.id, previousStatus);
      if (!updated) {
        // Conditional update matched no rows — already recovered by another cycle
        skipped++;
        continue;
      }

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
