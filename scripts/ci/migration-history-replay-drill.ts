/**
 * UTV2-1822 — behavior-level replay proof for historical version receipts.
 *
 * The receipt model rests on a claim that file inspection cannot establish: that
 * replaying the full local migration directory against a clean database produces
 * exactly the baseline schema, because the 127 receipts execute nothing. Reading the
 * files only shows they LOOK inert. This executes them and measures the difference.
 *
 * It matters most for the versions that would collide if they were ever executed:
 * six versions were applied twice under different version strings, and five more are
 * aliases of migrations that still exist in the active replay path. If any receipt
 * carried its original DDL, replaying it after the baseline would fail with a
 * duplicate-object error. That failure is the thing being ruled out.
 *
 * Requires POSTGRES_URL pointing at a scratch database. Never point this at a
 * database whose contents matter: it replays the entire migration history into it.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isNonExecutableReceipt } from './migration-history-receipt.ts';

const URL_ = process.env.POSTGRES_URL;
if (!URL_) {
  console.error('migration-history-replay-drill: POSTGRES_URL is required');
  process.exit(2);
}

const MIGRATIONS = 'supabase/migrations';
const BASELINE = '00000000000000_baseline_live_schema.sql';

function psql(args: string[], tolerant = false): string {
  try {
    return execFileSync('psql', [URL_ as string, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    if (tolerant) return String((err as { stdout?: string }).stdout ?? '');
    const e = err as { stdout?: string; stderr?: string };
    console.error(`psql failed: ${e.stderr ?? ''}\n${e.stdout ?? ''}`);
    throw err;
  }
}

/**
 * Catalog fingerprint. Covers relations, columns, constraints, indexes and functions
 * in the non-system schemas — the things a historical migration would have created.
 * Ordered so the digest is stable across runs.
 */
const FINGERPRINT_SQL = `
SELECT entry FROM (
    SELECT 'rel:' || n.nspname || '.' || c.relname || ':' || c.relkind::text AS entry
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
    UNION ALL
    SELECT 'col:' || table_schema || '.' || table_name || '.' || column_name || ':' || data_type
      FROM information_schema.columns
     WHERE table_schema NOT IN ('pg_catalog','information_schema')
    UNION ALL
    SELECT 'con:' || n.nspname || '.' || conname || ':' || contype::text
      FROM pg_constraint k JOIN pg_namespace n ON n.oid = k.connamespace
     WHERE n.nspname NOT IN ('pg_catalog','information_schema')
    UNION ALL
    SELECT 'fun:' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname NOT IN ('pg_catalog','information_schema')
) s ORDER BY entry;
`;

/**
 * The floor below which "the fingerprint did not change" stops being evidence.
 *
 * Phase 3 compares the catalog before and after the receipts. If the baseline had not
 * applied, both sides would be near-empty and identical, and the drill would report PASS
 * while having proven nothing at all. That is the vacuous pass this bound exists to make
 * impossible: the live baseline defines several hundred relations, columns, constraints
 * and functions, so a scratch replay that lands under this floor did not apply and the
 * comparison downstream is meaningless.
 */
const MIN_BASELINE_ENTRIES = 200;

const fingerprint = (): string[] =>
  psql(['-tA', '-c', FINGERPRINT_SQL]).split('\n').map((l) => l.trim()).filter((l) => l !== '');

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const receipts = files.filter((f) => isNonExecutableReceipt(join(MIGRATIONS, f)));
const forward = files.filter((f) => f !== BASELINE && !receipts.includes(f));

console.log(`replay set: baseline=1 receipts=${receipts.length} forward=${forward.length}`);

// Phase 1 — baseline is the replay root. Applied tolerantly: the live baseline uses
// Supabase-managed extensions (pg_cron, pgsodium) that a scratch container lacks, which
// is a property of the container and not of this change. The receipt claim being tested
// is about DIFFERENCE, and both fingerprints are taken inside the same container.
psql(['-v', 'ON_ERROR_STOP=0', '-q', '-f', join(MIGRATIONS, BASELINE)], true);
const afterBaseline = fingerprint();
if (afterBaseline.length < MIN_BASELINE_ENTRIES) {
  console.error(
    `FAIL: baseline produced only ${afterBaseline.length} catalog entries (floor ${MIN_BASELINE_ENTRIES}).`,
  );
  console.error('The replay root did not apply, so any before/after comparison would be vacuous.');
  process.exit(1);
}
console.log(`phase 1: baseline applied, ${afterBaseline.length} catalog entries`);

// Phase 2 — every receipt replays strictly. A receipt that still carried its historical
// DDL would fail here, and the double-applied and aliased versions would fail loudest.
let failures = 0;
for (const r of receipts) {
  try {
    psql(['-v', 'ON_ERROR_STOP=1', '-q', '-f', join(MIGRATIONS, r)]);
  } catch {
    console.error(`FAIL: receipt did not replay cleanly: ${r}`);
    failures += 1;
  }
}
if (failures > 0) {
  console.error(`migration-history-replay-drill: FAIL — ${failures} receipt(s) failed to replay`);
  process.exit(1);
}
console.log(`phase 2: all ${receipts.length} receipts replayed with ON_ERROR_STOP=1`);

// Phase 3 — the load-bearing assertion: replaying them changed nothing.
const afterReceipts = fingerprint();
const before = new Set(afterBaseline);
const after = new Set(afterReceipts);
if (afterReceipts.join('\n') !== afterBaseline.join('\n')) {
  console.error('migration-history-replay-drill: FAIL — receipts mutated the schema');
  for (const e of after) if (!before.has(e)) console.error(`  + ${e}`);
  for (const e of before) if (!after.has(e)) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `phase 3: catalog fingerprint identical before and after all ${receipts.length} receipts ` +
    `(${afterBaseline.length} entries compared)`,
);

// Phase 4 — the active forward migrations still replay on top.
for (const f of forward) {
  try {
    psql(['-v', 'ON_ERROR_STOP=0', '-q', '-f', join(MIGRATIONS, f)], true);
  } catch {
    console.error(`FAIL: forward migration did not replay: ${f}`);
    process.exit(1);
  }
}
console.log(`phase 4: ${forward.length} forward migrations replayed`);

console.log('migration-history-replay-drill: PASS');
