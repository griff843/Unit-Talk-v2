/**
 * UTV2-1718 — executable proof that a migration's fail-closed precondition refuses.
 *
 * ## Why this exists
 *
 * The predecessor lane's ledger-repair migration captured live DDL for two Command
 * Center tables. It was written with `CREATE ... IF NOT EXISTS` so a scratch replay
 * would converge. That made an accidental production run SILENT — indistinguishable
 * from success — which is precisely the failure mode that matters: executing the
 * migration on production bypasses the operator authorization boundary that
 * `supabase migration repair --status applied` exists to enforce.
 *
 * The remedy was a precondition that RAISEs before any DDL. But a guard that has
 * never been observed refusing is not a proven control. Reading the SQL proves
 * nothing; the control must be made to FAIL on the condition it names.
 *
 * ## The convention
 *
 * A migration opts in by declaring, on its own comment line:
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
 * ## Why psql rather than a driver
 *
 * This deliberately shells out to `psql` instead of constructing a database client.
 * A direct client construction would be a new privileged-client site requiring
 * registration in `scripts/ci/privileged-db-client-inventory.json`. A throwaway CI
 * drill has no business joining that inventory, and `psql` is already installed by
 * the job. `-v VERBOSITY=verbose` makes psql print the SQLSTATE, which is the whole
 * assertion.
 *
 * Runs against an ephemeral scratch Postgres. It never holds a production
 * credential and must never be wired to one.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Anchored: prose that merely mentions the marker must not count as declaring it. */
const PRECONDITION_MARKER = /^[ \t]*--[ \t]*FAIL-CLOSED-PRECONDITION:[ \t]*(.+)$/im;

/** SQLSTATE the precondition is required to raise. `42P07` is duplicate_table. */
export const REQUIRED_SQLSTATE = '42P07';

/** psql prints `ERROR:  42P07: message` under VERBOSITY=verbose. */
const SQLSTATE_PATTERN = /^(?:psql:[^\n]*?)?ERROR:\s+([0-9A-Z]{5}):/m;

/**
 * The first ERROR line psql emitted, trimmed of its `psql:file:line:` prefix.
 *
 * Reported alongside a SQLSTATE mismatch: a bare "expected X, got Y" gives a
 * reviewer nothing to act on and invites guessing about the cause.
 */
export function extractErrorMessage(psqlOutput: string): string {
  const line = psqlOutput.split('\n').find((l) => /ERROR:/.test(l));
  return line ? line.replace(/^psql:[^\s]*:\s*/, '').trim() : '(no ERROR line in psql output)';
}

const SCHEMA_FINGERPRINT_QUERY = `
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
  -- con.oid, not a bare oid: pg_namespace also exposes oid, and the unqualified
  -- form fails with 42702 (ambiguous column reference).
  SELECT 'constraint', n.nspname || '.' || con.conname, pg_get_constraintdef(con.oid)
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

export interface DrillCase {
  readonly name: string;
  readonly status: 'pass' | 'fail';
  readonly detail: string;
}

/**
 * Relations a migration declares its precondition guards. Returns an empty array
 * when the migration does not opt in; the caller decides whether that is fatal.
 */
export function parseDeclaredRelations(sqlText: string): string[] {
  const match = PRECONDITION_MARKER.exec(sqlText);
  if (!match?.[1]) return [];
  return match[1]
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
}

/** Extracts the SQLSTATE psql reported, or null if none is present. */
export function extractSqlstate(psqlOutput: string): string | null {
  return SQLSTATE_PATTERN.exec(psqlOutput)?.[1] ?? null;
}

function psql(dsn: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(
      'psql',
      [dsn, '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-X', '-q', ...args],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { ok: true, stdout, stderr: '' };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { ok: false, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

function snapshotSchema(dsn: string): string {
  const result = psql(dsn, ['-At', '-F', '|', '-c', SCHEMA_FINGERPRINT_QUERY]);
  if (!result.ok) throw new Error(`schema fingerprint query failed: ${result.stderr}`);
  return result.stdout.trim();
}

export function runDrill(dsn: string, migrationPath: string): DrillCase[] {
  const sqlText = readFileSync(migrationPath, 'utf8');
  const relations = parseDeclaredRelations(sqlText);
  const cases: DrillCase[] = [];

  if (relations.length === 0) {
    return [
      {
        name: 'declaration',
        status: 'fail',
        detail:
          `${migrationPath} has no "-- FAIL-CLOSED-PRECONDITION:" declaration on its own ` +
          'comment line. This drill was invoked for it, so the declaration is missing or malformed.',
      },
    ];
  }

  const baseline = snapshotSchema(dsn);

  // --- Refusal, once per declared relation, independently. -------------------
  for (const relation of relations) {
    const seed = psql(dsn, ['-c', `CREATE TABLE ${relation} (id uuid PRIMARY KEY)`]);
    if (!seed.ok) throw new Error(`could not seed decoy ${relation}: ${seed.stderr}`);
    const seeded = snapshotSchema(dsn);

    const attempt = psql(dsn, ['-f', migrationPath]);
    const sqlstate = attempt.ok ? null : extractSqlstate(attempt.stderr);
    const afterAttempt = snapshotSchema(dsn);

    if (attempt.ok) {
      cases.push({
        name: `refuses when ${relation} pre-exists`,
        status: 'fail',
        detail: 'migration APPLIED despite the relation already existing — the guard did not fire',
      });
    } else if (sqlstate !== REQUIRED_SQLSTATE) {
      cases.push({
        name: `refuses when ${relation} pre-exists`,
        status: 'fail',
        detail:
          `migration failed with SQLSTATE ${sqlstate ?? 'unknown'}, expected ${REQUIRED_SQLSTATE}. ` +
          `psql reported: ${extractErrorMessage(attempt.stderr)}`,
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
          ? 'schema fingerprint identical before and after the refused attempt'
          : 'SCHEMA CHANGED during a refused attempt — the guard did not run before DDL',
    });

    const teardown = psql(dsn, ['-c', `DROP TABLE ${relation}`]);
    if (!teardown.ok) throw new Error(`could not drop decoy ${relation}: ${teardown.stderr}`);
    const restored = snapshotSchema(dsn);
    cases.push({
      name: `scratch restored after ${relation} case`,
      status: restored === baseline ? 'pass' : 'fail',
      detail: restored === baseline ? 'back to baseline' : 'decoy teardown left residue',
    });
  }

  // --- The guard must not simply always refuse. ------------------------------
  const clean = psql(dsn, ['-f', migrationPath]);
  if (!clean.ok) {
    cases.push({
      name: 'applies on an empty scratch schema',
      status: 'fail',
      detail:
        `migration failed with SQLSTATE ${extractSqlstate(clean.stderr) ?? 'unknown'} ` +
        `when no target relation existed. psql reported: ${extractErrorMessage(clean.stderr)}`,
    });
  } else {
    const missing = relations.filter((relation) => {
      const check = psql(dsn, ['-At', '-c', `SELECT to_regclass('${relation}') IS NOT NULL`]);
      return check.stdout.trim() !== 't';
    });
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
}

function main(): number {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const migrationPath = args.find((a) => a.endsWith('.sql'));
  const dsn = process.env['POSTGRES_URL'];

  if (!migrationPath || !dsn) {
    console.error(
      'Usage: pnpm exec tsx scripts/ci/migration-precondition-drill.ts <migration.sql> [--json]\n' +
        '  POSTGRES_URL must point at an EPHEMERAL scratch database. Never a production DSN.',
    );
    return 2;
  }

  const cases = runDrill(dsn, migrationPath);
  const failures = cases.filter((c) => c.status === 'fail');

  if (json) {
    console.log(
      JSON.stringify(
        {
          schema_version: 1,
          gate: 'migration-precondition-drill',
          migration: migrationPath,
          cases,
          ok: failures.length === 0,
        },
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

const invokedPath = process.argv[1] ?? '';
if (invokedPath.endsWith('migration-precondition-drill.ts')) {
  try {
    process.exit(main());
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
