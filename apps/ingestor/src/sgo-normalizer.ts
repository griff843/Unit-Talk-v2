import type { NormalizedProviderOffer } from '@unit-talk/contracts';

export interface SGOPairedProp {
  providerEventId: string;
  marketKey: string;
  providerParticipantId: string | null;
  sportKey: string | null;
  line: number | string | null;
  overOdds: number | null;
  underOdds: number | null;
  snapshotAt: string;
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
  const providerMarketKey = normalizeProviderMarketKey(prop.marketKey);
  const providerParticipantId =
    prop.providerParticipantId ?? inferParticipantId(prop.marketKey);

  const bookmakerKey = prop.bookmakerKey ?? null;
  const normalized: NormalizedProviderOffer = {
    providerKey: 'sgo',
    providerEventId: prop.providerEventId,
    providerMarketKey,
    providerParticipantId,
    sportKey: prop.sportKey,
    line,
    overOdds: toAmericanOdds(prop.overOdds),
    underOdds: toAmericanOdds(prop.underOdds),
    devigMode:
      prop.overOdds !== null && prop.underOdds !== null
        ? 'PAIRED'
        : 'FALLBACK_SINGLE_SIDED',
    isOpening: false,
    isClosing: false,
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
  return parts.join(':');
}

function normalizeProviderMarketKey(marketKey: string) {
  const baseKey = stripSideSuffix(marketKey);
  const segments = baseKey.split('-');
  if (segments.length >= 4) {
    return [segments[0], 'all', ...segments.slice(-2)].join('-');
  }
  return baseKey;
}

function inferParticipantId(marketKey: string) {
  const segments = stripSideSuffix(marketKey).split('-');
  if (segments.length < 4) {
    return null;
  }

  const candidate = segments.slice(1, -2).join('-');
  if (!candidate || candidate === 'all' || /^(player[-_])?(home|away)$/i.test(candidate)) {
    return null;
  }
  return candidate;
}

function stripSideSuffix(marketKey: string) {
  return marketKey.replace(/-(over|under|home|away)$/i, '');
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

function toAmericanOdds(value: number | null) {
  if (value === null) {
    return null;
  }
  return Number.isFinite(value) ? Math.trunc(value) : null;
}
