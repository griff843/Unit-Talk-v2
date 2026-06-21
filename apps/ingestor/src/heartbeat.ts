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
  /** Epoch ms when the heartbeat was written (== lastProgressAt; see below). */
  ts: number;
  /** Cycle counter at the time of the heartbeat. */
  cycle: number;
  /** PID that wrote it (diagnostic; helps spot a stale file from a dead process). */
  pid: number;
  /**
   * Coarse loop phase that last advanced (UTV2-1286): 'startup', 'cycle-start',
   * 'league-start', 'league-end', 'finalized-repoll-start', etc. Optional for
   * backward-compatibility with pre-1286 heartbeat files that only carry ts/cycle/pid.
   */
  phase?: string;
  /**
   * League in flight when the phase advanced (UTV2-1286), or null for cycle-level
   * phases. Optional for backward-compatibility.
   */
  league?: string | null;
  /**
   * Epoch ms of the last forward loop progress (UTV2-1286). Equal to `ts` because the
   * heartbeat is written ONLY when the loop makes progress — a heartbeat that pinged
   * without progress would re-introduce the wedge-masking bug UTV2-1284 fixed. Carried
   * explicitly so consumers can read the progress timestamp without relying on the
   * file's mtime. Optional for backward-compatibility.
   */
  lastProgressAt?: number;
}

/**
 * A single forward-progress signal emitted by the cycle loop (UTV2-1286).
 *
 * UTV2-1284 stamped one heartbeat per *cycle iteration* (at the top of the loop,
 * before any work). A single MLB cycle's wall-clock — 4 leagues × the per-league
 * bound, plus finalized-repolls — can exceed the 20-minute watchdog threshold, so a
 * slow-but-progressing cycle went "stale" and the watchdog force-exited it (false
 * positive). UTV2-1286 emits this finer-grained signal at every phase boundary
 * (poll start, each league start/end, finalized-repoll start/end), so the watchdog
 * keys off *no progress*, not *slow progress*.
 */
export interface IngestorLoopProgress {
  /** Cycle counter (1-based; 0 for the pre-first-cycle startup beat). */
  cycle: number;
  /** Coarse phase label that advanced. */
  phase: string;
  /** League in flight, when the phase is league-scoped; omitted/null for cycle-level phases. */
  league?: string | null;
}

export interface HeartbeatLiveness {
  healthy: boolean;
  ageMs: number | null;
  reason: string;
}

/** Default heartbeat file. Overridable via UNIT_TALK_INGESTOR_HEARTBEAT_FILE. */
export const DEFAULT_HEARTBEAT_FILE = join(tmpdir(), 'unit-talk-ingestor-heartbeat.json');

/**
 * Max time without ANY loop progress before the loop is considered wedged.
 *
 * UTV2-1286: progress is now stamped at every phase boundary (per poll, per league
 * start/end, per finalized-repoll), so the gap between heartbeats is bounded by a
 * single phase — at most the per-league wall-clock bound (`leagueTimeoutMs`,
 * default 240s), never a whole multi-league cycle. This threshold therefore only
 * needs to comfortably clear one phase while still catching a true wedge (no phase
 * advancing for many minutes). Kept at 20 min — ~5× the per-league bound — for
 * margin. Overridable via UNIT_TALK_INGESTOR_HEARTBEAT_MAX_AGE_MS.
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
    const heartbeat: IngestorHeartbeat = {
      ts: parsed.ts,
      cycle: parsed.cycle,
      pid: parsed.pid,
    };
    // Optional progress metadata (UTV2-1286) — present only on heartbeats written
    // by the post-1286 daemon. Pre-1286 files round-trip to exactly {ts,cycle,pid}.
    if (typeof parsed.phase === 'string') heartbeat.phase = parsed.phase;
    if (typeof parsed.league === 'string') heartbeat.league = parsed.league;
    else if (parsed.league === null) heartbeat.league = null;
    if (typeof parsed.lastProgressAt === 'number') heartbeat.lastProgressAt = parsed.lastProgressAt;
    return heartbeat;
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
  const where = heartbeat.phase
    ? `phase=${heartbeat.phase}${heartbeat.league ? ` league=${heartbeat.league}` : ''}`
    : `cycle=${heartbeat.cycle}`;
  if (ageMs > maxAgeMs) {
    return {
      healthy: false,
      ageMs,
      reason: `heartbeat stale: ${Math.round(ageMs / 1000)}s without loop progress (> ${Math.round(maxAgeMs / 1000)}s) — loop wedged (last ${where})`,
    };
  }
  return {
    healthy: true,
    ageMs,
    reason: `heartbeat fresh: ${Math.round(ageMs / 1000)}s old, cycle=${heartbeat.cycle} (last ${where})`,
  };
}

/**
 * Pure in-process watchdog decision (UTV2-1286): force-exit the daemon ONLY when
 * the loop has made no forward progress for longer than the bound — i.e. a true
 * no-progress wedge, not a slow-but-advancing cycle.
 *
 * `lastProgressAt` is the epoch ms of the most recent progress signal (any phase
 * boundary). Because progress is stamped per-phase, a long-but-progressing cycle
 * keeps advancing this value and never trips; only a genuinely stuck loop (no
 * phase advancing past the bound) does.
 */
export function shouldWatchdogForceExit(
  lastProgressAt: number,
  maxAgeMs: number,
  now: number,
): boolean {
  return now - lastProgressAt > maxAgeMs;
}
