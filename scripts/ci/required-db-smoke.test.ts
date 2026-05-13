import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectDbSmokeSkipped,
  evaluateDbSmokeResult,
  hasSupabaseSmokeCredentials,
  isDbSmokeRequired,
  parseEnvText,
} from './required-db-smoke.js';

test('parseEnvText reads simple key-value env files', () => {
  assert.deepEqual(parseEnvText('SUPABASE_URL=https://example.test\n# ignored\nEMPTY=\n'), {
    SUPABASE_URL: 'https://example.test',
    EMPTY: '',
  });
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
      reason: 'DB smoke is required but the test run reported skipped smoke tests',
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
