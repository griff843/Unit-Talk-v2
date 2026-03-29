import {
  loadAlertAgentConfig,
  type AlertAgentConfig,
} from './alert-agent-service.js';
import type { AlertDetectionRepository } from '@unit-talk/db';

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
  minTier: string;
  lookbackMinutes: number;
  last1h: {
    notable: number;
    alertWorthy: number;
    notified: number;
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
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): Promise<AlertStatusResponse> {
  const config = loadAlertAgentConfig(env);
  const lastHourWindowStart = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const summary = await repository.getStatusSummary(lastHourWindowStart);

  return {
    enabled: config.enabled,
    dryRun: config.dryRun,
    minTier: config.minTier,
    lookbackMinutes: config.lookbackMinutes,
    last1h: summary.counts,
    lastDetectedAt: summary.lastDetectedAt,
  };
}

export function resolveAlertAgentConfig(
  env: NodeJS.ProcessEnv = process.env,
): AlertAgentConfig {
  return loadAlertAgentConfig(env);
}
