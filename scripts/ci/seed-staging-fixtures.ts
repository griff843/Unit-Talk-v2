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

/** Minimal FK chain the DB smoke suite needs. */
export const STAGING_FIXTURES: SeedRow[] = [
  {
    table: 'market_families',
    rows: [{ id: 'player_props', display_name: 'STAGING FIXTURE — player props' }],
  },
  {
    table: 'selection_types',
    rows: [{ id: 'over_under', display_name: 'STAGING FIXTURE — over/under' }],
  },
  {
    table: 'market_types',
    rows: [
      {
        id: 'player_points_ou',
        market_family_id: 'player_props',
        selection_type_id: 'over_under',
        display_name: 'STAGING FIXTURE — player points O/U',
        short_label: 'PTS O/U',
        requires_line: true,
        requires_participant: true,
        active: true,
        sort_order: 1,
        metadata: { fixture: 'utv2-1630', synthetic: true },
      },
      {
        id: 'player_assists_ou',
        market_family_id: 'player_props',
        selection_type_id: 'over_under',
        display_name: 'STAGING FIXTURE — player assists O/U',
        short_label: 'AST O/U',
        requires_line: true,
        requires_participant: true,
        active: true,
        sort_order: 2,
        metadata: { fixture: 'utv2-1630', synthetic: true },
      },
    ],
  },
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

const invoked = process.argv[1]?.replace(/\\/g, '/');
if (invoked?.endsWith('/seed-staging-fixtures.ts')) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
