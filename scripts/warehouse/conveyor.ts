import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
  /** Canonical warehouse domain the export is filed under. */
  domain: CanonicalDomain;
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
  /** Season label for the layout, or a function of the window date. */
  season: string;
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
    season: 'all',
  },
];

export interface ConveyorPlanItem {
  target: ArchiveTarget;
  source: SourceSpec;
  relation: string;
  date: string;
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

    for (const sport of entry.sports) {
      items.push({
        relation: entry.relation,
        date,
        target: {
          kind: 'canonical',
          domain: entry.domain,
          sport,
          season: entry.season,
          date,
        },
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

export type ConveyorItemStatus = 'skipped_already_verified' | 'archived' | 'failed';

export interface ConveyorItemResult {
  data_key: string;
  relation: string;
  date: string;
  status: ConveyorItemStatus;
  source_row_count: number | null;
  exported_row_count: number | null;
  byte_size: number | null;
  prune_eligible: boolean;
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
  const log = options.log ?? ((event) => process.stdout.write(`${JSON.stringify(event)}\n`));
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
      const dataKey = dataObjectKey(item.target);
      const relationExpr = options.relationExpr(item);
      const result: ConveyorItemResult = {
        data_key: dataKey,
        relation: item.relation,
        date: item.date,
        status: 'failed',
        source_row_count: null,
        exported_row_count: null,
        byte_size: null,
        prune_eligible: false,
        failures: [],
      };

      try {
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
          result.prune_eligible = true;
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
        result.prune_eligible = decision.eligible;
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
    await writeHeartbeat(options.store, run);
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
    CONVEYOR_HEARTBEAT_KEY,
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

