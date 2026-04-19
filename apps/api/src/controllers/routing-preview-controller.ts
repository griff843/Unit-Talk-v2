import type { OutboxRecord, RepositoryBundle } from '@unit-talk/db';
import type { ApiResponse } from '../http.js';
import { errorResponse, successResponse } from '../http.js';

export interface RoutingPreviewResult {
  pickId: string;
  status: string;
  promotionTarget: string | null;
  distributionTarget: string | null;
  routingReason: string;
  outboxStatus: string;
}

export async function routingPreviewController(
  pickId: string,
  repositories: RepositoryBundle,
): Promise<ApiResponse<RoutingPreviewResult>> {
  const pick = await repositories.picks.findPickById(pickId);
  if (!pick) {
    return errorResponse(404, 'PICK_NOT_FOUND', `Pick not found: ${pickId}`);
  }

  const outboxRows = await repositories.outbox.listByPickId(pickId);
  const latestOutbox = findLatestOutbox(outboxRows);
  const promotionTarget = pick.promotion_target ?? null;
  const distributionTarget = latestOutbox?.target ?? null;
  const outboxStatus = latestOutbox?.status ?? 'not_enqueued';

  return successResponse(200, {
    pickId,
    status: pick.status,
    promotionTarget,
    distributionTarget,
    outboxStatus,
    routingReason: buildRoutingReason({
      status: pick.status,
      promotionStatus: pick.promotion_status,
      promotionTarget,
      distributionTarget,
      outboxStatus,
    }),
  });
}

function findLatestOutbox(rows: OutboxRecord[]): OutboxRecord | null {
  return [...rows].sort((left, right) => right.created_at.localeCompare(left.created_at))[0] ?? null;
}

function buildRoutingReason(input: {
  status: string;
  promotionStatus: string;
  promotionTarget: string | null;
  distributionTarget: string | null;
  outboxStatus: string;
}) {
  if (!input.promotionTarget) {
    return `Pick status is ${input.status}; no promotion target is set.`;
  }

  if (input.promotionStatus !== 'qualified' && input.promotionStatus !== 'promoted') {
    return `Promotion status is ${input.promotionStatus}; live routing requires qualified promotion.`;
  }

  const expectedTarget = `discord:${input.promotionTarget}`;
  if (!input.distributionTarget) {
    return `Pick qualifies for ${expectedTarget}, but no distribution_outbox row exists yet.`;
  }

  if (input.distributionTarget !== expectedTarget) {
    return `Outbox target ${input.distributionTarget} differs from promoted target ${expectedTarget}.`;
  }

  return `Pick qualifies for ${expectedTarget}; outbox status is ${input.outboxStatus}.`;
}
