export type FreshnessProximityTier = 'pre' | 'standard' | 'game-day' | 'pre-start' | 'unknown-event';

export const STALE_DATA_FRESHNESS_CONTRACT = {
  proximityTiers: {
    pre: { thresholdMs: 6 * 60 * 60 * 1000 },
    standard: { thresholdMs: 2 * 60 * 60 * 1000 },
    gameDay: { thresholdMs: 60 * 60 * 1000 },
    preStart: { thresholdMs: 20 * 60 * 1000 },
    unknownEvent: { thresholdMs: 2 * 60 * 60 * 1000 },
  },
  sportModifiers: { nfl: 2, tennis: 0.75, default: 1 },
  marketModifiers: { playerPrefix: 1.5, default: 1 },
} as const;

export function evaluateProviderDataFreshness(input: {
  snapshotAt: string | null | undefined;
  eventStartsAt?: string | null | undefined;
  sportKey?: string | null | undefined;
  marketKey?: string | null | undefined;
  nowMs?: number | undefined;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const snapshotMs = parseTime(input.snapshotAt);
  const eventMs = parseTime(input.eventStartsAt);
  const snapshotAgeMs = snapshotMs === null ? null : Math.max(0, nowMs - snapshotMs);
  const minutesToEvent = eventMs === null ? null : Math.floor((eventMs - nowMs) / 60_000);
  const proximityTier = resolveTier(minutesToEvent);
  const freshnessThresholdMs = thresholdMs(proximityTier, input.sportKey, input.marketKey);
  const staleAtScanTime = snapshotAgeMs === null || snapshotAgeMs > freshnessThresholdMs;
  return {
    snapshotAgeMs,
    eventStartsAt: eventMs === null ? null : new Date(eventMs).toISOString(),
    minutesToEvent,
    proximityTier,
    freshnessThresholdMs,
    staleAtScanTime,
    staleReason: staleAtScanTime
      ? snapshotAgeMs === null
        ? 'missing_snapshot_at'
        : 'snapshot_age_exceeds_freshness_threshold'
      : null,
    freshnessWindowFailed: staleAtScanTime && (proximityTier === 'game-day' || proximityTier === 'pre-start'),
  };
}

function resolveTier(minutesToEvent: number | null): FreshnessProximityTier {
  if (minutesToEvent === null) return 'unknown-event';
  if (minutesToEvent < 60) return 'pre-start';
  if (minutesToEvent <= 6 * 60) return 'game-day';
  if (minutesToEvent <= 24 * 60) return 'standard';
  return 'pre';
}

function thresholdMs(
  tier: FreshnessProximityTier,
  sportKey: string | null | undefined,
  marketKey: string | null | undefined,
): number {
  const base = tier === 'pre'
    ? STALE_DATA_FRESHNESS_CONTRACT.proximityTiers.pre.thresholdMs
    : tier === 'standard'
      ? STALE_DATA_FRESHNESS_CONTRACT.proximityTiers.standard.thresholdMs
      : tier === 'game-day'
        ? STALE_DATA_FRESHNESS_CONTRACT.proximityTiers.gameDay.thresholdMs
        : tier === 'pre-start'
          ? STALE_DATA_FRESHNESS_CONTRACT.proximityTiers.preStart.thresholdMs
          : STALE_DATA_FRESHNESS_CONTRACT.proximityTiers.unknownEvent.thresholdMs;
  const sport = sportKey?.toLowerCase() === 'nfl'
    ? STALE_DATA_FRESHNESS_CONTRACT.sportModifiers.nfl
    : sportKey?.toLowerCase() === 'tennis'
      ? STALE_DATA_FRESHNESS_CONTRACT.sportModifiers.tennis
      : STALE_DATA_FRESHNESS_CONTRACT.sportModifiers.default;
  const market = marketKey?.toLowerCase().startsWith('player_')
    ? STALE_DATA_FRESHNESS_CONTRACT.marketModifiers.playerPrefix
    : STALE_DATA_FRESHNESS_CONTRACT.marketModifiers.default;
  return Math.round(base * sport * market);
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
