import type { AuditLogRepository, PickRecord, PickRepository } from '@unit-talk/db';
import { createLogger } from '@unit-talk/observability';

const logger = createLogger({ service: 'api', fields: { component: 'stranded-pick-reconciler' } });

const DEFAULT_STRANDED_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export interface StrandedPicksResult {
  stranded: PickRecord[];
  checkedAt: string;
  thresholdMs: number;
}

/**
 * Finds picks stuck in 'submitted' lifecycle state with no promotion_target set.
 * These are picks where evaluateAllPoliciesEagerAndPersist threw after the atomic
 * insert succeeded (UTV2-1018). Threshold guards against false positives on brand-new picks.
 */
export async function detectStrandedPicks(
  pickRepository: PickRepository,
  thresholdMs = DEFAULT_STRANDED_THRESHOLD_MS,
): Promise<StrandedPicksResult> {
  const checkedAt = new Date().toISOString();
  const cutoff = new Date(Date.now() - thresholdMs);

  const candidates = await pickRepository.listByLifecycleState('validated', 200);

  const stranded = candidates.filter(
    (p) =>
      p.promotion_target === null &&
      p.created_at != null &&
      new Date(p.created_at) < cutoff,
  );

  if (stranded.length > 0) {
    logger.warn('stranded-picks-detected', {
      count: stranded.length,
      pickIds: stranded.map((p) => p.id),
    });
  }

  return { stranded, checkedAt, thresholdMs };
}

/**
 * Writes an audit record for each stranded pick to surface them in the audit log.
 * Does not modify pick state — detection only.
 */
export async function auditStrandedPicks(
  picks: PickRecord[],
  auditRepository: AuditLogRepository,
): Promise<void> {
  for (const pick of picks) {
    await auditRepository.record({
      entityType: 'pick',
      entityId: pick.id,
      entityRef: pick.id,
      action: 'stranded_pick_detected',
      actor: 'stranded-pick-reconciler',
      payload: {
        pickId: pick.id,
        createdAt: pick.created_at,
        promotionTarget: pick.promotion_target,
        detectedAt: new Date().toISOString(),
      },
    });
  }
}
