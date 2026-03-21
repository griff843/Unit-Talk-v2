import { randomUUID } from 'node:crypto';
import type {
  CanonicalPick,
  LifecycleEvent,
  SubmissionPayload,
  ValidatedSubmission,
} from '@unit-talk/contracts';
import {
  mapValidatedSubmissionToSubmissionCreateInput,
  type AuditLogRepository,
  type PickLifecycleRecord,
  type PickRecord,
  type PickRepository,
  type SubmissionEventRecord,
  type SubmissionRecord,
  type SubmissionRepository,
} from '@unit-talk/db';
import {
  createCanonicalPickFromSubmission,
  createValidatedSubmission,
} from '@unit-talk/domain';
import {
  computeSubmissionDomainAnalysis,
  enrichMetadataWithDomainAnalysis,
} from './domain-analysis-service.js';
import { evaluateAllPoliciesEagerAndPersist } from './promotion-service.js';

export interface SubmissionProcessingResult {
  submission: ValidatedSubmission;
  submissionRecord: SubmissionRecord;
  submissionEventRecord: SubmissionEventRecord;
  pick: CanonicalPick;
  pickRecord: PickRecord;
  lifecycleEvent: LifecycleEvent;
  lifecycleEventRecord: PickLifecycleRecord;
}

function nextSubmissionId() {
  return randomUUID();
}

export async function processSubmission(
  payload: SubmissionPayload,
  repositories: {
    submissions: SubmissionRepository;
    picks: PickRepository;
    audit: AuditLogRepository;
  },
): Promise<SubmissionProcessingResult> {
  const submission = createValidatedSubmission(nextSubmissionId(), payload);
  const materialized = createCanonicalPickFromSubmission(submission);

  // Domain analysis enrichment: compute implied probability, edge, and Kelly
  // sizing from odds/confidence and store in pick metadata.
  const domainAnalysis = computeSubmissionDomainAnalysis(materialized.pick);
  const enrichedPick: CanonicalPick = {
    ...materialized.pick,
    metadata: enrichMetadataWithDomainAnalysis(
      materialized.pick.metadata,
      domainAnalysis,
    ),
  };

  // Step 1: persist the submission row — submission_events and pick_lifecycle
  // both have NOT NULL FKs that require their parents to exist first.
  const submissionRecord = await repositories.submissions.saveSubmission(
    mapValidatedSubmissionToSubmissionCreateInput(submission),
  );

  // Step 2: submission_event (FK → submission) and pick (no hard FK dep) in parallel.
  const [submissionEventRecord, pickRecord] = await Promise.all([
    repositories.submissions.saveSubmissionEvent({
      submissionId: submission.id,
      eventName: 'submission.accepted',
      payload: {
        source: submission.payload.source,
        market: submission.payload.market,
        selection: submission.payload.selection,
      },
      createdAt: submission.receivedAt,
    }),
    repositories.picks.savePick(enrichedPick),
  ]);

  // Step 3: lifecycle event (FK → pick) must follow the pick insert.
  const lifecycleEventRecord = await repositories.picks.saveLifecycleEvent(
    materialized.lifecycleEvent,
  );

  // Step 4: eager promotion evaluation — both policies evaluated in priority order.
  // picks.promotion_target is set to the highest-priority qualified target (or null).
  // Two pick_promotion_history rows are written, one per policy.
  const eagerResult = await evaluateAllPoliciesEagerAndPersist(
    pickRecord.id,
    'system',
    repositories.picks,
    repositories.audit,
  );

  return {
    submission,
    submissionRecord,
    submissionEventRecord,
    pick: eagerResult.pick,
    pickRecord: eagerResult.pickRecord,
    lifecycleEvent: materialized.lifecycleEvent,
    lifecycleEventRecord,
  };
}
