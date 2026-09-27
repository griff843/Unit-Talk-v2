// WORK-2026092701: pure classification for scripts/pipeline-health.ts.
//
// The monitor used to judge the outbox against `discord:canary` — the fallback
// when `UNIT_TALK_DISTRIBUTION_TARGETS` is unset in CI — rather than against the
// worker that is actually deployed. It then called a row held by the live kill
// switch a stranding "target mismatch" and advised rerouting it, and called rows
// on retired targets that no deployed worker can claim "stuck processing".
//
// Everything here is pure: no I/O, no env, no clock. The script feeds it rows it
// has already read.

export type WorkerTargetSource = 'heartbeat' | 'env' | 'unknown';

export interface HeartbeatRow {
  started_at: string;
  details?: unknown;
}

export interface ResolvedWorkerTargets {
  source: WorkerTargetSource;
  targets: string[];
  /** started_at of the heartbeat the targets came from, when source = heartbeat. */
  heartbeatAt: string | null;
  /** Human-readable account of how the targets were resolved. */
  note: string;
}

export interface ResolveWorkerTargetsInput {
  /** Newest first, as the script reads them. */
  heartbeats: readonly HeartbeatRow[];
  envTargets: string | undefined;
  now: Date;
  maxHeartbeatAgeMinutes: number;
}

function heartbeatTargets(details: unknown): string[] | null {
  if (details === null || typeof details !== 'object') return null;
  const targets = (details as { targets?: unknown }).targets;
  if (!Array.isArray(targets) || targets.length === 0) return null;
  if (!targets.every((t): t is string => typeof t === 'string' && t.trim().length > 0)) return null;
  return [...new Set(targets.map((t) => t.trim()))];
}

/**
 * The deployed worker records the targets it polls on every heartbeat. That is
 * the only source that describes the running worker; an env value in the
 * monitor's own job describes nothing deployed, so it is used only when no fresh
 * heartbeat says otherwise. With neither, the target set is unknown — there is
 * deliberately no default.
 */
export function resolveDeployedWorkerTargets(input: ResolveWorkerTargetsInput): ResolvedWorkerTargets {
  const maxAgeMs = input.maxHeartbeatAgeMinutes * 60_000;
  for (const heartbeat of input.heartbeats) {
    const startedMs = new Date(heartbeat.started_at).getTime();
    if (!Number.isFinite(startedMs)) continue;
    const ageMs = input.now.getTime() - startedMs;
    if (ageMs < 0 || ageMs > maxAgeMs) continue;
    const targets = heartbeatTargets(heartbeat.details);
    if (targets) {
      return {
        source: 'heartbeat',
        targets,
        heartbeatAt: heartbeat.started_at,
        note: `from worker.heartbeat at ${heartbeat.started_at}`,
      };
    }
  }

  const envTargets = (input.envTargets ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (envTargets.length > 0) {
    return {
      source: 'env',
      targets: [...new Set(envTargets)],
      heartbeatAt: null,
      note: `from UNIT_TALK_DISTRIBUTION_TARGETS (no worker.heartbeat within ${input.maxHeartbeatAgeMinutes}m recorded its targets)`,
    };
  }

  return {
    source: 'unknown',
    targets: [],
    heartbeatAt: null,
    note: `no worker.heartbeat within ${input.maxHeartbeatAgeMinutes}m recorded its targets and UNIT_TALK_DISTRIBUTION_TARGETS is unset`,
  };
}

/**
 * The worker's own kill-switch key for a delivery target
 * (apps/worker/src/runner.ts): `discord:X` → `X`, with `discord:canary` exempt.
 * Any other target has no kill-switch key.
 */
export function killSwitchKeyForTarget(target: string): string | null {
  return target.startsWith('discord:') && target !== 'discord:canary'
    ? target.slice('discord:'.length)
    : null;
}

export interface KillSwitchRow {
  target: string;
  killed: boolean;
}

export interface OutboxRowLike {
  id: string;
  status: string;
  target: string;
}

export interface HeldPartition<Row> {
  held: Row[];
  rest: Row[];
}

/**
 * A pending row on a target the worker polls is *held* when the worker would
 * refuse it at the kill switch: the key's row says `killed = true`, or there is
 * no row at all (the worker's `isKilled` is fail-closed on a missing row).
 *
 * `killSwitchRows = null` means the table could not be read. Nothing is then
 * classified as held, so every such row keeps the critical treatment it had.
 */
export function partitionHeldPendingRows<Row extends OutboxRowLike>(
  rows: readonly Row[],
  killSwitchRows: readonly KillSwitchRow[] | null,
  workerTargets: readonly string[],
): HeldPartition<Row> {
  if (killSwitchRows === null) return { held: [], rest: [...rows] };
  const polled = new Set(workerTargets);
  const liveByKey = new Map(killSwitchRows.map((row) => [row.target, row.killed]));
  const held: Row[] = [];
  const rest: Row[] = [];
  for (const row of rows) {
    const key = killSwitchKeyForTarget(row.target);
    const isHeld =
      row.status === 'pending' &&
      polled.has(row.target) &&
      key !== null &&
      liveByKey.get(key) !== false;
    (isHeld ? held : rest).push(row);
  }
  return { held, rest };
}

/**
 * `processing` rows on a target the resolved worker does not poll cannot be
 * reclaimed by it, so a stale claim there is not evidence of a stuck worker.
 * They are returned separately so the report can name them — never dropped.
 *
 * With an unknown target set nothing is classified unclaimable: without knowing
 * what the worker polls, no row can be shown to be outside it.
 */
export function partitionUnclaimableProcessing<Row extends OutboxRowLike>(
  rows: readonly Row[],
  workerTargets: readonly string[],
): { unclaimable: Row[]; rest: Row[] } {
  if (workerTargets.length === 0) return { unclaimable: [], rest: [...rows] };
  const polled = new Set(workerTargets);
  const unclaimable: Row[] = [];
  const rest: Row[] = [];
  for (const row of rows) {
    (row.status === 'processing' && !polled.has(row.target) ? unclaimable : rest).push(row);
  }
  return { unclaimable, rest };
}

export function countByTarget(rows: readonly { target: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.target] = (counts[row.target] ?? 0) + 1;
  return counts;
}

export function formatTargetCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([target, count]) => `${target}=${count}`)
    .join(', ');
}
