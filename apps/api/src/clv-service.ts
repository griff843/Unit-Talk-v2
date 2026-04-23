import { americanToImplied, applyDevig } from '@unit-talk/domain';
import type {
  EventParticipantRepository,
  EventRepository,
  ParticipantRepository,
  PickRecord,
  ProviderOfferRecord,
  ProviderOfferRepository,
} from '@unit-talk/db';

export interface CLVResult {
  pickOdds: number;
  closingOdds: number;
  closingLine: number | null;
  closingSnapshotAt: string;
  clvRaw: number;
  clvPercent: number;
  beatsClosingLine: boolean;
  providerKey: string;
  /** True when opening line was used as CLV proxy (no closing line available). */
  isOpeningLineFallback?: boolean;
  /** True when only one side of the closing line was available — devig skipped, raw implied used. */
  isSingleSideDevig?: boolean;
}

export type CLVComputationStatus =
  | 'computed'
  | 'opening_line_fallback'
  | 'missing_pick_odds'
  | 'missing_selection_side'
  | 'missing_event_context'
  | 'missing_closing_line'
  | 'missing_priced_side'
  | 'devig_failed';

export interface CLVComputationOutcome {
  result: CLVResult | null;
  status: CLVComputationStatus;
  resolvedMarketKey: string | null;
  availableMarkets: string[];
}

/**
 * Pre-resolved event context for use in the graded-settlement path.
 * Passing this bypasses the internal event resolution in computeAndAttachCLV,
 * ensuring CLV uses the same event that grading resolved rather than re-resolving
 * by proximity (which can select a different, wrong event).
 */
export interface CLVPreResolvedContext {
  providerEventId: string;
  eventStartTime: string;
  participantExternalId: string | null;
  /** Optional: participant home/away role for moneyline CLV side selection. */
  participantSide?: 'home' | 'away' | null;
}

export interface ComputeAndAttachClvOptions {
  logger?: Pick<Console, 'warn'>;
  /** Skip internal event/participant resolution — use this context directly. */
  preResolvedContext?: CLVPreResolvedContext;
}

interface PickEventContext {
  providerEventId: string;
  eventStartTime: string;
  participantExternalId: string | null;
  /** home/away role for the resolved participant. Used for moneyline CLV side selection. */
  participantSide: 'home' | 'away' | null;
}

export async function computeAndAttachCLV(
  pick: PickRecord,
  repositories: {
    providerOffers: ProviderOfferRepository;
    participants: ParticipantRepository;
    events: EventRepository;
    eventParticipants: EventParticipantRepository;
  },
  options: ComputeAndAttachClvOptions = {},
): Promise<CLVResult | null> {
  const outcome = await computeCLVOutcome(pick, repositories, options);
  if (!outcome.result && outcome.status !== 'opening_line_fallback') {
    const logger = options.logger ?? console;
    logger.warn({
      msg: 'CLV computation skipped',
      pickId: pick.id,
      market: pick.market,
      clvSkipReason: outcome.status,
      resolvedMarketKey: outcome.resolvedMarketKey,
      availableMarkets: outcome.availableMarkets,
    });
  }
  return outcome.result;
}

export async function computeCLVOutcome(
  pick: PickRecord,
  repositories: {
    providerOffers: ProviderOfferRepository;
    participants: ParticipantRepository;
    events: EventRepository;
    eventParticipants: EventParticipantRepository;
  },
  options: ComputeAndAttachClvOptions = {},
): Promise<CLVComputationOutcome> {
  if (!Number.isFinite(pick.odds ?? null)) {
    return {
      result: null,
      status: 'missing_pick_odds',
      resolvedMarketKey: null,
      availableMarkets: [],
    };
  }

  const isMoneyline = pick.market === 'moneyline';

  // For O/U markets, infer side before event resolution (cheap check).
  // For moneyline, defer side inference until after event context so we can
  // use the participant's home/away role from event_participants.
  if (!isMoneyline) {
    const selectionSide = inferSelectionSide(pick.selection);
    if (!selectionSide) {
      return {
        result: null,
        status: 'missing_selection_side',
        resolvedMarketKey: null,
        availableMarkets: [],
      };
    }
  }

  const eventContext: PickEventContext | null = options.preResolvedContext
    ? { ...options.preResolvedContext, participantSide: options.preResolvedContext.participantSide ?? null }
    : await resolvePickEventContext(pick, repositories);
  if (!eventContext) {
    return {
      result: null,
      status: 'missing_event_context',
      resolvedMarketKey: null,
      availableMarkets: [],
    };
  }

  // Translate canonical pick.market (e.g. 'player_turnovers_ou') to the SGO
  // provider market key (e.g. 'turnovers-all-game-ou') via the alias table.
  // Falls back to pick.market as-is when no alias exists (handles picks already
  // submitted with provider-native market keys).
  const resolvedMarketKey =
    (await repositories.providerOffers.resolveProviderMarketKey(pick.market, 'sgo')) ??
    pick.market;

  const baseLineCriteria = {
    providerEventId: eventContext.providerEventId,
    providerMarketKey: resolvedMarketKey,
    // Moneyline offers are event-level (no participant), so query with null.
    // O/U player-prop offers are participant-scoped.
    providerParticipantId: isMoneyline ? null : eventContext.participantExternalId,
    before: eventContext.eventStartTime,
  };

  // Prefer Pinnacle closing line for highest-quality CLV; fall back to consensus
  let closingLine = await repositories.providerOffers.findClosingLine({
    ...baseLineCriteria,
    bookmakerKey: 'pinnacle',
  });
  if (!closingLine) {
    closingLine = await repositories.providerOffers.findClosingLine(baseLineCriteria);
  }

  // Fallback: use SGO opening line as CLV proxy when no closing line is available.
  // This removes the hard dependency on Odds API Pinnacle data — picks still get a
  // directionally-valid CLV even when the Odds API is down or hasn't ingested yet.
  let isOpeningFallback = false;
  if (!closingLine) {
    closingLine = await repositories.providerOffers.findOpeningLine(baseLineCriteria);
    if (closingLine) {
      isOpeningFallback = true;
    }
  }

  if (!closingLine) {
    const availableMarkets = await logMarketMismatchIfNeeded(
      pick,
      eventContext,
      repositories.providerOffers,
      options.logger,
    );
    return {
      result: null,
      status: 'missing_closing_line',
      resolvedMarketKey,
      availableMarkets,
    };
  }

  // Resolve final selection side for odds column mapping:
  // - O/U picks: 'over' or 'under' from selection string (already validated above)
  // - Moneyline: 'home' role → 'over' column, 'away' role → 'under' column
  let resolvedSide: 'over' | 'under';
  if (isMoneyline) {
    const participantSide = eventContext.participantSide;
    if (!participantSide) {
      return {
        result: null,
        status: 'missing_selection_side',
        resolvedMarketKey,
        availableMarkets: [],
      };
    }
    resolvedSide = participantSide === 'home' ? 'over' : 'under';
  } else {
    resolvedSide = inferSelectionSide(pick.selection)!;
  }

  const pricedSide = readClosingSideOdds(closingLine, resolvedSide);
  if (!pricedSide) {
    return {
      result: null,
      status: 'missing_priced_side',
      resolvedMarketKey,
      availableMarkets: [],
    };
  }

  const pickImpliedProb = americanToImplied(pick.odds as number);
  const overImplied = americanToImplied(closingLine.over_odds as number);
  const underImplied = americanToImplied(closingLine.under_odds as number);
  const bothSidesAvailable = Number.isFinite(overImplied) && Number.isFinite(underImplied);
  const devigged = bothSidesAvailable
    ? applyDevig(overImplied, underImplied, 'proportional')
    : null;

  let closingImpliedProb: number;
  let isSingleSideDevig = false;

  if (devigged) {
    closingImpliedProb = resolvedSide === 'over' ? devigged.overFair : devigged.underFair;
  } else {
    // Only one closing side available — skip devig and use raw implied probability.
    // This occurs when the ingestor captured only one side of the moneyline market.
    const rawImplied = resolvedSide === 'over' ? overImplied : underImplied;
    if (!Number.isFinite(rawImplied)) {
      return {
        result: null,
        status: 'devig_failed',
        resolvedMarketKey,
        availableMarkets: [],
      };
    }
    closingImpliedProb = rawImplied;
    isSingleSideDevig = true;
  }

  const clvRaw = roundTo(pickImpliedProb - closingImpliedProb, 6);

  const result = {
    pickOdds: pick.odds as number,
    closingOdds: pricedSide,
    closingLine: closingLine.line,
    closingSnapshotAt: closingLine.snapshot_at,
    clvRaw,
    clvPercent: roundTo(clvRaw * 100, 4),
    beatsClosingLine: clvRaw > 0,
    providerKey: closingLine.provider_key,
    ...(isOpeningFallback ? { isOpeningLineFallback: true } : {}),
    ...(isSingleSideDevig ? { isSingleSideDevig: true } : {}),
  };

  return {
    result,
    status: isOpeningFallback ? 'opening_line_fallback' : 'computed',
    resolvedMarketKey,
    availableMarkets: [],
  };
}

async function resolvePickEventContext(
  pick: PickRecord,
  repositories: {
    participants: ParticipantRepository;
    events: EventRepository;
    eventParticipants: EventParticipantRepository;
  },
): Promise<PickEventContext | null> {
  // Team moneyline picks carry metadata.teamId + metadata.eventId instead of
  // participant_id or metadata.player. Resolve via event ID directly, bypassing
  // the participant chain which only handles player names.
  if (pick.market === 'moneyline') {
    const metadata = asRecord(pick.metadata);
    const metaEventId = typeof metadata['eventId'] === 'string' ? metadata['eventId'] : null;
    if (metaEventId) {
      const event = await repositories.events.findById(metaEventId);
      if (event?.external_id) {
        const teamId = typeof metadata['teamId'] === 'string' ? metadata['teamId'] : null;
        const links = teamId
          ? await repositories.eventParticipants.listByParticipant(teamId)
          : [];
        const link = links.find((l) => l.event_id === event.id);
        const participantSide =
          link?.role === 'home' || link?.role === 'away' ? link.role : null;
        return {
          providerEventId: event.external_id,
          eventStartTime: readEventStartTime(event),
          participantExternalId: null,
          participantSide,
        };
      }
    }
  }

  // Resolve participant: use direct FK if set; otherwise fuzzy-match from metadata.player
  const resolvedParticipantId = await resolveParticipantId(pick, repositories.participants);
  if (!resolvedParticipantId) {
    return null;
  }

  const participant = await repositories.participants.findById(resolvedParticipantId);
  if (!participant) {
    return null;
  }

  const links = await repositories.eventParticipants.listByParticipant(resolvedParticipantId);
  if (links.length === 0) {
    return null;
  }

  const candidateEvents = (
    await Promise.all(links.map((link) => repositories.events.findById(link.event_id)))
  )
    .filter((event): event is NonNullable<typeof event> => event !== null)
    .filter((event) => typeof event.external_id === 'string' && event.external_id.length > 0);

  if (candidateEvents.length === 0) {
    return null;
  }

  const matchedEvent = chooseEventForPick(pick, candidateEvents);
  if (!matchedEvent?.external_id) {
    return null;
  }

  const matchedLink = links.find((link) => link.event_id === matchedEvent.id);
  const participantSide = matchedLink?.role === 'home' || matchedLink?.role === 'away'
    ? matchedLink.role
    : null;

  return {
    providerEventId: matchedEvent.external_id,
    eventStartTime: readEventStartTime(matchedEvent),
    participantExternalId: participant.external_id,
    participantSide,
  };
}

function chooseEventForPick(
  pick: PickRecord,
  events: Array<{
    id: string;
    event_name: string;
    event_date: string;
    external_id: string | null;
    metadata: Record<string, unknown>;
  }>,
) {
  const metadata = asRecord(pick.metadata);
  const eventName = typeof metadata.eventName === 'string' ? metadata.eventName.trim() : null;
  if (eventName) {
    const namedMatch = events.find(
      (event) => event.event_name.trim().toLowerCase() === eventName.toLowerCase(),
    );
    if (namedMatch) {
      return namedMatch;
    }
  }

  const pickCreatedAt = new Date(pick.created_at).getTime();
  return [...events].sort((left, right) => {
    const leftDistance = Math.abs(new Date(readEventStartTime(left)).getTime() - pickCreatedAt);
    const rightDistance = Math.abs(
      new Date(readEventStartTime(right)).getTime() - pickCreatedAt,
    );
    return leftDistance - rightDistance;
  })[0] ?? null;
}

function readEventStartTime(event: { event_date: string; metadata: Record<string, unknown> }) {
  const metadata = asRecord(event.metadata);
  const startsAt = metadata.starts_at;
  return typeof startsAt === 'string' && startsAt.trim().length > 0
    ? startsAt
    : `${event.event_date}T23:59:59Z`;
}

async function logMarketMismatchIfNeeded(
  pick: PickRecord,
  eventContext: PickEventContext,
  providerOffers: ProviderOfferRepository,
  logger: Pick<Console, 'warn'> | undefined,
): Promise<string[]> {
  const offers = await providerOffers.listByProvider('sgo');
  const relatedOffers = offers.filter(
    (offer) =>
      offer.provider_event_id === eventContext.providerEventId &&
      offer.snapshot_at <= eventContext.eventStartTime &&
      offer.provider_participant_id === eventContext.participantExternalId,
  );

  if (relatedOffers.length === 0) {
    return [];
  }

  const availableMarkets = [...new Set(relatedOffers.map((offer) => offer.provider_market_key))].sort();
  logger?.warn?.(
    `CLV market mismatch for pick ${pick.id}: pick.market="${pick.market}" available=${availableMarkets.join(', ')}`,
  );
  return availableMarkets;
}

/**
 * Resolve participant_id for a pick.
 * Priority: pick.participant_id → fuzzy name match from metadata.player + metadata.sport.
 * Returns null if no unambiguous match is found (fail-open: CLV stays null).
 */
async function resolveParticipantId(
  pick: PickRecord,
  participants: ParticipantRepository,
): Promise<string | null> {
  if (pick.participant_id) {
    return pick.participant_id;
  }

  const metadata = asRecord(pick.metadata);
  const playerName = typeof metadata['player'] === 'string' ? metadata['player'].trim() : '';
  if (!playerName) {
    return null;
  }

  const sport = typeof metadata['sport'] === 'string' ? metadata['sport'].trim() : undefined;
  const candidates = await participants.listByType('player', sport);
  const matches = candidates.filter(
    (c) => normalizeName(c.display_name) === normalizeName(playerName),
  );

  // Require exactly one match to avoid ambiguity (same logic as grading service)
  return matches.length === 1 ? (matches[0]?.id ?? null) : null;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function inferSelectionSide(selection: string) {
  const normalized = selection.toLowerCase();
  if (/\bover\b/.test(normalized)) {
    return 'over' as const;
  }
  if (/\bunder\b/.test(normalized)) {
    return 'under' as const;
  }
  // Smart-form serializes picks as "Player Name O X.5" / "O X.5" with abbreviated O/U.
  // Match standalone O/U token followed by a digit (e.g. "Brunson O 28.5", "O 8").
  if (/\bO\s+\d/.test(selection) || /^O\s+\d/.test(selection)) {
    return 'over' as const;
  }
  if (/\bU\s+\d/.test(selection) || /^U\s+\d/.test(selection)) {
    return 'under' as const;
  }
  return null;
}

function readClosingSideOdds(
  offer: ProviderOfferRecord,
  selectionSide: 'over' | 'under',
) {
  const requested = selectionSide === 'over' ? offer.over_odds : offer.under_odds;
  if (!Number.isFinite(requested)) return null;
  return requested as number;
}

function asRecord(value: unknown) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function roundTo(value: number, decimals: number) {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}
