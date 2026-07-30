/**
 * UTV2-1630 — negative tests for the staging-only writable DB path.
 *
 * These assert the properties that were *false* before this lane, each tied to
 * an observed failure rather than a hypothetical:
 *
 *   - 2026-07-29: 310 fixture rows written to production by lane test runs.
 *   - 2026-07-30: 7 picks + 4 submissions written to production from a pull
 *     request, because `verify:live-db-verdict` -> `test:live-db` -> `test:db`
 *     bypassed the guard that lived only inside `ci:db-smoke`.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertStagingTarget } from './assert-staging-target.js';
import {
  CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF,
  EXPECTED_STAGING_SUPABASE_PROJECT_REF,
} from './isolated-proof-attestation.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readRepo = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const pkg = JSON.parse(readRepo('package.json')) as { scripts: Record<string, string> };

const STAGING_URL = `https://${EXPECTED_STAGING_SUPABASE_PROJECT_REF}.supabase.co`;
const PRODUCTION_URL = `https://${CANONICAL_PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`;

// ---------------------------------------------------------------------------
// A direct production-bound invocation must fail
// ---------------------------------------------------------------------------

test('a production target is refused before any client is constructed', () => {
  const result = assertStagingTarget({ SUPABASE_URL: PRODUCTION_URL });
  assert.equal(result.ok, false);
  assert.match(result.reason, /CANONICAL PRODUCTION/);
});

test('the staging target is accepted', () => {
  const result = assertStagingTarget({ SUPABASE_URL: STAGING_URL });
  assert.equal(result.ok, true);
  assert.equal(result.observedRef, EXPECTED_STAGING_SUPABASE_PROJECT_REF);
});

for (const [label, url] of [
  ['missing environment (no URL)', undefined],
  ['empty URL', ''],
  ['unknown project', 'https://abcdefghijklmnopqrst.supabase.co'],
  ['custom domain', 'https://db.unit-talk.com'],
  ['pooler', 'https://aws-0-us-east-1.pooler.supabase.com:6543'],
  ['tunnel', 'http://127.0.0.1:54321'],
  ['malformed', 'not-a-url'],
] as const) {
  test(`refused: ${label}`, () => {
    assert.equal(assertStagingTarget({ SUPABASE_URL: url as string | undefined }).ok, false);
  });
}

test('the gate CLI exits non-zero for production', () => {
  let status = 0;
  try {
    execFileSync(
      process.execPath,
      ['--import', 'tsx', path.join(REPO_ROOT, 'scripts/ci/assert-staging-target.ts')],
      { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, SUPABASE_URL: PRODUCTION_URL } },
    );
  } catch (error) {
    status = (error as { status?: number }).status ?? 1;
  }
  assert.equal(status, 1, 'assert-staging-target must exit 1 for a production target');
});

// ---------------------------------------------------------------------------
// The bypass must be structurally closed
// ---------------------------------------------------------------------------

test('every writable DB script is gated by ci:assert-staging', () => {
  for (const script of ['test:db', 'test:t1-proof:live']) {
    assert.match(
      pkg.scripts[script] ?? '',
      /^pnpm ci:assert-staging &&/,
      `${script} must begin with the staging gate — it is reachable directly, via ` +
        'test:live-db, and via verify:live-db-verdict',
    );
  }
});

test('test:live-db cannot reach a writable suite except through gated scripts', () => {
  const live = pkg.scripts['test:live-db'] ?? '';
  // It may only compose the two gated scripts.
  const composed = live.split('&&').map((part) => part.trim()).filter(Boolean);
  for (const part of composed) {
    assert.match(
      part,
      /^pnpm (test:db|test:t1-proof:live)$/,
      `test:live-db must compose only gated scripts; found "${part}"`,
    );
  }
});

test('ci:assert-staging is wired as a real script', () => {
  assert.equal(pkg.scripts['ci:assert-staging'], 'tsx scripts/ci/assert-staging-target.ts');
});

// ---------------------------------------------------------------------------
// PR-triggered workflows must not carry production write credentials
// ---------------------------------------------------------------------------

const PRODUCTION_DB_SECRETS = [
  'secrets.SUPABASE_URL',
  'secrets.SUPABASE_ANON_KEY',
  'secrets.SUPABASE_SERVICE_ROLE_KEY',
  'secrets.SUPABASE_DB_URL',
  'secrets.SUPABASE_DB_POOLER_URL',
];

test('ci.yml carries no production database credential', () => {
  const source = readRepo('.github/workflows/ci.yml');
  for (const secret of PRODUCTION_DB_SECRETS) {
    assert.ok(
      !source.includes(secret),
      `ci.yml must not reference ${secret} — it runs on pull_request and previously ` +
        'wrote fixture rows to production through the live-DB path',
    );
  }
});

test('ci.yml binds the staging-ci environment', () => {
  const source = readRepo('.github/workflows/ci.yml');
  assert.match(source, /environment:\s*staging-ci/, 'ci.yml must bind staging-ci');
  for (const name of [
    'secrets.CI_SUPABASE_URL',
    'secrets.CI_SUPABASE_PROJECT_REF',
    'secrets.CI_SUPABASE_PUBLISHABLE_KEY',
    'secrets.CI_SUPABASE_SECRET_KEY',
  ]) {
    assert.ok(source.includes(name), `ci.yml must read ${name}`);
  }
});

test('the staging proof workflow binds staging-ci and no production secret', () => {
  const source = readRepo('.github/workflows/staging-db-proof.yml');
  assert.match(source, /environment:\s*staging-ci/);
  for (const secret of PRODUCTION_DB_SECRETS) {
    assert.ok(!source.includes(secret), `staging-db-proof.yml must not reference ${secret}`);
  }
});

test('the staging proof workflow uses pull_request, not pull_request_target', () => {
  // Strip comments first: prose explaining why pull_request_target is avoided
  // must not read as a usage of it.
  const source = readRepo('.github/workflows/staging-db-proof.yml')
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
  assert.ok(
    !/^\s*pull_request_target:/mu.test(source),
    'pull_request_target would expose secrets to fork PRs',
  );
  assert.match(source, /^\s+pull_request:/mu);
});

test('the proof auditor job depends on the DB job and downloads a same-run artifact', () => {
  const source = readRepo('.github/workflows/staging-db-proof.yml');
  assert.match(source, /needs:\s*staging-db-proof/, 'auditor must depend on the DB job');
  assert.match(
    source,
    /utv2-1630-db-proof-receipt-\$\{\{\s*github\.run_id\s*\}\}-\$\{\{\s*github\.run_attempt\s*\}\}/,
    'artifact name must be scoped to this run and attempt, so a previous run cannot be reused',
  );
  assert.match(source, /if-no-files-found:\s*error/, 'a missing artifact must fail, not skip');
});
