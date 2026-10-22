import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  classifyPrivilegeOnlyViewMigration,
  runPrivilegeOnlyViewDrill,
  splitSqlStatements,
} from './privilege-only-view-drill.ts';

// Verbatim PR #1775 migration text, with only the policy marker required by this
// lane prepended. Keeping the intended first consumer inline prevents this test
// from becoming coupled to, or editing, PR #1775.
const PR_1775_WITH_MARKER = `-- PRIVILEGE-ONLY-VIEW: public.v_governed_pick_performance security_invoker=true anon=none authenticated=none service_role=select
-- UTV2-1980: make governed pick performance service-role-only.
--
-- Role-guarded: each role-specific REVOKE/GRANT runs only when that role exists
-- (scratch Postgres in CI has no Supabase roles; Supabase always has all three).
-- security_invoker and the PUBLIC revoke are unconditional. A final check fails
-- closed: for every role that exists, the end-state privileges must be exactly
-- anon/authenticated = none, service_role = SELECT only, and the view must be
-- security_invoker. A guard therefore only skips on a MISSING role.
--
-- Recovery (run only in an authorized environment): see
-- db/migrations-rollback/20261022090000_revoke_governed_pick_performance_anon.down.sql
-- which restores the measured pre-change posture (anon and authenticated hold
-- all privileges, service_role holds all privileges, PUBLIC none, no
-- security_invoker). Production execution is not authorized by this migration
-- or by this lane.
--
-- Capture each staging snapshot (before, after, recovered, and reapplied) with:
--   SELECT role_name,
--          privilege,
--          has_table_privilege(
--            role_name,
--            'public.v_governed_pick_performance',
--            privilege
--          ) AS allowed
--   FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS roles(role_name)
--   CROSS JOIN unnest(ARRAY[
--     'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
--   ]) AS privileges(privilege)
--   ORDER BY role_name, privilege;

BEGIN;

ALTER VIEW public.v_governed_pick_performance
  SET (security_invoker = true);

REVOKE ALL PRIVILEGES ON TABLE public.v_governed_pick_performance
  FROM PUBLIC;

DO $$
DECLARE
  role_name text;
  priv text;
  expected boolean;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.v_governed_pick_performance FROM %I',
        role_name
      );
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT ON TABLE public.v_governed_pick_performance TO service_role';
  END IF;

  -- Fail-closed end-state check for every role that exists.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
    WHERE oid = 'public.v_governed_pick_performance'::regclass
      AND 'security_invoker=true' = ANY (coalesce(reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'v_governed_pick_performance is not security_invoker after migration';
  END IF;

  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      FOREACH priv IN ARRAY ARRAY[ -- lint-override: truncate (privilege name, not a TRUNCATE statement)
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
      ] LOOP
        expected := (role_name = 'service_role' AND priv = 'SELECT');
        IF has_table_privilege(role_name, 'public.v_governed_pick_performance', priv)
           IS DISTINCT FROM expected THEN
          RAISE EXCEPTION 'v_governed_pick_performance end-state wrong: % % expected % ',
            role_name, priv, expected;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END
$$;

COMMIT;
`;

const marker = (view = 'public.test_privilege_view') =>
  `-- PRIVILEGE-ONLY-VIEW: ${view} security_invoker=true anon=none authenticated=none service_role=select`;

function validUp(view = 'public.test_privilege_view'): string {
  return `${marker(view)}
BEGIN;
ALTER VIEW ${view} SET (security_invoker = true);
REVOKE ALL PRIVILEGES ON TABLE ${view} FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE ${view} FROM anon;
REVOKE ALL PRIVILEGES ON TABLE ${view} FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE ${view} FROM service_role;
GRANT SELECT ON TABLE ${view} TO service_role;
COMMIT;`;
}

const validDown = `BEGIN;
ALTER VIEW public.test_privilege_view RESET (security_invoker);
REVOKE ALL PRIVILEGES ON TABLE public.test_privilege_view FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.test_privilege_view FROM anon, authenticated, service_role;
GRANT ALL PRIVILEGES ON TABLE public.test_privilege_view TO anon, authenticated, service_role;
COMMIT;`;

test('top-level splitting ignores comments, strings, and DO-body semicolons', () => {
  const statements = splitSqlStatements(
    `-- comment ;\nBEGIN; DO $$ BEGIN RAISE EXCEPTION 'not; a split'; END $$; COMMIT;`,
  );
  assert.equal(statements.length, 3);
  assert.match(statements[1]!, /^DO/);
});

test('the inline PR #1775 migration classifies as privilege-only with its marker', () => {
  const result = classifyPrivilegeOnlyViewMigration(PR_1775_WITH_MARKER);
  assert.equal(
    result.kind,
    'valid',
    result.kind === 'invalid' ? result.errors.join('; ') : undefined,
  );
  if (result.kind === 'valid')
    assert.equal(result.policy.view, 'public.v_governed_pick_performance');
});

for (const [name, sql] of [
  [
    'CREATE TABLE',
    `${marker()}\nCREATE TABLE public.test_privilege_view(id integer);`,
  ],
  ['schema mutation', `${marker()}\nCREATE SCHEMA second;`],
  [
    'mixed migration',
    `${validUp()}\nINSERT INTO public.audit_log DEFAULT VALUES;`,
  ],
  [
    'second relation',
    `${validUp()}\nREVOKE SELECT ON TABLE public.other_view FROM anon;`,
  ],
  [
    'fake declaration',
    `-- prose says ${marker()}\nCREATE TABLE public.x(id integer);`,
  ],
  [
    'comment-only declaration',
    `${marker()}\n-- ALTER VIEW public.test_privilege_view SET (security_invoker = true);`,
  ],
  [
    'DO block smuggling SQL behind a fake comment inside a double-quoted alias (full #1775 body)',
    PR_1775_WITH_MARKER.replace(
      "  FOREACH role_name IN ARRAY ARRAY['anon'",
      "  role_name := (SELECT 1 \"end--\"); EXECUTE 'DROP TABLE public.victim';\n  FOREACH role_name IN ARRAY ARRAY['anon'",
    ),
  ],
  [
    'DO block hiding code behind a nested dollar-quoted string under a tagged outer quote',
    PR_1775_WITH_MARKER.replace('DO $$', 'DO $g$')
      .replace(/END\s*\$\$;/, 'END\n$g$;')
      .replace(
        "  FOREACH role_name IN ARRAY ARRAY['anon'",
        "  role_name := $$'$$; DROP TABLE public.victim; role_name := $$'$$;\n  FOREACH role_name IN ARRAY ARRAY['anon'",
      ),
  ],
  [
    'DO block hiding code behind a dollar-quoted dash-dash',
    PR_1775_WITH_MARKER.replace('DO $$', 'DO $g$')
      .replace(/END\s*\$\$;/, 'END\n$g$;')
      .replace(
        "  FOREACH role_name IN ARRAY ARRAY['anon'",
        "  role_name := $$--$$; DELETE FROM public.victim;\n  FOREACH role_name IN ARRAY ARRAY['anon'",
      ),
  ],
  [
    'EXECUTE operand concatenated with a second literal',
    PR_1775_WITH_MARKER.replace(
      "EXECUTE 'GRANT SELECT ON TABLE public.v_governed_pick_performance TO service_role';",
      "EXECUTE 'GRANT SELECT ON TABLE public.v_governed_pick_performance TO service_role' || '; DROP TABLE public.victim';",
    ),
  ],
  [
    'EXECUTE operand continued by an adjacent literal',
    PR_1775_WITH_MARKER.replace(
      "EXECUTE 'GRANT SELECT ON TABLE public.v_governed_pick_performance TO service_role';",
      "EXECUTE 'GRANT SELECT ON TABLE public.v_governed_pick_performance TO service_role'\n'; DROP TABLE public.victim';",
    ),
  ],
  [
    'non-ASCII whitespace in executable SQL',
    PR_1775_WITH_MARKER.replace('ALTER VIEW', 'ALTER\u00a0VIEW'),
  ],
  [
    'carriage return ending a top-level comment',
    PR_1775_WITH_MARKER.replace(
      'COMMIT;',
      '-- x\rDROP TABLE public.victim;\nCOMMIT;',
    ),
  ],
  [
    'carriage return ending a comment inside the DO body',
    PR_1775_WITH_MARKER.replace(
      '  -- Fail-closed end-state check for every role that exists.',
      "  -- x\r EXECUTE 'DROP TABLE public.victim';",
    ),
  ],
  [
    'extra role in the FOREACH array',
    PR_1775_WITH_MARKER.replace(
      "ARRAY['anon', 'authenticated', 'service_role'] LOOP",
      "ARRAY['anon', 'authenticated', 'service_role', 'postgres'] LOOP",
    ),
  ],
  [
    'role_name reassigned inside the DO block',
    PR_1775_WITH_MARKER.replace(
      'IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN\n      EXECUTE format(',
      "IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN\n      role_name := 'attacker';\n      EXECUTE format(",
    ),
  ],
  [
    'top-level GRANT to PUBLIC',
    PR_1775_WITH_MARKER.replace(
      'COMMIT;',
      'GRANT SELECT ON TABLE public.v_governed_pick_performance TO PUBLIC;\nCOMMIT;',
    ),
  ],
  [
    'unknown DO content',
    `${marker()}\nALTER VIEW public.test_privilege_view SET (security_invoker = true);\nDO $$ BEGIN PERFORM pg_sleep(1); END $$;`,
  ],
] as const) {
  test(`classifier fails closed for ${name}`, () => {
    assert.notEqual(classifyPrivilegeOnlyViewMigration(sql).kind, 'valid');
  });
}

test('a migration without the anchored marker remains on the ordinary drill path', () => {
  assert.deepEqual(
    classifyPrivilegeOnlyViewMigration('CREATE TABLE public.x(id integer);'),
    {
      kind: 'ordinary',
      errors: [],
    },
  );
});

const adminDsn = process.env['PRIVILEGE_ONLY_VIEW_TEST_ADMIN_URL'];

function fixture(
  up: string,
  down = validDown,
  target: 'view' | 'table' | 'missing' = 'view',
): ReturnType<typeof runPrivilegeOnlyViewDrill> {
  assert.ok(adminDsn, 'explicit scratch admin URL required');
  const admin = new URL(adminDsn);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(admin.hostname));
  assert.equal(admin.pathname, '/postgres');
  assert.equal(admin.search, '');
  const database = `privilege_only_view_drill_${randomUUID().replaceAll('-', '')}`;
  const sql = (value: string) =>
    execFileSync('psql', [adminDsn, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
      input: value,
      encoding: 'utf8',
      timeout: 30_000,
    });
  const root = mkdtempSync(
    path.join(os.tmpdir(), 'privilege-only-view-proof-'),
  );
  const dsn = new URL(adminDsn);
  dsn.pathname = `/${database}`;
  sql(`CREATE DATABASE ${database};`);
  try {
    mkdirSync(path.join(root, 'supabase/migrations'), { recursive: true });
    mkdirSync(path.join(root, 'db/migrations-rollback'), { recursive: true });
    const migrationPath = path.join(
      root,
      'supabase/migrations/20000101000000_fixture.sql',
    );
    const downPath = path.join(
      root,
      'db/migrations-rollback/20000101000000_fixture.down.sql',
    );
    writeFileSync(migrationPath, up);
    writeFileSync(downPath, down);
    if (target === 'view')
      execFileSync('psql', [dsn.href, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
        input:
          'CREATE VIEW public.test_privilege_view AS SELECT 1::integer AS value;',
        encoding: 'utf8',
      });
    else if (target === 'table')
      execFileSync('psql', [dsn.href, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
        input: 'CREATE TABLE public.test_privilege_view(value integer);',
        encoding: 'utf8',
      });
    return runPrivilegeOnlyViewDrill(dsn.href, migrationPath, downPath);
  } finally {
    sql(`DROP DATABASE ${database} WITH (FORCE);`);
    rmSync(root, { recursive: true, force: true });
  }
}

function assertFailed(
  cases: ReturnType<typeof runPrivilegeOnlyViewDrill>,
  pattern: RegExp,
): void {
  const failures = cases.filter((item) => item.status === 'fail');
  assert.ok(failures.length > 0, 'fixture unexpectedly passed');
  assert.match(
    failures.map((item) => `${item.name}: ${item.detail}`).join('\n'),
    pattern,
  );
}

test(
  'real Postgres proves positive state, exact rollback, and reapply parity',
  { skip: !adminDsn },
  () => {
    const cases = fixture(validUp());
    assert.equal(cases.filter((item) => item.status === 'fail').length, 0);
    assert.ok(cases.some((item) => item.name === 'declared post-state'));
    assert.ok(cases.some((item) => item.name === 'rollback exact restoration'));
    assert.ok(cases.some((item) => item.name === 'up/down/up parity'));
  },
);

test(
  'real Postgres rejects an omitted anon revocation',
  { skip: !adminDsn },
  () => {
    assertFailed(
      fixture(
        validUp().replace(
          'REVOKE ALL PRIVILEGES ON TABLE public.test_privilege_view FROM anon;',
          '',
        ),
      ),
      /anon .* expected denied/,
    );
  },
);

test(
  'real Postgres rejects anon SELECT left behind',
  { skip: !adminDsn },
  () => {
    assertFailed(
      fixture(
        validUp().replace(
          'COMMIT;',
          'GRANT SELECT ON TABLE public.test_privilege_view TO anon;\nCOMMIT;',
        ),
      ),
      /anon SELECT expected denied/,
    );
  },
);

test(
  'real Postgres rejects wrong security_invoker',
  { skip: !adminDsn },
  () => {
    assertFailed(
      fixture(
        validUp().replace(
          'security_invoker = true',
          'security_invoker = false',
        ),
      ),
      /security_invoker expected true/,
    );
  },
);

test(
  'real Postgres rejects a down script that does not restore',
  { skip: !adminDsn },
  () => {
    assertFailed(
      fixture(
        validUp(),
        validDown.replace(
          'GRANT ALL PRIVILEGES ON TABLE public.test_privilege_view TO anon, authenticated, service_role;',
          'GRANT ALL PRIVILEGES ON TABLE public.test_privilege_view TO authenticated, service_role;',
        ),
      ),
      /did not restore/,
    );
  },
);

test('real Postgres rejects an unresolved target', { skip: !adminDsn }, () => {
  assertFailed(fixture(validUp(), validDown, 'missing'), /unresolved/);
});

test('real Postgres rejects a non-view target', { skip: !adminDsn }, () => {
  assertFailed(fixture(validUp(), validDown, 'table'), /relkind r/);
});

test('workflow routes the classifier before legacy marker greps and runs adversarial tests', () => {
  const workflow = readFileSync(
    new URL(
      '../../.github/workflows/migration-reversibility-gate.yml',
      import.meta.url,
    ),
    'utf8',
  );
  const classifier = workflow.indexOf(
    'privilege-only-view-drill.ts "$MIGRATION" --classify',
  );
  const legacyGreps = workflow.indexOf('HAS_GUARD=0');
  assert.ok(classifier > 0 && classifier < legacyGreps);
  assert.ok(workflow.includes('PRIVILEGE_ONLY_VIEW_TEST_ADMIN_URL'));
  assert.ok(
    workflow.includes("grep -oiE '(utv2|uni|work)-[0-9]+'"),
    'proof binding must recognize the canonical WORK lane identity without weakening issue matching',
  );
  assert.ok(
    workflow.includes(
      'tsx --test scripts/ci/privilege-only-view-drill.test.ts',
    ),
  );
  assert.ok(workflow.includes('privilege-only-view-drill.ts "$MIGRATION"'));
});
