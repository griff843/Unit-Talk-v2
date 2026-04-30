import type {
  EventRepository,
  ParticipantRepository,
  ProviderOfferRepository,
} from './repositories.js';
import type { PickOfferSnapshotKind, PickRecord, ProviderOfferRecord } from './types.js';

type SnapshotCaptureRepositories = {
  providerOffers: ProviderOfferRepository;
  participants?: ParticipantRepository | undefined;
  events?: EventRepository | undefined;
};

type SnapshotLookupContext = {
  providerEventId: string;
  providerMarketKey: string;
  providerParticipantId: string | null;
  bookmakerKey: string | null;
};

function metadataString(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function buildIdentityKey(offer: {
  provider_key: string;
  provider_event_id: string;
  provider_market_key: string;
  provider_participant_id: string | null;
  bookmaker_key: string | null;
}) {
  return [
    offer.provider_key,
    offer.provider_event_id,
    offer.provider_market_key,
    offer.provider_participant_id ?? '',
    offer.bookmaker_key ?? '',
  ].join(':');
}

export async function resolvePickOfferSnapshotContext(
  pick: PickRecord,
  repositories: SnapshotCaptureRepositories,
): Promise<SnapshotLookupContext | null> {
  const metadata = asRecord(pick.metadata);
  const providerEventId =
    metadataString(metadata, 'providerEventId') ??
    (metadataString(metadata, 'eventId') && repositories.events
      ? (await repositories.events.findById(metadataString(metadata, 'eventId')!))?.external_id ?? null
      : null);

  const canonicalMarketKey = pick.market_type_id ?? pick.market;
  const providerMarketKey =
    metadataString(metadata, 'providerMarketKey') ??
    (await repositories.providerOffers.resolveProviderMarketKey(canonicalMarketKey, 'sgo')) ??
    pick.market;

  let providerParticipantId = metadataString(metadata, 'providerParticipantId');
  if (providerParticipantId == null && repositories.participants) {
    const participantId =
      metadataString(metadata, 'participantId') ??
      (typeof pick.participant_id === 'string' && pick.participant_id.length > 0 ? pick.participant_id : null);
    if (participantId) {
      providerParticipantId = (await repositories.participants.findById(participantId))?.external_id ?? null;
    }
  }

  const bookmakerKey = metadataString(metadata, 'bookmakerKey');
  if (!providerEventId || !providerMarketKey) {
    return null;
  }

  return {
    providerEventId,
    providerMarketKey,
    providerParticipantId,
    bookmakerKey,
  };
}

export async function captureCurrentPickOfferSnapshot(
  pick: PickRecord,
  snapshotKind: Extract<PickOfferSnapshotKind, 'submission' | 'approval' | 'posting'>,
  repositories: SnapshotCaptureRepositories,
  capturedAt: string,
) {
  const context = await resolvePickOfferSnapshotContext(pick, repositories);
  if (!context) {
    return null;
  }

  const offer = await repositories.providerOffers.findCurrentOffer({
    providerKey: 'sgo',
    ...context,
  });
  if (!offer) {
    return null;
  }

  return repositories.providerOffers.savePickOfferSnapshot({
    pickId: pick.id,
    snapshotKind,
    providerKey: offer.provider_key,
    providerEventId: offer.provider_event_id,
    providerMarketKey: offer.provider_market_key,
    providerParticipantId: offer.provider_participant_id,
    bookmakerKey: offer.bookmaker_key,
    identityKey: buildIdentityKey(offer),
    line: offer.line,
    overOdds: offer.over_odds,
    underOdds: offer.under_odds,
    devigMode: offer.devig_mode,
    sourceSnapshotAt: offer.snapshot_at,
    capturedAt,
    sourceRunId: offer.source_run_id ?? null,
    sourceCurrentIdentityKey: buildIdentityKey(offer),
    payload: {
      captureSource: 'provider_offer_current',
    },
  });
}

export async function captureOfferBackedPickSnapshot(
  pick: PickRecord,
  snapshotKind: Extract<PickOfferSnapshotKind, 'closing_for_clv' | 'settlement_proof'>,
  offer: ProviderOfferRecord,
  repositories: SnapshotCaptureRepositories,
  capturedAt: string,
  options?: {
    settlementRecordId?: string | null;
    payload?: Record<string, unknown>;
  },
) {
  return repositories.providerOffers.savePickOfferSnapshot({
    pickId: pick.id,
    snapshotKind,
    providerKey: offer.provider_key,
    providerEventId: offer.provider_event_id,
    providerMarketKey: offer.provider_market_key,
    providerParticipantId: offer.provider_participant_id,
    bookmakerKey: offer.bookmaker_key,
    identityKey: buildIdentityKey(offer),
    line: offer.line,
    overOdds: offer.over_odds,
    underOdds: offer.under_odds,
    devigMode: offer.devig_mode,
    sourceSnapshotAt: offer.snapshot_at,
    capturedAt,
    sourceRunId: offer.source_run_id ?? null,
    ...(options?.settlementRecordId ? { settlementRecordId: options.settlementRecordId } : {}),
    payload: {
      captureSource: snapshotKind === 'closing_for_clv' ? 'closing_line' : 'settlement_proof',
      ...(options?.payload ?? {}),
    },
  });
}
