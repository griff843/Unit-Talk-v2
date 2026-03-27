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
  type ProviderOfferRecord,
  type ProviderOfferRepository,
  type SubmissionEventRecord,
  type SubmissionRecord,
  type SubmissionRepository,
} from '@unit-talk/db';
import {
  americanToImplied,
  americanToDecimal,
  createCanonicalPickFromSubmission,
  createValidatedSubmission,
  computeKellySize,
  DEFAULT_BANKROLL_CONFIG,
  applyDevig as devig,
  normalizeMarketKey,
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
    providerOffers: ProviderOfferRepository;
  },
): Promise<SubmissionProcessingResult> {
  const normalizedMarketKey = normalizeMarketKey(payload.market);
  const submission = createValidatedSubmission(nextSubmissionId(), {
    ...payload,
    market: normalizedMarketKey,
  });
  const materialized = createCanonicalPickFromSubmission(submission);

  // Domain analysis enrichment: compute implied probability, edge, and Kelly
  // sizing from odds/confidence and store in pick metadata.
  const domainAnalysis = computeSubmissionDomainAnalysis(materialized.pick);
  const deviggingResult = await resolveDeviggingResult(
    normalizedMarketKey,
    repositories.providerOffers,
  );
  const kellySizing = resolveKellySizing(
    deviggingResult,
    materialized.pick.odds,
    normalizedMarketKey,
  );

  const enrichedMetadata = enrichMetadataWithDomainAnalysis(
    materialized.pick.metadata,
    domainAnalysis,
  );
  const enrichedPick: CanonicalPick = {
    ...materialized.pick,
    metadata: {
      ...enrichedMetadata,
      ...(deviggingResult ? { deviggingResult } : {}),
      kellySizing,
    },
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

async function resolveDeviggingResult(
  normalizedMarketKey: string,
  providerOffers: ProviderOfferRepository,
) {
  try {
    const matchingOffer = await findLatestMatchingOffer(normalizedMarketKey, providerOffers);
    if (!matchingOffer) {
      return null;
    }

    if (
      !Number.isFinite(matchingOffer.over_odds) ||
      !Number.isFinite(matchingOffer.under_odds)
    ) {
      return null;
    }

    const overImplied = americanToImplied(matchingOffer.over_odds as number);
    const underImplied = americanToImplied(matchingOffer.under_odds as number);
    const devigged = devig(overImplied, underImplied, 'proportional');
    if (!devigged) {
      return null;
    }

    return {
      providerKey: matchingOffer.provider_key,
      providerMarketKey: matchingOffer.provider_market_key,
      snapshotAt: matchingOffer.snapshot_at,
      line: matchingOffer.line,
      overOdds: matchingOffer.over_odds,
      underOdds: matchingOffer.under_odds,
      overImplied,
      underImplied,
      devigMethod: 'proportional' as const,
      ...devigged,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`Devig enrichment skipped for market ${normalizedMarketKey}: ${reason}`);
    return null;
  }
}

async function findLatestMatchingOffer(
  normalizedMarketKey: string,
  providerOffers: ProviderOfferRepository,
): Promise<ProviderOfferRecord | null> {
  const offers = await providerOffers.listByProvider('sgo');
  const latestOffer = [...offers]
    .sort((left, right) => {
      const snapshotCompare = right.snapshot_at.localeCompare(left.snapshot_at);
      if (snapshotCompare !== 0) {
        return snapshotCompare;
      }

      const createdCompare = right.created_at.localeCompare(left.created_at);
      if (createdCompare !== 0) {
        return createdCompare;
      }

      return right.id.localeCompare(left.id);
    })
    .find((offer) => offer.provider_market_key === normalizedMarketKey);

  return latestOffer ?? null;
}

function resolveKellySizing(
  deviggingResult:
    | {
        overFair: number;
        providerMarketKey: string;
      }
    | null,
  odds: number | undefined,
  normalizedMarketKey: string,
) {
  if (!deviggingResult || !Number.isFinite(odds)) {
    return null;
  }

  try {
    return computeKellySize(
      deviggingResult.overFair,
      americanToDecimal(odds as number),
      DEFAULT_BANKROLL_CONFIG,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`Kelly sizing skipped for market ${normalizedMarketKey}: ${reason}`);
    return null;
  }
}
