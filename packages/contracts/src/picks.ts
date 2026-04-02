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

export function materializeCanonicalPick(
  submission: ValidatedSubmission,
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
    approvalStatus: 'approved',
    promotionStatus: 'not_eligible',
    lifecycleState: 'validated',
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
