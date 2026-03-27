import type { CanonicalPick, PickLifecycleState } from '@unit-talk/contracts';
import type { PickRecord, RepositoryBundle } from '@unit-talk/db';
import { errorResponse, successResponse, type ApiResponse } from '../http.js';
import { enqueueDistributionWithRunTracking } from '../run-audit-service.js';

export interface RequeuePickControllerResult {
  outboxId: string;
  target: string;
  pickId: string;
}

const EXISTING_OUTBOX_STATUSES = ['pending', 'processing', 'sent'] as const;

export async function requeuePickController(
  pickId: string,
  repositories: RepositoryBundle,
): Promise<ApiResponse<RequeuePickControllerResult>> {
  const pick = await repositories.picks.findPickById(pickId);

  if (!pick) {
    return errorResponse(404, 'PICK_NOT_FOUND', `Pick not found: ${pickId}`);
  }

  if (pick.promotion_status !== 'qualified' || pick.promotion_target == null) {
    return errorResponse(
      422,
      'PICK_NOT_QUALIFIED',
      'Pick must be qualified with a promotion target before it can be re-queued',
    );
  }

  if (pick.status === 'settled' || pick.status === 'voided') {
    return errorResponse(
      409,
      'PICK_TERMINAL',
      `Pick ${pickId} is already ${pick.status} and cannot be re-queued`,
    );
  }

  const target = `discord:${pick.promotion_target}`;
  const existing = await repositories.outbox.findByPickAndTarget(
    pickId,
    target,
    EXISTING_OUTBOX_STATUSES,
  );

  if (existing) {
    return errorResponse(
      409,
      'ALREADY_QUEUED',
      `Pick ${pickId} already has an outbox row for ${target}`,
    );
  }

  const canonicalPick = mapPickRecordToCanonicalPick(pick);
  const tracked = await enqueueDistributionWithRunTracking(
    canonicalPick,
    target,
    'requeue',
    repositories.picks,
    repositories.outbox,
    repositories.runs,
    repositories.audit,
  );

  const outbox = await repositories.outbox.findByPickAndTarget(
    pickId,
    target,
    EXISTING_OUTBOX_STATUSES,
  );
  const outboxId = outbox?.id ?? tracked.audit.entity_id;

  if (typeof outboxId !== 'string' || outboxId.length === 0) {
    throw new Error('Requeue enqueue succeeded but outboxId was not recorded');
  }

  return successResponse(200, {
    outboxId,
    target,
    pickId,
  });
}

function mapPickRecordToCanonicalPick(pick: PickRecord): CanonicalPick {
  return {
    id: pick.id,
    submissionId: pick.submission_id ?? '',
    market: pick.market,
    selection: pick.selection,
    line: pick.line ?? undefined,
    odds: pick.odds ?? undefined,
    stakeUnits: pick.stake_units ?? undefined,
    confidence: pick.confidence ?? undefined,
    source: pick.source,
    approvalStatus: pick.approval_status as CanonicalPick['approvalStatus'],
    promotionStatus: pick.promotion_status as CanonicalPick['promotionStatus'],
    promotionTarget: (pick.promotion_target ?? undefined) as CanonicalPick['promotionTarget'],
    promotionScore: pick.promotion_score ?? undefined,
    promotionReason: pick.promotion_reason ?? undefined,
    promotionVersion: pick.promotion_version ?? undefined,
    promotionDecidedAt: pick.promotion_decided_at ?? undefined,
    promotionDecidedBy: pick.promotion_decided_by ?? undefined,
    lifecycleState: pick.status as PickLifecycleState,
    metadata: isRecord(pick.metadata) ? pick.metadata : {},
    createdAt: pick.created_at,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
