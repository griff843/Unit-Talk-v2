import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizePgDumpSchemaDump } from './schema-roundtrip-hash.js';

// Recognition is an exact repository path, never a caller-supplied SQL marker.
export const CATALOG_MIGRATIONS = {
  'supabase/migrations/20261010170000_ncaaf_participant_catalog.sql': 'NCAAF',
  'supabase/migrations/20261010170100_wnba_participant_catalog.sql': 'WNBA',
} as const;
type Sport = 'NCAAF' | 'WNBA';
type Row = Record<string, unknown>;
export interface Identity {
  id: string;
  externalId: string;
  displayName: string;
}
interface Snapshot {
  schema: string;
  tables: Record<string, Row[]>;
}

export const WNBA_NAMES = [
  'Atlanta Dream',
  'Chicago Sky',
  'Connecticut Sun',
  'Indiana Fever',
  'New York Liberty',
  'Toronto Tempo',
  'Washington Mystics',
  'Dallas Wings',
  'Golden State Valkyries',
  'Las Vegas Aces',
  'Los Angeles Sparks',
  'Minnesota Lynx',
  'Phoenix Mercury',
  'Portland Fire',
  'Seattle Storm',
] as const; // Frozen official 2026 roster: https://www.wnba.com/teams; Cleveland is 2028.

export function governedId(sport: Sport, key: string): string {
  const namespace = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex'); // UUID namespace URL
  const input =
    sport === 'NCAAF'
      ? `unit-talk:participant:ncaaf:ncaa:${key}`
      : `unit-talk:participant:wnba:${key}`;
  const bytes = createHash('sha1')
    .update(namespace)
    .update(input)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function recognizeCatalogMigration(file: string): Sport | null {
  return (
    Object.entries(CATALOG_MIGRATIONS).find(
      ([candidate]) => candidate === file,
    )?.[1] ?? null
  );
}

export function assertDisposableDsn(dsn: string): void {
  const url = new URL(dsn);
  assert.ok(
    ['postgres:', 'postgresql:'].includes(url.protocol),
    'Postgres DSN required',
  );
  assert.ok(
    ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname),
    'only loopback scratch Postgres is permitted',
  );
  assert.match(
    url.pathname,
    /^\/participant_catalog_drill_[a-z0-9_]+$/,
    'disposable database name required',
  );
  assert.equal(url.search, '', 'DSN query overrides are prohibited');
}

function object(value: unknown): Row {
  assert.ok(
    value !== null && typeof value === 'object' && !Array.isArray(value),
  );
  return value as Row;
}

export function expectedIdentities(sport: Sport, root: string): Identity[] {
  if (sport === 'WNBA')
    return WNBA_NAMES.map((displayName) => {
      const key = displayName.toLowerCase().replaceAll(' ', '-');
      return {
        id: governedId(sport, key),
        externalId: `unit-talk:wnba:${key}`,
        displayName,
      };
    });
  const frozen = object(
    JSON.parse(
      readFileSync(
        path.join(root, 'packages/db/src/ncaaf-participant-roster.json'),
        'utf8',
      ),
    ),
  );
  assert.equal(frozen['season'], 2026);
  assert.equal(frozen['academicYear'], 2027);
  const participants: unknown = frozen['participants'];
  assert.ok(Array.isArray(participants));
  assert.equal(participants.length, 266);
  const rows = participants.map((value: unknown) => object(value));
  assert.equal(rows.filter((row) => row['subdivision'] === 'FBS').length, 138);
  assert.equal(rows.filter((row) => row['subdivision'] === 'FCS').length, 128);
  const result = rows.map((row) => {
    assert.ok(
      Number.isInteger(row['ncaaOrgId']) && Number(row['ncaaOrgId']) > 0,
    );
    const key = String(row['ncaaOrgId']);
    assert.equal(row['id'], governedId(sport, key));
    assert.equal(row['externalId'], `unit-talk:ncaaf:ncaa:${key}`);
    assert.ok(
      typeof row['displayName'] === 'string' && row['displayName'].length > 3,
    );
    return {
      id: governedId(sport, key),
      externalId: `unit-talk:ncaaf:ncaa:${key}`,
      displayName: String(row['displayName']),
    };
  });
  for (const key of ['id', 'externalId', 'displayName'] as const) {
    assert.equal(
      new Set(result.map((row) => row[key].toLowerCase())).size,
      266,
      `duplicate ${key}`,
    );
  }
  return result;
}

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

export function scratchSql(dsn: string, sql: string): string {
  assertDisposableDsn(dsn);
  return execFileSync(
    'psql',
    [dsn, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'],
    {
      input: sql,
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  ).trim();
}

function snapshot(dsn: string): Snapshot {
  const dump = execFileSync(
    'pg_dump',
    [dsn, '--schema-only', '--no-owner', '--no-privileges'],
    {
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const names: unknown = JSON.parse(
    scratchSql(
      dsn,
      `SELECT coalesce(jsonb_agg(jsonb_build_array(schemaname,tablename) ORDER BY schemaname,tablename),'[]')
    FROM pg_tables WHERE schemaname NOT LIKE 'pg_%' AND schemaname <> 'information_schema';`,
    ),
  );
  assert.ok(Array.isArray(names));
  const tables: Record<string, Row[]> = {};
  for (const pair of names) {
    assert.ok(
      Array.isArray(pair) &&
        pair.length === 2 &&
        pair.every((item: unknown) => typeof item === 'string'),
    );
    const schema = String(pair[0]);
    const table = String(pair[1]);
    const values: unknown = JSON.parse(
      scratchSql(
        dsn,
        `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') FROM ${identifier(schema)}.${identifier(table)} t;`,
      ),
    );
    assert.ok(Array.isArray(values));
    tables[`${schema}.${table}`] = values.map((row: unknown) => object(row));
  }
  assert.ok(
    tables['public.participants'],
    'canonical participants table missing',
  );
  return { schema: normalizePgDumpSchemaDump(dump), tables };
}

function equal(a: Snapshot, b: Snapshot, message: string): void {
  assert.deepEqual(b, a, message);
}
function matches(row: Row, identity: Identity, sport: Sport): boolean {
  return (
    row['participant_type'] === 'team' &&
    row['sport'] === sport &&
    (row['external_id'] === identity.externalId ||
      String(row['display_name']).toLowerCase() ===
        identity.displayName.toLowerCase())
  );
}

function verifyApply(
  before: Snapshot,
  after: Snapshot,
  expected: Identity[],
  sport: Sport,
): Row[] {
  assert.equal(
    after.schema,
    before.schema,
    'catalog must not manufacture schema objects',
  );
  assert.deepEqual(Object.keys(after.tables), Object.keys(before.tables));
  const permitted =
    sport === 'WNBA'
      ? new Set([
          'public.sports',
          'public.leagues',
          'public.sport_market_type_availability',
        ])
      : new Set<string>();
  for (const [table, rows] of Object.entries(before.tables)) {
    const current = after.tables[table] ?? [];
    if (table === 'public.participants' || permitted.has(table)) {
      for (const row of rows)
        assert.ok(
          current.some(
            (value) => JSON.stringify(value) === JSON.stringify(row),
          ),
          `existing ${table} row changed`,
        );
      if (permitted.has(table))
        for (const row of current) {
          if (
            rows.some((value) => JSON.stringify(value) === JSON.stringify(row))
          )
            continue;
          assert.ok(
            table === 'public.sports'
              ? row['id'] === 'WNBA'
              : table === 'public.leagues'
                ? row['id'] === 'wnba' && row['sport_id'] === 'WNBA'
                : row['sport_id'] === 'WNBA',
            `unrelated ${table} insert`,
          );
        }
    } else assert.deepEqual(current, rows, `forbidden write to ${table}`);
  }
  const prior = before.tables['public.participants'] ?? [];
  const current = after.tables['public.participants'] ?? [];
  const selected = expected.map((identity) => {
    const found = current.filter((row) => matches(row, identity, sport));
    assert.equal(
      found.length,
      1,
      `exactly one ${identity.displayName} identity required`,
    );
    const row = found[0]!;
    const existing = prior.filter((value) => matches(value, identity, sport));
    assert.ok(
      existing.length <= 1,
      'baseline has ambiguous canonical identities',
    );
    if (existing[0])
      assert.deepEqual(
        row,
        existing[0],
        'pre-existing matching identity must remain byte-identical',
      );
    else {
      assert.equal(row['id'], identity.id);
      assert.equal(row['external_id'], identity.externalId);
      assert.equal(row['display_name'], identity.displayName);
      assert.equal(row['league'], sport.toLowerCase());
      assert.equal(
        object(row['metadata'])['seedIssue'],
        sport === 'NCAAF' ? 'UTV2-1971' : 'UTV2-1972',
      );
    }
    return row;
  });
  const introduced = current.filter(
    (row) => !prior.some((value) => value['id'] === row['id']),
  );
  assert.equal(
    introduced.length,
    selected.filter((row) => !prior.some((value) => value['id'] === row['id']))
      .length,
    'unexpected participant insert',
  );
  return selected;
}

function requireRefusal(dsn: string, sql: string, states: string[]): void {
  let state: string | undefined;
  try {
    scratchSql(dsn, sql);
  } catch (error) {
    const stderr = object(error)['stderr'];
    state = String(stderr).match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1];
  }
  assert.ok(
    state && states.includes(state),
    `expected atomic refusal (${states.join('/')}); received ${state ?? 'success or unrelated error'}`,
  );
}

export function runSeedDrill(
  dsn: string,
  migration: string,
  root = process.cwd(),
): string[] {
  assertDisposableDsn(dsn);
  const sport = recognizeCatalogMigration(migration);
  assert.ok(sport, 'unrecognized catalog migration');
  const expected = expectedIdentities(sport, root);
  const up = readFileSync(path.join(root, migration), 'utf8');
  const down = readFileSync(
    path.join(
      root,
      'db/migrations-rollback',
      `${path.basename(migration, '.sql')}.down.sql`,
    ),
    'utf8',
  );
  const baseline = snapshot(dsn);
  const first = expected[0]!;
  assert.ok(
    !(baseline.tables['public.participants'] ?? []).some((row) =>
      matches(row, first, sport),
    ),
    'drill needs one unseeded identity',
  );
  const proof: string[] = ['baseline captured'];
  const conflictId = randomUUID();
  scratchSql(
    dsn,
    `INSERT INTO public.participants(id,external_id,participant_type,sport,league,display_name,metadata)
    VALUES (${literal(conflictId)},${literal(first.externalId)},'team',${literal(sport)},${literal(sport.toLowerCase())},'CONFLICT: wrong school','{}');`,
  );
  const conflict = snapshot(dsn);
  requireRefusal(dsn, up, ['P0001', '23505', '23514']);
  equal(conflict, snapshot(dsn), 'conflict refusal was not atomic');
  scratchSql(
    dsn,
    `DELETE FROM public.participants WHERE id=${literal(conflictId)};`,
  );
  equal(baseline, snapshot(dsn), 'conflict fixture cleanup changed baseline');
  proof.push('identity conflict refused atomically');

  scratchSql(dsn, up);
  const applied = snapshot(dsn);
  const identities = verifyApply(baseline, applied, expected, sport);
  proof.push(
    `clean apply: ${identities.length} frozen identities; protected tables unchanged`,
  );
  scratchSql(dsn, up);
  equal(
    applied,
    snapshot(dsn),
    'repeat application changed rows, UUIDs or schema',
  );
  proof.push('repeat application: zero data/UUID/count churn');

  // A cascading FK catches down scripts that rely on FK enforcement alone.
  scratchSql(
    dsn,
    `CREATE SCHEMA participant_catalog_drill_fixture;
    CREATE TABLE participant_catalog_drill_fixture.reference(id uuid REFERENCES public.participants(id) ON DELETE CASCADE);
    INSERT INTO participant_catalog_drill_fixture.reference VALUES (${literal(first.id)});`,
  );
  const referenced = snapshot(dsn);
  requireRefusal(dsn, down, ['P0001', '23503']);
  equal(
    referenced,
    snapshot(dsn),
    'referenced-row rollback refusal was not atomic',
  );
  scratchSql(
    dsn,
    'DROP TABLE participant_catalog_drill_fixture.reference; DROP SCHEMA participant_catalog_drill_fixture;',
  );
  equal(
    applied,
    snapshot(dsn),
    'reference fixture cleanup changed applied state',
  );
  proof.push('rollback refused referenced identity, including cascading FK');
  scratchSql(dsn, down);
  equal(baseline, snapshot(dsn), 'rollback did not restore exact baseline');
  proof.push('rollback restored exact baseline');
  scratchSql(dsn, up);
  const reapplied = verifyApply(baseline, snapshot(dsn), expected, sport);
  const logical = (rows: Row[]) =>
    rows.map(({ created_at: _created, updated_at: _updated, ...row }) => row);
  assert.deepEqual(
    logical(reapplied),
    logical(identities),
    'reapply changed governed identities/data',
  );
  scratchSql(dsn, down);
  equal(baseline, snapshot(dsn), 'reapply rollback changed baseline');
  proof.push('reapply preserved stable governed identities');

  const existingId = randomUUID();
  scratchSql(
    dsn,
    `INSERT INTO public.participants(id,external_id,participant_type,sport,league,display_name,metadata)
    VALUES (${literal(existingId)},'existing-canonical-provider-identity','team',${literal(sport)},${literal(sport.toLowerCase())},${literal(first.displayName)},'{"preserve":"existing"}');`,
  );
  const existing = snapshot(dsn);
  scratchSql(dsn, up);
  const existingApplied = snapshot(dsn);
  verifyApply(existing, existingApplied, expected, sport);
  scratchSql(dsn, up);
  equal(
    existingApplied,
    snapshot(dsn),
    'matching existing identity churned on repeat',
  );
  scratchSql(dsn, down);
  equal(
    existing,
    snapshot(dsn),
    'rollback removed or altered pre-existing canonical identity',
  );
  scratchSql(
    dsn,
    `DELETE FROM public.participants WHERE id=${literal(existingId)};`,
  );
  equal(baseline, snapshot(dsn), 'drill did not leave exact baseline intact');
  proof.push('matching canonical UUID preserved through apply/repeat/rollback');
  return proof;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const dsn = process.env['POSTGRES_URL'];
    const migration = process.argv[2];
    assert.ok(
      dsn && migration,
      'POSTGRES_URL and recognized migration path required',
    );
    console.log(
      JSON.stringify(
        {
          gate: 'participant-catalog-seed-drill',
          ok: true,
          migration,
          cases: runSeedDrill(dsn, migration),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        gate: 'participant-catalog-seed-drill',
        ok: false,
        error: error instanceof Error ? error.message : 'drill failed',
      }),
    );
    process.exitCode = 1;
  }
}
