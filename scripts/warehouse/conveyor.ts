import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { redactLogEvent } from './config.js';
import { type DuckConnection } from './duckdb.js';
import {
  type ArchiveTarget,
  type CanonicalDomain,
  dataObjectKey,
  manifestObjectKey,
  requireIsoDate,
} from './object-layout.js';
import {
  type ArchiveManifestV1,
  buildManifest,
  computeManifestId,
  parseManifest,
  serializeManifest,
} from './manifest.js';
import { type ObjectStore } from './object-store.js';
import {
  type SourceSpec,
  exportWindowToParquet,
  buildSelectSql,
} from './export-partition.js';
import { applyVerification, decidePrune, verifyArchive } from './verify-archive.js';

/**
 * The scheduled archive conveyor.
 *
 * One closed window per source per day, moving at the same rate the hot
 * database fills. Three properties are load-bearing and are what the tests
 * target:
 *
 *   **Idempotent.** A target's object key is a pure function of the target, and
 *   a run that finds an already-verified manifest for that key does nothing.
 *   Re-running yesterday is free, which is what makes an automatic retry safe.
 *
 *   **No corrupt intermediate state on retry.** The data object is written as a
 *   single whole-object PUT, and the *manifest is written last, only after
 *   verification has passed against the uploaded object*. A run killed between
 *   upload and verification leaves an object with no manifest -- invisible to
 *   the prune gate, and overwritten wholesale by the next attempt. There is no
 *   ordering here that can leave a manifest vouching for bytes that were never
 *   checked.
 *
 *   **Observable.** Every run writes a heartbeat object and emits structured
 *   events. Staleness is then a question anyone can ask of the bucket, without
 *   a database credential and without access to the runner.
 */

export const CONVEYOR_HEARTBEAT_KEY = 'manifests/_conveyor/heartbeat.json';
export const CONVEYOR_EVENT = 'warehouse.conveyor';

export interface RetentionPolicyEntry {
  /** `schema.relation` in the operational database. */
  relation: string;
  /**
   * Canonical warehouse domain the export is filed under. Required unless the
   * entry files under `raw/` (see {@link target}), where the namespace is the
   * raw provider token instead and a domain would name nothing.
   */
  domain?: CanonicalDomain | null;
  /** Timestamp column the daily window is taken on. */
  windowColumn: string;
  /** Days of history that stay hot in Postgres. */
  hotRetentionDays: number;
  /** Column carrying the sport, when the source partitions by sport. */
  sportColumn?: string | null;
  /** Sports to emit one object each for. A single-element list is fine. */
  sports: string[];
  /** Deterministic export ordering. */
  orderBy: string[];
  /**
   * Season label for the layout: a literal `YYYY` / `YYYY-YY`, or
   * {@link WINDOW_YEAR_SEASON} to file each window under its own year.
   *
   * A string rather than a function so a `--policy` JSON file can say it too.
   */
  season: string;
  /**
   * File the export under `raw/{provider}/` instead of `canonical/{domain}/`.
   *
   * For a source whose shape is not the canonical domain's: two tables with
   * different columns under one prefix would put two tables' objects at one
   * key whenever their dates met. A separate namespace makes that collision
   * impossible by construction rather than merely absent from today's dates.
   */
  target?: { kind: 'raw'; provider: string } | null;
  /**
   * A standing PM prune hold. A held source is archived and verified like any
   * other, and is **never** reported prune-eligible, whatever its manifest
   * says. It is data in the policy so that a prune implementation that forgets
   * the hold fails a test rather than silently deleting the table.
   */
  pruneHold?: boolean;
}

/**
 * Season mode that derives the layout season from the window: `2026-06-24`
 * files under `2026`. A source that is not sport-partitioned has no league
 * season to name, and the literal `'all'` this replaced is not a season the
 * layout accepts -- `dataObjectKey` refused it for every window.
 */
export const WINDOW_YEAR_SEASON = 'window-year';

/** The layout season for one window of a policy entry. */
export function resolveSeason(entry: Pick<RetentionPolicyEntry, 'season'>, date: string): string {
  return entry.season === WINDOW_YEAR_SEASON ? requireIsoDate(date).slice(0, 4) : entry.season;
}

/**
 * The policy the scheduled conveyor runs when no `--policy` file is given.
 *
 * Retention days come from `docs/02_architecture/HISTORICAL_MARKET_DATA_WAREHOUSE.md` §4.
 *
 * Note what these entries deliberately do **not** do: partition by sport. A
 * sport-partitioned policy has to enumerate its sports up front, and any row
 * whose `sport_key` is not on that list is then archived by nothing at all --
 * a silent data-loss hole that widens exactly when a new league is added. One
 * object per day per source is lossless, and the sport stays a column that
 * DuckDB filters on. A per-sport policy becomes safe once a source can be
 * proven to have no sport outside its declared list, and not before.
 */
export const DEFAULT_RETENTION_POLICY: RetentionPolicyEntry[] = [
  {
    relation: 'public.provider_offer_history',
    domain: 'markets',
    windowColumn: 'snapshot_at',
    hotRetentionDays: 45,
    sportColumn: null,
    sports: ['all'],
    orderBy: ['snapshot_at', 'id'],
    season: WINDOW_YEAR_SEASON,
  },
  // The three below are archived table-as-is under `raw/<table>/`: none of them
  // is a canonical domain's shape, and a separate namespace per table makes a
  // key collision between them impossible by construction. Hot retention is
  // HISTORICAL_MARKET_DATA_WAREHOUSE.md §4. Each window uses an index that
  // already exists on its column (EXPLAIN, 2026-09-26), so none needs DDL.
  {
    relation: 'public.raw_payloads',
    windowColumn: 'snapshot_at',
    hotRetentionDays: 21,
    sportColumn: null,
    sports: ['all'],
    orderBy: ['snapshot_at', 'id'],
    season: WINDOW_YEAR_SEASON,
    target: { kind: 'raw', provider: 'raw_payloads' },
  },
  {
    // §4 names no figure for odds snapshots; they take offer history's 45 days,
    // the conservative choice for line history an operator might still read.
    relation: 'public.odds_snapshots',
    windowColumn: 'snapshot_at',
    hotRetentionDays: 45,
    sportColumn: null,
    sports: ['all'],
    orderBy: ['snapshot_at', 'id'],
    season: WINDOW_YEAR_SEASON,
    target: { kind: 'raw', provider: 'odds_snapshots' },
  },
  {
    // Run telemetry. Windowed on `started_at`, the column every run has from
    // its first write; `finished_at` is null while a run is open.
    relation: 'public.system_runs',
    windowColumn: 'started_at',
    hotRetentionDays: 90,
    sportColumn: null,
    sports: ['all'],
    orderBy: ['started_at', 'id'],
    season: WINDOW_YEAR_SEASON,
    target: { kind: 'raw', provider: 'system_runs' },
  },
];

export interface ConveyorPlanItem {
  target: ArchiveTarget;
  source: SourceSpec;
  relation: string;
  date: string;
  /** Carried from the policy entry; see {@link RetentionPolicyEntry.pruneHold}. */
  pruneHold: boolean;
}

export interface ConveyorPlan {
  run_date: string;
  items: ConveyorPlanItem[];
}

function isoDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(dateIso: string, days: number): string {
  const d = new Date(`${requireIsoDate(dateIso)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDateOnly(d);
}

/**
 * Plan the windows a run should process.
 *
 * The window chosen is the single day that has just fallen out of hot
 * retention: `today - hotRetentionDays - 1`. One day per source per run, so the
 * conveyor's rate is fixed and a backlog is visible as a backlog rather than
 * absorbed into one enormous export.
 *
 * Pure. The tests drive it with a fixed `today`, because a scheduler whose
 * behaviour you can only observe by waiting a day is a scheduler nobody checks.
 */
function requireDomain(entry: RetentionPolicyEntry): CanonicalDomain {
  if (!entry.domain) {
    throw new Error(`${entry.relation} files under canonical/ but names no domain`);
  }
  return entry.domain;
}

export function planConveyorRun(input: {
  policy: RetentionPolicyEntry[];
  today: string;
  /** Explicit override for a backfill of one specific day. */
  windowDate?: string;
}): ConveyorPlan {
  const today = requireIsoDate(input.today);
  const items: ConveyorPlanItem[] = [];

  for (const entry of input.policy) {
    if (!Number.isInteger(entry.hotRetentionDays) || entry.hotRetentionDays < 0) {
      throw new Error(
        `hotRetentionDays must be a non-negative integer for ${entry.relation}; received ${entry.hotRetentionDays}`,
      );
    }
    const date = input.windowDate
      ? requireIsoDate(input.windowDate)
      : addDays(today, -(entry.hotRetentionDays + 1));

    const season = resolveSeason(entry, date);
    for (const sport of entry.sports) {
      const target: ArchiveTarget =
        entry.target?.kind === 'raw'
          ? { kind: 'raw', provider: entry.target.provider, sport, season, date }
          : { kind: 'canonical', domain: requireDomain(entry), sport, season, date };
      items.push({
        relation: entry.relation,
        date,
        pruneHold: entry.pruneHold === true,
        target,
        source: {
          relation: entry.relation,
          window: {
            column: entry.windowColumn,
            start: `${date}T00:00:00.000Z`,
            end: `${addDays(date, 1)}T00:00:00.000Z`,
          },
          filterColumn: entry.sportColumn ?? null,
          filterValue: entry.sportColumn ? sport : null,
          orderBy: entry.orderBy,
        },
      });
    }
  }

  return { run_date: today, items };
}

export interface RetentionDecision {
  eligible: boolean;
  /** Every refusal, named. Empty only when `eligible`. */
  reasons: string[];
  window_date: string;
  data_key: string | null;
  manifest_key: string | null;
  policy: string;
}

const DAY_MS = 86_400_000;

/**
 * The retention boundary a future prune must satisfy. **It deletes nothing.**
 * There is no prune path in this repository; this is the decision such a path
 * would have to obey, written down as a pure function so it can be tested now.
 *
 * A window is eligible only when all of these hold at evaluation time:
 *
 *   - the source carries no prune hold;
 *   - the window is older than `hotRetentionDays` on `today`;
 *   - a manifest for **that exact window** exists -- the key, the relation and
 *     the half-open bounds all agree with what the policy plans for the day;
 *   - `decidePrune(manifest).eligible` is true now, not when the upload ran.
 *
 * Every failed condition is recorded, not only the first, so a refusal says
 * everything an operator would have to fix.
 */
export function decideRetentionEligibility(input: {
  entry: RetentionPolicyEntry;
  windowDate: string;
  /** The day the decision is taken: when a prune would run. */
  today: string;
  /** The object stored at the window's manifest key, or `null` when absent. */
  manifest: unknown;
  /** Required only when the entry emits more than one sport per window. */
  sport?: string;
}): RetentionDecision {
  const reasons: string[] = [];
  const windowDate = requireIsoDate(input.windowDate);
  const today = requireIsoDate(input.today);
  let dataKey: string | null = null;
  let manifestKey: string | null = null;

  if (input.entry.pruneHold === true) {
    reasons.push('prune_hold');
  }

  const ageDays = (Date.parse(`${today}T00:00:00.000Z`) - Date.parse(`${windowDate}T00:00:00.000Z`)) / DAY_MS;
  if (!(ageDays > input.entry.hotRetentionDays)) {
    reasons.push('within_hot_retention');
  }

  const sport = input.sport ?? (input.entry.sports.length === 1 ? input.entry.sports[0] : undefined);
  const item =
    sport === undefined
      ? undefined
      : planConveyorRun({ policy: [input.entry], today, windowDate }).items.find(
          (candidate) => 'sport' in candidate.target && candidate.target.sport === sport,
        );

  if (!item) {
    reasons.push(sport === undefined ? 'sport_required' : 'sport_not_in_policy');
  } else {
    try {
      dataKey = dataObjectKey(item.target);
      manifestKey = manifestObjectKey(item.target, computeManifestId(dataKey));
    } catch (error) {
      reasons.push(`invalid_target:${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (input.manifest === null || input.manifest === undefined) {
    reasons.push('no_manifest');
  } else {
    const verdict = decidePrune(input.manifest);
    reasons.push(...verdict.reasons.map((reason) => `manifest_not_verified:${reason}`));
    // Structurally valid or not, the manifest must be for this window. A
    // verified manifest for a different day, table or bound vouches for
    // nothing here.
    const m = input.manifest as Partial<ArchiveManifestV1>;
    const window = m.source?.window;
    const exact =
      item !== undefined &&
      dataKey !== null &&
      m.object?.data_key === dataKey &&
      m.object?.manifest_key === manifestKey &&
      m.source?.relation === input.entry.relation &&
      window?.column === item.source.window.column &&
      window?.start === item.source.window.start &&
      window?.end === item.source.window.end;
    if (!exact) {
      reasons.push('manifest_window_mismatch');
    }
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    window_date: windowDate,
    data_key: dataKey,
    manifest_key: manifestKey,
    policy:
      'A window is prune-eligible only when its source carries no prune hold, it is older than the ' +
      'hot-retention window, and a manifest for that exact window passes decidePrune at the time of ' +
      'evaluation. This function decides; nothing in this repository deletes.',
  };
}

export type ConveyorItemStatus = 'skipped_already_verified' | 'archived' | 'failed';

export interface ConveyorItemResult {
  /** `null` only when the item's key could not be constructed at all. */
  data_key: string | null;
  relation: string;
  date: string;
  status: ConveyorItemStatus;
  source_row_count: number | null;
  exported_row_count: number | null;
  byte_size: number | null;
  /** Verified, and not under a prune hold. Never true for a held source. */
  prune_eligible: boolean;
  prune_hold: boolean;
  failures: string[];
}

export interface ConveyorRunResult {
  event: typeof CONVEYOR_EVENT;
  run_date: string;
  started_at: string;
  finished_at: string;
  items: ConveyorItemResult[];
  archived: number;
  skipped: number;
  failed: number;
  ok: boolean;
  /** Present whenever `failed > 0`; the conveyor's alert payload. */
  alert: { severity: 'error'; message: string } | null;
  /** Set when the heartbeat could not be written; the run's result still stands. */
  heartbeat_error?: string;
}

export interface ConveyorRunOptions {
  plan: ConveyorPlan;
  connection: DuckConnection;
  store: ObjectStore;
  /**
   * Relation expression inside DuckDB for a planned item. Supplied by the
   * caller so the conveyor is testable against a local fixture table without a
   * Postgres attachment.
   */
  relationExpr: (item: ConveyorPlanItem) => string;
  exporterRepoSha: string;
  workDir?: string;
  sampleSize?: number;
  now?: () => Date;
  log?: (event: Record<string, unknown>) => void;
  /**
   * Where this run's heartbeat goes. Defaults to the scheduled conveyor's own
   * key. A backfill passes its own, so a backfill running does not make a dead
   * daily conveyor read as alive.
   */
  heartbeatKey?: string;
}

async function readExistingManifest(
  store: ObjectStore,
  manifestKey: string,
): Promise<ArchiveManifestV1 | null> {
  const body = await store.get(manifestKey);
  if (body === null) {
    return null;
  }
  try {
    return parseManifest(body.toString('utf8'));
  } catch {
    // An unparseable manifest is treated as absent, never as a pass. The run
    // re-exports and overwrites it.
    return null;
  }
}

export async function runConveyor(options: ConveyorRunOptions): Promise<ConveyorRunResult> {
  const now = options.now ?? (() => new Date());
  // Fail closed without a caller-supplied sink too: the default writes only redacted events.
  const log = options.log ?? ((event) => process.stdout.write(`${JSON.stringify(redactLogEvent(event))}\n`));
  const startedAt = now().toISOString();
  const results: ConveyorItemResult[] = [];

  let ownedWorkDir: string | null = null;
  let workDir = options.workDir;
  if (!workDir) {
    ownedWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-talk-warehouse-conveyor-'));
    workDir = ownedWorkDir;
  }

  try {
    for (const item of options.plan.items) {
      const result: ConveyorItemResult = {
        data_key: null,
        relation: item.relation,
        date: item.date,
        status: 'failed',
        source_row_count: null,
        exported_row_count: null,
        byte_size: null,
        prune_eligible: false,
        prune_hold: item.pruneHold,
        failures: [],
      };

      // Assigned inside the `try`: a target whose key cannot be built (a bad
      // season, a bad slug) is a failed window, recorded like any other. Were
      // it computed above the `try`, the throw would escape the run, and the
      // run would end with no failed-item result and no heartbeat.
      let dataKey: string | null = null;
      try {
        dataKey = dataObjectKey(item.target);
        result.data_key = dataKey;
        const relationExpr = options.relationExpr(item);

        // --- idempotency ------------------------------------------------
        // The manifest key is a pure function of the target, so a previous run
        // for this window wrote it here. If that run already proved the window,
        // this one does nothing -- which is what makes an automatic retry free.
        const manifestKey = manifestObjectKey(item.target, computeManifestId(dataKey));
        const existing = await readExistingManifest(options.store, manifestKey);
        if (existing && decidePrune(existing).eligible) {
          result.status = 'skipped_already_verified';
          result.source_row_count = existing.source.row_count;
          result.exported_row_count = existing.export.exported_row_count;
          result.byte_size = existing.object.byte_size;
          result.prune_eligible = !item.pruneHold;
          results.push(result);
          log({ event: CONVEYOR_EVENT, phase: 'skip', data_key: dataKey, reason: 'already_verified' });
          continue;
        }

        // --- export -----------------------------------------------------
        const localPath = path.join(workDir, `${dataKey.replaceAll('/', '__')}`);
        const exported = await exportWindowToParquet({
          connection: options.connection,
          source: item.source,
          relationExpr,
          destinationPath: localPath,
        });
        result.source_row_count = exported.sourceRowCount;
        result.exported_row_count = exported.exportedRowCount;
        result.byte_size = exported.byteSize;

        const manifest = buildManifest({
          target: item.target,
          bucket: options.store.bucket,
          sourceRelation: item.relation,
          sourceRowCount: exported.sourceRowCount,
          window: item.source.window,
          exportedRowCount: exported.exportedRowCount,
          byteSize: exported.byteSize,
          checksumSha256: exported.checksumSha256,
          columns: exported.columns,
          rowGroupSize: exported.rowGroupSize,
          exporterRepoSha: options.exporterRepoSha,
          exportedAt: now().toISOString(),
        });

        // --- upload the data object (whole-object PUT) --------------------
        await options.store.put(dataKey, fs.readFileSync(localPath), 'application/vnd.apache.parquet');

        // --- verify against the store, not the local file -----------------
        const report = await verifyArchive({
          connection: options.connection,
          store: options.store,
          manifest,
          sampleSize: options.sampleSize,
          now,
          sourceSample: async (limit) => {
            if (limit <= 0) return [];
            return options.connection.all(
              `${buildSelectSql(item.source, relationExpr)} LIMIT ${Math.trunc(limit)}`,
            );
          },
        });

        const verified = applyVerification(manifest, report);
        const decision = decidePrune(verified);
        result.prune_eligible = decision.eligible && !item.pruneHold;
        result.failures = report.failures;

        if (!report.passed) {
          // Record the failure where an operator will find it, under a key the
          // prune gate does not read. A failed archive must not be able to
          // become prune-eligible by being written down.
          await options.store.put(
            `${verified.object.manifest_key.replace(/\.json$/, '')}.failed.json`,
            Buffer.from(serializeManifest(verified), 'utf8'),
            'application/json',
          );
          result.status = 'failed';
          log({
            event: CONVEYOR_EVENT,
            phase: 'verify_failed',
            data_key: dataKey,
            failures: report.failures,
          });
          results.push(result);
          continue;
        }

        // --- manifest last -------------------------------------------------
        await options.store.put(
          verified.object.manifest_key,
          Buffer.from(serializeManifest(verified), 'utf8'),
          'application/json',
        );
        result.status = 'archived';
        log({
          event: CONVEYOR_EVENT,
          phase: 'archived',
          data_key: dataKey,
          rows: exported.exportedRowCount,
          bytes: exported.byteSize,
        });
      } catch (error) {
        result.status = 'failed';
        result.failures = [error instanceof Error ? error.message : String(error)];
        log({
          event: CONVEYOR_EVENT,
          phase: 'error',
          data_key: dataKey,
          error: result.failures[0],
        });
      }

      results.push(result);
    }
  } finally {
    if (ownedWorkDir) {
      fs.rmSync(ownedWorkDir, { recursive: true, force: true });
    }
  }

  const archived = results.filter((r) => r.status === 'archived').length;
  const skipped = results.filter((r) => r.status === 'skipped_already_verified').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const finishedAt = now().toISOString();

  const run: ConveyorRunResult = {
    event: CONVEYOR_EVENT,
    run_date: options.plan.run_date,
    started_at: startedAt,
    finished_at: finishedAt,
    items: results,
    archived,
    skipped,
    failed,
    ok: failed === 0,
    alert:
      failed > 0
        ? {
            severity: 'error',
            message: `warehouse conveyor: ${failed} of ${results.length} windows failed to archive on ${options.plan.run_date}`,
          }
        : null,
  };

  // The heartbeat is written whether or not the run succeeded: a run that fails
  // every window is still a run that happened, and conflating "failing" with
  // "not running" is how a dead conveyor goes unnoticed.
  //
  // It is also written in a way that cannot take the run down with it. The
  // heartbeat is observability; a run that archived and verified real windows
  // must not lose that result because the object reporting on it could not be
  // written. A failed heartbeat degrades to "stale", which is the correct and
  // conservative reading, and says so on the run.
  try {
    await writeHeartbeat(options.store, run, options.heartbeatKey);
  } catch (error) {
    run.heartbeat_error = error instanceof Error ? error.message : String(error);
    log({ event: CONVEYOR_EVENT, phase: 'heartbeat_failed', error: run.heartbeat_error });
  }
  log(run as unknown as Record<string, unknown>);
  return run;
}

export interface ConveyorHeartbeat {
  event: typeof CONVEYOR_EVENT;
  last_run_at: string;
  run_date: string;
  ok: boolean;
  archived: number;
  skipped: number;
  failed: number;
}

export async function writeHeartbeat(
  store: ObjectStore,
  run: ConveyorRunResult,
  key: string = CONVEYOR_HEARTBEAT_KEY,
): Promise<ConveyorHeartbeat> {
  const heartbeat: ConveyorHeartbeat = {
    event: CONVEYOR_EVENT,
    last_run_at: run.finished_at,
    run_date: run.run_date,
    ok: run.ok,
    archived: run.archived,
    skipped: run.skipped,
    failed: run.failed,
  };
  await store.put(
    key,
    Buffer.from(`${JSON.stringify(heartbeat, null, 2)}\n`, 'utf8'),
    'application/json',
  );
  return heartbeat;
}

export interface StalenessVerdict {
  stale: boolean;
  age_hours: number | null;
  reason: string;
}

/**
 * Staleness is read from the bucket, so the question "is the conveyor alive?"
 * can be answered by anyone who can read the archive -- no runner access and no
 * database credential. A missing heartbeat is stale, not unknown.
 */
export async function readStaleness(
  store: ObjectStore,
  options: { now?: Date; maxAgeHours?: number } = {},
): Promise<StalenessVerdict> {
  const now = options.now ?? new Date();
  const maxAgeHours = options.maxAgeHours ?? 36;
  const body = await store.get(CONVEYOR_HEARTBEAT_KEY);
  if (body === null) {
    return { stale: true, age_hours: null, reason: 'no conveyor heartbeat object exists' };
  }
  let heartbeat: ConveyorHeartbeat;
  try {
    heartbeat = JSON.parse(body.toString('utf8')) as ConveyorHeartbeat;
  } catch {
    return { stale: true, age_hours: null, reason: 'conveyor heartbeat object is unparseable' };
  }
  const lastRun = Date.parse(heartbeat.last_run_at ?? '');
  if (Number.isNaN(lastRun)) {
    return { stale: true, age_hours: null, reason: 'conveyor heartbeat has no valid last_run_at' };
  }
  const ageHours = (now.getTime() - lastRun) / 3_600_000;
  return {
    stale: ageHours > maxAgeHours,
    age_hours: Number(ageHours.toFixed(2)),
    reason:
      ageHours > maxAgeHours
        ? `last conveyor run was ${ageHours.toFixed(1)}h ago, above the ${maxAgeHours}h threshold`
        : `last conveyor run was ${ageHours.toFixed(1)}h ago`,
  };
}

