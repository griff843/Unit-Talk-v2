// WORK-2026092701: pure classification for scripts/pipeline-health.ts.
//
// The monitor used to judge the outbox against `discord:canary` — the fallback
// when `UNIT_TALK_DISTRIBUTION_TARGETS` is unset in CI — rather than against the
// worker that is actually deployed. It then called a row held by the live kill
// switch a stranding "target mismatch" and advised rerouting it, and called rows
// on retired targets that no deployed worker can claim "stuck processing".
//
// Everything here is pure (no env, no clock, no I/O of its own) except
// `readAllPages`, which performs only the reads its caller injects.
//
// WORK-2026092703: the monitor also read only the first 1000 non-sent rows, and
// classified dead letters with its own copy of a rule the readiness gate owns.
//
// WORK-2026092708: the authority-boundary check judged 100 arbitrary receipts
// against a hardcoded two-target list that never named `official-picks`.

import { governedDeliveryTargets } from '@unit-talk/contracts';
import { classifyDeadLetter } from './outbox-triage.js';

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
  if (
    !targets.every(
      (t): t is string => typeof t === 'string' && t.trim().length > 0,
    )
  )
    return null;
  return [...new Set(targets.map((t) => t.trim()))];
}

/**
 * The deployed worker records the targets it polls on every heartbeat. That is
 * the only source that describes the running worker; an env value in the
 * monitor's own job describes nothing deployed, so it is used only when no fresh
 * heartbeat says otherwise. With neither, the target set is unknown — there is
 * deliberately no default.
 */
export function resolveDeployedWorkerTargets(
  input: ResolveWorkerTargetsInput,
): ResolvedWorkerTargets {
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
  const liveByKey = new Map(
    killSwitchRows.map((row) => [row.target, row.killed]),
  );
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
    (row.status === 'processing' && !polled.has(row.target)
      ? unclaimable
      : rest
    ).push(row);
  }
  return { unclaimable, rest };
}

export function countByTarget(
  rows: readonly { target: string }[],
): Record<string, number> {
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

// ── dead letters (WORK-2026092703) ────────────────────────────────────────

export type DeadLetterBucket =
  | 'governance_hold'
  | 'unattempted_unclassified'
  | 'true_failure';

export interface DeadLetterRowLike {
  status: string;
  last_error?: unknown;
  attempt_count?: unknown;
}

/**
 * The readiness gate's rule (`bucketDeadLetterRows` in readiness-refresh.ts),
 * applied per row: a recognised disposition reason is a governance hold whatever
 * its attempt count; otherwise an attempted row is a true failure and an
 * unattempted one is unclassified. A non-numeric attempt count is not evidence
 * of "never attempted", so it counts as attempted (fail closed). The reason
 * classification itself is `classifyDeadLetter`, never a local copy.
 */
export function deadLetterBucket(row: DeadLetterRowLike): DeadLetterBucket {
  const reason = typeof row.last_error === 'string' ? row.last_error : null;
  const attempted =
    typeof row.attempt_count === 'number' ? row.attempt_count > 0 : true;
  const classification = classifyDeadLetter(reason);
  if (
    classification !== 'unrecognised' &&
    classification !== 'unclassified_null_reason'
  ) {
    return 'governance_hold';
  }
  return attempted ? 'true_failure' : 'unattempted_unclassified';
}

export interface DeadLetterPartition<Row> {
  governanceHold: Row[];
  unattemptedUnclassified: Row[];
  trueFailure: Row[];
  /** Every row that is not a dead letter, in input order. */
  rest: Row[];
}

export function partitionDeadLetters<Row extends DeadLetterRowLike>(
  rows: readonly Row[],
): DeadLetterPartition<Row> {
  const partition: DeadLetterPartition<Row> = {
    governanceHold: [],
    unattemptedUnclassified: [],
    trueFailure: [],
    rest: [],
  };
  for (const row of rows) {
    if (row.status !== 'dead_letter') {
      partition.rest.push(row);
      continue;
    }
    const bucket = deadLetterBucket(row);
    if (bucket === 'governance_hold') partition.governanceHold.push(row);
    else if (bucket === 'unattempted_unclassified')
      partition.unattemptedUnclassified.push(row);
    else partition.trueFailure.push(row);
  }
  return partition;
}

export function countByReasonClass(
  rows: readonly DeadLetterRowLike[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = classifyDeadLetter(
      typeof row.last_error === 'string' ? row.last_error : null,
    );
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

// ── paged reads (WORK-2026092703) ─────────────────────────────────────────

/** PostgREST's `max-rows` on this project; no response is ever larger. */
export const OUTBOX_PAGE_SIZE = 1000;

export interface RangeQuery<Row> {
  order(column: string, options: { ascending: boolean }): RangeQuery<Row>;
  range(
    from: number,
    to: number,
  ): PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;
}

/**
 * PostgREST caps every response at 1000 rows whatever `.limit()` asks for, so a
 * single read of a larger population silently returns its first page. Read in
 * `id`-ordered pages until a page comes back empty — the same loop as the
 * readiness reader. Without a stable order, range pages overlap and skip rows.
 * Rows are de-duplicated by id; the caller compares the result against an exact
 * count and refuses a partial read.
 */
export async function readAllPages<Row extends { id: string }>(
  makeQuery: () => RangeQuery<Row>,
  pageSize = OUTBOX_PAGE_SIZE,
  maxRows = 200_000,
): Promise<Row[]> {
  const byId = new Map<string, Row>();
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await makeQuery()
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error)
      throw new Error(`paged read failed at offset ${from}: ${error.message}`);
    const page = data ?? [];
    if (page.length === 0) break;
    for (const row of page) byId.set(row.id, row);
  }
  return [...byId.values()];
}

// ── receipt authority (WORK-2026092708) ───────────────────────────────────

/** Receipts recorded inside this many days are judged; older ones are history. */
export const RECEIPT_AUTHORITY_WINDOW_DAYS = 30;

export type ReceiptDestinationClass =
  | 'governed'
  | 'control'
  | 'simulated'
  | 'unrecognized';

export interface ReceiptRowLike {
  id: string;
  channel: string | null;
  payload?: unknown;
  recorded_at?: string;
  status?: unknown;
}

/**
 * The logical target a receipt was delivered for. Since UTV2-1929 `channel` is
 * the resolved Discord id (a pinned per-capper channel, say) and the logical
 * target lives in `payload.target`; older receipts carry the target in
 * `channel` itself.
 */
export function receiptLogicalTarget(row: ReceiptRowLike): string | null {
  const payload = row.payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const target = (payload as Record<string, unknown>).target;
    if (typeof target === 'string' && target.trim() !== '')
      return target.trim();
  }
  return typeof row.channel === 'string' && row.channel.trim() !== ''
    ? row.channel.trim()
    : null;
}

/**
 * `governed` — a destination the registry, worker coverage and kill switch
 * govern (`governedDeliveryTargets`). `control` — the canary lane.
 * `simulated` — a dry-run receipt, which delivered nothing. Anything else,
 * including a bare channel id with no logical target, is `unrecognized`: the
 * monitor cannot show it was authorized, so it does not call it clean.
 */
export function classifyReceiptDestination(
  row: ReceiptRowLike,
): ReceiptDestinationClass {
  const logical = receiptLogicalTarget(row);
  if (logical === null) return 'unrecognized';
  let name = logical.toLowerCase();
  if (name.startsWith('simulated:')) return 'simulated';
  if (name.startsWith('discord:')) name = name.slice('discord:'.length);
  if (name.startsWith('#')) name = name.slice(1);
  if ((governedDeliveryTargets as readonly string[]).includes(name))
    return 'governed';
  if (name === 'canary') return 'control';
  return 'unrecognized';
}

export interface ReceiptAuthorityPartition<Row> {
  governed: Row[];
  control: Row[];
  simulated: Row[];
  unrecognized: Row[];
}

export function partitionReceiptAuthority<Row extends ReceiptRowLike>(
  rows: readonly Row[],
): ReceiptAuthorityPartition<Row> {
  const out: ReceiptAuthorityPartition<Row> = {
    governed: [],
    control: [],
    simulated: [],
    unrecognized: [],
  };
  for (const row of rows) out[classifyReceiptDestination(row)].push(row);
  return out;
}

// ── delivery freshness from receipts (WORK-2026092811) ────────────────────

/**
 * A `sent` outbox row is not evidence of delivery: the worker marks a row
 * `sent`, and writes no receipt, when its pick is already settled or voided
 * (`apps/worker/src/distribution-worker.ts`). Only a receipt for a real
 * destination — `governed` or the `control` canary — shows something was
 * delivered. `simulated` receipts delivered nothing and `unrecognized` ones
 * cannot be shown to be authorized, so neither counts.
 */
export function newestDeliveredReceiptAt(
  rows: readonly ReceiptRowLike[],
): string | null {
  let newest: string | null = null;
  let newestMs = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    if (row.status !== 'sent') continue;
    const cls = classifyReceiptDestination(row);
    if (cls !== 'governed' && cls !== 'control') continue;
    const ms = row.recorded_at ? Date.parse(row.recorded_at) : Number.NaN;
    if (Number.isFinite(ms) && ms > newestMs) {
      newest = row.recorded_at ?? null;
      newestMs = ms;
    }
  }
  return newest;
}

/** Newest governed receipt per logical target, for the operator readout. */
export function newestGovernedReceiptByTarget(
  rows: readonly ReceiptRowLike[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (row.status !== 'sent') continue;
    if (classifyReceiptDestination(row) !== 'governed' || !row.recorded_at)
      continue;
    const target = receiptLogicalTarget(row);
    if (target === null) continue;
    const ms = Date.parse(row.recorded_at);
    if (!Number.isFinite(ms)) continue;
    const current = out[target];
    if (current === undefined || ms > Date.parse(current))
      out[target] = row.recorded_at;
  }
  return out;
}
