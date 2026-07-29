import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertIsolatedWritableDatabaseTarget,
  assertProductionReadOnlyDatabaseTarget,
  CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF,
  evaluateDatabaseIdentity,
} from './production-identity-guard.js';

const ISOLATED_REF = 'abcdefghijklmnopqrst';
const ISOLATED_URL = `https://${ISOLATED_REF}.supabase.co`;

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
