import type { NormalizedProviderOffer } from '@unit-talk/contracts';
import {
  inferSgoParticipantId,
  normalizeSgoProviderMarketKey,
} from './sgo-request-contract.js';

export interface SGOPairedProp {
  providerEventId: string;
  marketKey: string;
  providerParticipantId: string | null;
  sportKey: string | null;
  line: number | string | null;
  overOdds: number | null;
  underOdds: number | null;
  snapshotAt: string;
  /** Distinguishes explicit SGO historical open/close prices sharing the same snapshot. */
  priceSource?: 'current' | 'open' | 'close';
  isOpening?: boolean;
  isClosing?: boolean;
  /** Per-bookmaker source from byBookmaker (e.g. 'pinnacle'). Null = consensus SGO row. */
  bookmakerKey?: string | null;
}

export function normalizeSGOPairedProp(
  prop: SGOPairedProp,
): NormalizedProviderOffer | null {
  if (prop.overOdds === null && prop.underOdds === null) {
    return null;
  }

  const line = parseLineValue(prop.line);
  const providerParticipantId =
    normalizeSgoParticipantId(prop.providerParticipantId) ??
    inferSgoParticipantId(prop.marketKey);
  const providerMarketKey = normalizeSgoProviderMarketKey(prop.marketKey, {
    statEntityId: providerParticipantId,
  });
  if (providerMarketKey === null) {
    return null;
  }

  const bookmakerKey = prop.bookmakerKey ?? null;
  const normalized: NormalizedProviderOffer = {
    providerKey: 'sgo',
    providerEventId: prop.providerEventId,
    providerMarketKey,
    providerParticipantId,
    sportKey: overrideSportKeyFromMarketKey(prop.marketKey, prop.sportKey),
    line,
    overOdds: toAmericanOdds(prop.overOdds),
    underOdds: toAmericanOdds(prop.underOdds),
    devigMode:
      prop.overOdds !== null && prop.underOdds !== null
        ? 'PAIRED'
        : 'FALLBACK_SINGLE_SIDED',
    isOpening: prop.isOpening ?? false,
    isClosing: prop.isClosing ?? false,
    snapshotAt: prop.snapshotAt,
    bookmakerKey,
    idempotencyKey: buildProviderOfferIdempotencyKey({
      providerKey: 'sgo',
      providerEventId: prop.providerEventId,
      providerMarketKey,
      providerParticipantId,
      line,
      snapshotAt: prop.snapshotAt,
      bookmakerKey,
      ...(prop.priceSource ? { priceSource: prop.priceSource } : {}),
    }),
  };

  return normalized;
}

export function buildProviderOfferIdempotencyKey(input: {
  providerKey: string;
  providerEventId: string;
  providerMarketKey: string;
  providerParticipantId: string | null;
  line: number | null;
  snapshotAt: string;
  bookmakerKey?: string | null;
  priceSource?: 'current' | 'open' | 'close';
}) {
  const lineStr = input.line !== null ? input.line.toFixed(1) : 'null';
  const parts = [
    input.providerKey,
    input.providerEventId,
    input.providerMarketKey,
    input.providerParticipantId ?? 'all',
    lineStr,
    input.snapshotAt,
  ];
  if (input.bookmakerKey) {
    parts.push(input.bookmakerKey);
  }
  if (input.priceSource && input.priceSource !== 'current') {
    parts.push(input.priceSource);
  }
  return parts.join(':');
}

// MLB-exclusive market key prefixes. SGO occasionally sends the wrong sportKey
// for events that contain these markets; market key is the ground truth.
const MLB_MARKET_PREFIXES = ['batting_', 'pitching_'];

function overrideSportKeyFromMarketKey(
  marketKey: string,
  sportKey: string | null,
): string | null {
  const lower = marketKey.toLowerCase();
  if (MLB_MARKET_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return 'MLB';
  }
  return sportKey;
}

function parseLineValue(value: number | string | null) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeSgoParticipantId(value: string | null) {
  if (
    !value ||
    /^(player[-_])?(home|away)$/i.test(value) ||
    value.toLowerCase() === 'all'
  ) {
    return null;
  }
  return value;
}

function toAmericanOdds(value: number | null) {
  if (value === null) {
    return null;
  }
  return Number.isFinite(value) ? Math.trunc(value) : null;
}
