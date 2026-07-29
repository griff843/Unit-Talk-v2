import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  type DatabaseWriterInventory,
  validateDatabaseWriterInventory,
} from './db-writer-inventory.js';

test('checked-in DB writer inventory is complete and internally consistent', () => {
  const result = validateDatabaseWriterInventory();
  assert.deepEqual(result.errors, []);
  assert.ok(result.discoveredCredentialedTests.length > 0);
});

test('a newly added credentialed DB test fails closed when unclassified', () => {
  withFixtureRepo(({ root, inventory }) => {
    writeFile(
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
    writeFile(
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
    writeFile(
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

test('removing the guard from the UTV2-1497 canary fails inventory validation', () => {
  withFixtureRepo(({ root, inventory }) => {
    writeFile(
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
    writeFile(
      root,
      'package.json',
      JSON.stringify({
        scripts: {
          'test:db': 'tsx --test apps/api/src/existing.test.ts',
          'test:t1-proof:live': 'tsx --test apps/api/src/existing.test.ts',
        },
      }),
    );
    writeFile(
      root,
      'apps/api/src/existing.test.ts',
      "const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];\nvoid key;\n",
    );
    writeFile(
      root,
      'scripts/ci/required-db-smoke.ts',
      'assertIsolatedWritableDatabaseTarget(input);\n',
    );
    writeFile(
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

function writeFile(root: string, relativePath: string, source: string): void {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, source, 'utf8');
}
