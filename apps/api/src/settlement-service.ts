import {
  createLifecycleEvent,
  validateSettlementRequest,
  type PickLifecycleState,
  type SettlementRequest,
} from '@unit-talk/contracts';
import {
  classifyLoss,
  computeSettlementSummary,
  resolveEffectiveSettlement,
  summarizeLossAttributions,
  type EffectiveSettlement,
  type LossAttributionOutput,
  type LossAttributionSummary,
  type SettlementInput,
  type SettlementSummary,
} from '@unit-talk/domain';
import type {
  AuditLogRecord,
  AuditLogRepository,
  EventParticipantRepository,
  EventRepository,
  IMarketUniverseRepository,
  PickLifecycleRecord,
  PickRecord,
  PickRepository,
  ProviderOfferRepository,
  ParticipantRepository,
  SettlementRecord,
  SettlementRepository,
} from '@unit-talk/db';
import { ensurePickLifecycleState, transitionPickLifecycle } from './lifecycle-service.js';
import { ApiError } from './errors.js';
import {
  computeCLVOutcome,
  type CLVComputationOutcome,
  type CLVPreResolvedContext,
} from './clv-service.js';

export interface RecordSettlementResult {
  pickRecord: PickRecord;
  settlementRecord: SettlementRecord;
  lifecycleEvent: PickLifecycleRecord | null;
  auditRecords: AuditLogRecord[];
  finalLifecycleState: PickRecord['status'];
  downstream: SettlementDownstreamBundle;
}

export interface SettlementDownstreamBundle {
  effectiveSettlement: EffectiveSettlement | null;
  settlementSummary: SettlementSummary;
  lossAttribution: LossAttributionOutput | null;
  lossAttributionSummary: LossAttributionSummary | null;
  unresolvedReason: string | null;
}

export async function recordPickSettlement(
  pickId: string,
  request: SettlementRequest,
  repositories: {
    picks: PickRepository;
    settlements: SettlementRepository;
    audit: AuditLogRepository;
    providerOffers?: ProviderOfferRepository;
    participants?: ParticipantRepository;
    events?: EventRepository;
    eventParticipants?: EventParticipantRepository;
    marketUniverse?: IMarketUniverseRepository;
  },
): Promise<RecordSettlementResult> {
  const validation = validateSettlementRequest(request);
  if (!validation.ok) {
    throw new ApiError(
      400,
      'INVALID_SETTLEMENT_REQUEST',
      validation.errors.join(', '),
    );
  }

  if (request.source === 'feed') {
    throw new ApiError(
      409,
      'AUTOMATED_SETTLEMENT_NOT_ALLOWED',
      'Automated settlement input is blocked until a separate written and ratified contract authorizes feed-triggered writes.',
    );
  }

  const pick = await repositories.picks.findPickById(pickId);
  if (!pick) {
    throw new ApiError(404, 'PICK_NOT_FOUND', `Pick not found: ${pickId}`);
  }

  if (request.status === 'manual_review') {
    return recordManualReview(pick, request, repositories);
  }

  if (pick.status === 'posted') {
    return recordInitialSettlement(pick, request, repositories);
  }

  if (pick.status === 'settled') {
    return recordSettlementCorrection(pick, request, repositories);
  }

  throw new ApiError(
    409,
    'SETTLEMENT_NOT_ALLOWED',
    `Pick ${pickId} must be in posted or settled state; found ${pick.status}`,
  );
}

export async function recordGradedSettlement(
  pickId: string,
  result: 'win' | 'loss' | 'push',
  gradingContext: {
    actualValue: number;
    marketKey: string;
    eventId: string;
    gameResultId: string;
  },
  repositories: {
    picks: PickRepository;
    settlements: SettlementRepository;
    audit: AuditLogRepository;
    providerOffers: ProviderOfferRepository;
    participants: ParticipantRepository;
    events: EventRepository;
    eventParticipants: EventParticipantRepository;
    marketUniverse?: IMarketUniverseRepository;
  },
): Promise<RecordSettlementResult> {
  const pick = await repositories.picks.findPickById(pickId);
  if (!pick) {
    throw new Error(`Pick not found for graded settlement: ${pickId}`);
  }

  // Allow both 'posted' (normal path) and 'settled' (when atomicClaimForTransition
  // has already transitioned the pick before this function is called).
  if (pick.status !== 'posted' && pick.status !== 'settled') {
    throw new Error(
      `Pick ${pickId} must be in posted or settled state for graded settlement; found ${pick.status}`,
    );
  }

  // Resolve CLV context from the grading event directly so CLV uses the same event
  // that grading resolved — not a re-resolved event that could pick a different game
  // due to proximity-only matching (the root cause of null CLV on auto-graded picks).
  const clvContext = await buildCLVContextFromGradingEvent(
    gradingContext.eventId,
    pick,
    repositories,
  );
  const clvOutcome = await computeCLVOutcome(pick, repositories, {
    ...(clvContext ? { preResolvedContext: clvContext } : {}),
  });
  const clv = clvOutcome.result;
  const payload: Record<string, unknown> = {
    gradingContext,
    correction: false,
    ...buildPickProvenancePayload(pick),
    clv: clv ?? null,
    ...buildClvDiagnosticPayload(clvOutcome),
  };

  if (clv) {
    payload['clvRaw'] = clv.clvRaw;
    payload['clvPercent'] = clv.clvPercent;
    payload['beatsClosingLine'] = clv.beatsClosingLine;
  }

  const profitLossUnits = computeProfitLossUnits(result, pick.odds, pick.stake_units);
  if (profitLossUnits !== null) {
    payload['profitLossUnits'] = profitLossUnits;
  }

  const settledAt = new Date().toISOString();

  let settlementRecord: SettlementRecord;
  try {
    settlementRecord = await repositories.settlements.record({
      pickId: pick.id,
      status: 'settled',
      result,
      source: 'grading',
      confidence: 'confirmed',
      evidenceRef: `game-result:${gradingContext.gameResultId}`,
      notes: null,
      reviewReason: null,
      settledBy: 'grading-service',
      settledAt,
      payload,
    });
  } catch (err: unknown) {
    // Handle unique constraint violation (duplicate settlement for same pick+source).
    // Postgres error code 23505 = unique_violation.
    if (isDuplicateSettlementError(err)) {
      const existing = await repositories.settlements.findLatestForPick(pick.id);
      if (existing) {
        const currentPick = await repositories.picks.findPickById(pick.id);
        const downstream = await computeSettlementDownstreamBundle(
          currentPick ?? pick,
          repositories.settlements,
        );
        return {
          pickRecord: currentPick ?? pick,
          settlementRecord: existing,
          lifecycleEvent: null,
          auditRecords: [],
          finalLifecycleState: currentPick?.status ?? pick.status,
          downstream,
        };
      }
    }
    throw err;
  }

  // Use ensurePickLifecycleState instead of transitionPickLifecycle so that
  // if atomicClaimForTransition already moved the pick to 'settled', we
  // skip the redundant transition gracefully.
  const transitioned = await ensurePickLifecycleState(
    repositories.picks,
    pick.id,
    'settled',
    'graded settlement recorded',
    'settler',
  );
  const updatedPick = await repositories.picks.findPickById(pick.id);
  if (!updatedPick) {
    throw new Error(`Pick not found after graded settlement: ${pickId}`);
  }

  const downstream = await computeSettlementDownstreamBundle(
    updatedPick,
    repositories.settlements,
  );

  const audit = await repositories.audit.record({
    entityType: 'settlement_records',
    entityId: settlementRecord.id,
    entityRef: pick.id,
    action: 'settlement.graded',
    actor: 'grading-service',
    payload: {
      pickId: pick.id,
      settlementRecordId: settlementRecord.id,
      result,
      source: 'grading',
      gradingContext,
      settledLifecycleEventId: transitioned?.lifecycleEvent.id ?? null,
      downstream,
    },
  });

  return {
    pickRecord: updatedPick,
    settlementRecord,
    lifecycleEvent: transitioned?.lifecycleEvent ?? null,
    auditRecords: [audit],
    finalLifecycleState: updatedPick.status,
    downstream,
  };
}

async function recordManualReview(
  pick: PickRecord,
  request: SettlementRequest,
  repositories: {
    picks: PickRepository;
    settlements: SettlementRepository;
    audit: AuditLogRepository;
  },
): Promise<RecordSettlementResult> {
  if (pick.status !== 'posted') {
    throw new ApiError(
      409,
      'MANUAL_REVIEW_NOT_ALLOWED',
      `Manual review requires posted state; found ${pick.status}`,
    );
  }

  const settledAt = new Date().toISOString();
  const settlementRecord = await repositories.settlements.record({
    pickId: pick.id,
    status: 'manual_review',
    result: null,
    source: request.source,
    confidence: request.confidence,
    evidenceRef: request.evidenceRef,
    notes: request.notes ?? null,
    reviewReason: request.reviewReason ?? null,
    settledBy: request.settledBy,
    settledAt,
    payload: {
      requestStatus: request.status,
      ...buildPickProvenancePayload(pick),
    },
  });

  const lifecycleEvent = await repositories.picks.saveLifecycleEvent(
    createLifecycleEvent(
      pick.id,
      pick.status as PickLifecycleState,
      'settler',
      'manual review settlement recorded',
      pick.status as PickLifecycleState,
    ),
  );

  const downstream = await computeSettlementDownstreamBundle(
    pick,
    repositories.settlements,
  );

  const audit = await repositories.audit.record({
    entityType: 'settlement_records',
    entityId: settlementRecord.id,
    entityRef: pick.id,
    action: 'settlement.manual_review',
    actor: request.settledBy,
    payload: {
      pickId: pick.id,
      settlementRecordId: settlementRecord.id,
      reviewReason: request.reviewReason,
      evidenceRef: request.evidenceRef,
      lifecycleEventId: lifecycleEvent.id,
      downstream,
    },
  });

  return {
    pickRecord: pick,
    settlementRecord,
    lifecycleEvent,
    auditRecords: [audit],
    finalLifecycleState: pick.status,
    downstream,
  };
}

async function recordInitialSettlement(
  pick: PickRecord,
  request: SettlementRequest,
  repositories: {
    picks: PickRepository;
    settlements: SettlementRepository;
    audit: AuditLogRepository;
    providerOffers?: ProviderOfferRepository;
    participants?: ParticipantRepository;
    events?: EventRepository;
    eventParticipants?: EventParticipantRepository;
    marketUniverse?: IMarketUniverseRepository;
  },
): Promise<RecordSettlementResult> {
  const settledAt = new Date().toISOString();

  // CLV computation (fail-open) — same logic as recordGradedSettlement
  let clvOutcome: CLVComputationOutcome | null = null;
  if (repositories.providerOffers && repositories.participants && repositories.events && repositories.eventParticipants) {
    try {
      clvOutcome = await computeCLVOutcome(pick, {
        providerOffers: repositories.providerOffers,
        participants: repositories.participants,
        events: repositories.events,
        eventParticipants: repositories.eventParticipants,
        ...(repositories.marketUniverse ? { marketUniverse: repositories.marketUniverse } : {}),
      });
    } catch {
      // CLV is fail-open on manual settlement
    }
  }
  const clv = clvOutcome?.result ?? null;

  // P/L computation from result and pick odds/stake
  const profitLossUnits = computeProfitLossUnits(
    request.result ?? null,
    pick.odds,
    pick.stake_units,
  );

  const payload: Record<string, unknown> = {
    requestStatus: request.status,
    correction: false,
    ...buildPickProvenancePayload(pick),
    clv: clv ?? null,
    ...(clvOutcome ? buildClvDiagnosticPayload(clvOutcome) : {}),
    ...(clv ? {
      clvRaw: clv.clvRaw,
      clvPercent: clv.clvPercent,
      beatsClosingLine: clv.beatsClosingLine,
    } : {}),
    ...(profitLossUnits !== null ? { profitLossUnits } : {}),
  };

  const settlementInput = {
    pickId: pick.id,
    status: 'settled' as const,
    result: request.result ?? null,
    source: request.source,
    confidence: request.confidence,
    evidenceRef: request.evidenceRef,
    notes: request.notes ?? null,
    reviewReason: null,
    settledBy: request.settledBy,
    settledAt,
    payload,
  };

  // Try atomic settlement (all writes in one Postgres transaction),
  // fall back to sequential for InMemory mode.
  try {
    const atomicResult = await repositories.settlements.settlePickAtomic({
      pickId: pick.id,
      settlement: settlementInput,
      lifecycleFromState: pick.status,
      lifecycleToState: 'settled',
      lifecycleWriterRole: 'settler',
      lifecycleReason: 'settlement recorded',
      auditAction: 'settlement.recorded',
      auditActor: request.settledBy,
      auditPayload: {
        pickId: pick.id,
        result: request.result,
        source: request.source,
        confidence: request.confidence,
        evidenceRef: request.evidenceRef,
      },
    });

    if (atomicResult.duplicate) {
      const currentPick = atomicResult.pick;
      const downstream = await computeSettlementDownstreamBundle(
        currentPick,
        repositories.settlements,
      );
      return {
        pickRecord: currentPick,
        settlementRecord: atomicResult.settlement,
        lifecycleEvent: null,
        auditRecords: [],
        finalLifecycleState: currentPick.status,
        downstream,
      };
    }

    const downstream = await computeSettlementDownstreamBundle(
      atomicResult.pick,
      repositories.settlements,
    );

    return {
      pickRecord: atomicResult.pick,
      settlementRecord: atomicResult.settlement,
      lifecycleEvent: atomicResult.lifecycleEvent,
      auditRecords: [],
      finalLifecycleState: atomicResult.pick.status,
      downstream,
    };
  } catch {
    // Sequential fallback (InMemory mode or RPC not deployed).
  }

  let settlementRecord: SettlementRecord;
  try {
    settlementRecord = await repositories.settlements.record(settlementInput);
  } catch (err: unknown) {
    if (isDuplicateSettlementError(err)) {
      const existing = await repositories.settlements.findLatestForPick(pick.id);
      if (existing) {
        const currentPick = await repositories.picks.findPickById(pick.id);
        const downstream = await computeSettlementDownstreamBundle(
          currentPick ?? pick,
          repositories.settlements,
        );
        return {
          pickRecord: currentPick ?? pick,
          settlementRecord: existing,
          lifecycleEvent: null,
          auditRecords: [],
          finalLifecycleState: currentPick?.status ?? pick.status,
          downstream,
        };
      }
    }
    throw err;
  }

  const transitioned = await transitionPickLifecycle(
    repositories.picks,
    pick.id,
    'settled',
    'settlement recorded',
    'settler',
  );
  const updatedPick = await repositories.picks.findPickById(pick.id);
  if (!updatedPick) {
    throw new ApiError(500, 'PICK_NOT_FOUND_AFTER_SETTLEMENT', pick.id);
  }

  const downstream = await computeSettlementDownstreamBundle(
    updatedPick,
    repositories.settlements,
  );

  const audit = await repositories.audit.record({
    entityType: 'settlement_records',
    entityId: settlementRecord.id,
    entityRef: pick.id,
    action: 'settlement.recorded',
    actor: request.settledBy,
    payload: {
      pickId: pick.id,
      settlementRecordId: settlementRecord.id,
      result: request.result,
      source: request.source,
      confidence: request.confidence,
      evidenceRef: request.evidenceRef,
      settledLifecycleEventId: transitioned.lifecycleEvent.id,
      downstream,
    },
  });

  return {
    pickRecord: updatedPick,
    settlementRecord,
    lifecycleEvent: transitioned.lifecycleEvent,
    auditRecords: [audit],
    finalLifecycleState: updatedPick.status,
    downstream,
  };
}

async function recordSettlementCorrection(
  pick: PickRecord,
  request: SettlementRequest,
  repositories: {
    picks: PickRepository;
    settlements: SettlementRepository;
    audit: AuditLogRepository;
    providerOffers?: ProviderOfferRepository;
    participants?: ParticipantRepository;
    events?: EventRepository;
    eventParticipants?: EventParticipantRepository;
    marketUniverse?: IMarketUniverseRepository;
  },
): Promise<RecordSettlementResult> {
  const latest = await repositories.settlements.findLatestForPick(pick.id);
  if (!latest) {
    throw new ApiError(
      409,
      'SETTLEMENT_CORRECTION_NOT_ALLOWED',
      `Pick ${pick.id} is settled but has no prior settlement record`,
    );
  }

  // CLV computation on correction (fail-open)
  let clvOutcome: CLVComputationOutcome | null = null;
  if (repositories.providerOffers && repositories.participants && repositories.events && repositories.eventParticipants) {
    try {
      clvOutcome = await computeCLVOutcome(pick, {
        providerOffers: repositories.providerOffers,
        participants: repositories.participants,
        events: repositories.events,
        eventParticipants: repositories.eventParticipants,
        ...(repositories.marketUniverse ? { marketUniverse: repositories.marketUniverse } : {}),
      });
    } catch {
      // CLV is fail-open on correction
    }
  }
  const clv = clvOutcome?.result ?? null;

  const profitLossUnits = computeProfitLossUnits(
    request.result ?? null,
    pick.odds,
    pick.stake_units,
  );

  const settledAt = new Date().toISOString();
  const settlementRecord = await repositories.settlements.record({
    pickId: pick.id,
    status: 'settled',
    result: request.result ?? null,
    source: request.source,
    confidence: request.confidence,
    evidenceRef: request.evidenceRef,
    notes: request.notes ?? null,
    reviewReason: null,
    settledBy: request.settledBy,
    settledAt,
    correctsId: latest.id,
    payload: {
      requestStatus: request.status,
      correction: true,
      priorSettlementRecordId: latest.id,
      ...buildPickProvenancePayload(pick),
      clv: clv ?? null,
      ...(clvOutcome ? buildClvDiagnosticPayload(clvOutcome) : {}),
      ...(clv ? {
        clvRaw: clv.clvRaw,
        clvPercent: clv.clvPercent,
        beatsClosingLine: clv.beatsClosingLine,
      } : {}),
      ...(profitLossUnits !== null ? { profitLossUnits } : {}),
    },
  });

  const correctionLifecycleEvent = await repositories.picks.saveLifecycleEvent(
    createLifecycleEvent(
      pick.id,
      pick.status as PickLifecycleState,
      'settler',
      'settlement correction recorded',
      pick.status as PickLifecycleState,
    ),
  );

  const downstream = await computeSettlementDownstreamBundle(
    pick,
    repositories.settlements,
  );

  const audit = await repositories.audit.record({
    entityType: 'settlement_records',
    entityId: settlementRecord.id,
    entityRef: pick.id,
    action: 'settlement.corrected',
    actor: request.settledBy,
    payload: {
      pickId: pick.id,
      settlementRecordId: settlementRecord.id,
      correctsId: latest.id,
      result: request.result,
      source: request.source,
      confidence: request.confidence,
      evidenceRef: request.evidenceRef,
      lifecycleEventId: correctionLifecycleEvent.id,
      downstream,
    },
  });

  return {
    pickRecord: pick,
    settlementRecord,
    lifecycleEvent: correctionLifecycleEvent,
    auditRecords: [audit],
    finalLifecycleState: pick.status,
    downstream,
  };
}

const CLV_SKIP_REASON_MAP: Record<string, string> = {
  missing_pick_odds: 'Pick has no valid odds',
  missing_selection_side: "Selection doesn't contain 'over' or 'under'",
  missing_event_context: 'Event could not be resolved from pick metadata',
  missing_closing_line: 'No closing line available for this market',
  missing_priced_side: 'Closing line missing price for selected side',
  devig_failed: 'Probability devigging calculation failed',
  opening_line_fallback: 'Used opening line as closing line proxy',
};

function buildClvDiagnosticPayload(outcome: CLVComputationOutcome): Record<string, unknown> {
  return {
    clvStatus: outcome.status,
    clvUnavailableReason: outcome.result ? null : outcome.status,
    clvSkipReason: outcome.result ? null : (CLV_SKIP_REASON_MAP[outcome.status] ?? outcome.status),
    ...(outcome.result?.isOpeningLineFallback ? { isOpeningLineFallback: true } : {}),
    ...(outcome.resolvedMarketKey ? { clvResolvedMarketKey: outcome.resolvedMarketKey } : {}),
    ...(outcome.availableMarkets.length > 0 ? { clvAvailableMarkets: outcome.availableMarkets } : {}),
  };
}

function buildPickProvenancePayload(pick: PickRecord): Record<string, unknown> {
  const metadata = asRecord(pick.metadata) ?? {};
  const marketUniverseId = readString(metadata, 'marketUniverseId') ?? readString(metadata, 'universeId');
  const scoredCandidateId = readString(metadata, 'scoredCandidateId') ?? readString(metadata, 'candidateId');

  return {
    ...(marketUniverseId ? { marketUniverseId } : {}),
    ...(scoredCandidateId ? { scoredCandidateId } : {}),
  };
}

async function computeSettlementDownstreamBundle(
  pick: PickRecord,
  settlements: SettlementRepository,
): Promise<SettlementDownstreamBundle> {
  const records = await settlements.listByPick(pick.id);
  if (records.length === 0) {
    console.warn(JSON.stringify({
      service: 'settlement-service',
      event: 'settlement_records_empty',
      pickId: pick.id,
      reason: 'no settlement rows found for pick',
    }));
  }
  const resolved = resolveEffectiveSettlement(
    records.map(mapSettlementRecordToInput),
  );

  if (!resolved.ok) {
    return {
      effectiveSettlement: null,
      settlementSummary: computeSettlementSummary([]),
      lossAttribution: null,
      lossAttributionSummary: null,
      unresolvedReason: resolved.reason,
    };
  }

  const lossAttribution = computeLossAttributionForPick(pick, resolved.settlement);

  return {
    effectiveSettlement: resolved.settlement,
    settlementSummary: computeSettlementSummary([resolved.settlement]),
    lossAttribution,
    lossAttributionSummary: lossAttribution
      ? summarizeLossAttributions([lossAttribution])
      : null,
    unresolvedReason: null,
  };
}

function mapSettlementRecordToInput(record: SettlementRecord): SettlementInput {
  return {
    id: record.id,
    pick_id: record.pick_id,
    status: record.status as SettlementInput['status'],
    result: record.result,
    confidence: record.confidence,
    corrects_id: record.corrects_id,
    settled_at: record.settled_at,
  };
}

function computeLossAttributionForPick(
  pick: PickRecord,
  settlement: EffectiveSettlement,
): LossAttributionOutput | null {
  if (settlement.status !== 'settled' || settlement.result !== 'loss') {
    return null;
  }

  const input = readLossAttributionInput(pick.metadata);
  return classifyLoss(input);
}

function readLossAttributionInput(metadata: unknown) {
  const record = asRecord(metadata);
  const attribution = asRecord(record?.lossAttribution) ?? record;

  return {
    ev: readNumber(attribution?.ev) ?? 0,
    clv_at_bet:
      readNumber(attribution?.clv_at_bet) ??
      readNumber(attribution?.clvAtBet) ??
      0,
    clv_at_close:
      readNumber(attribution?.clv_at_close) ??
      readNumber(attribution?.clvAtClose) ??
      0,
    has_feature_snapshot:
      readBoolean(attribution?.has_feature_snapshot) ??
      readBoolean(attribution?.hasFeatureSnapshot) ??
      false,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/**
 * Detect Postgres unique_violation (code 23505) on the
 * settlement_records_pick_source_idx partial unique index.
 */
function isDuplicateSettlementError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const record = err as Record<string, unknown>;
  // Supabase/pg errors surface the code as `.code`
  return record['code'] === '23505';
}

/**
 * Builds a CLVPreResolvedContext from the event grading already identified.
 * This ensures CLV uses the same event as grading rather than re-resolving by
 * proximity — which can select a different, unrelated future event.
 *
 * Returns null if the event or participant cannot be resolved (CLV will return null).
 */
async function buildCLVContextFromGradingEvent(
  eventId: string,
  pick: PickRecord,
  repositories: {
    events: EventRepository;
    participants: ParticipantRepository;
  },
): Promise<CLVPreResolvedContext | null> {
  const event = await repositories.events.findById(eventId);
  if (!event?.external_id) {
    return null;
  }

  const eventMeta = asRecord(event.metadata);
  const startsAt = eventMeta?.['starts_at'];
  const eventStartTime =
    typeof startsAt === 'string' && startsAt.trim().length > 0
      ? startsAt
      : `${event.event_date}T23:59:59Z`;

  // For game-line markets there is no participant — CLV lookup uses null participant.
  if (!pick.participant_id && !asRecord(pick.metadata)?.['player']) {
    return {
      providerEventId: event.external_id,
      eventStartTime,
      participantExternalId: null,
    };
  }

  // For player-prop markets, resolve the participant's external_id for provider_offers lookup.
  let participantExternalId: string | null = null;
  if (pick.participant_id) {
    const participant = await repositories.participants.findById(pick.participant_id);
    participantExternalId = participant?.external_id ?? null;
  } else {
    const metadata = asRecord(pick.metadata);
    const playerName = typeof metadata?.['player'] === 'string' ? metadata['player'].trim() : '';
    if (playerName) {
      const sport = typeof metadata?.['sport'] === 'string' ? metadata['sport'].trim() : undefined;
      const candidates = await repositories.participants.listByType('player', sport);
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const matches = candidates.filter(c => norm(c.display_name) === norm(playerName));
      participantExternalId = matches.length === 1 ? (matches[0]?.external_id ?? null) : null;
    }
  }

  return {
    providerEventId: event.external_id,
    eventStartTime,
    participantExternalId,
  };
}

/**
 * Compute profit/loss in units from settlement result and pick odds/stake.
 * American odds: win at +odds → profit = stake × (odds / 100)
 *                win at -odds → profit = stake × (100 / |odds|)
 *                loss → -stake, push → 0
 * Returns null when result is missing (manual_review without outcome).
 */
function computeProfitLossUnits(
  result: string | null,
  odds: number | null | undefined,
  stakeUnits: number | null | undefined,
): number | null {
  if (!result) return null;
  const stake = stakeUnits ?? 1;

  if (result === 'push') return 0;
  if (result === 'loss') return -stake;
  if (result === 'win') {
    if (odds != null && Number.isFinite(odds) && odds !== 0) {
      return odds > 0
        ? roundPL(stake * (odds / 100))
        : roundPL(stake * (100 / Math.abs(odds)));
    }
    return stake;
  }
  return null;
}

function roundPL(value: number): number {
  return Math.round(value * 100) / 100;
}

