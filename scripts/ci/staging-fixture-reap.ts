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
 *   - page by offset. It pages by primary key, so its own reads do not add the
 *     offset scans it exists to relieve.
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
/** PostgREST caps every response at 1000 rows, so reads page at that size. */
const READ_PAGE_SIZE = 1000;
/** IDs per `in.(...)` filter and per DELETE. Keeps the request URL well under proxy limits. */
export const BATCH_SIZE = 150;

export interface ReapCandidate {
  id: string;
  created_at: string | null;
  status: string | null;
  source: string | null;
}

export type ReapSkipReason = 'unparseable_created_at' | 'not_older_than_cutoff' | 'settled' | 'reviewed';

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
}

function tally(rows: ReapCandidate[], key: 'status' | 'source'): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const value = row[key] ?? '<null>';
    out[value] = (out[value] ?? 0) + 1;
  }
  return out;
}

async function idsWithRow(
  client: BoundarySupabaseClient,
  table: 'settlement_records' | 'pick_reviews',
  pickIds: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  for (const ids of chunk(pickIds, BATCH_SIZE)) {
    const { data, error } = await client.from(table).select('pick_id').in('pick_id', ids);
    if (error) throw new Error(`reap read of ${table} failed: ${error.message}`);
    for (const row of (data ?? []) as { pick_id: string }[]) found.add(row.pick_id);
  }
  return found;
}

async function readAgedRows(
  client: BoundarySupabaseClient,
  table: 'picks' | 'submissions',
  columns: string,
  cutoffIso: string,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let after: string | null = null;
  for (;;) {
    let query = client.from(table).select(columns).lt('created_at', cutoffIso).order('id', { ascending: true });
    if (after !== null) query = query.gt('id', after);
    const { data, error } = await query.limit(READ_PAGE_SIZE);
    if (error) throw new Error(`reap read of ${table} failed: ${error.message}`);
    const page = (data ?? []) as unknown as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < READ_PAGE_SIZE) break;
    after = String(page[page.length - 1]!['id']);
  }
  return rows;
}

/**
 * Select every reapable pick read-only, then, in execute mode only, delete in
 * batches. Each batch re-checks settlement and review rows and re-asserts the
 * cutoff in the DELETE filter, so a pick that changed after selection is left
 * alone and counted as raced.
 */
export async function reapStagingFixtures(
  client: BoundarySupabaseClient,
  options: { cutoff: Date; now?: Date; execute: boolean; maxPicks?: number; projectRef: string },
): Promise<ReapReport> {
  const now = options.now ?? new Date();
  assertReapCutoff(options.cutoff, now);
  const cutoffIso = options.cutoff.toISOString();

  const rows = (await readAgedRows(client, 'picks', 'id,created_at,status,source', cutoffIso)) as unknown as ReapCandidate[];
  const allIds = rows.map((row) => row.id);
  const settled = await idsWithRow(client, 'settlement_records', allIds);
  const reviewed = await idsWithRow(client, 'pick_reviews', allIds);
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
      const settledNow = await idsWithRow(client, 'settlement_records', batch);
      const reviewedNow = await idsWithRow(client, 'pick_reviews', batch);
      const safe = batch.filter((id) => !settledNow.has(id) && !reviewedNow.has(id));
      raced += batch.length - safe.length;
      for (const id of batch) if (!safe.includes(id)) selectedIds.delete(id);
      if (safe.length === 0) continue;
      const { error, count } = await client
        .from('picks')
        .delete({ count: 'exact' })
        .in('id', safe)
        .lt('created_at', cutoffIso);
      if (error) throw new Error(`reap delete of picks failed after ${deletedPicks} deleted: ${error.message}`);
      deletedPicks += count ?? 0;
    }
  }

  // A submission is orphaned when every pick that references it is gone (execute)
  // or selected (dry run). Reading the remaining picks covers both.
  const submissions = await readAgedRows(client, 'submissions', 'id', cutoffIso);
  const orphaned: string[] = [];
  for (const ids of chunk(submissions.map((row) => String(row['id'])), BATCH_SIZE)) {
    const { data, error } = await client.from('picks').select('id,submission_id').in('submission_id', ids);
    if (error) throw new Error(`reap read of picks by submission failed: ${error.message}`);
    const kept = new Set(
      ((data ?? []) as { id: string; submission_id: string }[])
        .filter((pick) => !selectedIds.has(pick.id))
        .map((pick) => pick.submission_id),
    );
    for (const id of ids) if (!kept.has(id)) orphaned.push(id);
  }

  let deletedSubmissions = 0;
  if (options.execute) {
    for (const batch of chunk(orphaned, BATCH_SIZE)) {
      const { error, count } = await client
        .from('submissions')
        .delete({ count: 'exact' })
        .in('id', batch)
        .lt('created_at', cutoffIso);
      if (error) {
        throw new Error(`reap delete of submissions failed after ${deletedSubmissions} deleted: ${error.message}`);
      }
      deletedSubmissions += count ?? 0;
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
  };
}

export interface ReapArgs {
  execute: boolean;
  cutoff: Date;
  maxPicks?: number;
  reportPath?: string;
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
  const report = await reapStagingFixtures(client, {
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
