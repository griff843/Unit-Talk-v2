/** Staging-ci only: full population reads and run-owned microsecond fixtures. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { loadEnvironment } from '@unit-talk/config';
import {
  createDatabaseRepositoryBundle,
  createDatabaseClientFromConnection,
  createServiceRoleDatabaseConnectionConfig,
  orderedPageFilter,
  readAllOrderedPages,
} from '@unit-talk/db';
import { processSubmission } from './submission-service.js';

const fixtureRun = process.env['CI_FIXTURE_RUN_ID'];
const skip = !fixtureRun ? 'requires staging-ci CI_SUPABASE_* credentials and CI_FIXTURE_RUN_ID; writable proof deferred locally' : false;

test('WORK0307 staging: complete readers and duplicate timestamp boundary mutations', { skip, timeout: 300_000 }, async t => {
  const environment = loadEnvironment();
  const url = environment.SUPABASE_URL ?? '';
  const key = environment.SUPABASE_SERVICE_ROLE_KEY ?? '';
  assert.equal(process.env['CI'], 'true');
  assert.equal(new URL(url).protocol, 'https:');
  assert.equal(new URL(url).hostname, 'xskgrzbteyqdufktjrjx.supabase.co');
  assert.ok(key);
  const client = createDatabaseClientFromConnection(createServiceRoleDatabaseConnectionConfig(environment));
  const repositories = createDatabaseRepositoryBundle(createServiceRoleDatabaseConnectionConfig(environment));
  const namespace = `work0307-${fixtureRun}-${randomUUID()}`;

  for (const [label, states, trackOnly] of [
    ['settled-voided', ['settled', 'voided'], false],
    ['track-only-validated', ['validated'], true],
    ['validated', ['validated'], false],
  ] as const) {
    let countQuery = client.from('picks').select('id', { count: 'exact', head: true }).in('status', [...states]);
    if (trackOnly) countQuery = countQuery.eq('metadata->>distributionMode', 'track-only');
    const before = await countQuery;
    assert.equal(before.error, null);
    const started = performance.now();
    // A statement timeout on any constituent query is an error and fails here.
    assert.equal(typeof repositories.picks.listTrackOnlyByLifecycleState, 'function');
    const result = trackOnly
      ? await repositories.picks.listTrackOnlyByLifecycleState!('validated')
      : await repositories.picks.listByLifecycleStates([...states]);
    const elapsedMs = performance.now() - started;
    const after = await countQuery;
    assert.equal(after.error, null);
    assert.equal(before.count, after.count, `${label}: external population drift; rerun proof`);
    assert.equal(result.length, after.count);
    assert.equal(new Set(result.map(row => row.id)).size, result.length);
    t.diagnostic(JSON.stringify({ label, exactCount: after.count, rows: result.length, elapsedMs, statementTimeoutMs: 8000 }));
  }

  // Submit through the canonical pipeline; only the run-owned fixture timestamps
  // are adjusted, never lifecycle state, audit history, or existing populations.
  const ids: string[] = [];
  for (let index = 0; index < 5; index++) {
    const result = await processSubmission({
      source: 'api', market: 'moneyline', selection: `${namespace}-${index}`,
      eventName: `${namespace} fixture`, odds: -110, stakeUnits: 1,
      metadata: { distributionMode: 'track-only', proof_issue: 'WORK-2026110307', proof_run: namespace },
    }, repositories);
    assert.equal(result.duplicate, false);
    ids.push(result.pick.id);
  }
  const timestamp = '2026-11-03T12:34:56.123456+00:00';
  const updated = await client.from('picks').update({ created_at: timestamp }).in('id', ids).select('id');
  assert.equal(updated.error, null);
  assert.equal(updated.data?.length, ids.length);
  const oracle = await client.from('picks').select('id,created_at').in('id', ids)
    .order('created_at', { ascending: true }).order('id', { ascending: true });
  assert.equal(oracle.error, null);
  assert.equal(oracle.data?.length, 5);
  assert.ok(oracle.data!.every((row: { created_at: string }) => row.created_at.includes('.123456')));

  async function boundary(mutation?: 'date' | 'no-id') {
    let calls = 0;
    const result = await readAllOrderedPages<{ id: string; created_at: string }>(async (_from, _to, cursor) => {
      assert.ok(++calls <= 4, 'non-progressing cursor (precision mutation)');
      let query = client.from('picks').select('id,created_at').in('id', ids)
        .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(2);
      if (cursor) {
        const filter = mutation === 'no-id'
          ? `created_at.gt.${cursor.created_at}`
          : orderedPageFilter(mutation === 'date'
            ? { ...cursor, created_at: new Date(cursor.created_at).toISOString() } : cursor);
        query = query.or(filter);
      }
      return query;
    }, 2);
    assert.deepEqual(result, oracle.data);
  }
  await boundary();
  await assert.rejects(boundary('no-id'), /Expected values/);
  await assert.rejects(boundary('date'), /non-progressing cursor/);
  t.diagnostic(JSON.stringify({ namespace, fixtureIds: ids, boundaryRows: 5, pageSize: 2, timestamp,
    mutations: { noId: 'rejected', dateReserialization: 'rejected' } }));
});
