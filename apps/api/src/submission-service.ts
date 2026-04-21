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
  type EventRepository,
  type PickLifecycleRecord,
  type PickRecord,
  type PickRepository,
  type ProviderOfferRecord,
  type ProviderOfferRepository,
  type SettlementRepository,
  type SubmissionEventRecord,
  type SubmissionRecord,
  type SubmissionRepository,
} from '@unit-talk/db';
import { ApiError } from './errors.js';
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
import { resolvePickThumbnailUrl } from './pick-asset-resolver.js';
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

export interface ShadowSubmissionProcessingResult extends SubmissionProcessingResult {
  shadowMode: {
    subsystem: 'routing';
    recordedAt: string;
  };
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
    settlements?: SettlementRepository;
    participants?: import('@unit-talk/db').ParticipantRepository;
    events?: EventRepository;
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

  // Event existence gate: for human submission surfaces (smart-form, alert-agent), if the
  // events repository has been populated and the pick specifies an eventName, verify a
  // matching event exists before accepting.
  // Gate is skipped for api/model-driven/other sources and when the events repo is empty.
  const isHumanSource = payload.source === 'smart-form' || payload.source === 'alert-agent';
  if (
    isHumanSource &&
    repositories.events &&
    typeof payload.eventName === 'string' &&
    payload.eventName.trim().length > 0
  ) {
    await checkEventExistenceGate(payload.eventName.trim(), repositories.events);
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
        ...(
          realEdgeResult.contrarySignal &&
          realEdgeResult.contrarySignal.contrarianism !== 'aligned'
            ? {
                contrarySignal: {
                  contrarianism: realEdgeResult.contrarySignal.contrarianism,
                  divergence: realEdgeResult.contrarySignal.divergence,
                  direction: realEdgeResult.contrarySignal.direction,
                  marketSource: realEdgeResult.contrarySignal.marketSource,
                },
              }
            : {}
        ),
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

  // Resolve thumbnail URL from enriched participant data (fail-open)
  let thumbnailUrl: string | null = null;
  if (repositories.participants) {
    const pickSport = enrichedMetadata['sport'] as string | undefined;
    thumbnailUrl = await resolvePickThumbnailUrl(
      payload.selection,
      pickSport ?? null,
      repositories.participants,
    );
  }

  const normalizedIdentity = await resolveNormalizedPickIdentityMetadata(
    payload,
    enrichedMetadata,
    repositories,
  );

  const enrichedPick: CanonicalPick = {
    ...materialized.pick,
    metadata: {
      ...enrichedMetadata,
      ...normalizedIdentity,
      ...(deviggingResult ? { deviggingResult } : {}),
      kellySizing,
      ...realEdgeData,
      ...(payload.thesis ? { thesis: payload.thesis } : {}),
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
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
  // settlements passed to enable CLV-based trust adjustment.
  const eagerResult = await evaluateAllPoliciesEagerAndPersist(
    pickRecord.id,
    'system',
    repositories.picks,
    repositories.audit,
    repositories.settlements,
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

export async function processShadowSubmission(
  payload: SubmissionPayload,
  repositories: {
    submissions: SubmissionRepository;
    picks: PickRepository;
    audit: AuditLogRepository;
    providerOffers: ProviderOfferRepository;
    participants?: import('@unit-talk/db').ParticipantRepository;
    events?: EventRepository;
  },
): Promise<ShadowSubmissionProcessingResult> {
  const normalizedMarketKey = normalizeMarketKey(payload.market);
  const shadowRecordedAt = new Date().toISOString();
  const shadowPayload: SubmissionPayload = {
    ...payload,
    market: normalizedMarketKey,
    metadata: {
      ...(payload.metadata ?? {}),
      shadowMode: {
        enabled: true,
        subsystem: 'routing',
        recordedAt: shadowRecordedAt,
        publicPromotionBlocked: true,
      },
    },
  };

  const idempotencyKey = computeSubmissionIdempotencyKey(shadowPayload);
  const existingPick = await repositories.picks.findPickByIdempotencyKey(idempotencyKey);
  if (existingPick) {
    const duplicateResult = await processSubmissionDuplicate(existingPick, shadowPayload);
    return {
      ...duplicateResult,
      shadowMode: {
        subsystem: 'routing',
        recordedAt: readShadowRecordedAt(existingPick.metadata) ?? shadowRecordedAt,
      },
    };
  }

  const submission = createValidatedSubmission(nextSubmissionId(), shadowPayload);
  const materialized = createCanonicalPickFromSubmission(submission);
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

  const normalizedIdentity = await resolveNormalizedPickIdentityMetadata(
    payload,
    enrichedMetadata,
    repositories,
  );

  // Resolve thumbnail URL from enriched participant data (fail-open)
  let shadowThumbnailUrl: string | null = null;
  if (repositories.participants) {
    const pickSport = enrichedMetadata['sport'] as string | undefined;
    shadowThumbnailUrl = await resolvePickThumbnailUrl(
      payload.selection,
      pickSport ?? null,
      repositories.participants,
    );
  }

  const enrichedPick: CanonicalPick = {
    ...materialized.pick,
    metadata: {
      ...enrichedMetadata,
      ...normalizedIdentity,
      ...(deviggingResult ? { deviggingResult } : {}),
      kellySizing,
      ...(payload.thesis ? { thesis: payload.thesis } : {}),
      ...(shadowThumbnailUrl ? { thumbnailUrl: shadowThumbnailUrl } : {}),
    },
  };

  const submissionInput = mapValidatedSubmissionToSubmissionCreateInput(submission);
  const eventInput = {
    submissionId: submission.id,
    eventName: 'submission.accepted',
    payload: {
      source: submission.payload.source,
      market: submission.payload.market,
      selection: submission.payload.selection,
      shadowMode: true,
    },
    createdAt: submission.receivedAt,
  };

  let submissionRecord: SubmissionRecord;
  let pickRecord: PickRecord;
  let lifecycleEventRecord: PickLifecycleRecord;
  let submissionEventRecord: SubmissionEventRecord | undefined;

  try {
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

  await repositories.audit.record({
    entityType: 'pick',
    entityId: pickRecord.id,
    entityRef: pickRecord.id,
    action: 'shadow.prediction.recorded',
    actor: 'system:model-shadow',
    payload: {
      submissionId: submission.id,
      source: payload.source,
      subsystem: 'routing',
      recordedAt: shadowRecordedAt,
      market: normalizedMarketKey,
      selection: payload.selection,
    },
  });

  return {
    submission,
    submissionRecord,
    submissionEventRecord,
    pick: enrichedPick,
    pickRecord,
    lifecycleEvent: materialized.lifecycleEvent,
    lifecycleEventRecord,
    shadowMode: {
      subsystem: 'routing',
      recordedAt: shadowRecordedAt,
    },
  };
}

async function resolveNormalizedPickIdentityMetadata(
  payload: SubmissionPayload,
  metadata: Record<string, unknown>,
  repositories: {
    participants?: import('@unit-talk/db').ParticipantRepository;
    events?: import('@unit-talk/db').EventRepository;
  },
): Promise<Record<string, unknown>> {
  const normalized: Record<string, unknown> = {};

  if (typeof payload.eventName === 'string' && payload.eventName.trim().length > 0 && !readMetadataString(metadata, 'eventName')) {
    normalized['eventName'] = payload.eventName.trim();
  }

  if (typeof payload.submittedBy === 'string' && payload.submittedBy.trim().length > 0 && !readMetadataString(metadata, 'submittedBy')) {
    normalized['submittedBy'] = payload.submittedBy.trim();
  }

  const eventContext = await resolveEventIdentityContext(payload, metadata, repositories.events);
  if (eventContext.eventId && !readMetadataString(metadata, 'eventId')) {
    normalized['eventId'] = eventContext.eventId;
  }
  if (eventContext.eventName && !readMetadataString(metadata, 'eventName')) {
    normalized['eventName'] = eventContext.eventName;
  }
  if (eventContext.sport && !readMetadataString(metadata, 'sport')) {
    normalized['sport'] = eventContext.sport;
  }
  if (eventContext.eventStartTime) {
    if (!readMetadataString(metadata, 'eventTime')) {
      normalized['eventTime'] = eventContext.eventStartTime;
    }
    if (!readMetadataString(metadata, 'eventStartTime')) {
      normalized['eventStartTime'] = eventContext.eventStartTime;
    }
  }

  const participantContext = await resolveParticipantIdentityContext(metadata, repositories.participants);
  if (participantContext.participantId && !readMetadataString(metadata, 'participantId')) {
    normalized['participantId'] = participantContext.participantId;
  }
  if (participantContext.player && !readMetadataString(metadata, 'player')) {
    normalized['player'] = participantContext.player;
  }
  if (participantContext.team && !readMetadataString(metadata, 'team')) {
    normalized['team'] = participantContext.team;
  }
  if (participantContext.sport && !readMetadataString(metadata, 'sport')) {
    normalized['sport'] = participantContext.sport;
  }

  return normalized;
}

async function resolveEventIdentityContext(
  payload: SubmissionPayload,
  metadata: Record<string, unknown>,
  events: import('@unit-talk/db').EventRepository | undefined,
): Promise<{
  eventId: string | null;
  eventName: string | null;
  sport: string | null;
  eventStartTime: string | null;
}> {
  if (!events) {
    return {
      eventId: null,
      eventName: null,
      sport: null,
      eventStartTime: null,
    };
  }

  try {
    const metadataEventId = readMetadataString(metadata, 'eventId');
    const providerEventId = readMetadataString(metadata, 'providerEventId');
    const payloadEventName = typeof payload.eventName === 'string' && payload.eventName.trim().length > 0
      ? payload.eventName.trim()
      : null;

    let eventRow =
      metadataEventId != null
        ? await events.findById(metadataEventId)
        : null;

    if (!eventRow && providerEventId != null) {
      eventRow = await events.findByExternalId(providerEventId);
    }

    if (!eventRow && payloadEventName != null) {
      const matches = await events.listByName(payloadEventName);
      if (matches.length === 1) {
        eventRow = matches[0] ?? null;
      }
    }

    if (!eventRow) {
      return {
        eventId: null,
        eventName: null,
        sport: null,
        eventStartTime: null,
      };
    }

    const eventMeta =
      typeof eventRow.metadata === 'object' && eventRow.metadata !== null && !Array.isArray(eventRow.metadata)
        ? (eventRow.metadata as Record<string, unknown>)
        : null;
    const startsAt = eventMeta != null && typeof eventMeta['starts_at'] === 'string' && eventMeta['starts_at'].trim().length > 0
      ? eventMeta['starts_at'].trim()
      : eventRow.event_date
        ? `${eventRow.event_date}T00:00:00Z`
        : null;

    return {
      eventId: eventRow.id,
      eventName: eventRow.event_name,
      sport: eventRow.sport_id,
      eventStartTime: startsAt,
    };
  } catch {
    return {
      eventId: null,
      eventName: null,
      sport: null,
      eventStartTime: null,
    };
  }
}

async function resolveParticipantIdentityContext(
  metadata: Record<string, unknown>,
  participants: import('@unit-talk/db').ParticipantRepository | undefined,
): Promise<{
  participantId: string | null;
  player: string | null;
  team: string | null;
  sport: string | null;
}> {
  if (!participants) {
    return {
      participantId: null,
      player: null,
      team: null,
      sport: null,
    };
  }

  const participantId =
    readMetadataString(metadata, 'participantId') ?? readMetadataString(metadata, 'playerId');
  if (!participantId) {
    return {
      participantId: null,
      player: null,
      team: null,
      sport: null,
    };
  }

  try {
    const participant = await participants.findById(participantId);
    if (!participant) {
      return {
        participantId: null,
        player: null,
        team: null,
        sport: null,
      };
    }

    return {
      participantId: participant.id,
      player: participant.participant_type === 'player' ? participant.display_name : null,
      team: participant.participant_type === 'team' ? participant.display_name : null,
      sport: participant.sport ?? null,
    };
  } catch {
    return {
      participantId: null,
      player: null,
      team: null,
      sport: null,
    };
  }
}

/**
 * Rejects the submission with a 422 when the events table has data but contains
 * no event matching the given name. Skipped when the events repository is empty
 * (cold start before first ingest, or InMemory tests without seeded events).
 */
async function checkEventExistenceGate(eventName: string, events: EventRepository): Promise<void> {
  const upcoming = await events.listUpcoming(undefined, 90);
  if (upcoming.length === 0) {
    return;
  }
  const matching = await events.listByName(eventName);
  if (matching.length === 0) {
    throw new ApiError(
      422,
      'EVENT_NOT_FOUND',
      `No event found matching "${eventName}" — verify the event name and try again`,
    );
  }
}

function readMetadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

async function processSubmissionDuplicate(
  existingPick: PickRecord,
  payload: SubmissionPayload,
): Promise<SubmissionProcessingResult> {
  const submission = createValidatedSubmission(existingPick.submission_id ?? existingPick.id, payload);
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

function readShadowRecordedAt(metadata: unknown) {
  if (!isRecord(metadata)) {
    return null;
  }
  const shadowMode = metadata['shadowMode'];
  if (!isRecord(shadowMode)) {
    return null;
  }
  const recordedAt = shadowMode['recordedAt'];
  return typeof recordedAt === 'string' ? recordedAt : null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
