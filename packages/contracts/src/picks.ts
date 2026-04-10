import { randomUUID } from 'node:crypto';
import type {
  ApprovalStatus,
  PromotionStatus,
  PromotionTarget,
  WriterRole,
} from './index.js';
import type { PickSource, SubmissionPayload, ValidatedSubmission } from './submission.js';

export type PickLifecycleState =
  | 'draft'
  | 'validated'
  | 'awaiting_approval'
  | 'queued'
  | 'posted'
  | 'settled'
  | 'voided';

export interface CanonicalPick {
  id: string;
  submissionId: string;
  market: string;
  selection: string;
  line?: number | undefined;
  odds?: number | undefined;
  stakeUnits?: number | undefined;
  confidence?: number | undefined;
  source: PickSource;
  submittedBy?: string | undefined;
  approvalStatus: ApprovalStatus;
  promotionStatus: PromotionStatus;
  promotionTarget?: PromotionTarget | undefined;
  promotionScore?: number | undefined;
  promotionReason?: string | undefined;
  promotionVersion?: string | undefined;
  promotionDecidedAt?: string | undefined;
  promotionDecidedBy?: string | undefined;
  lifecycleState: PickLifecycleState;
  eventStartTime?: string | undefined;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface LifecycleEvent {
  pickId: string;
  fromState?: PickLifecycleState | undefined;
  toState: PickLifecycleState;
  writerRole: WriterRole;
  reason: string;
  createdAt: string;
}

/**
 * Options for controlling the initial lifecycle/approval state at materialization.
 *
 * Phase 7A (UTV2-491): added to allow non-human producers to land picks in
 * `awaiting_approval` at the same atomic step as materialization, instead of
 * performing a separate post-create transition (which would leave a race
 * window where the brake could miss a just-created `validated` pick).
 *
 * Backward-compatible: omitting `initial` preserves pre-Phase-7A defaults
 * (`lifecycleState: 'validated'`, `approvalStatus: 'approved'`).
 *
 * Producer routing policy (which source uses which initial state) is NOT
 * decided in UTV2-491. See UTV2-492 and later.
 */
export interface MaterializeCanonicalPickInitial {
  lifecycleState?: PickLifecycleState;
  approvalStatus?: ApprovalStatus;
}

export function materializeCanonicalPick(
  submission: ValidatedSubmission,
  initial?: MaterializeCanonicalPickInitial,
  now = new Date().toISOString(),
): CanonicalPick {
  const payload: SubmissionPayload = submission.payload;

  return {
    id: randomUUID(),
    submissionId: submission.id,
    market: payload.market,
    selection: payload.selection,
    line: payload.line,
    odds: payload.odds,
    stakeUnits: payload.stakeUnits,
    confidence: payload.confidence,
    source: payload.source,
    submittedBy: payload.submittedBy,
    approvalStatus: initial?.approvalStatus ?? 'approved',
    promotionStatus: 'not_eligible',
    lifecycleState: initial?.lifecycleState ?? 'validated',
    eventStartTime:
      typeof payload.metadata?.['eventStartTime'] === 'string'
        ? payload.metadata['eventStartTime']
        : undefined,
    metadata: payload.metadata ?? {},
    createdAt: now,
  };
}

export function createLifecycleEvent(
  pickId: string,
  toState: PickLifecycleState,
  writerRole: WriterRole,
  reason: string,
  fromState?: PickLifecycleState | undefined,
  now = new Date().toISOString(),
): LifecycleEvent {
  return {
    pickId,
    fromState,
    toState,
    writerRole,
    reason,
    createdAt: now,
  };
}
