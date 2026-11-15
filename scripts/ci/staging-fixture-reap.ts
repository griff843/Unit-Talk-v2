/**
 * WORK-2026103009 — reap aged CI picks from the staging project.
 *
 * The staging project is CI-only and nothing removes what CI writes to it. By
 * 2026-10-30 `picks` held 184.5k rows, CI added 1k–4.5k a day, and the
 * service-role status scans that page `picks` by offset were running close to
 * the 8 s statement timeout. Staging proofs then failed with 57014 and 502, and
 * each failure cost a full `ci.yml` rerun on the shared staging slot.
 *
 * Approved scope (Griff, 2026-10-30, "age-based, unsettled only"): picks older
 * than the cutoff that have no `settlement_records` row and no `pick_reviews`
 * row, their ON DELETE CASCADE children, and submissions left with no picks
 * that are older than the same cutoff. Staging only.
 *
 * What it never does:
 *   - run against anything but the approved staging project (refused before a
 *     client exists);
 *   - delete in a dry run, which is the default;
 *   - delete a pick younger than MIN_REAP_AGE_MS, or past `--max-picks`;
 *   - delete a pick that has a settlement or review row. `settlement_records` is
 *     append-only and `pick_reviews` has no cascade, so those picks are left
 *     alone rather than forced, and both are re-checked per batch;
 *   - delete a pick whose `status` is `settled`, even with no settlement row
 *     (Griff, 2026-11-01, Option B: WORK-2026110101). Every DELETE re-asserts it;
 *   - page by offset. It pages by primary key, so its own reads do not add the
 *     offset scans it exists to relieve;
 *   - act on a partial read. Every read is checked against an exact count taken
 *     before and after it, and a shortfall or change aborts the run.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createPrivilegedClient,
  type BoundarySupabaseClient,
} from '@unit-talk/db/privileged-client-boundary';
import {
  EXPECTED_STAGING_SUPABASE_PROJECT_REF,
  extractProjectRefFromUrl,
  isApprovedStagingTarget,
} from './isolated-proof-attestation.js';
import { collectEffectiveEnv } from './required-db-smoke.js';

/** No pick younger than this is ever selected, whatever cutoff is passed. */
export const MIN_REAP_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Rows asked for per read. PostgREST may return fewer (its max-rows cap), so
 * completeness is checked against an exact count, never inferred from page size.
 */
const READ_PAGE_SIZE = 1000;
/** IDs per `in.(...)` filter and per DELETE. Keeps the request URL well under proxy limits. */
export const BATCH_SIZE = 150;

export interface ReapCandidate {
  id: string;
  created_at: string | null;
  status: string | null;
  source: string | null;
}

export type ReapSkipReason =
  | 'unparseable_created_at'
  | 'not_older_than_cutoff'
  | 'settled'
  | 'reviewed'
  | 'status_settled';

/** A pick in this status is kept even when it has no `settlement_records` row. */
export const KEPT_PICK_STATUS = 'settled';

export interface ReapSelection {
  selected: ReapCandidate[];
  skipped: Record<ReapSkipReason, number>;
}

/**
 * Validate the cutoff against the minimum age. Throws rather than clamping: a
 * cutoff that is too young is an operator error, not something to correct
 * silently.
 */
export function assertReapCutoff(cutoff: Date, now: Date): void {
  if (!Number.isFinite(cutoff.getTime())) {
    throw new Error('reap cutoff is not a valid date');
  }
  if (cutoff.getTime() > now.getTime() - MIN_REAP_AGE_MS) {
    throw new Error(
      `reap cutoff ${cutoff.toISOString()} is younger than the ${MIN_REAP_AGE_MS}ms minimum ` +
        `(latest allowed ${new Date(now.getTime() - MIN_REAP_AGE_MS).toISOString()})`,
    );
  }
}

/**
 * The pure decision. The query narrows the read; this re-applies every rule, so
 * a query that drifted could only select less, never more.
 */
export function selectReapablePicks(
  rows: ReapCandidate[],
  cutoff: Date,
  settledPickIds: ReadonlySet<string>,
  reviewedPickIds: ReadonlySet<string>,
): ReapSelection {
  const skipped: Record<ReapSkipReason, number> = {
    unparseable_created_at: 0,
    not_older_than_cutoff: 0,
    settled: 0,
    reviewed: 0,
    status_settled: 0,
  };
  const selected: ReapCandidate[] = [];
  for (const row of rows) {
    const createdAt = row.created_at === null ? Number.NaN : Date.parse(row.created_at);
    if (!Number.isFinite(createdAt)) {
      skipped.unparseable_created_at += 1;
      continue;
    }
    if (createdAt >= cutoff.getTime()) {
      skipped.not_older_than_cutoff += 1;
      continue;
    }
    if (settledPickIds.has(row.id)) {
      skipped.settled += 1;
      continue;
    }
    if (reviewedPickIds.has(row.id)) {
      skipped.reviewed += 1;
      continue;
    }
    // Checked last, so this count is exactly what Option B removed from eligibility.
    if (row.status === KEPT_PICK_STATUS) {
      skipped.status_settled += 1;
      continue;
    }
    selected.push(row);
  }
  return { selected, skipped };
}

/** Refuse an execute whose selection is larger than the reviewed cap. */
export function assertWithinCap(selectedCount: number, maxPicks: number): void {
  if (!Number.isInteger(maxPicks) || maxPicks < 0) {
    throw new Error(`--max-picks must be a non-negative integer, got ${maxPicks}`);
  }
  if (selectedCount > maxPicks) {
    throw new Error(
      `reap refused: ${selectedCount} pick(s) selected, more than --max-picks ${maxPicks}. Nothing was deleted.`,
    );
  }
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface ReapReport {
  mode: 'dry-run' | 'execute';
  project_ref: string;
  cutoff: string;
  scanned: number;
  selected: number;
  skipped: Record<ReapSkipReason, number>;
  by_status: Record<string, number>;
  by_source: Record<string, number>;
  orphaned_submissions: number;
  deleted_picks: number;
  deleted_submissions: number;
  raced: number;
  raced_submissions: number;
}

function tally(rows: ReapCandidate[], key: 'status' | 'source'): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const value = row[key] ?? '<null>';
    out[value] = (out[value] ?? 0) + 1;
  }
  return out;
}

/** A filter over one table, read keyset-paged by `id`. */
export interface ReadSpec {
  table: 'picks' | 'submissions' | 'settlement_records' | 'pick_reviews';
  columns: string;
  createdBefore?: string;
  inFilter?: { column: 'pick_id' | 'submission_id'; values: string[] };
}

/**
 * Everything the reap does to the database. `reapStagingFixtures` never touches
 * a client directly, so the tests can run it against a store that enforces the
 * PostgREST response cap and the `picks.submission_id` ON DELETE SET NULL rule.
 */
export interface ReapStore {
  /** Exact number of rows the spec matches, or null when the server gave none. */
  count(spec: ReadSpec): Promise<number | null>;
  /** Up to `limit` matching rows with `id` greater than `afterId`, ascending by `id`. */
  page(spec: ReadSpec, afterId: string | null, limit: number): Promise<Record<string, unknown>[]>;
  deletePicks(ids: string[], cutoffIso: string): Promise<number>;
  deleteSubmissions(ids: string[], cutoffIso: string): Promise<number>;
}

function describe(spec: ReadSpec): string {
  return spec.inFilter ? `${spec.table} by ${spec.inFilter.column}` : spec.table;
}

/**
 * Read every row a spec matches, or throw. A response may hold fewer rows than
 * asked for (PostgREST caps each one at its max-rows setting), so completeness is
 * judged against an exact count taken before the read and again after it, never
 * against page length. The read fails closed when the count is missing, when the
 * two counts differ (the view changed underneath it), when a row repeats, or when
 * the rows read do not equal the count.
 */
export async function readAllVerified(store: ReapStore, spec: ReadSpec): Promise<Record<string, unknown>[]> {
  const label = describe(spec);
  const before = await store.count(spec);
  if (before === null || !Number.isInteger(before) || before < 0) {
    throw new Error(`reap read of ${label} returned no exact count; refusing an unverifiable read`);
  }
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  while (rows.length < before) {
    const page = await store.page(spec, after, READ_PAGE_SIZE);
    if (page.length === 0) break;
    for (const row of page) {
      const id = String(row['id']);
      if (seen.has(id)) throw new Error(`reap read of ${label} returned id ${id} twice; refusing an inconsistent read`);
      seen.add(id);
      rows.push(row);
    }
    after = String(page[page.length - 1]!['id']);
  }
  const afterCount = await store.count(spec);
  if (afterCount !== before) {
    throw new Error(`reap read of ${label} changed during the read (${before} rows before, ${afterCount} after); nothing was trusted`);
  }
  if (rows.length !== before) {
    throw new Error(`reap read of ${label} is incomplete: read ${rows.length} of ${before} rows; nothing was trusted`);
  }
  return rows;
}

async function idsWithRow(
  store: ReapStore,
  table: 'settlement_records' | 'pick_reviews',
  pickIds: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  for (const ids of chunk(pickIds, BATCH_SIZE)) {
    const rows = await readAllVerified(store, {
      table,
      columns: 'id,pick_id',
      inFilter: { column: 'pick_id', values: ids },
    });
    for (const row of rows) found.add(String(row['pick_id']));
  }
  return found;
}

/** Every pick that references one of these submissions, read completely. */
async function linkedPicks(store: ReapStore, submissionIds: string[]): Promise<{ id: string; submission_id: string }[]> {
  const rows = await readAllVerified(store, {
    table: 'picks',
    columns: 'id,submission_id',
    inFilter: { column: 'submission_id', values: submissionIds },
  });
  return rows.map((row) => ({ id: String(row['id']), submission_id: String(row['submission_id']) }));
}

/**
 * The pure orphan rule: a submission is orphaned only when every pick that
 * references it is in `goneOrSelected`. `links` must be the complete set of
 * linking picks; a partial set makes a retained pick invisible, which is why it
 * is only ever produced by `readAllVerified`.
 */
export function classifyOrphanedSubmissions(
  submissionIds: readonly string[],
  links: readonly { id: string; submission_id: string }[],
  goneOrSelected: ReadonlySet<string>,
): string[] {
  const kept = new Set(links.filter((pick) => !goneOrSelected.has(pick.id)).map((pick) => pick.submission_id));
  return submissionIds.filter((id) => !kept.has(id));
}

/**
 * Select every reapable pick read-only, then, in execute mode only, delete in
 * batches. Each batch re-checks settlement and review rows and re-asserts the
 * cutoff in the DELETE filter, so a pick that changed after selection is left
 * alone and counted as raced. Each submission batch is re-read immediately
 * before its DELETE and any submission that still has a linking pick is kept,
 * because deleting it would null `submission_id` on that pick.
 */
export async function reapStagingFixtures(
  store: ReapStore,
  options: { cutoff: Date; now?: Date; execute: boolean; maxPicks?: number | undefined; projectRef: string },
): Promise<ReapReport> {
  const now = options.now ?? new Date();
  assertReapCutoff(options.cutoff, now);
  const cutoffIso = options.cutoff.toISOString();

  const rows = (await readAllVerified(store, {
    table: 'picks',
    columns: 'id,created_at,status,source',
    createdBefore: cutoffIso,
  })) as unknown as ReapCandidate[];
  const allIds = rows.map((row) => row.id);
  const settled = await idsWithRow(store, 'settlement_records', allIds);
  const reviewed = await idsWithRow(store, 'pick_reviews', allIds);
  const { selected, skipped } = selectReapablePicks(rows, options.cutoff, settled, reviewed);

  if (options.execute) {
    if (options.maxPicks === undefined) throw new Error('execute requires --max-picks');
    assertWithinCap(selected.length, options.maxPicks);
  }

  let deletedPicks = 0;
  let raced = 0;
  const selectedIds = new Set(selected.map((row) => row.id));
  if (options.execute) {
    for (const batch of chunk([...selectedIds], BATCH_SIZE)) {
      const settledNow = await idsWithRow(store, 'settlement_records', batch);
      const reviewedNow = await idsWithRow(store, 'pick_reviews', batch);
      const safe = batch.filter((id) => !settledNow.has(id) && !reviewedNow.has(id));
      raced += batch.length - safe.length;
      for (const id of batch) if (!safe.includes(id)) selectedIds.delete(id);
      if (safe.length === 0) continue;
      deletedPicks += await store.deletePicks(safe, cutoffIso);
    }
  }

  // A submission is orphaned when every pick that references it is gone (execute)
  // or selected (dry run). Reading the remaining picks covers both.
  const submissions = await readAllVerified(store, { table: 'submissions', columns: 'id', createdBefore: cutoffIso });
  const orphaned: string[] = [];
  for (const ids of chunk(submissions.map((row) => String(row['id'])), BATCH_SIZE)) {
    orphaned.push(...classifyOrphanedSubmissions(ids, await linkedPicks(store, ids), selectedIds));
  }

  let deletedSubmissions = 0;
  let racedSubmissions = 0;
  if (options.execute) {
    for (const batch of chunk(orphaned, BATCH_SIZE)) {
      // Selected picks are deleted by now, so any linking pick is one being kept.
      const safe = classifyOrphanedSubmissions(batch, await linkedPicks(store, batch), new Set());
      racedSubmissions += batch.length - safe.length;
      if (safe.length === 0) continue;
      deletedSubmissions += await store.deleteSubmissions(safe, cutoffIso);
    }
  }

  return {
    mode: options.execute ? 'execute' : 'dry-run',
    project_ref: options.projectRef,
    cutoff: cutoffIso,
    scanned: rows.length,
    selected: selected.length,
    skipped,
    by_status: tally(selected, 'status'),
    by_source: tally(selected, 'source'),
    orphaned_submissions: orphaned.length,
    deleted_picks: deletedPicks,
    deleted_submissions: deletedSubmissions,
    raced,
    raced_submissions: racedSubmissions,
  };
}

/** The live store: PostgREST through the privileged client boundary. */
export function supabaseReapStore(client: BoundarySupabaseClient): ReapStore {
  const filtered = (spec: ReadSpec, head: boolean) => {
    let query = client.from(spec.table).select(spec.columns, head ? { count: 'exact', head: true } : undefined);
    if (spec.createdBefore !== undefined) query = query.lt('created_at', spec.createdBefore);
    if (spec.inFilter !== undefined) query = query.in(spec.inFilter.column, spec.inFilter.values);
    return query;
  };
  return {
    async count(spec) {
      const { error, count } = await filtered(spec, true);
      if (error) throw new Error(`reap count of ${describe(spec)} failed: ${error.message}`);
      return count ?? null;
    },
    async page(spec, afterId, limit) {
      let query = filtered(spec, false);
      if (afterId !== null) query = query.gt('id', afterId);
      const { data, error } = await query.order('id', { ascending: true }).limit(limit);
      if (error) throw new Error(`reap read of ${describe(spec)} failed: ${error.message}`);
      return (data ?? []) as unknown as Record<string, unknown>[];
    },
    async deletePicks(ids, cutoffIso) {
      const { error, count } = await client
        .from('picks')
        .delete({ count: 'exact' })
        .in('id', ids)
        .lt('created_at', cutoffIso)
        .neq('status', KEPT_PICK_STATUS);
      if (error) throw new Error(`reap delete of picks failed: ${error.message}`);
      return count ?? 0;
    },
    async deleteSubmissions(ids, cutoffIso) {
      const { error, count } = await client
        .from('submissions')
        .delete({ count: 'exact' })
        .in('id', ids)
        .lt('created_at', cutoffIso);
      if (error) throw new Error(`reap delete of submissions failed: ${error.message}`);
      return count ?? 0;
    },
  };
}

export interface ReapArgs {
  execute: boolean;
  cutoff: Date;
  maxPicks?: number | undefined;
  reportPath?: string | undefined;
}

export function parseReapArgs(argv: string[], now: Date): ReapArgs {
  let execute = false;
  let cutoff: Date | null = null;
  let maxPicks: number | undefined;
  let reportPath: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = (): string => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} requires a value`);
      i += 1;
      return next;
    };
    if (arg === '--execute') execute = true;
    else if (arg === '--cutoff') cutoff = new Date(value());
    else if (arg === '--max-picks') maxPicks = Number(value());
    else if (arg === '--report') reportPath = value();
    else throw new Error(`unknown argument ${arg}`);
  }
  if (execute && (cutoff === null || maxPicks === undefined)) {
    throw new Error('--execute requires both --cutoff <ISO> and --max-picks <n> from a reviewed dry run');
  }
  const resolved = cutoff ?? new Date(now.getTime() - MIN_REAP_AGE_MS);
  assertReapCutoff(resolved, now);
  return { execute, cutoff: resolved, maxPicks, reportPath };
}

async function main(): Promise<void> {
  const now = new Date();
  const args = parseReapArgs(process.argv.slice(2), now);
  const env = collectEffectiveEnv();
  const url = env['SUPABASE_URL'];
  const key = env['SUPABASE_SERVICE_ROLE_KEY'];
  const { projectRef, host } = extractProjectRefFromUrl(url);

  // Identity is asserted BEFORE the client is constructed.
  console.log(`[staging-reap] resolved host=${host ?? 'unparseable'} ref=${projectRef ?? 'unidentified'}`);
  if (!isApprovedStagingTarget(url)) {
    console.error(
      `[staging-reap] refusing: target is not the approved staging project ` +
        `(observed=${projectRef ?? 'unidentified'}, expected=${EXPECTED_STAGING_SUPABASE_PROJECT_REF}).`,
    );
    process.exit(1);
  }
  if (!key) {
    console.error('[staging-reap] SUPABASE_SERVICE_ROLE_KEY is required');
    process.exit(1);
  }

  const client = createPrivilegedClient(url as string, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const report = await reapStagingFixtures(supabaseReapStore(client), {
    cutoff: args.cutoff,
    now,
    execute: args.execute,
    maxPicks: args.maxPicks,
    projectRef: projectRef ?? EXPECTED_STAGING_SUPABASE_PROJECT_REF,
  });
  const json = JSON.stringify(report, null, 2);
  console.log(json);
  if (args.reportPath) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(args.reportPath, `${json}\n`);
  }
}

/** Real-path comparison, never a filename match (see staging-path-enforcement.test.ts). */
function isCliEntrypoint(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return realpathSync(invoked) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isCliEntrypoint()) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
