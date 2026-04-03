import { createHash, randomUUID } from 'node:crypto';
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
  submissionEventRecord?: SubmissionEventRecord | undefined;
  pick: CanonicalPick;
  pickRecord: PickRecord;
  lifecycleEvent: LifecycleEvent;
  lifecycleEventRecord: PickLifecycleRecord;
  /** True when the submission was deduplicated against an existing pick. */
  duplicate?: boolean;
}

function nextSubmissionId() {
  return randomUUID();
}

/**
 * Compute a deterministic idempotency key from the submission payload.
 * Hash of (source + market + selection + line + odds + eventDate/eventName).
 * Two identical submissions produce the same key, preventing duplicate picks.
 */
export function computeSubmissionIdempotencyKey(payload: SubmissionPayload): string {
  const parts = [
    payload.source ?? '',
    payload.market ?? '',
    payload.selection ?? '',
    String(payload.line ?? ''),
    String(payload.odds ?? ''),
    payload.eventName ?? '',
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
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

  // Idempotency check: compute key from normalized payload and check for existing pick.
  const idempotencyKey = computeSubmissionIdempotencyKey({
    ...payload,
    market: normalizedMarketKey,
  });
  const existingPick = await repositories.picks.findPickByIdempotencyKey(idempotencyKey);
  if (existingPick) {
    // Return idempotent success — no new rows created.
    const submission = createValidatedSubmission(existingPick.submission_id ?? existingPick.id, {
      ...payload,
      market: normalizedMarketKey,
    });
    const stubPick: CanonicalPick = {
      id: existingPick.id,
      submissionId: existingPick.submission_id ?? existingPick.id,
      market: existingPick.market,
      selection: existingPick.selection,
      line: existingPick.line ?? undefined,
      odds: existingPick.odds ?? undefined,
      stakeUnits: existingPick.stake_units ?? undefined,
      confidence: existingPick.confidence ?? undefined,
      source: existingPick.source as CanonicalPick['source'],
      approvalStatus: existingPick.approval_status as CanonicalPick['approvalStatus'],
      promotionStatus: existingPick.promotion_status as CanonicalPick['promotionStatus'],
      promotionTarget: (existingPick.promotion_target ?? undefined) as CanonicalPick['promotionTarget'],
      lifecycleState: existingPick.status as CanonicalPick['lifecycleState'],
      metadata: (existingPick.metadata ?? {}) as Record<string, unknown>,
      createdAt: existingPick.created_at,
    };
    return {
      submission,
      submissionRecord: { id: existingPick.submission_id ?? existingPick.id } as SubmissionRecord,
      submissionEventRecord: {} as SubmissionEventRecord,
      pick: stubPick,
      pickRecord: existingPick,
      lifecycleEvent: {
        pickId: existingPick.id,
        toState: existingPick.status as CanonicalPick['lifecycleState'],
        writerRole: 'submitter' as const,
        reason: 'idempotent-duplicate',
        createdAt: existingPick.created_at,
      },
      lifecycleEventRecord: {} as PickLifecycleRecord,
      duplicate: true,
    };
  }

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
    materialized.pick.selection,
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

  // Compute real edge against Pinnacle/consensus market data (Sprint D UTV2-198)
  let realEdgeData: Record<string, unknown> = {};
  if (
    materialized.pick.confidence != null &&
    materialized.pick.confidence > 0 &&
    materialized.pick.confidence < 1 &&
    materialized.pick.odds != null
  ) {
    try {
      const { computeRealEdge } = await import('./real-edge-service.js');
      const realEdgeResult = await computeRealEdge({
        confidence: materialized.pick.confidence,
        marketKey: normalizedMarketKey,
        selection: materialized.pick.selection,
        submittedOdds: materialized.pick.odds,
        providerOffers: repositories.providerOffers,
      });

      realEdgeData = {
        realEdge: realEdgeResult.realEdge,
        realEdgeSource: realEdgeResult.marketSource,
        marketProbability: realEdgeResult.marketProbability,
        hasRealEdge: realEdgeResult.hasRealEdge,
        realEdgeBookCount: realEdgeResult.bookCount,
      };

      // Enrich domain analysis with real edge if available
      if (domainAnalysis && realEdgeResult.marketSource !== 'confidence-delta') {
        domainAnalysis.realEdge = realEdgeResult.realEdge;
        domainAnalysis.realEdgeSource = realEdgeResult.marketSource;
        domainAnalysis.marketProbability = realEdgeResult.marketProbability;
        domainAnalysis.hasRealEdge = realEdgeResult.hasRealEdge;
        domainAnalysis.realEdgeBookCount = realEdgeResult.bookCount;
      }
    } catch {
      // Real edge computation is fail-open — if it fails, confidence delta is used
    }
  }

  const enrichedPick: CanonicalPick = {
    ...materialized.pick,
    metadata: {
      ...enrichedMetadata,
      ...(deviggingResult ? { deviggingResult } : {}),
      kellySizing,
      ...realEdgeData,
    },
  };

  // Persist submission + event + pick + lifecycle atomically when supported
  // (Database mode uses a Postgres RPC; InMemory mode falls back to sequential).
  const submissionInput = mapValidatedSubmissionToSubmissionCreateInput(submission);
  const eventInput = {
    submissionId: submission.id,
    eventName: 'submission.accepted',
    payload: {
      source: submission.payload.source,
      market: submission.payload.market,
      selection: submission.payload.selection,
    },
    createdAt: submission.receivedAt,
  };

  let submissionRecord: SubmissionRecord;
  let pickRecord: PickRecord;
  let lifecycleEventRecord: PickLifecycleRecord;
  let submissionEventRecord: SubmissionEventRecord | undefined;

  try {
    // Atomic path: all 4 inserts in a single Postgres transaction.
    const atomicResult = await repositories.submissions.processSubmissionAtomic({
      submission: submissionInput,
      event: eventInput,
      pick: enrichedPick,
      idempotencyKey,
      lifecycleEvent: materialized.lifecycleEvent,
    });

    submissionRecord = atomicResult.submission;
    submissionEventRecord = atomicResult.submissionEvent ?? undefined;
    pickRecord = atomicResult.pick;
    lifecycleEventRecord = atomicResult.lifecycleEvent!;
  } catch {
    // Sequential fallback (InMemory mode or RPC not deployed yet).
    submissionRecord = await repositories.submissions.saveSubmission(submissionInput);

    const [seqEventRecord, seqPickRecord] = await Promise.all([
      repositories.submissions.saveSubmissionEvent(eventInput),
      repositories.picks.savePick(enrichedPick, idempotencyKey),
    ]);
    submissionEventRecord = seqEventRecord;
    pickRecord = seqPickRecord;

    lifecycleEventRecord = await repositories.picks.saveLifecycleEvent(
      materialized.lifecycleEvent,
    );
  }

  // Eager promotion evaluation — all policies evaluated in priority order.
  // picks.promotion_target is set to the highest-priority qualified target (or null).
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
  selection: string,
  providerOffers: ProviderOfferRepository,
) {
  try {
    const matchingOffer = await findLatestMatchingOffer(
      normalizedMarketKey,
      selection,
      providerOffers,
    );
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
  selection: string,
  providerOffers: ProviderOfferRepository,
): Promise<ProviderOfferRecord | null> {
  const participantKey =
    normalizedMarketKey === 'moneyline' ? normalizeSelectionParticipantKey(selection) : undefined;

  // Use indexed query instead of full table scan (UTV2-205).
  // Tries SGO first (has results data), falls back to any provider.
  const sgoOffer = await providerOffers.findLatestByMarketKey(
    normalizedMarketKey,
    'sgo',
    participantKey,
  );
  if (sgoOffer) return sgoOffer;

  // Fall back to any provider (Odds API, etc.)
  return providerOffers.findLatestByMarketKey(normalizedMarketKey, undefined, participantKey);
}

function normalizeSelectionParticipantKey(selection: string): string | null {
  const normalized = selection.trim();
  return normalized.length > 0 ? normalized : null;
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
