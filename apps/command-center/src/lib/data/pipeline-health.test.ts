import assert from 'node:assert/strict';
import test from 'node:test';

import type { AppEnv } from '../../../../../packages/config/dist/env.js';

import { createDatabaseConnectionConfig } from './client';
import { resolveOptionalAnonConnection } from './pipeline-health';
import { createPipelineLiveConfig, derivePipelineHealthSnapshot } from '../pipeline-health';

/**
 * UTV2-1948 regression coverage.
 *
 * Production deploys Command Center with `SUPABASE_URL` and
 * `SUPABASE_SERVICE_ROLE_KEY` and *no* `SUPABASE_ANON_KEY`. Every read in
 * `getPipelineHealthSnapshot()` succeeded on the service-role client; the
 * subsequent anon resolution threw and destroyed the finished snapshot, so the
 * operator saw "GLOBAL HEALTH unavailable" for data that had been fetched.
 */

/** Exactly the deployed shape: service-role present, anon absent. */
const SERVICE_ROLE_ONLY_ENV = {
  SUPABASE_URL: 'https://zfzdnfwdarxucxtaojxm.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-fixture',
  SUPABASE_ANON_KEY: undefined,
} as unknown as AppEnv;

test('PRECONDITION: an unguarded anon resolve really does throw on a service-role-only env', () => {
  // Without this the guard below would be vacuous -- it would "handle" a
  // failure that never happens. This asserts the fixture reproduces the
  // production failure through the real production code path.
  assert.throws(
    () => createDatabaseConnectionConfig({ env: SERVICE_ROLE_ONLY_ENV, useServiceRole: false }),
    /SUPABASE_URL and SUPABASE_ANON_KEY are required for Supabase anon access/,
  );

  // ...and that the failure is isolated to the *optional* credential: the url
  // and the service-role key the snapshot actually reads with are both present
  // in this fixture, so nothing about the real reads is being simulated away.
  assert.ok(SERVICE_ROLE_ONLY_ENV.SUPABASE_URL);
  assert.ok(SERVICE_ROLE_ONLY_ENV.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(SERVICE_ROLE_ONLY_ENV.SUPABASE_ANON_KEY, undefined);
});

test('resolveOptionalAnonConnection degrades to nulls instead of throwing', () => {
  const resolved = resolveOptionalAnonConnection(() =>
    createDatabaseConnectionConfig({ env: SERVICE_ROLE_ONLY_ENV, useServiceRole: false }),
  );

  assert.deepEqual(resolved, { url: null, key: null });
  assert.equal(createPipelineLiveConfig(resolved.url, resolved.key), null);
});

test('resolveOptionalAnonConnection still returns real credentials when anon is configured', () => {
  const resolved = resolveOptionalAnonConnection(() =>
    createDatabaseConnectionConfig({
      env: {
        ...SERVICE_ROLE_ONLY_ENV,
        SUPABASE_ANON_KEY: 'anon-key-fixture',
      } as unknown as AppEnv,
      useServiceRole: false,
    }),
  );

  assert.deepEqual(resolved, {
    url: 'https://zfzdnfwdarxucxtaojxm.supabase.co',
    key: 'anon-key-fixture',
  });

  const liveConfig = createPipelineLiveConfig(resolved.url, resolved.key);
  assert.equal(liveConfig?.supabaseAnonKey, 'anon-key-fixture');
});

test('a snapshot survives an unavailable anon connection with its real reads intact', () => {
  const resolved = resolveOptionalAnonConnection(() =>
    createDatabaseConnectionConfig({ env: SERVICE_ROLE_ONLY_ENV, useServiceRole: false }),
  );

  const snapshot = derivePipelineHealthSnapshot({
    observedAt: '2026-09-19T20:00:00.000Z',
    submissions: [
      { status: 'materialized', created_at: '2026-09-19T19:30:00.000Z', updated_at: '2026-09-19T19:45:00.000Z' },
    ],
    picks: [
      { status: 'posted', promotion_status: 'qualified', promotion_score: 81, created_at: '2026-09-19T19:00:00.000Z', updated_at: '2026-09-19T19:30:00.000Z' },
    ],
    outbox: [
      { status: 'sent', created_at: '2026-09-19T19:36:00.000Z', updated_at: '2026-09-19T19:36:00.000Z', claimed_at: null },
    ],
    receipts: [{ recorded_at: '2026-09-19T19:55:00.000Z' }],
    runs: [
      { run_type: 'worker.heartbeat', status: 'succeeded', started_at: '2026-09-19T19:59:54.000Z', finished_at: '2026-09-19T19:59:54.000Z' },
    ],
    liveConfig: createPipelineLiveConfig(resolved.url, resolved.key),
  });

  // The degradation costs the live subscription and nothing else: the snapshot
  // is a real reading of the rows, not an "unavailable" placeholder.
  assert.equal(snapshot.liveConfig, null);
  assert.equal(snapshot.stages.length, 5);
  assert.equal(snapshot.errorCount, 0);
  assert.notEqual(snapshot.overallStatus, undefined);
  assert.ok(snapshot.stages.every((stage) => stage.status !== undefined));
});
