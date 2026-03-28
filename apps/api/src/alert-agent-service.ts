import { computeMovementScore, type ProviderOfferSlim } from '@unit-talk/domain';
import type { ProviderOfferRecord, ProviderOfferRepository } from '@unit-talk/db';

export interface LineMovementAlertSignal {
  kind: 'line_movement';
  signalId: string;
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
  repositories: Pick<{ providerOffers: ProviderOfferRepository }, 'providerOffers'>,
  options: ListLineMovementAlertsOptions = {},
): Promise<LineMovementAlertSignal[]> {
  const providerKey = options.providerKey ?? DEFAULT_PROVIDER_KEY;
  const threshold = normalizePositiveNumber(
    options.threshold,
    DEFAULT_MOVEMENT_THRESHOLD,
  );
  const limit = normalizePositiveInteger(options.limit, DEFAULT_LIMIT);

  const offers = await repositories.providerOffers.listByProvider(providerKey);
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

  for (const group of groupedOffers.values()) {
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
      signalId: buildSignalId(current),
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

function buildSignalId(offer: ProviderOfferRecord) {
  return [
    'line-movement',
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
