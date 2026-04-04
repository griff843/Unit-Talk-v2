import {
  ACTIVE_ALERT_SPORTS,
  SYSTEM_PICK_BLOCKED_MARKET_TYPES,
  SYSTEM_PICK_ELIGIBLE_MARKET_TYPES,
  loadAlertAgentConfig,
  type AlertAgentConfig,
} from './alert-agent-service.js';
import type {
  AlertDetectionRepository,
  AuditLogRepository,
  PickRepository,
  SettlementRecord,
  SettlementRepository,
} from '@unit-talk/db';

export type RecentAlertTier = 'notable' | 'alert-worthy';

export interface RecentAlertDetection {
  id: string;
  eventId: string;
  marketKey: string;
  bookmakerKey: string;
  marketType: 'spread' | 'total' | 'moneyline' | 'player_prop';
  direction: 'up' | 'down';
  tier: RecentAlertTier;
  oldLine: number;
  newLine: number;
  lineChange: number;
  lineChangeAbs: number;
  velocity: number | null;
  timeElapsedMinutes: number;
  currentSnapshotAt: string;
  notified: boolean;
  cooldownExpiresAt: string | null;
}

export interface AlertsRecentResponse {
  detections: RecentAlertDetection[];
  total: number;
}

export interface AlertStatusResponse {
  enabled: boolean;
  dryRun: boolean;
  systemPicksEnabled: boolean;
  effectiveMode: 'disabled' | 'dry-run' | 'live';
  minTier: string;
  lookbackMinutes: number;
  activeSports: string[];
  systemPickEligibleMarketTypes: string[];
  systemPickBlockedMarketTypes: string[];
  last1h: {
    notable: number;
    alertWorthy: number;
    notified: number;
    failedDeliveries: number;
    steamEvents: number;
  };
  lastDetectedAt: string | null;
}

export interface AlertSignalQualitySlice {
  count: number;
  avgClvPct: number | null;
  winRate: number | null;
  sufficientSample: boolean;
}

export interface AlertSignalQualitySportSummary {
  count: number;
  avgClvPct: number | null;
  winRate: number | null;
}

export interface AlertSignalQualityResponse {
  periods: {
    '30d': AlertSignalQualitySlice;
    '60d': AlertSignalQualitySlice;
    '90d': AlertSignalQualitySlice;
  };
  bySport: Record<string, AlertSignalQualitySportSummary>;
  insufficientData: boolean;
  minimumSampleRequired: number;
  dataGaps: string[];
}

type SettledAlertAgentPick = {
  settledAt: string;
  sport: string | null;
  result: string | null;
  clvPercent: number | null;
};

export const ALERT_SIGNAL_QUALITY_MIN_SAMPLE = 10;
export const ALERT_SIGNAL_QUALITY_DATA_GAPS = [
  'rlm_public_money_pct_not_available',
  'sharp_book_classification_requires_longitudinal_first_mover_data',
] as const;

export interface GetRecentAlertsOptions {
  limit?: number | null | undefined;
  minTier?: RecentAlertTier | null | undefined;
}

export function clampRecentAlertLimit(limit?: number | null | undefined) {
  if (!Number.isFinite(limit)) {
    return 5;
  }

  return Math.min(10, Math.max(1, Math.trunc(limit as number)));
}

export function normalizeRecentAlertTier(
  minTier?: string | null | undefined,
): RecentAlertTier {
  return minTier === 'alert-worthy' ? 'alert-worthy' : 'notable';
}

export async function getRecentAlerts(
  repository: AlertDetectionRepository,
  options: GetRecentAlertsOptions = {},
): Promise<AlertsRecentResponse> {
  const limit = clampRecentAlertLimit(options.limit);
  const minTier = normalizeRecentAlertTier(options.minTier);
  const records = await repository.listRecent(limit, { minTier });

  return {
    detections: records.map((record) => ({
      id: record.id,
      eventId: record.event_id,
      marketKey: record.market_key,
      bookmakerKey: record.bookmaker_key,
      marketType: record.market_type as RecentAlertDetection['marketType'],
      direction: record.direction as RecentAlertDetection['direction'],
      tier: record.tier as RecentAlertTier,
      oldLine: record.old_line,
      newLine: record.new_line,
      lineChange: record.line_change,
      lineChangeAbs: record.line_change_abs,
      velocity: record.velocity,
      timeElapsedMinutes: record.time_elapsed_minutes,
      currentSnapshotAt: record.current_snapshot_at,
      notified: record.notified,
      cooldownExpiresAt: record.cooldown_expires_at,
    })),
    total: records.length,
  };
}

export async function getAlertStatus(
  repository: AlertDetectionRepository,
  auditRepository: AuditLogRepository,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): Promise<AlertStatusResponse> {
  const config = loadAlertAgentConfig(env);
  const lastHourWindowStart = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const summary = await repository.getStatusSummary(lastHourWindowStart);
  const failedAttemptRows = await auditRepository.listRecentByEntityType(
    'alert_notification',
    lastHourWindowStart,
    'notify_attempt',
  );
  const failedDetectionIds = [
    ...new Set(
      failedAttemptRows
        .map((row) => row.entity_id)
        .filter((entityId): entityId is string => typeof entityId === 'string' && entityId.length > 0),
    ),
  ];
  const failedDetections = await repository.findByIds(failedDetectionIds);
  const failedDeliveries = [...failedDetections.values()].filter((record) => record.notified === false).length;

  return {
    enabled: config.enabled,
    dryRun: config.dryRun,
    systemPicksEnabled: env.SYSTEM_PICKS_ENABLED === 'true',
    effectiveMode:
      !config.enabled ? 'disabled' : config.dryRun ? 'dry-run' : 'live',
    minTier: config.minTier,
    lookbackMinutes: config.lookbackMinutes,
    activeSports: [...ACTIVE_ALERT_SPORTS],
    systemPickEligibleMarketTypes: [...SYSTEM_PICK_ELIGIBLE_MARKET_TYPES],
    systemPickBlockedMarketTypes: [...SYSTEM_PICK_BLOCKED_MARKET_TYPES],
    last1h: {
      ...summary.counts,
      failedDeliveries,
    },
    lastDetectedAt: summary.lastDetectedAt,
  };
}

export async function getAlertSignalQuality(
  repositories: {
    picks: PickRepository;
    settlements: SettlementRepository;
  },
  now: Date = new Date(),
): Promise<AlertSignalQualityResponse> {
  const picks = await repositories.picks.listBySource('alert-agent');
  const settled = (
    await Promise.all(
      picks.map(async (pick) => {
        const settlement = await resolveLatestSettlement(repositories.settlements, pick.id);
        if (!settlement || settlement.status !== 'settled') {
          return null;
        }

        return {
          settledAt: settlement.settled_at,
          sport: readSportFromMetadata(pick.metadata),
          result: settlement.result,
          clvPercent: readClvPercent(settlement),
        } satisfies SettledAlertAgentPick;
      }),
    )
  ).filter((record): record is SettledAlertAgentPick => record !== null);

  const periods = {
    '30d': summarizeSettledAlertPicks(settleWithinDays(settled, now, 30)),
    '60d': summarizeSettledAlertPicks(settleWithinDays(settled, now, 60)),
    '90d': summarizeSettledAlertPicks(settleWithinDays(settled, now, 90)),
  };

  const bySport = summarizeBySport(settleWithinDays(settled, now, 90));

  return {
    periods,
    bySport,
    insufficientData: Object.values(periods).some((period) => period.sufficientSample === false),
    minimumSampleRequired: ALERT_SIGNAL_QUALITY_MIN_SAMPLE,
    dataGaps: [...ALERT_SIGNAL_QUALITY_DATA_GAPS],
  };
}

export function resolveAlertAgentConfig(
  env: NodeJS.ProcessEnv = process.env,
): AlertAgentConfig {
  return loadAlertAgentConfig(env);
}

async function resolveLatestSettlement(
  repository: SettlementRepository,
  pickId: string,
): Promise<SettlementRecord | null> {
  const settlements = await repository.listByPick(pickId);
  return settlements[0] ?? null;
}

function settleWithinDays(
  records: SettledAlertAgentPick[],
  now: Date,
  days: number,
) {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  return records.filter((record) => record.settledAt >= cutoff);
}

function summarizeSettledAlertPicks(
  records: SettledAlertAgentPick[],
): AlertSignalQualitySlice {
  const count = records.length;
  const sufficientSample = count >= ALERT_SIGNAL_QUALITY_MIN_SAMPLE;

  if (!sufficientSample) {
    return {
      count,
      avgClvPct: null,
      winRate: null,
      sufficientSample,
    };
  }

  const clvValues = records
    .map((record) => record.clvPercent)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const wins = records.filter((record) => record.result === 'win').length;

  return {
    count,
    avgClvPct: clvValues.length > 0 ? roundTo(clvValues.reduce((sum, value) => sum + value, 0) / clvValues.length, 4) : null,
    winRate: roundTo(wins / count, 4),
    sufficientSample,
  };
}

function summarizeBySport(
  records: SettledAlertAgentPick[],
): Record<string, AlertSignalQualitySportSummary> {
  const grouped = new Map<string, SettledAlertAgentPick[]>();

  for (const record of records) {
    const sport = record.sport;
    if (!sport) {
      continue;
    }

    const current = grouped.get(sport) ?? [];
    current.push(record);
    grouped.set(sport, current);
  }

  return Object.fromEntries(
    Array.from(grouped.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([sport, sportRecords]) => {
        const summary = summarizeSettledAlertPicks(sportRecords);
        return [
          sport,
          {
            count: summary.count,
            avgClvPct: summary.avgClvPct,
            winRate: summary.winRate,
          } satisfies AlertSignalQualitySportSummary,
        ];
      }),
  );
}

function readClvPercent(settlement: SettlementRecord) {
  const payload = asRecord(settlement.payload);
  const raw = payload.clvPercent;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function readSportFromMetadata(metadata: unknown) {
  const record = asRecord(metadata);
  const sport = record.sport;
  return typeof sport === 'string' && sport.trim().length > 0 ? sport.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function roundTo(value: number, decimals: number) {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}
