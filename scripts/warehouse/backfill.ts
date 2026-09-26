import { redactForPersistence, redactLogEvent } from './config.js';
import { type DuckConnection } from './duckdb.js';
import {
  type ConveyorItemResult,
  type ConveyorPlanItem,
  type RetentionPolicyEntry,
  DEFAULT_RETENTION_POLICY,
  WINDOW_YEAR_SEASON,
  planConveyorRun,
  runConveyor,
} from './conveyor.js';
import { computeManifestId } from './manifest.js';
import { dataObjectKey, manifestObjectKey, requireIsoDate } from './object-layout.js';
import { type ObjectStore } from './object-store.js';

/**
 * The bounded historical backfill.
 *
 * The daily conveyor archives exactly one window per run, the day that has just
 * left hot retention, so it never reaches history that is already older than
 * that. This module reaches it -- and it is deliberately a thin driver over the
 * conveyor, not a second archiver. Export, manifest, verification and
 * idempotency are the conveyor's, unchanged: each day is run as a one-item
 * conveyor plan, so a backfilled day and a conveyor day are the same object
 * under the same key, and can never become two archives of one window.
 *
 * What the driver adds is order and a stopping rule:
 *
 *   **Bounded and explicit.** An inclusive `[from, to]` range of UTC days, at
 *   most {@link MAX_BACKFILL_WINDOWS}, planned oldest first. A wider range is
 *   split by the caller rather than absorbed here.
 *
 *   **Stop on first failure.** A failed window ends the run. No later window is
 *   attempted, so a failure is always the newest thing the run touched.
 *
 *   **Retry is a re-run.** A window whose manifest exists and passes
 *   `decidePrune` is skipped without reading the source. No state outside the
 *   bucket decides what is done; the progress ledger records, it never vouches.
 *
 * Plan: docs/05_operations/WAREHOUSE_HISTORICAL_BACKFILL_PLAN.md §4.
 * Nothing here deletes anything, and there is no prune path to add one to.
 */

export const BACKFILL_EVENT = 'warehouse.backfill';

/** The largest range one run may cover. The biggest this plan needs is 51 days. */
export const MAX_BACKFILL_WINDOWS = 62;

/**
 * The sources a backfill may be run for. Named, rather than taken from a policy
 * file, because each one is a PM decision (backfill plan §2).
 *
 * History is the daily conveyor's own entry, not a copy of it: the backfill and
 * the conveyor must compute the same key for the same day.
 */
function dailyConveyorEntry(relation: string): RetentionPolicyEntry {
  const entry = DEFAULT_RETENTION_POLICY.find((candidate) => candidate.relation === relation);
  if (!entry) {
    throw new Error(`DEFAULT_RETENTION_POLICY has no entry for ${relation}`);
  }
  return entry;
}

export const BACKFILL_SOURCES = {
  provider_offer_history: dailyConveyorEntry('public.provider_offer_history'),
  raw_payloads: dailyConveyorEntry('public.raw_payloads'),
  odds_snapshots: dailyConveyorEntry('public.odds_snapshots'),
  system_runs: dailyConveyorEntry('public.system_runs'),
  provider_offers_legacy_quarantine: {
    relation: 'public.provider_offers_legacy_quarantine',
    domain: 'markets',
    windowColumn: 'snapshot_at',
    hotRetentionDays: 45,
    sportColumn: null,
    sports: ['all'],
    orderBy: ['snapshot_at', 'id'],
    season: WINDOW_YEAR_SEASON,
    // A different table shape from history, so a different namespace. Its
    // manifests land under `manifests/raw_provider_offers_legacy/`.
    target: { kind: 'raw', provider: 'provider_offers_legacy' },
    // PM, 2026-09-24: archived, and not pruned -- not even once it verifies.
    pruneHold: true,
  },
} satisfies Record<string, RetentionPolicyEntry>;

export type BackfillSource = keyof typeof BACKFILL_SOURCES;

export function isBackfillSource(value: unknown): value is BackfillSource {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BACKFILL_SOURCES, value);
}

/** Relations whose policy entry carries a standing prune hold. */
export function isPruneHeldRelation(relation: string): boolean {
  return [...DEFAULT_RETENTION_POLICY, ...Object.values(BACKFILL_SOURCES)].some(
    (entry: RetentionPolicyEntry) => entry.pruneHold === true && entry.relation === relation,
  );
}

export class BackfillPlanError extends Error {
  readonly code = 'invalid_backfill_range';
  constructor(message: string) {
    super(message);
    this.name = 'BackfillPlanError';
  }
}

export interface BackfillWindow {
  date: string;
  data_key: string;
  manifest_key: string;
  item: ConveyorPlanItem;
}

export interface BackfillPlan {
  source: BackfillSource;
  relation: string;
  from: string;
  to: string;
  run_date: string;
  prune_hold: boolean;
  ledger_key: string;
  heartbeat_key: string;
  windows: BackfillWindow[];
}

function dayIndex(dateIso: string): number {
  return Date.parse(`${dateIso}T00:00:00.000Z`) / 86_400_000;
}

function isoFromIndex(index: number): string {
  return new Date(index * 86_400_000).toISOString().slice(0, 10);
}

/** `manifests/_backfill/<source>/<from>_<to>.json` -- an operator record, never read by the prune gate. */
export function backfillLedgerKey(source: BackfillSource, from: string, to: string): string {
  return `manifests/_backfill/${source}/${requireIsoDate(from)}_${requireIsoDate(to)}.json`;
}

/**
 * Plan a backfill. Pure, and refuses rather than trims: a range that is too
 * wide, backwards, or not made of real dates is an operator error to fix, not
 * something to silently narrow into a different run than the one dispatched.
 *
 * A window that has not yet left hot retention on `today` is refused too. Its
 * day may still be filling, and a verified manifest over a partial day would
 * make the daily conveyor skip it later as already done.
 */
export function planBackfill(input: {
  source: string;
  from: string;
  to: string;
  today: string;
  maxWindows?: number;
}): BackfillPlan {
  if (!isBackfillSource(input.source)) {
    throw new BackfillPlanError(
      `source must be one of ${Object.keys(BACKFILL_SOURCES).join(', ')}; received ${JSON.stringify(input.source)}`,
    );
  }
  const source = input.source;
  const entry: RetentionPolicyEntry = BACKFILL_SOURCES[source];

  let from: string;
  let to: string;
  let today: string;
  try {
    from = requireIsoDate(input.from);
    to = requireIsoDate(input.to);
    today = requireIsoDate(input.today);
  } catch (error) {
    throw new BackfillPlanError(`backfill bounds must be ISO dates: ${(error as Error).message}`);
  }

  if (from > to) {
    throw new BackfillPlanError(`from (${from}) is after to (${to})`);
  }

  const cap = input.maxWindows ?? MAX_BACKFILL_WINDOWS;
  if (!Number.isInteger(cap) || cap < 1 || cap > MAX_BACKFILL_WINDOWS) {
    throw new BackfillPlanError(
      `maxWindows must be an integer from 1 to ${MAX_BACKFILL_WINDOWS}; received ${input.maxWindows}`,
    );
  }
  const count = dayIndex(to) - dayIndex(from) + 1;
  if (count > cap) {
    throw new BackfillPlanError(
      `range ${from}..${to} is ${count} windows, above the limit of ${cap}. Split it into smaller runs.`,
    );
  }

  const newestClosed = isoFromIndex(dayIndex(today) - entry.hotRetentionDays - 1);
  if (to > newestClosed) {
    throw new BackfillPlanError(
      `to (${to}) has not left hot retention on ${today}; the newest closed window is ${newestClosed}`,
    );
  }

  const windows: BackfillWindow[] = [];
  for (let index = dayIndex(from); index <= dayIndex(to); index += 1) {
    const date = isoFromIndex(index);
    const [item] = planConveyorRun({ policy: [entry], today, windowDate: date }).items;
    if (!item) {
      throw new BackfillPlanError(`the conveyor planned no item for ${source} on ${date}`);
    }
    const dataKey = dataObjectKey(item.target);
    windows.push({
      date,
      data_key: dataKey,
      manifest_key: manifestObjectKey(item.target, computeManifestId(dataKey)),
      item,
    });
  }

  return {
    source,
    relation: entry.relation,
    from,
    to,
    run_date: today,
    prune_hold: entry.pruneHold === true,
    ledger_key: backfillLedgerKey(source, from, to),
    heartbeat_key: `manifests/_backfill/${source}/heartbeat.json`,
    windows,
  };
}

export type BackfillWindowStatus = ConveyorItemResult['status'] | 'not_attempted';

export interface BackfillLedgerWindow {
  date: string;
  status: BackfillWindowStatus;
  data_key: string;
  manifest_key: string;
  source_row_count: number | null;
  exported_row_count: number | null;
  byte_size: number | null;
  failures: string[];
}

export interface BackfillLedger {
  event: typeof BACKFILL_EVENT;
  source: BackfillSource;
  relation: string;
  from: string;
  to: string;
  run_date: string;
  prune_hold: boolean;
  started_at: string;
  updated_at: string;
  /** Every window is `archived` or `skipped_already_verified`. */
  complete: boolean;
  ok: boolean;
  /** The window that stopped the run, when one did. */
  failed_window: string | null;
  windows: BackfillLedgerWindow[];
}

export interface BackfillRunResult extends BackfillLedger {
  archived: number;
  skipped: number;
  failed: number;
  not_attempted: number;
  /** Set when the ledger could not be written; the run then stops as failed. */
  ledger_error?: string;
}

export interface BackfillRunOptions {
  plan: BackfillPlan;
  connection: DuckConnection;
  store: ObjectStore;
  /** Relation expression inside DuckDB for a window; see `ConveyorRunOptions`. */
  relationExpr: (item: ConveyorPlanItem) => string;
  exporterRepoSha: string;
  workDir?: string;
  sampleSize?: number;
  now?: () => Date;
  /**
   * Where log events go. Every event reaches it already redacted: failures and
   * ledger errors carry driver, database and object-store text, which can
   * include a connection string or a key.
   */
  log?: (event: Record<string, unknown>) => void;
}

function isComplete(ledger: BackfillLedger): boolean {
  return ledger.windows.every(
    (window) => window.status === 'archived' || window.status === 'skipped_already_verified',
  );
}

/**
 * The ledger's only serialization point, and its at-rest redaction boundary:
 * window failures carry driver, database and object-store text, which can hold
 * a connection string or a key. If redaction throws, this throws, and the run
 * stops as `ledger_failed` rather than persisting raw text.
 */
function ledgerBody(ledger: BackfillLedger): Buffer {
  return Buffer.from(`${JSON.stringify(redactForPersistence(ledger), null, 2)}\n`, 'utf8');
}

/**
 * Run a planned backfill, one window at a time, oldest first, through
 * `runConveyor`. The ledger is rewritten after every window, so an interrupted
 * run leaves an accurate record of how far it got.
 */
export async function runBackfill(options: BackfillRunOptions): Promise<BackfillRunResult> {
  const now = options.now ?? (() => new Date());
  const sink = options.log ?? ((event) => process.stdout.write(`${JSON.stringify(event)}\n`));
  // The redaction boundary. Nothing below calls `sink` directly, and the
  // conveyor is handed this wrapper too, so its per-window error lines pass
  // through the same boundary.
  const log = (event: Record<string, unknown>): void => sink(redactLogEvent(event));
  const { plan } = options;

  const ledger: BackfillLedger = {
    event: BACKFILL_EVENT,
    source: plan.source,
    relation: plan.relation,
    from: plan.from,
    to: plan.to,
    run_date: plan.run_date,
    prune_hold: plan.prune_hold,
    started_at: now().toISOString(),
    updated_at: now().toISOString(),
    complete: false,
    ok: true,
    failed_window: null,
    windows: plan.windows.map((window) => ({
      date: window.date,
      status: 'not_attempted',
      data_key: window.data_key,
      manifest_key: window.manifest_key,
      source_row_count: null,
      exported_row_count: null,
      byte_size: null,
      failures: [],
    })),
  };
  let ledgerError: string | undefined;

  for (const [index, window] of plan.windows.entries()) {
    const run = await runConveyor({
      plan: { run_date: plan.run_date, items: [window.item] },
      connection: options.connection,
      store: options.store,
      relationExpr: options.relationExpr,
      exporterRepoSha: options.exporterRepoSha,
      ...(options.workDir !== undefined ? { workDir: options.workDir } : {}),
      ...(options.sampleSize !== undefined ? { sampleSize: options.sampleSize } : {}),
      now,
      log,
      heartbeatKey: plan.heartbeat_key,
    });
    const [item] = run.items;
    const prior = ledger.windows[index];
    if (!item || !prior) {
      throw new Error(`the conveyor returned no result for backfill window ${window.date}`);
    }
    ledger.windows[index] = {
      ...prior,
      status: item.status,
      source_row_count: item.source_row_count,
      exported_row_count: item.exported_row_count,
      byte_size: item.byte_size,
      failures: item.failures,
    };
    if (item.status === 'failed') {
      ledger.ok = false;
      ledger.failed_window = window.date;
    }
    ledger.updated_at = now().toISOString();
    ledger.complete = isComplete(ledger);

    try {
      await options.store.put(plan.ledger_key, ledgerBody(ledger), 'application/json');
    } catch (error) {
      // A run that cannot record its progress stops: continuing would leave an
      // operator reading a ledger that is behind what the bucket holds.
      ledgerError = error instanceof Error ? error.message : String(error);
      ledger.ok = false;
      log({ event: BACKFILL_EVENT, phase: 'ledger_failed', error: ledgerError });
      break;
    }

    if (item.status === 'failed') {
      log({
        event: BACKFILL_EVENT,
        phase: 'stopped',
        window: window.date,
        failures: item.failures,
        not_attempted: plan.windows.length - index - 1,
      });
      break;
    }
  }

  const count = (status: BackfillWindowStatus) =>
    ledger.windows.filter((window) => window.status === status).length;
  ledger.complete = isComplete(ledger);

  const result: BackfillRunResult = {
    ...ledger,
    ok: ledger.ok && ledger.complete,
    archived: count('archived'),
    skipped: count('skipped_already_verified'),
    failed: count('failed'),
    not_attempted: count('not_attempted'),
  };
  if (ledgerError !== undefined) {
    result.ledger_error = ledgerError;
  }
  log(result as unknown as Record<string, unknown>);
  return result;
}
