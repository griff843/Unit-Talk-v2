import {
  ACTIVE_ALERT_SPORTS,
  SYSTEM_PICK_BLOCKED_MARKET_TYPES,
  SYSTEM_PICK_ELIGIBLE_MARKET_TYPES,
  loadAlertAgentConfig,
  type AlertAgentConfig,
} from './alert-agent-service.js';
import type { AlertDetectionRepository, AuditLogRepository } from '@unit-talk/db';

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

export function resolveAlertAgentConfig(
  env: NodeJS.ProcessEnv = process.env,
): AlertAgentConfig {
  return loadAlertAgentConfig(env);
}
