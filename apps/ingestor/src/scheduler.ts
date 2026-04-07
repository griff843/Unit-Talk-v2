/**
 * Adaptive on-peak / off-peak poll scheduler for the ingestor runner.
 *
 * When scheduling is disabled (default), the runner uses its fixed `pollIntervalMs`.
 * When enabled, the runner resolves the current ET hour and picks the appropriate interval.
 *
 * Peak window is [peakStartHourEt, peakEndHourEt) in Eastern Time (0–23).
 * peakEndHourEt=24 is treated as end-of-day (covers hours 12–23 when start=12).
 * Overnight windows are supported (e.g. start=20, end=4 covers 20:00–03:59 ET).
 */

export interface SchedulerConfig {
  enabled: boolean;
  /** Poll interval (ms) during peak hours. Default: 30 000 (30s). */
  peakPollMs: number;
  /** Poll interval (ms) during off-peak hours. Default: 300 000 (5 min). */
  offPeakPollMs: number;
  /** Start of peak window, Eastern Time hour (0–23). Default: 12 (noon). */
  peakStartHourEt: number;
  /** End of peak window, Eastern Time hour, exclusive (0–24). Default: 24 (midnight). */
  peakEndHourEt: number;
}

export interface SchedulerResolution {
  intervalMs: number;
  mode: 'peak' | 'off-peak' | 'fixed';
  currentHourEt: number | null;
}

/**
 * Resolve the poll interval for the current moment.
 *
 * @param config  Scheduler configuration
 * @param fixedFallbackMs  Used when scheduling is disabled
 * @param nowMs   Optional override for current time (for testing)
 */
export function resolveCurrentPollIntervalMs(
  config: SchedulerConfig,
  fixedFallbackMs: number,
  nowMs?: number,
): SchedulerResolution {
  if (!config.enabled) {
    return { intervalMs: fixedFallbackMs, mode: 'fixed', currentHourEt: null };
  }

  const currentHourEt = getEasternHour(nowMs);
  const isPeak = isInPeakWindow(currentHourEt, config.peakStartHourEt, config.peakEndHourEt);

  return {
    intervalMs: isPeak ? config.peakPollMs : config.offPeakPollMs,
    mode: isPeak ? 'peak' : 'off-peak',
    currentHourEt,
  };
}

/** Return a human-readable log line for a scheduler resolution. */
export function formatSchedulerLog(resolution: SchedulerResolution): string {
  if (resolution.mode === 'fixed') {
    return `scheduling=disabled interval=${resolution.intervalMs}ms`;
  }
  return `scheduling=enabled mode=${resolution.mode} hourET=${resolution.currentHourEt} interval=${resolution.intervalMs}ms`;
}

export interface SchedulerEnv {
  UNIT_TALK_INGESTOR_SCHEDULING_ENABLED?: string | undefined;
  UNIT_TALK_INGESTOR_PEAK_POLL_MS?: string | undefined;
  UNIT_TALK_INGESTOR_OFFPEAK_POLL_MS?: string | undefined;
  UNIT_TALK_INGESTOR_PEAK_START_HOUR_ET?: string | undefined;
  UNIT_TALK_INGESTOR_PEAK_END_HOUR_ET?: string | undefined;
}

export function parseSchedulerConfig(env: SchedulerEnv): SchedulerConfig {
  const enabled = env.UNIT_TALK_INGESTOR_SCHEDULING_ENABLED === 'true';
  return {
    enabled,
    peakPollMs: parsePositiveInt(env.UNIT_TALK_INGESTOR_PEAK_POLL_MS, 30_000),
    offPeakPollMs: parsePositiveInt(env.UNIT_TALK_INGESTOR_OFFPEAK_POLL_MS, 300_000),
    peakStartHourEt: parseHour(env.UNIT_TALK_INGESTOR_PEAK_START_HOUR_ET, 12),
    peakEndHourEt: parseHour(env.UNIT_TALK_INGESTOR_PEAK_END_HOUR_ET, 24),
  };
}

// ── internals ─────────────────────────────────────────────────────────────────

function getEasternHour(nowMs?: number): number {
  const date = nowMs !== undefined ? new Date(nowMs) : new Date();
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hour12: false,
    }).formatToParts(date);
    const hourPart = parts.find((p) => p.type === 'hour');
    if (hourPart) {
      const h = Number(hourPart.value);
      // Intl may return 24 at midnight in some runtimes — normalise to 0
      return h === 24 ? 0 : h;
    }
  } catch {
    // fall through to local-time fallback
  }
  return date.getHours();
}

function isInPeakWindow(hour: number, startHour: number, endHour: number): boolean {
  // Normalise endHour=24 → treat as exclusive upper bound past 23
  const end = endHour > 23 ? 24 : endHour;

  if (startHour < end) {
    // Normal window (e.g. 12–24, 9–17)
    return hour >= startHour && hour < end;
  }
  // Overnight window (e.g. 20–4: covers 20,21,22,23,0,1,2,3)
  return hour >= startHour || hour < end;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseHour(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 24) return fallback;
  return parsed;
}
