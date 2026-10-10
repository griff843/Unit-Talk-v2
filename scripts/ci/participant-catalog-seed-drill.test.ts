import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CATALOG_MIGRATIONS,
  assertDisposableDsn,
  expectedIdentities,
  governedId,
  recognizeCatalogMigration,
  runSeedDrill,
  scratchSql,
} from './participant-catalog-seed-drill.js';

test('recognition permits only frozen repository paths, never marker/name lookalikes', () => {
  for (const [file, sport] of Object.entries(CATALOG_MIGRATIONS))
    assert.equal(recognizeCatalogMigration(file), sport);
  for (const file of [
    'other.sql',
    '/supabase/migrations/20261010170000_ncaaf_participant_catalog.sql',
    'supabase/migrations/20261011170000_ncaaf_participant_catalog.sql',
    '../supabase/migrations/20261010170000_ncaaf_participant_catalog.sql',
    '-- NO-PRECONDITION-REQUIRED: participant catalog',
  ])
    assert.equal(recognizeCatalogMigration(file), null);
});

test('scratch guard refuses remote hosts, ordinary databases and connection overrides', () => {
  assertDisposableDsn(
    'postgresql://postgres:postgres@localhost:5432/participant_catalog_drill_test',
  );
  for (const dsn of [
    'postgresql://localhost/production',
    'postgresql://production.example/participant_catalog_drill_test',
    'postgresql://localhost/participant_catalog_drill_test?host=production.example',
    'postgresql://localhost/postgres',
  ]) {
    assert.throws(() => assertDisposableDsn(dsn));
  }
});

test('WNBA expectation freezes 15 official active clubs and excludes future Cleveland', () => {
  const rows = expectedIdentities('WNBA', '.');
  assert.equal(rows.length, 15);
  assert.equal(new Set(rows.map((row) => row.id)).size, 15);
  for (const name of [
    'Portland Fire',
    'Toronto Tempo',
    'Golden State Valkyries',
  ])
    assert.ok(rows.some((row) => row.displayName === name));
  assert.ok(!rows.some((row) => row.displayName.includes('Cleveland')));
  assert.equal(
    governedId('WNBA', 'atlanta-dream'),
    governedId('WNBA', 'atlanta-dream'),
  );
});

const adminDsn = process.env['PARTICIPANT_CATALOG_TEST_ADMIN_URL'];
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

function fixture(
  sport: 'NCAAF' | 'WNBA',
  mutate?: (up: string, down: string) => [string, string],
): { cases: string[] } {
  assert.ok(adminDsn, 'explicit disposable test admin URL required');
  const admin = new URL(adminDsn);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(admin.hostname));
  assert.equal(admin.pathname, '/postgres');
  assert.equal(admin.search, '');
  const db = `participant_catalog_drill_${randomUUID().replaceAll('-', '')}`;
  const sql = (value: string) =>
    execFileSync('psql', [adminDsn, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
      input: value,
      encoding: 'utf8',
      timeout: 30_000,
    });
  const root = mkdtempSync(path.join(os.tmpdir(), 'participant-seed-proof-'));
  const dsn = new URL(adminDsn);
  dsn.pathname = `/${db}`;
  sql(`CREATE DATABASE ${db};`);
  try {
    mkdirSync(path.join(root, 'supabase/migrations'), { recursive: true });
    mkdirSync(path.join(root, 'db/migrations-rollback'), { recursive: true });
    mkdirSync(path.join(root, 'packages/db/src'), { recursive: true });
    // Synthetic NCAA identities exercise the drill contract, not the production roster.
    if (sport === 'NCAAF')
      writeFileSync(
        path.join(root, 'packages/db/src/ncaaf-participant-roster.json'),
        JSON.stringify({
          season: 2026,
          academicYear: 2027,
          participants: Array.from({ length: 266 }, (_, index) => ({
            ncaaOrgId: index + 1,
            id: governedId('NCAAF', String(index + 1)),
            externalId: `unit-talk:ncaaf:ncaa:${index + 1}`,
            displayName: `Synthetic School ${index + 1}`,
            subdivision: index < 138 ? 'FBS' : 'FCS',
          })),
        }),
      );
    const rows = expectedIdentities(sport, root);
    const issue = sport === 'WNBA' ? 'UTV2-1972' : 'UTV2-1971';
    const catalog = JSON.stringify(rows);
    let up = `BEGIN;
      DO $guard$ BEGIN
        IF EXISTS (SELECT 1 FROM public.participants p JOIN jsonb_to_recordset(${quote(catalog)}::jsonb) s("id" uuid,"externalId" text,"displayName" text)
          ON p.external_id=s."externalId" WHERE p.display_name<>s."displayName" OR p.sport<>${quote(sport)} OR p.participant_type<>'team') THEN
          RAISE EXCEPTION 'canonical identity conflict';
        END IF;
      END $guard$;
      INSERT INTO public.participants(id,external_id,participant_type,sport,league,display_name,metadata)
        SELECT s.id,s."externalId",'team',${quote(sport)},${quote(sport.toLowerCase())},s."displayName",jsonb_build_object('seedIssue',${quote(issue)})
        FROM jsonb_to_recordset(${quote(catalog)}::jsonb) s(id uuid,"externalId" text,"displayName" text)
        WHERE NOT EXISTS (SELECT 1 FROM public.participants p WHERE p.participant_type='team' AND p.sport=${quote(sport)} AND lower(p.display_name)=lower(s."displayName"));
      COMMIT;`;
    const owned = `id IN (${rows.map((row) => `${quote(row.id)}::uuid`).join(',')}) AND metadata->>'seedIssue'=${quote(issue)}`;
    let down = `BEGIN;
      DO $guard$ DECLARE ref record; used boolean; BEGIN
        FOR ref IN SELECT c.conrelid::regclass AS rel,a.attname AS col FROM pg_constraint c
          CROSS JOIN LATERAL unnest(c.conkey,c.confkey) AS keys(source,target)
          JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=keys.source
          JOIN pg_attribute b ON b.attrelid=c.confrelid AND b.attnum=keys.target
          WHERE c.contype='f' AND c.confrelid='public.participants'::regclass AND b.attname='id'
        LOOP
          EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I IN (SELECT id FROM public.participants WHERE ${owned.replaceAll("'", "''")}))',ref.rel,ref.col) INTO used;
          IF used THEN RAISE EXCEPTION 'referenced candidate identity'; END IF;
        END LOOP;
      END $guard$;
      DELETE FROM public.participants WHERE ${owned};
      COMMIT;`;
    if (mutate) [up, down] = mutate(up, down);
    const migration = Object.entries(CATALOG_MIGRATIONS).find(
      ([, value]) => value === sport,
    )![0];
    writeFileSync(path.join(root, migration), up);
    writeFileSync(
      path.join(
        root,
        'db/migrations-rollback',
        `${path.basename(migration, '.sql')}.down.sql`,
      ),
      down,
    );
    scratchSql(
      dsn.href,
      `CREATE TABLE public.participants(id uuid PRIMARY KEY,external_id text UNIQUE,participant_type text NOT NULL,sport text,league text,display_name text NOT NULL,metadata jsonb NOT NULL DEFAULT '{}',created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      CREATE TABLE public.teams(id uuid PRIMARY KEY,name text);
      CREATE TABLE public.picks(id uuid PRIMARY KEY,status text);
      CREATE TABLE public.events(id uuid PRIMARY KEY,name text);
      CREATE TABLE public.provider_offers(id uuid PRIMARY KEY,name text);
      CREATE TABLE public.outbox(id uuid PRIMARY KEY,status text);
      CREATE TABLE public.delivery_receipts(id uuid PRIMARY KEY,name text);
      INSERT INTO public.participants VALUES ('00000000-0000-4000-8000-000000000001','baseline-nba','team','NBA','nba','Unrelated NBA identity','{}',now(),now());
      INSERT INTO public.teams VALUES ('00000000-0000-4000-8000-000000000002','untouched');
      INSERT INTO public.picks VALUES ('00000000-0000-4000-8000-000000000003','queued');`,
    );
    return { cases: runSeedDrill(dsn.href, migration, root) };
  } finally {
    sql(`DROP DATABASE ${db} WITH (FORCE);`);
    rmSync(root, { recursive: true, force: true });
  }
}

for (const sport of ['NCAAF', 'WNBA'] as const)
  test(
    `${sport}: real Postgres proves the complete seed/rollback lifecycle`,
    { skip: !adminDsn },
    () => {
      const result = fixture(sport);
      assert.equal(result.cases.length, 8);
      assert.ok(result.cases.some((value) => value.includes('cascading FK')));
      assert.ok(
        result.cases.some((value) =>
          value.includes('canonical UUID preserved'),
        ),
      );
    },
  );

test(
  'real Postgres rejects a seed that accepts a conflicting canonical identity',
  { skip: !adminDsn },
  () => {
    assert.throws(
      () =>
        fixture('WNBA', (up, down) => [
          up
            .replace(/DO \$guard\$[\s\S]*?END \$guard\$;/, '')
            .replace(
              'lower(s."displayName"));',
              'lower(s."displayName")) ON CONFLICT(external_id) DO NOTHING;',
            ),
          down,
        ]),
      /expected atomic refusal/,
    );
  },
);
test(
  'real Postgres rejects non-atomic conflict refusal',
  { skip: !adminDsn },
  () => {
    assert.throws(
      () =>
        fixture('WNBA', (up, down) => [
          "INSERT INTO public.events VALUES ('00000000-0000-4000-8000-000000000005','forbidden');\n" +
            up,
          down,
        ]),
      /conflict refusal was not atomic/,
    );
  },
);
test(
  'real Postgres rejects writes to unrelated picks',
  { skip: !adminDsn },
  () => {
    assert.throws(
      () =>
        fixture('WNBA', (up, down) => [
          up.replace(
            'COMMIT;',
            "UPDATE public.picks SET status='posted'; COMMIT;",
          ),
          down,
        ]),
      /forbidden write to public.picks/,
    );
  },
);
test('real Postgres rejects repeat metadata churn', { skip: !adminDsn }, () => {
  assert.throws(
    () =>
      fixture('WNBA', (up, down) => [
        up.replace(
          'COMMIT;',
          "UPDATE public.participants SET metadata=metadata||jsonb_build_object('churn',clock_timestamp()) WHERE sport='WNBA'; COMMIT;",
        ),
        down,
      ]),
    /repeat application changed/,
  );
});
test(
  'real Postgres rejects UUIDs that do not match the frozen governed identities',
  { skip: !adminDsn },
  () => {
    assert.throws(() =>
      fixture('WNBA', (up, down) => [
        up.replace('SELECT s.id,s.', 'SELECT gen_random_uuid(),s.'),
        down,
      ]),
    );
  },
);
test(
  'real Postgres rejects cascade-based rollback that does not refuse references',
  { skip: !adminDsn },
  () => {
    assert.throws(
      () =>
        fixture('WNBA', (up, down) => [
          up,
          down.replace(/DO \$guard\$[\s\S]*?END \$guard\$;/, ''),
        ]),
      /expected atomic refusal/,
    );
  },
);
test(
  'real Postgres rejects broad sport deletion on rollback',
  { skip: !adminDsn },
  () => {
    assert.throws(
      () =>
        fixture('WNBA', (up, down) => [
          up,
          down.replace(
            /DELETE FROM public.participants WHERE [\s\S]*?;\n {6}COMMIT;/,
            'DELETE FROM public.participants;\n      COMMIT;',
          ),
        ]),
      /rollback did not restore exact baseline/,
    );
  },
);
test(
  'real Postgres rejects rollback that deletes pre-existing participants in the candidate sport',
  { skip: !adminDsn },
  () => {
    assert.throws(
      () =>
        fixture('WNBA', (up, down) => [
          up,
          down.replace(
            /DELETE FROM public.participants WHERE [\s\S]*?;\n {6}COMMIT;/,
            "DELETE FROM public.participants WHERE sport='WNBA';\n      COMMIT;",
          ),
        ]),
      /rollback removed or altered pre-existing canonical identity/,
    );
  },
);

test('workflow runs the focused scratch tests and routes seed proof before the unchanged DDL guard', () => {
  const workflow = readFileSync(
    new URL(
      '../../.github/workflows/migration-reversibility-gate.yml',
      import.meta.url,
    ),
    'utf8',
  );
  for (const file of Object.keys(CATALOG_MIGRATIONS))
    assert.ok(workflow.includes(file));
  assert.ok(workflow.includes('PARTICIPANT_CATALOG_TEST_ADMIN_URL'));
  assert.ok(
    workflow.includes(
      'tsx --test scripts/ci/participant-catalog-seed-drill.test.ts',
    ),
  );
  const route = workflow.indexOf(
    'pnpm exec tsx scripts/ci/participant-catalog-seed-drill.ts',
  );
  assert.ok(route > 0 && route < workflow.indexOf('HAS_GUARD=0'));
  assert.ok(
    workflow
      .slice(route, workflow.indexOf('HAS_GUARD=0'))
      .includes('DRILLED=$((DRILLED + 1))'),
  );
  assert.ok(
    workflow.includes(
      'pnpm exec tsx scripts/ci/migration-precondition-drill.ts "$MIGRATION"',
    ),
  );
  assert.ok(
    workflow.includes('New migrations were detected but NONE were drilled'),
  );
});
