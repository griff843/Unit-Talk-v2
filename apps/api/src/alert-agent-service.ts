import { computeMovementScore, type ProviderOfferSlim } from '@unit-talk/domain';
import type {
  EventParticipantRepository,
  EventRepository,
  ParticipantRepository,
  PickRecord,
  PickRepository,
  ProviderOfferRecord,
  ProviderOfferRepository,
} from '@unit-talk/db';

export interface LineMovementAlertSignal {
  kind: 'line_movement';
  signalId: string;
  pickId: string;
  source: string;
  submittedBy: string | null;
  lifecycleState: PickRecord['status'];
  promotionTarget: string | null;
  providerKey: string;
  providerEventId: string;
  providerMarketKey: string;
  providerParticipantId: string | null;
  sportKey: string | null;
  currentLine: number;
  previousLine: number;
  lineDelta: number;
  absoluteLineDelta: number;
  direction: 'up' | 'down';
  movementScore: number;
  threshold: number;
  currentSnapshotAt: string;
  previousSnapshotAt: string;
  overOdds: number | null;
  underOdds: number | null;
}

export interface ListLineMovementAlertsOptions {
  providerKey?: string;
  threshold?: number;
  limit?: number;
}

const DEFAULT_PROVIDER_KEY = 'sgo';
const DEFAULT_MOVEMENT_THRESHOLD = 0.5;
const DEFAULT_LIMIT = 20;

export async function listLineMovementAlerts(
  repositories: Pick<
    {
      picks: PickRepository;
      providerOffers: ProviderOfferRepository;
      participants: ParticipantRepository;
      events: EventRepository;
      eventParticipants: EventParticipantRepository;
    },
    'eventParticipants' | 'events' | 'participants' | 'picks' | 'providerOffers'
  >,
  options: ListLineMovementAlertsOptions = {},
): Promise<LineMovementAlertSignal[]> {
  const providerKey = options.providerKey ?? DEFAULT_PROVIDER_KEY;
  const threshold = normalizePositiveNumber(
    options.threshold,
    DEFAULT_MOVEMENT_THRESHOLD,
  );
  const limit = normalizePositiveInteger(options.limit, DEFAULT_LIMIT);

  const offers = await repositories.providerOffers.listByProvider(providerKey);
  const trackedPicks = await listTrackedPicks(repositories.picks);
  const groupedOffers = new Map<string, ProviderOfferRecord[]>();

  for (const offer of offers) {
    const key = [
      offer.provider_event_id,
      offer.provider_market_key,
      offer.provider_participant_id ?? 'all',
    ].join(':');
    const group = groupedOffers.get(key) ?? [];
    group.push(offer);
    groupedOffers.set(key, group);
  }

  const alerts: LineMovementAlertSignal[] = [];

  for (const pick of trackedPicks) {
    const trackedContext = await resolveTrackedPickContext(pick, repositories);
    if (!trackedContext) {
      continue;
    }

    const group = groupedOffers.get(trackedContext.groupKey);
    if (!group) {
      continue;
    }

    const latestTwo = group
      .filter((offer) => offer.line !== null)
      .sort((left, right) => right.snapshot_at.localeCompare(left.snapshot_at))
      .slice(0, 2);

    if (latestTwo.length < 2) {
      continue;
    }

    const current = latestTwo[0];
    const previous = latestTwo[1];

    if (!current || !previous || current.line === null || previous.line === null) {
      continue;
    }

    const lineDelta = roundToTenth(current.line - previous.line);
    const absoluteLineDelta = Math.abs(lineDelta);
    if (absoluteLineDelta < threshold) {
      continue;
    }

    alerts.push({
      kind: 'line_movement',
      signalId: buildSignalId(pick, current),
      pickId: pick.id,
      source: pick.source,
      submittedBy: trackedContext.submittedBy,
      lifecycleState: pick.status,
      promotionTarget: pick.promotion_target,
      providerKey: current.provider_key,
      providerEventId: current.provider_event_id,
      providerMarketKey: current.provider_market_key,
      providerParticipantId: current.provider_participant_id,
      sportKey: current.sport_key,
      currentLine: current.line,
      previousLine: previous.line,
      lineDelta,
      absoluteLineDelta,
      direction: lineDelta >= 0 ? 'up' : 'down',
      movementScore: computeMovementScore(
        [toProviderOfferSlim(previous)],
        [toProviderOfferSlim(current)],
      ),
      threshold,
      currentSnapshotAt: current.snapshot_at,
      previousSnapshotAt: previous.snapshot_at,
      overOdds: current.over_odds,
      underOdds: current.under_odds,
    });
  }

  return alerts
    .sort((left, right) => {
      if (right.absoluteLineDelta !== left.absoluteLineDelta) {
        return right.absoluteLineDelta - left.absoluteLineDelta;
      }
      return right.currentSnapshotAt.localeCompare(left.currentSnapshotAt);
    })
    .slice(0, limit);
}

async function listTrackedPicks(picks: PickRepository) {
  const pickStates: Array<Parameters<PickRepository['listByLifecycleState']>[0]> = [
    'validated',
    'queued',
    'posted',
  ];
  const results = await Promise.all(pickStates.map((state) => picks.listByLifecycleState(state)));
  return results.flat();
}

async function resolveTrackedPickContext(
  pick: PickRecord,
  repositories: Pick<
    {
      participants: ParticipantRepository;
      events: EventRepository;
      eventParticipants: EventParticipantRepository;
    },
    'eventParticipants' | 'events' | 'participants'
  >,
) {
  const submittedBy = readSubmittedBy(pick);
  if (pick.source !== 'system' && submittedBy === null) {
    return null;
  }

  const providerMarketKey = readProviderMarketKey(pick) ?? pick.market;
  const participantId = await resolvePickParticipantId(pick, repositories);
  const participantExternalId = participantId
    ? (await repositories.participants.findById(participantId))?.external_id ?? null
    : null;
  const event = await resolvePickEvent(pick, participantId, repositories);
  if (!event?.external_id) {
    return null;
  }

  return {
    groupKey: [
      event.external_id,
      providerMarketKey,
      participantExternalId ?? 'all',
    ].join(':'),
    submittedBy,
  };
}

function buildSignalId(pick: PickRecord, offer: ProviderOfferRecord) {
  return [
    'line-movement',
    pick.id,
    offer.provider_key,
    offer.provider_event_id,
    offer.provider_market_key,
    offer.provider_participant_id ?? 'all',
    offer.snapshot_at,
  ].join(':');
}

function toProviderOfferSlim(offer: ProviderOfferRecord): ProviderOfferSlim {
  return {
    provider: offer.provider_key,
    line: offer.line,
    over_odds: offer.over_odds,
    under_odds: offer.under_odds,
    snapshot_at: offer.snapshot_at,
    is_opening: offer.is_opening,
    is_closing: offer.is_closing,
  };
}

async function resolvePickEvent(
  pick: PickRecord,
  participantId: string | null,
  repositories: Pick<
    {
      events: EventRepository;
      eventParticipants: EventParticipantRepository;
    },
    'eventParticipants' | 'events'
  >,
) {
  const participantEvents = participantId
    ? (
        await Promise.all(
          (await repositories.eventParticipants.listByParticipant(participantId)).map((link) =>
            repositories.events.findById(link.event_id),
          ),
        )
      ).filter(
        (event): event is NonNullable<typeof event> =>
          event !== null && typeof event.external_id === 'string' && event.external_id.length > 0,
      )
    : [];

  if (participantEvents.length > 0) {
    return chooseEventForPick(pick, participantEvents);
  }

  const metadata = asRecord(pick.metadata);
  const eventName = typeof metadata.eventName === 'string' ? metadata.eventName.trim() : '';
  if (!eventName) {
    return null;
  }

  const sport = typeof metadata.sport === 'string' ? metadata.sport.trim() : undefined;
  const upcomingEvents = await repositories.events.listUpcoming(sport);
  return (
    upcomingEvents.find(
      (event) => event.event_name.trim().toLowerCase() === eventName.toLowerCase(),
    ) ?? null
  );
}

async function resolvePickParticipantId(
  pick: PickRecord,
  repositories: Pick<{ participants: ParticipantRepository }, 'participants'>,
): Promise<string | null> {
  if (pick.participant_id) {
    return pick.participant_id;
  }

  const metadata = asRecord(pick.metadata);
  const playerName = typeof metadata.player === 'string' ? metadata.player.trim() : '';
  if (!playerName) {
    return null;
  }

  const sport = typeof metadata.sport === 'string' ? metadata.sport.trim() : undefined;
  const candidates = await repositories.participants.listByType('player', sport);
  const matches = candidates.filter(
    (candidate) => normalizeName(candidate.display_name) === normalizeName(playerName),
  );

  return matches.length === 1 ? (matches[0]?.id ?? null) : null;
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
  return (
    [...events].sort((left, right) => {
      const leftDistance = Math.abs(new Date(readEventStartTime(left)).getTime() - pickCreatedAt);
      const rightDistance = Math.abs(
        new Date(readEventStartTime(right)).getTime() - pickCreatedAt,
      );
      return leftDistance - rightDistance;
    })[0] ?? null
  );
}

function readEventStartTime(event: { event_date: string; metadata: Record<string, unknown> }) {
  const metadata = asRecord(event.metadata);
  const startsAt = metadata.starts_at;
  return typeof startsAt === 'string' && startsAt.trim().length > 0
    ? startsAt
    : `${event.event_date}T23:59:59Z`;
}

function readProviderMarketKey(pick: PickRecord) {
  const metadata = asRecord(pick.metadata);
  const deviggingResult = asRecord(metadata.deviggingResult);
  const providerMarketKey = deviggingResult.providerMarketKey;
  return typeof providerMarketKey === 'string' && providerMarketKey.trim().length > 0
    ? providerMarketKey.trim()
    : null;
}

function readSubmittedBy(pick: PickRecord) {
  const metadata = asRecord(pick.metadata);
  const capper =
    typeof metadata.capper === 'string'
      ? metadata.capper
      : typeof metadata.submittedBy === 'string'
        ? metadata.submittedBy
        : null;

  const trimmed = capper?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePositiveNumber(value: number | undefined, fallback: number) {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return value;
}

function normalizePositiveInteger(value: number | undefined, fallback: number) {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.trunc(value);
}

function roundToTenth(value: number) {
  return Math.round(value * 10) / 10;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
