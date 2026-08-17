/**
 * UTV2-1718 — executable proof that a migration's fail-closed precondition refuses.
 *
 * ## Why this exists
 *
 * UTV2-1540's ledger-repair migration captured live DDL for two Command Center
 * tables. It was written with `CREATE ... IF NOT EXISTS` so a scratch replay would
 * converge. That made an accidental production run SILENT — indistinguishable from
 * success — which is precisely the failure mode that matters: executing the
 * migration on production bypasses the operator authorization boundary that
 * `supabase migration repair --status applied` exists to enforce.
 *
 * The remedy was a precondition that RAISEs before any DDL. But a guard that has
 * never been observed refusing is not a proven control. Reading the SQL proves
 * nothing; the control must be made to FAIL on the condition it names.
 *
 * ## The convention
 *
 * A migration opts in by declaring, anywhere in the file:
 *
 *     -- FAIL-CLOSED-PRECONDITION: public.foo, public.bar
 *
 * For EACH declared relation independently, this drill:
 *   1. snapshots the schema,
 *   2. seeds that one relation as a decoy,
 *   3. executes the migration and requires SQLSTATE 42P07,
 *   4. re-snapshots and requires the schema to be byte-identical to step 2 —
 *      which is what "refused before any DDL" actually means,
 *   5. drops the decoy and confirms the schema returns to the step-1 snapshot.
 *
 * Then it proves the guard is not simply always-refusing: on a schema with none of
 * the declared relations present, the migration must apply in full.
 *
 * Testing each relation independently matters because the guard claims "either",
 * not "both". Seeding both at once would let a guard that only checks the first
 * relation pass.
 *
 * Runs against an ephemeral scratch Postgres. It never holds a production
 * credential and must never be wired to one.
 */
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const PRECONDITION_MARKER = /^--\s*FAIL-CLOSED-PRECONDITION:\s*(.+)$/im;

/** SQLSTATE the precondition is required to raise. `42P07` is duplicate_table. */
export const REQUIRED_SQLSTATE = '42P07';

export interface DrillCase {
  readonly name: string;
  readonly status: 'pass' | 'fail';
  readonly detail: string;
}

/**
 * Relations a migration declares its precondition guards. Returns an empty array
 * when the migration does not opt in, which is not an error — most migrations
 * legitimately have no precondition.
 */
export function parseDeclaredRelations(sqlText: string): string[] {
  const match = PRECONDITION_MARKER.exec(sqlText);
  if (!match?.[1]) return [];
  return match[1]
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
}

/**
 * A fingerprint of every schema object the migration could possibly create.
 *
 * Comparing this before and after a refusal is the actual evidence that no DDL
 * ran. Checking only "did the other table appear" would miss a partial apply that
 * created an index or a trigger before hitting the guard.
 */
async function snapshotSchema(sql: postgres.Sql): Promise<string> {
  const rows = await sql`
    SELECT 'relation' AS kind, n.nspname || '.' || c.relname AS ident, c.relkind::text AS extra
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'i', 'v', 'm', 'S', 'p')
    UNION ALL
    SELECT 'column', n.nspname || '.' || c.relname || '.' || a.attname, format_type(a.atttypid, a.atttypmod)
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped
    UNION ALL
    SELECT 'constraint', n.nspname || '.' || conname, pg_get_constraintdef(oid)
      FROM pg_constraint con JOIN pg_namespace n ON n.oid = con.connamespace
     WHERE n.nspname = 'public'
    UNION ALL
    SELECT 'trigger', c.relname || '.' || t.tgname, ''
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND NOT t.tgisinternal
    UNION ALL
    SELECT 'rls', n.nspname || '.' || c.relname, c.relrowsecurity::text
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY 1, 2, 3
  `;
  return rows.map((r) => `${r.kind}|${r.ident}|${r.extra}`).join('\n');
}

/**
 * Executes the migration exactly as a deploy would — simple protocol, whole file,
 * no wrapping transaction that could mask partial application.
 *
 * Returns the SQLSTATE on failure, or null on success.
 */
async function runMigration(sql: postgres.Sql, sqlText: string): Promise<string | null> {
  try {
    await sql.unsafe(sqlText).simple();
    return null;
  } catch (err) {
    const code = (err as { code?: string }).code;
    // A guard that raises the wrong SQLSTATE still fails the drill below; we
    // surface whatever it actually raised rather than normalising it away.
    return code ?? 'UNKNOWN';
  }
}

export async function runDrill(
  connectionString: string,
  migrationPath: string,
): Promise<DrillCase[]> {
  const sqlText = readFileSync(migrationPath, 'utf8');
  const relations = parseDeclaredRelations(sqlText);
  const cases: DrillCase[] = [];

  if (relations.length === 0) {
    return [
      {
        name: 'declaration',
        status: 'fail',
        detail:
          `${migrationPath} has no "-- FAIL-CLOSED-PRECONDITION:" declaration. ` +
          'This drill was invoked for it, so the declaration is missing or malformed.',
      },
    ];
  }

  const sql = postgres(connectionString, { max: 1, onnotice: () => {} });

  try {
    const baseline = await snapshotSchema(sql);

    // --- Refusal, once per declared relation, independently. -----------------
    for (const relation of relations) {
      await sql.unsafe(`CREATE TABLE ${relation} (id uuid PRIMARY KEY)`).simple();
      const seeded = await snapshotSchema(sql);

      const sqlstate = await runMigration(sql, sqlText);
      const afterAttempt = await snapshotSchema(sql);

      if (sqlstate === null) {
        cases.push({
          name: `refuses when ${relation} pre-exists`,
          status: 'fail',
          detail: 'migration APPLIED despite the relation already existing — the guard did not fire',
        });
      } else if (sqlstate !== REQUIRED_SQLSTATE) {
        cases.push({
          name: `refuses when ${relation} pre-exists`,
          status: 'fail',
          detail: `migration failed with SQLSTATE ${sqlstate}, expected ${REQUIRED_SQLSTATE}`,
        });
      } else {
        cases.push({
          name: `refuses when ${relation} pre-exists`,
          status: 'pass',
          detail: `raised SQLSTATE ${REQUIRED_SQLSTATE}`,
        });
      }

      cases.push({
        name: `no DDL ran when ${relation} pre-exists`,
        status: afterAttempt === seeded ? 'pass' : 'fail',
        detail:
          afterAttempt === seeded
            ? 'schema byte-identical before and after the refused attempt'
            : 'SCHEMA CHANGED during a refused attempt — the guard did not run before DDL',
      });

      await sql.unsafe(`DROP TABLE ${relation}`).simple();
      const restored = await snapshotSchema(sql);
      cases.push({
        name: `scratch restored after ${relation} case`,
        status: restored === baseline ? 'pass' : 'fail',
        detail: restored === baseline ? 'back to baseline' : 'decoy teardown left residue',
      });
    }

    // --- The guard must not simply always refuse. ----------------------------
    const cleanState = await runMigration(sql, sqlText);
    if (cleanState !== null) {
      cases.push({
        name: 'applies on an empty scratch schema',
        status: 'fail',
        detail: `migration failed with SQLSTATE ${cleanState} when no target relation existed`,
      });
    } else {
      const present = await Promise.all(
        relations.map(async (relation) => {
          const [row] = await sql`SELECT to_regclass(${relation}) IS NOT NULL AS ok`;
          return { relation, ok: Boolean(row?.ok) };
        }),
      );
      const missing = present.filter((p) => !p.ok).map((p) => p.relation);
      cases.push({
        name: 'applies on an empty scratch schema',
        status: missing.length === 0 ? 'pass' : 'fail',
        detail:
          missing.length === 0
            ? `created all declared relations: ${relations.join(', ')}`
            : `applied but did not create: ${missing.join(', ')}`,
      });
    }

    return cases;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const migrationPath = args.find((a) => a.endsWith('.sql'));
  const connectionString = process.env['POSTGRES_URL'];

  if (!migrationPath || !connectionString) {
    console.error(
      'Usage: pnpm exec tsx scripts/ci/migration-precondition-drill.ts <migration.sql> [--json]\n' +
        '  POSTGRES_URL must point at an EPHEMERAL scratch database. Never a production DSN.',
    );
    return 2;
  }

  const cases = await runDrill(connectionString, migrationPath);
  const failures = cases.filter((c) => c.status === 'fail');

  if (json) {
    console.log(
      JSON.stringify(
        { schema_version: 1, gate: 'migration-precondition-drill', migration: migrationPath, cases, ok: failures.length === 0 },
        null,
        2,
      ),
    );
  } else {
    console.log(`migration-precondition-drill: ${migrationPath}`);
    for (const c of cases) {
      console.log(`  [${c.status === 'pass' ? 'PASS' : 'FAIL'}] ${c.name} — ${c.detail}`);
    }
    console.log(
      failures.length === 0
        ? 'migration-precondition-drill: PASS'
        : `migration-precondition-drill: FAIL (${failures.length})`,
    );
  }

  return failures.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
