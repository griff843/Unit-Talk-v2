import type { AuditLogRepository, MemberTierRepository } from '@unit-talk/db';

export interface TrialExpiryScanResult {
  scanned: number;
  expired: number;
  errors: number;
}

/**
 * Scans for expired trial tier rows and deactivates them, writing audit log entries.
 *
 * A trial row is expired when effective_until < now. The scanner:
 * 1. Finds all expired trial rows via getExpiredActiveTrials()
 * 2. Calls deactivateTier() for each (no-op if already deactivated)
 * 3. Writes a member_tier.trial_expired audit log entry
 */
export async function deactivateExpiredTrials(
  memberTierRepository: MemberTierRepository,
  auditLogRepository: AuditLogRepository,
  as_of?: string,
): Promise<TrialExpiryScanResult> {
  const now = as_of ?? new Date().toISOString();
  const expiredRows = await memberTierRepository.getExpiredActiveTrials(now);

  let expired = 0;
  let errors = 0;

  for (const row of expiredRows) {
    try {
      await memberTierRepository.deactivateTier({
        discordId: row.discord_id,
        tier: 'trial',
        changedBy: 'trial-expiry-scanner',
        reason: `trial expired at ${row.effective_until}`,
      });

      await auditLogRepository.record({
        entityType: 'member_tier',
        entityId: row.id,
        entityRef: row.discord_id,
        action: 'member_tier.trial_expired',
        actor: 'trial-expiry-scanner',
        payload: {
          discordId: row.discord_id,
          discordUsername: row.discord_username,
          tierId: row.id,
          effectiveUntil: row.effective_until,
          expiredAt: now,
        },
      });

      expired += 1;
    } catch (err) {
      console.error(
        `[trial-expiry-scanner] Failed to deactivate trial for ${row.discord_id}:`,
        err instanceof Error ? err.message : String(err),
      );
      errors += 1;
    }
  }

  return { scanned: expiredRows.length, expired, errors };
}
