/**
 * UTV2-1630 — synthetic reference fixtures for the staging/CI project.
 *
 * A freshly migrated project has the schema but no reference rows, so
 * `picks.market_type_id -> market_types(id)` fails for every smoke submission.
 * The first staging run failed 6/7 on exactly that FK.
 *
 * These rows are SYNTHETIC, not copied from production. Only the `id` values
 * are meaningful — the application canonicalizes `market: 'NBA points'` to
 * `player_points_ou`, so that id must exist for the FK to resolve. Display
 * names and metadata are deliberately labelled as staging fixtures so a row can
 * never be mistaken for production taxonomy.
 *
 * Idempotent: every insert is an upsert on the primary key, so re-running is a
 * no-op. That is what lets the workflow re-run without cleanup bookkeeping.
 *
 * Refuses to run against anything but the approved staging project.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import {
  EXPECTED_STAGING_SUPABASE_PROJECT_REF,
  extractProjectRefFromUrl,
  isApprovedStagingTarget,
} from './isolated-proof-attestation.js';
import { collectEffectiveEnv } from './required-db-smoke.js';

interface SeedRow {
  table: string;
  rows: Record<string, unknown>[];
}

/**
 * Reference data staging needs, mirrored from production's lookup tables.
 *
 * Not hand-written: `market_type_id` is derived inside the submission service
 * from the market string, so a hand-picked subset guesses at that mapping and
 * gets it wrong. The T1 live suites failed on
 * `picks_market_type_id_fkey` for exactly that reason.
 *
 * These three tables are pure reference data — 6 families, 3 selection types,
 * 133 market types. No picks, no submissions, no user data. Committing them
 * keeps the seeder self-contained, which matters: CI has no production access
 * by design, so it cannot fetch them at run time.
 *
 * Regenerate by reading the same three tables from production read-only.
 */
const REFERENCE_FIXTURES = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'staging-reference-fixtures.json'), 'utf8'),
) as Record<string, Record<string, unknown>[]>;

/** Insert order matters: children reference their parents. */
export const STAGING_FIXTURES: SeedRow[] = [
  { table: 'market_families', rows: REFERENCE_FIXTURES['market_families'] ?? [] },
  { table: 'selection_types', rows: REFERENCE_FIXTURES['selection_types'] ?? [] },
  { table: 'market_types', rows: REFERENCE_FIXTURES['market_types'] ?? [] },
];

async function main(): Promise<void> {
  // Resolve from the same sources the DB clients use (local.env > .env >
  // .env.example, then process.env). Reading process.env alone is exactly the
  // defect that made the original CI identity guard a no-op.
  const env = collectEffectiveEnv();
  const url = env['SUPABASE_URL'];
  const key = env['SUPABASE_SERVICE_ROLE_KEY'];
  const { projectRef, host } = extractProjectRefFromUrl(url);

  // Identity is asserted BEFORE the client is constructed.
  console.log(`[seed-staging] resolved host=${host ?? 'unparseable'} ref=${projectRef ?? 'unidentified'}`);
  if (!isApprovedStagingTarget(url)) {
    console.error(
      `[seed-staging] refusing: target is not the approved staging project ` +
        `(observed=${projectRef ?? 'unidentified'}, expected=${EXPECTED_STAGING_SUPABASE_PROJECT_REF}).`,
    );
    process.exit(1);
  }
  if (!key) {
    console.error('[seed-staging] SUPABASE_SERVICE_ROLE_KEY is required');
    process.exit(1);
  }

  const client = createClient(url as string, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (const { table, rows } of STAGING_FIXTURES) {
    const { error } = await client.from(table).upsert(rows, { onConflict: 'id' });
    if (error) {
      console.error(`[seed-staging] ${table}: ${error.message}`);
      process.exit(1);
    }
    console.log(`[seed-staging] ${table}: ${rows.length} synthetic row(s) upserted`);
  }
  console.log('[seed-staging] done (idempotent — re-running is a no-op)');
}

/**
 * Compare resolved real paths rather than matching on filename.
 *
 * An `endsWith('/<name>.ts')` test is defeated by any rename, copy, symlink or
 * compiled .js invocation — and it fails OPEN: main() never runs, the process
 * exits 0, and a `&&` chain proceeds to the writable suite. Verified: a renamed
 * copy of this file exited 0 against a PRODUCTION target while the correctly
 * named file refused with exit 1.
 */
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
