/**
 * Ingestor loop heartbeat (UTV2-1284).
 *
 * The ingestor daemon is a single `runIngestorCycles` call that loops forever.
 * Before UTV2-1284 the only liveness signal was the container healthcheck
 * `pgrep -f node` — which proves a node process exists, NOT that the cycle loop
 * is making progress. A transient DB failure could kill the loop while the
 * process lingered, so the container reported "healthy" for hours while no
 * cycles ran (production went dark 2026-06-20, ~5.5h).
 *
 * This module records a per-cycle heartbeat to a file. Two consumers read it:
 *   1. The in-process watchdog (index.ts) — force-exits the process when the
 *      heartbeat goes stale so `restart: unless-stopped` recreates it.
 *   2. The container healthcheck (healthcheck.ts) — replaces `pgrep node` with
 *      a check that the loop actually advanced recently.
 *
 * Pure functions are exported for unit testing; file IO is best-effort and
 * never throws into the cycle loop.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface IngestorHeartbeat {
  /** Epoch ms when the heartbeat was written. */
  ts: number;
  /** Cycle counter at the time of the heartbeat. */
  cycle: number;
  /** PID that wrote it (diagnostic; helps spot a stale file from a dead process). */
  pid: number;
}

export interface HeartbeatLiveness {
  healthy: boolean;
  ageMs: number | null;
  reason: string;
}

/** Default heartbeat file. Overridable via UNIT_TALK_INGESTOR_HEARTBEAT_FILE. */
export const DEFAULT_HEARTBEAT_FILE = join(tmpdir(), 'unit-talk-ingestor-heartbeat.json');

/**
 * Max heartbeat age before the loop is considered wedged. Generous on purpose:
 * a single MLB cycle can take minutes (240s per-league bound × leagues + the
 * off-peak poll interval), so the threshold must clear a slow-but-alive cycle
 * while still catching a multi-hour wedge. Overridable via
 * UNIT_TALK_INGESTOR_HEARTBEAT_MAX_AGE_MS.
 */
export const DEFAULT_HEARTBEAT_MAX_AGE_MS = 20 * 60_000;

export function resolveHeartbeatFile(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env['UNIT_TALK_INGESTOR_HEARTBEAT_FILE']?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_HEARTBEAT_FILE;
}

export function resolveHeartbeatMaxAgeMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['UNIT_TALK_INGESTOR_HEARTBEAT_MAX_AGE_MS']?.trim();
  if (!raw) return DEFAULT_HEARTBEAT_MAX_AGE_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_HEARTBEAT_MAX_AGE_MS;
}

/** Best-effort heartbeat write. Never throws — a write failure must not break the loop. */
export function writeHeartbeat(filePath: string, heartbeat: IngestorHeartbeat): boolean {
  try {
    writeFileSync(filePath, JSON.stringify(heartbeat), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** Read + parse the heartbeat file, or null if missing/unreadable/malformed. */
export function readHeartbeat(filePath: string): IngestorHeartbeat | null {
  try {
    if (!existsSync(filePath)) return null;
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<IngestorHeartbeat>;
    if (
      typeof parsed?.ts !== 'number' ||
      typeof parsed?.cycle !== 'number' ||
      typeof parsed?.pid !== 'number'
    ) {
      return null;
    }
    return { ts: parsed.ts, cycle: parsed.cycle, pid: parsed.pid };
  } catch {
    return null;
  }
}

/**
 * Decide whether the loop is alive given the last heartbeat. A missing heartbeat
 * is treated as not-healthy: the Docker `start_period` covers the legitimate
 * pre-first-cycle window, so a missing heartbeat past that window is a real
 * startup wedge (exactly the 521-at-startup failure mode).
 */
export function evaluateHeartbeatLiveness(
  heartbeat: IngestorHeartbeat | null,
  maxAgeMs: number,
  now: number,
): HeartbeatLiveness {
  if (!heartbeat) {
    return { healthy: false, ageMs: null, reason: 'no heartbeat recorded yet' };
  }
  const ageMs = now - heartbeat.ts;
  if (ageMs > maxAgeMs) {
    return {
      healthy: false,
      ageMs,
      reason: `heartbeat stale: ${Math.round(ageMs / 1000)}s old (> ${Math.round(maxAgeMs / 1000)}s) — loop wedged`,
    };
  }
  return {
    healthy: true,
    ageMs,
    reason: `heartbeat fresh: ${Math.round(ageMs / 1000)}s old, cycle=${heartbeat.cycle}`,
  };
}
