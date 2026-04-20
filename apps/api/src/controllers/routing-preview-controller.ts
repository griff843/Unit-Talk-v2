import type { OutboxRecord, RepositoryBundle } from '@unit-talk/db';
import type { PickSource } from '@unit-talk/contracts';
import type { ApiResponse } from '../http.js';
import { errorResponse, successResponse } from '../http.js';
import { isGovernanceBrakeSource } from '../distribution-service.js';

export interface RoutingPreviewResult {
  pickId: string;
  status: string;
  source: string | null;

  /** Current promotion state */
  promotionTarget: string | null;
  promotionStatus: string | null;
  promotionScore: number | null;
  promotionReason: string | null;

  /** Distribution state */
  distributionTarget: string | null;
  outboxStatus: string;
  outboxAttemptCount: number;

  /** Gate checks — why the pick is/isn't routing */
  gateChecks: GateCheck[];

  /** Human-readable routing explanation */
  routingExplanation: string;
}

interface GateCheck {
  gate: string;
  passed: boolean;
  detail: string;
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
  const outboxAttemptCount = latestOutbox?.attempt_count ?? 0;

  // Run gate checks
  const gateChecks = buildGateChecks({
    status: pick.status,
    source: pick.source,
    promotionStatus: pick.promotion_status,
    promotionTarget,
    distributionTarget,
    outboxStatus,
    approvalStatus: pick.approval_status,
  });

  const routingExplanation = buildRoutingExplanation({
    status: pick.status,
    source: pick.source,
    promotionStatus: pick.promotion_status,
    promotionTarget,
    promotionScore: pick.promotion_score,
    promotionReason: pick.promotion_reason,
    distributionTarget,
    outboxStatus,
    outboxAttemptCount,
    approvalStatus: pick.approval_status,
    gateChecks,
  });

  return successResponse(200, {
    pickId,
    status: pick.status,
    source: pick.source ?? null,
    promotionTarget,
    promotionStatus: pick.promotion_status ?? null,
    promotionScore: pick.promotion_score ?? null,
    promotionReason: pick.promotion_reason ?? null,
    distributionTarget,
    outboxStatus,
    outboxAttemptCount,
    gateChecks,
    routingExplanation,
  });
}

function findLatestOutbox(rows: OutboxRecord[]): OutboxRecord | null {
  return [...rows].sort((left, right) => right.created_at.localeCompare(left.created_at))[0] ?? null;
}

function buildGateChecks(input: {
  status: string;
  source: string | null;
  promotionStatus: string;
  promotionTarget: string | null;
  distributionTarget: string | null;
  outboxStatus: string;
  approvalStatus: string | null;
}): GateCheck[] {
  const checks: GateCheck[] = [];

  // 1. Lifecycle state gate
  const validStatuses = new Set(['validated', 'queued', 'posted']);
  checks.push({
    gate: 'lifecycle_state',
    passed: validStatuses.has(input.status),
    detail: validStatuses.has(input.status)
      ? `Pick status "${input.status}" is eligible for routing`
      : `Pick status "${input.status}" is not eligible — must be validated/queued/posted`,
  });

  // 2. Governance brake gate
  const brakeApplied = input.source ? isGovernanceBrakeSource(input.source as PickSource) : false;
  checks.push({
    gate: 'governance_brake',
    passed: !brakeApplied,
    detail: brakeApplied
      ? `Source "${input.source}" is blocked by Phase 7A governance brake — requires operator approval`
      : `Source "${input.source ?? 'unknown'}" is not brake-blocked`,
  });

  // 3. Approval status gate (for awaiting_approval picks)
  const needsApproval = input.approvalStatus === 'awaiting_approval' || input.status === 'awaiting_approval';
  checks.push({
    gate: 'approval_status',
    passed: !needsApproval,
    detail: needsApproval
      ? `Pick is awaiting_approval — operator must approve before routing`
      : `No approval hold — pick can proceed`,
  });

  // 4. Promotion qualification gate
  const isQualified = input.promotionStatus === 'qualified' || input.promotionStatus === 'promoted';
  checks.push({
    gate: 'promotion_qualified',
    passed: isQualified,
    detail: isQualified
      ? `Promotion status "${input.promotionStatus}" — qualified for target "${input.promotionTarget}"`
      : `Promotion status "${input.promotionStatus}" — not qualified for any target`,
  });

  // 5. Distribution enqueue gate
  const isEnqueued = input.distributionTarget !== null;
  checks.push({
    gate: 'distribution_enqueued',
    passed: isEnqueued,
    detail: isEnqueued
      ? `Enqueued for delivery to "${input.distributionTarget}" (status: ${input.outboxStatus})`
      : `Not enqueued — no distribution_outbox row exists`,
  });

  // 6. Delivery completion gate
  const isDelivered = input.outboxStatus === 'sent';
  checks.push({
    gate: 'delivery_complete',
    passed: isDelivered,
    detail: isDelivered
      ? `Delivery complete — pick was sent to "${input.distributionTarget}"`
      : input.outboxStatus === 'dead_letter'
        ? `Delivery failed permanently — dead_letter after max retries`
        : `Delivery status: ${input.outboxStatus}`,
  });

  return checks;
}

function buildRoutingExplanation(input: {
  status: string;
  source: string | null;
  promotionStatus: string;
  promotionTarget: string | null;
  promotionScore: number | null;
  promotionReason: string | null;
  distributionTarget: string | null;
  outboxStatus: string;
  outboxAttemptCount: number;
  approvalStatus: string | null;
  gateChecks: GateCheck[];
}): string {
  const failedGates = input.gateChecks.filter((g) => !g.passed);

  if (failedGates.length === 0) {
    return `Pick routed successfully to ${input.distributionTarget}. Score: ${input.promotionScore ?? 'n/a'}. Reason: ${input.promotionReason ?? 'qualified'}. Delivery status: ${input.outboxStatus}.`;
  }

  const blockers = failedGates.map((g) => `[${g.gate}] ${g.detail}`);

  if (input.status === 'awaiting_approval') {
    return `Pick is held at awaiting_approval — governance brake applied for source "${input.source}". Operator must approve via review endpoint before routing proceeds.`;
  }

  if (!input.promotionTarget) {
    return `Pick did not qualify for promotion. Status: ${input.promotionStatus}. Score: ${input.promotionScore ?? 'n/a'}. ${input.promotionReason ?? 'No promotion target set.'}`;
  }

  return `Routing blocked by ${failedGates.length} gate(s):\n${blockers.join('\n')}`;
}
