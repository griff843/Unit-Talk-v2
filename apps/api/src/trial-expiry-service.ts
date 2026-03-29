import type { AuditLogRepository, MemberTierRepository } from '@unit-talk/db';

/** Canonical trial duration in days. Overridable via TRIAL_DURATION_DAYS env var. */
export const TRIAL_DURATION_DAYS = readTrialDurationDays();

function readTrialDurationDays(): number {
  const raw = process.env.TRIAL_DURATION_DAYS;
  if (!raw) return 7;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 7;
}

/**
 * Computes the effective_until date for a new trial activation.
 * Returns a Date set to `now + TRIAL_DURATION_DAYS` days.
 */
export function computeTrialEffectiveUntil(
  now: Date = new Date(),
  durationDays: number = TRIAL_DURATION_DAYS,
): Date {
  const expiry = new Date(now);
  expiry.setUTCDate(expiry.getUTCDate() + durationDays);
  return expiry;
}

export interface TrialExpiryPassResult {
  expired: number;
}

/**
 * Scans member_tiers for expired trial rows and deactivates them.
 * Returns { expired: number } — count of rows deactivated.
 */
export async function runTrialExpiryPass(
  tierRepo: MemberTierRepository,
  auditRepo: AuditLogRepository,
  now: string = new Date().toISOString(),
): Promise<TrialExpiryPassResult> {
  const expiredRows = await tierRepo.getExpiredTrials(now);
  let expired = 0;

  for (const row of expiredRows) {
    await tierRepo.deactivateTier({
      discordId: row.discord_id,
      tier: 'trial',
      changedBy: 'system:trial-expiry',
      reason: 'trial_period_expired',
    });

    await auditRepo.record({
      entityType: 'member_tiers',
      entityId: row.id,
      entityRef: row.discord_id,
      action: 'member_tier.trial_expired',
      actor: 'system:trial-expiry',
      payload: {
        discordId: row.discord_id,
        tier: 'trial',
        effectiveUntil: row.effective_until,
        expiredAt: now,
      },
    });

    expired += 1;
  }

  return { expired };
}

/**
 * Starts the trial expiry scheduler loop.
 * Fires on the configured interval (default every hour).
 * Returns a cleanup function that stops the interval.
 */
export function startTrialExpiryScheduler(
  tierRepo: MemberTierRepository,
  auditRepo: AuditLogRepository,
  options: {
    intervalMs?: number;
    logger?: Pick<Console, 'error' | 'info'>;
  } = {},
): () => void {
  const intervalMs = options.intervalMs ?? 3_600_000; // 1 hour default
  const logger = options.logger ?? console;

  const interval = setInterval(() => {
    void runTrialExpiryTick(tierRepo, auditRepo, logger);
  }, intervalMs);

  return () => {
    clearInterval(interval);
  };
}

async function runTrialExpiryTick(
  tierRepo: MemberTierRepository,
  auditRepo: AuditLogRepository,
  logger: Pick<Console, 'error' | 'info'>,
): Promise<void> {
  try {
    const result = await runTrialExpiryPass(tierRepo, auditRepo);
    logger.info(
      JSON.stringify({
        service: 'trial-expiry-scheduler',
        event: 'pass.completed',
        expired: result.expired,
      }),
    );
  } catch (err: unknown) {
    logger.error(
      JSON.stringify({
        service: 'trial-expiry-scheduler',
        event: 'pass.failed',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
