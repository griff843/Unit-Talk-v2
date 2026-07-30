import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertIsolatedWritableDatabaseTarget,
  assertProductionReadOnlyDatabaseTarget,
  CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF,
  evaluateDatabaseIdentity,
} from '../../packages/db/src/production-identity-guard.js';
import { createDatabaseConnectionConfig } from '../../packages/db/src/client.js';
import {
  type DatabaseWriterInventory,
  evaluateGuardReachability,
  validateDatabaseWriterInventory,
} from './db-writer-inventory.js';
import {
  assertDbSmokePreflight,
  detectDbSmokeSkipped,
  evaluateDbSmokeResult,
  hasSupabaseSmokeCredentials,
  isDbSmokeRequired,
  parseEnvText,
} from './required-db-smoke.js';

const ISOLATED_REF = 'abcdefghijklmnopqrst';
const ISOLATED_URL = `https://${ISOLATED_REF}.supabase.co`;

test('parseEnvText reads simple key-value env files', () => {
  assert.deepEqual(
    parseEnvText('SUPABASE_URL=https://example.test\n# ignored\nEMPTY=\n'),
    {
      SUPABASE_URL: 'https://example.test',
      EMPTY: '',
    },
  );
});

test('hasSupabaseSmokeCredentials requires all smoke keys', () => {
  assert.equal(
    hasSupabaseSmokeCredentials({
      SUPABASE_URL: 'https://example.test',
      SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
    }),
    true,
  );
  assert.equal(
    hasSupabaseSmokeCredentials({
      SUPABASE_URL: 'https://example.test',
      SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: '',
    }),
    false,
  );
});

test('isDbSmokeRequired trips for protected refs and explicit CI flag', () => {
  assert.equal(isDbSmokeRequired({ CI_REQUIRE_DB_SMOKE: 'true' }), true);
  assert.equal(isDbSmokeRequired({ GITHUB_REF_PROTECTED: 'true' }), true);
  assert.equal(isDbSmokeRequired({ GITHUB_REF: 'refs/heads/main' }), true);
  assert.equal(isDbSmokeRequired({ GITHUB_REF: 'refs/pull/10/merge' }), false);
});

test('assertDbSmokePreflight rejects production supplied as CI credentials', () => {
  assert.throws(
    () =>
      assertDbSmokePreflight({
        CI_REQUIRE_DB_SMOKE: 'true',
        CI_SUPABASE_PROJECT_REF: ISOLATED_REF,
        SUPABASE_URL: 'https://zfzdnfwdarxucxtaojxm.supabase.co',
        SUPABASE_ANON_KEY: 'anon',
        SUPABASE_SERVICE_ROLE_KEY: 'service',
        UNIT_TALK_DB_ACCESS_MODE: 'writable-isolated',
      }),
    /canonical production/,
  );
});

test('assertDbSmokePreflight rejects credentials when isolation classification is missing', () => {
  assert.throws(
    () =>
      assertDbSmokePreflight({
        CI_REQUIRE_DB_SMOKE: 'true',
        CI_SUPABASE_PROJECT_REF: ISOLATED_REF,
        SUPABASE_URL: ISOLATED_URL,
        SUPABASE_ANON_KEY: 'anon',
        SUPABASE_SERVICE_ROLE_KEY: 'service',
      }),
    /UNIT_TALK_DB_ACCESS_MODE=writable-isolated/,
  );
});

test('assertDbSmokePreflight accepts isolated credentials with matching identity', () => {
  const result = assertDbSmokePreflight({
    CI_REQUIRE_DB_SMOKE: 'true',
    CI_SUPABASE_PROJECT_REF: ISOLATED_REF,
    SUPABASE_URL: ISOLATED_URL,
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    UNIT_TALK_DB_ACCESS_MODE: 'writable-isolated',
  });

  assert.equal(result.required, true);
  assert.equal(result.hasCredentials, true);
  assert.equal(result.identity?.canonicalProduction, false);
});

test('assertDbSmokePreflight allows an optional credentialless local skip', () => {
  assert.deepEqual(assertDbSmokePreflight({}), {
    required: false,
    hasCredentials: false,
    identity: null,
  });
});

test('detectDbSmokeSkipped recognizes node test skip summaries and smoke skip reason', () => {
  assert.equal(detectDbSmokeSkipped('info skipped 1'), true);
  assert.equal(
    detectDbSmokeSkipped(
      'SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY not configured',
    ),
    true,
  );
  assert.equal(detectDbSmokeSkipped('info skipped 0\ninfo pass 5'), false);
});

test('evaluateDbSmokeResult fails required smoke when credentials are missing', () => {
  assert.deepEqual(
    evaluateDbSmokeResult({
      required: true,
      hasCredentials: false,
      exitCode: 0,
      output: '',
    }),
    {
      ok: false,
      status: 'failed',
      skipped: true,
      reason: 'DB smoke is required but Supabase smoke credentials are missing',
    },
  );
});

test('evaluateDbSmokeResult fails required smoke when the test run skipped', () => {
  assert.deepEqual(
    evaluateDbSmokeResult({
      required: true,
      hasCredentials: true,
      exitCode: 0,
      output: 'info skipped 1',
    }),
    {
      ok: false,
      status: 'failed',
      skipped: true,
      reason:
        'DB smoke is required but the test run reported skipped smoke tests',
    },
  );
});

test('evaluateDbSmokeResult allows optional smoke to skip while reporting skipped status', () => {
  assert.deepEqual(
    evaluateDbSmokeResult({
      required: false,
      hasCredentials: false,
      exitCode: 0,
      output: 'info skipped 1',
    }),
    {
      ok: true,
      status: 'skipped',
      skipped: true,
      reason: 'DB smoke skipped because credentials are optional for this ref',
    },
  );
});

test('evaluateDbSmokeResult passes required smoke when credentials exist and tests run', () => {
  assert.deepEqual(
    evaluateDbSmokeResult({
      required: true,
      hasCredentials: true,
      exitCode: 0,
      output: 'info skipped 0\ninfo pass 5',
    }),
    {
      ok: true,
      status: 'passed',
      skipped: false,
      reason: 'DB smoke passed',
    },
  );
});

test('detects canonical production from the actual URL under a misleading variable name', () => {
  const evaluation = evaluateDatabaseIdentity({
    accessMode: 'writable-isolated',
    declaredProjectRef: ISOLATED_REF,
    supabaseUrl: `https://${CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`,
  });

  assert.equal(evaluation.canonicalProduction, true);
  assert.throws(
    () =>
      assertIsolatedWritableDatabaseTarget({
        accessMode: 'writable-isolated',
        declaredProjectRef: ISOLATED_REF,
        supabaseUrl: `https://${CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`,
      }),
    /Refusing writable DB execution against canonical production/,
  );
});

test('detects production identity inside a pooled Postgres URL', () => {
  assert.throws(
    () =>
      assertIsolatedWritableDatabaseTarget({
        accessMode: 'writable-isolated',
        databaseUrl:
          `postgresql://postgres.${CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF}:secret@` +
          'aws-0-us-east-1.pooler.supabase.com:6543/postgres',
        declaredProjectRef: ISOLATED_REF,
      }),
    /canonical production/,
  );
});

test('fails closed when writable isolation configuration is missing', () => {
  assert.throws(
    () =>
      assertIsolatedWritableDatabaseTarget({
        declaredProjectRef: ISOLATED_REF,
        supabaseUrl: ISOLATED_URL,
      }),
    /UNIT_TALK_DB_ACCESS_MODE=writable-isolated/,
  );
  assert.throws(
    () =>
      assertIsolatedWritableDatabaseTarget({
        accessMode: 'writable-isolated',
        supabaseUrl: ISOLATED_URL,
      }),
    /CI_SUPABASE_PROJECT_REF/,
  );
});

test('rejects a declared project ref that does not match the target URL', () => {
  assert.throws(
    () =>
      assertIsolatedWritableDatabaseTarget({
        accessMode: 'writable-isolated',
        declaredProjectRef: 'zyxwvutsrqponmlkjihg',
        supabaseUrl: ISOLATED_URL,
      }),
    /identity mismatch/,
  );
});

test('accepts an explicitly classified non-production Supabase target', () => {
  const evaluation = assertIsolatedWritableDatabaseTarget({
    accessMode: 'writable-isolated',
    declaredProjectRef: ISOLATED_REF,
    supabaseUrl: ISOLATED_URL,
  });

  assert.equal(evaluation.canonicalProduction, false);
  assert.deepEqual(evaluation.observedProjectRefs, [ISOLATED_REF]);
});

test('production read-only mode requires the canonical target and explicit classification', () => {
  const productionUrl = `https://${CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`;

  assert.throws(
    () =>
      assertProductionReadOnlyDatabaseTarget({
        accessMode: 'writable-isolated',
        supabaseUrl: productionUrl,
      }),
    /production-read-only/,
  );
  assert.throws(
    () =>
      assertProductionReadOnlyDatabaseTarget({
        accessMode: 'production-read-only',
        supabaseUrl: ISOLATED_URL,
      }),
    /canonical production target/,
  );

  assert.equal(
    assertProductionReadOnlyDatabaseTarget({
      accessMode: 'production-read-only',
      supabaseUrl: productionUrl,
    }).canonicalProduction,
    true,
  );
});

test('checked-in DB writer inventory is complete and internally consistent', () => {
  const result = validateDatabaseWriterInventory();
  assert.deepEqual(result.errors, []);
  assert.ok(result.discoveredCredentialedTests.length > 0);
});

test('a newly added credentialed DB test fails closed when unclassified', () => {
  withFixtureRepo(({ root, inventory }) => {
    writeFixtureFile(
      root,
      'apps/api/src/new-live-writer.test.ts',
      "const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];\nvoid key;\n",
    );

    const result = validateDatabaseWriterInventory(root, inventory);
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.includes(
        'unclassified credentialed DB test: apps/api/src/new-live-writer.test.ts',
      ),
    );
  });
});

test('production-read-only classification rejects mutation syntax', () => {
  withFixtureRepo(({ root, inventory }) => {
    writeFixtureFile(
      root,
      'scripts/read-only-proof.ts',
      "await client.from('picks').insert({ id: 'fixture' });\n",
    );
    inventory.production_read_only_entrypoints.push({
      execution: ['workflow -> scripts/read-only-proof.ts'],
      owner: 'ops',
      path: 'scripts/read-only-proof.ts',
    });

    const result = validateDatabaseWriterInventory(root, inventory);
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((error) =>
        error.includes(
          'production-read-only entrypoint contains mutation signal',
        ),
      ),
    );
  });
});

test('writable workflow fails if production credentials are accidentally wired', () => {
  withFixtureRepo(({ root, inventory }) => {
    const workflowPath = '.github/workflows/isolated.yml';
    writeFixtureFile(
      root,
      workflowPath,
      [
        'on:',
        '  pull_request:',
        'jobs:',
        '  test:',
        '    env:',
        '      UNIT_TALK_DB_ACCESS_MODE: writable-isolated',
        '      SUPABASE_URL: ${{ secrets.SUPABASE_URL }}',
        '      SUPABASE_ANON_KEY: ${{ secrets.CI_SUPABASE_ANON_KEY }}',
        '      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.CI_SUPABASE_SERVICE_ROLE_KEY }}',
      ].join('\n'),
    );
    inventory.workflows.push({
      mode: 'writable-isolated',
      packageScripts: ['test:db'],
      path: workflowPath,
    });

    const result = validateDatabaseWriterInventory(root, inventory);
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((error) =>
        error.includes('references production credential secrets.SUPABASE_URL'),
      ),
    );
  });
});

test('removing the guard from the concurrent-claim canary fails inventory validation', () => {
  withFixtureRepo(({ root, inventory }) => {
    writeFixtureFile(
      root,
      'apps/worker/src/t1-proof-utv2-1497-outbox-concurrent-claim.test.ts',
      '// guard accidentally removed\n',
    );

    const result = validateDatabaseWriterInventory(root, inventory);
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.includes(
        'UTV2-1497 canary no longer invokes the production identity guard',
      ),
    );
  });
});

function withFixtureRepo(
  run: (fixture: { inventory: DatabaseWriterInventory; root: string }) => void,
): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-db-inventory-'));
  try {
    writeFixtureFile(
      root,
      'package.json',
      JSON.stringify({
        scripts: {
          'test:db': 'tsx --test apps/api/src/existing.test.ts',
          'test:t1-proof:live': 'tsx --test apps/api/src/existing.test.ts',
        },
      }),
    );
    writeFixtureFile(
      root,
      'apps/api/src/existing.test.ts',
      "const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];\nvoid key;\n",
    );
    writeFixtureFile(
      root,
      'scripts/ci/required-db-smoke.ts',
      'assertIsolatedWritableDatabaseTarget(input);\n',
    );
    writeFixtureFile(
      root,
      'apps/worker/src/t1-proof-utv2-1497-outbox-concurrent-claim.test.ts',
      "const guard = 'production-identity-guard.ts --assert-isolated-writable';\n",
    );
    const inventory: DatabaseWriterInventory = {
      schema_version: 1,
      canonical_production_project_ref: 'zfzdnfwdarxucxtaojxm',
      credentialed_tests: [
        {
          execution: ['test:db', 'test:t1-proof:live'],
          owner: 'api',
          path: 'apps/api/src/existing.test.ts',
        },
      ],
      production_read_only_entrypoints: [],
      workflows: [],
    };
    run({ inventory, root });
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
}

function writeFixtureFile(
  root: string,
  relativePath: string,
  source: string,
): void {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, source, 'utf8');
}

// ---------------------------------------------------------------------------
// UTV2-1627 — regression tests for the exact-head adversarial review.
// Each test below corresponds to a finding or to a mutation that previously
// survived (i.e. the behavior was correct but unprotected).
// ---------------------------------------------------------------------------

// Surviving mutation M4: deleting the "requires an actual database target URL"
// throw left all tests green.
test('M4: writable-isolated rejects a config with no database target URL at all', () => {
  assert.throws(
    () =>
      assertIsolatedWritableDatabaseTarget({
        accessMode: 'writable-isolated',
        declaredProjectRef: ISOLATED_REF,
      }),
    /requires an actual database target URL/,
  );
});

// Surviving mutation M7: replacing `value.toLowerCase().includes(...)` with a
// case-sensitive `includes` left all tests green. Hostnames are
// case-insensitive, so an uppercased production host is a real production URL.
test('M7: canonical production is detected case-insensitively in the host', () => {
  const upper = `https://${CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF.toUpperCase()}.supabase.co`;

  assert.equal(
    evaluateDatabaseIdentity({ supabaseUrl: upper }).canonicalProduction,
    true,
  );
  assert.throws(
    () =>
      assertIsolatedWritableDatabaseTarget({
        accessMode: 'writable-isolated',
        declaredProjectRef: ISOLATED_REF,
        supabaseUrl: upper,
      }),
    /canonical production/,
  );
});

// P1-9: a Supabase custom domain carries no project ref, so the old
// declared-vs-observed check was skipped and the target was ALLOWED even though
// it may front production.
test('P1-9: rejects a custom-domain target whose identity cannot be determined', () => {
  assert.throws(
    () =>
      assertIsolatedWritableDatabaseTarget({
        accessMode: 'writable-isolated',
        declaredProjectRef: ISOLATED_REF,
        supabaseUrl: 'https://db.unit-talk.com',
      }),
    /Cannot positively identify/,
  );
});

// P1-9: a loopback URL may be an SSH tunnel forwarding to production.
test('P1-9: rejects a bare loopback target without the explicit local opt-in', () => {
  assert.throws(
    () =>
      assertIsolatedWritableDatabaseTarget({
        accessMode: 'writable-isolated',
        declaredProjectRef: ISOLATED_REF,
        supabaseUrl: 'http://127.0.0.1:54321',
      }),
    /Cannot positively identify/,
  );
});

test('P1-9: allows loopback only when explicitly opted in', () => {
  const evaluation = assertIsolatedWritableDatabaseTarget({
    accessMode: 'writable-isolated',
    declaredProjectRef: ISOLATED_REF,
    supabaseUrl: 'http://127.0.0.1:54321',
    allowLocalSupabase: true,
  });
  assert.equal(evaluation.canonicalProduction, false);
});

test('P1-9: the local opt-in does not extend to a remote host', () => {
  assert.throws(
    () =>
      assertIsolatedWritableDatabaseTarget({
        accessMode: 'writable-isolated',
        declaredProjectRef: ISOLATED_REF,
        supabaseUrl: 'https://db.unit-talk.com',
        allowLocalSupabase: true,
      }),
    /Cannot positively identify/,
  );
});

// P1-9: `CI_SUPABASE_PROJECT_REF=x` was normalized but never validated, so it
// satisfied the "declared" requirement and then vacuously "matched".
test('P1-9: rejects a malformed declared project ref', () => {
  assert.throws(
    () =>
      assertIsolatedWritableDatabaseTarget({
        accessMode: 'writable-isolated',
        declaredProjectRef: 'x',
        supabaseUrl: 'https://db.unit-talk.com',
      }),
    /well-formed 20-character Supabase project ref/,
  );
});

// ---------------------------------------------------------------------------
// P1-4 — the durable boundary. Before UTV2-1627 the guard was invoked by
// exactly 1 of 49 credentialed tests, so a test process holding production
// credentials could construct a service-role client and write. These tests
// assert the boundary itself, which every service-role client passes through.
// ---------------------------------------------------------------------------

const PRODUCTION_APP_ENV = {
  SUPABASE_URL: `https://${CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`,
  SUPABASE_ANON_KEY: 'anon-key-fixture',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-fixture',
} as unknown as Parameters<typeof createDatabaseConnectionConfig>[0]['env'];

const ISOLATED_APP_ENV = {
  SUPABASE_URL: ISOLATED_URL,
  SUPABASE_ANON_KEY: 'anon-key-fixture',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-fixture',
} as unknown as Parameters<typeof createDatabaseConnectionConfig>[0]['env'];

test('P1-4: a test runner cannot construct a service-role client against production', () => {
  const previous = process.env['UNIT_TALK_DB_ACCESS_MODE'];
  delete process.env['UNIT_TALK_DB_ACCESS_MODE'];
  try {
    assert.throws(
      () =>
        createDatabaseConnectionConfig({
          env: PRODUCTION_APP_ENV,
          useServiceRole: true,
        }),
      /Refusing to construct a service-role client against canonical production/,
    );
  } finally {
    if (previous !== undefined) process.env['UNIT_TALK_DB_ACCESS_MODE'] = previous;
  }
});

test('P1-4: an anon client against production is still permitted', () => {
  const config = createDatabaseConnectionConfig({
    env: PRODUCTION_APP_ENV,
    useServiceRole: false,
  });
  assert.equal(config.role, 'anon');
});

test('P1-4: a service-role client against an isolated project is permitted', () => {
  const config = createDatabaseConnectionConfig({
    env: ISOLATED_APP_ENV,
    useServiceRole: true,
  });
  assert.equal(config.role, 'service_role');
  assert.equal(config.url, ISOLATED_URL);
});

test('P1-4: production-read-only intent permits a production service-role client', () => {
  const previous = process.env['UNIT_TALK_DB_ACCESS_MODE'];
  process.env['UNIT_TALK_DB_ACCESS_MODE'] = 'production-read-only';
  try {
    const config = createDatabaseConnectionConfig({
      env: PRODUCTION_APP_ENV,
      useServiceRole: true,
    });
    assert.equal(config.role, 'service_role');
  } finally {
    if (previous === undefined) delete process.env['UNIT_TALK_DB_ACCESS_MODE'];
    else process.env['UNIT_TALK_DB_ACCESS_MODE'] = previous;
  }
});

// ---------------------------------------------------------------------------
// P0-2 — the inventory gate must assert guard EXECUTION, not string presence.
// The real ci.yml pattern below kept this gate green while the guard never ran.
// ---------------------------------------------------------------------------

test('P0-2: rejects the real ci.yml dead-branch pattern that shipped', () => {
  const deadBranch = [
    '      - name: Live DB proof (classified)',
    '        run: |',
    '          if [ -n "$SUPABASE_SERVICE_ROLE_KEY" ]; then',
    '            pnpm exec tsx packages/db/src/production-identity-guard.ts --assert-isolated-writable',
    '          fi',
    '          pnpm verify:live-db-verdict',
  ].join('\n');

  const result = evaluateGuardReachability(deadBranch);
  assert.equal(result.ok, false);
  assert.match(result.reason, /nested inside a shell conditional/);
  assert.match(result.reason, /unconditionally/);
});

test('P0-2: rejects a guard that appears only in a comment', () => {
  const commentOnly = [
    '        run: |',
    '          # pnpm exec tsx guard.ts --assert-isolated-writable',
    '          pnpm test:db',
  ].join('\n');

  const result = evaluateGuardReachability(commentOnly);
  assert.equal(result.ok, false);
  assert.match(result.reason, /no uncommented guard invocation/);
});

test('P0-2: rejects a guard that runs after a mutating command', () => {
  const afterMutation = [
    '        run: supabase db push --db-url "$POSTGRES_URL"',
    '        run: pnpm exec tsx guard.ts --assert-isolated-writable',
  ].join('\n');

  const result = evaluateGuardReachability(afterMutation);
  assert.equal(result.ok, false);
  assert.match(result.reason, /after a mutating command/);
});

test('P0-2: accepts an unconditional guard that precedes every mutation', () => {
  const correct = [
    '        run: |',
    '          set -euo pipefail',
    '          pnpm exec tsx packages/db/src/production-identity-guard.ts --assert-isolated-writable',
    '          pnpm verify:live-db-verdict',
  ].join('\n');

  assert.equal(evaluateGuardReachability(correct).ok, true);
});
