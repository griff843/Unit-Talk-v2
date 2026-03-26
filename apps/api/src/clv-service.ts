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
}

export interface ComputeAndAttachClvOptions {
  logger?: Pick<Console, 'warn'>;
}

interface PickEventContext {
  providerEventId: string;
  eventStartTime: string;
  participantExternalId: string | null;
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
  if (!Number.isFinite(pick.odds ?? null)) {
    return null;
  }

  const selectionSide = inferSelectionSide(pick.selection);
  if (!selectionSide) {
    return null;
  }

  const eventContext = await resolvePickEventContext(pick, repositories);
  if (!eventContext) {
    return null;
  }

  const closingLine = await repositories.providerOffers.findClosingLine({
    providerEventId: eventContext.providerEventId,
    providerMarketKey: pick.market,
    providerParticipantId: eventContext.participantExternalId,
    before: eventContext.eventStartTime,
  });

  if (!closingLine) {
    await logMarketMismatchIfNeeded(pick, eventContext, repositories.providerOffers, options.logger);
    return null;
  }

  const pricedSide = readClosingSideOdds(closingLine, selectionSide);
  if (!pricedSide) {
    return null;
  }

  const pickImpliedProb = americanToImplied(pick.odds as number);
  const overImplied = americanToImplied(closingLine.over_odds as number);
  const underImplied = americanToImplied(closingLine.under_odds as number);
  const devigged = applyDevig(overImplied, underImplied, 'proportional');
  if (!devigged) {
    return null;
  }

  const closingImpliedProb =
    selectionSide === 'over' ? devigged.overFair : devigged.underFair;
  const clvRaw = roundTo(pickImpliedProb - closingImpliedProb, 6);

  return {
    pickOdds: pick.odds as number,
    closingOdds: pricedSide,
    closingLine: closingLine.line,
    closingSnapshotAt: closingLine.snapshot_at,
    clvRaw,
    clvPercent: roundTo(clvRaw * 100, 4),
    beatsClosingLine: clvRaw > 0,
    providerKey: closingLine.provider_key,
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
  if (!pick.participant_id) {
    return null;
  }

  const participant = await repositories.participants.findById(pick.participant_id);
  if (!participant) {
    return null;
  }

  const links = await repositories.eventParticipants.listByParticipant(pick.participant_id);
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

  return {
    providerEventId: matchedEvent.external_id,
    eventStartTime: readEventStartTime(matchedEvent),
    participantExternalId: participant.external_id,
  };
}

function chooseEventForPick(
  pick: PickRecord,
  events: Array<{
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
) {
  const offers = await providerOffers.listByProvider('sgo');
  const relatedOffers = offers.filter(
    (offer) =>
      offer.provider_event_id === eventContext.providerEventId &&
      offer.snapshot_at <= eventContext.eventStartTime &&
      offer.provider_participant_id === eventContext.participantExternalId,
  );

  if (relatedOffers.length === 0) {
    return;
  }

  const availableMarkets = [...new Set(relatedOffers.map((offer) => offer.provider_market_key))].sort();
  logger?.warn?.(
    `CLV market mismatch for pick ${pick.id}: pick.market="${pick.market}" available=${availableMarkets.join(', ')}`,
  );
}

function inferSelectionSide(selection: string) {
  const normalized = selection.toLowerCase();
  if (/\bover\b/.test(normalized)) {
    return 'over' as const;
  }
  if (/\bunder\b/.test(normalized)) {
    return 'under' as const;
  }
  return null;
}

function readClosingSideOdds(
  offer: ProviderOfferRecord,
  selectionSide: 'over' | 'under',
) {
  const overOdds = offer.over_odds;
  const underOdds = offer.under_odds;
  if (!Number.isFinite(overOdds) || !Number.isFinite(underOdds)) {
    return null;
  }

  return selectionSide === 'over' ? (overOdds as number) : (underOdds as number);
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
