/**
 * WORK-2026092101 — the scheduled archive conveyor.
 *
 * Three properties are asserted, and they are the three that decide whether an
 * unattended daily job is safe to leave running:
 *
 *   idempotency — a second run over the same window does nothing;
 *   retry safety — a run interrupted after the upload leaves no manifest, and
 *     the next attempt produces the same object rather than a half-written one;
 *   observability — staleness is answerable from the bucket alone.
 *
 * `planConveyorRun` is pure and is driven with a fixed `today`, because a
 * scheduler you can only observe by waiting a day is a scheduler nobody checks.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CONVEYOR_EVENT,
  CONVEYOR_HEARTBEAT_KEY,
  type ConveyorPlan,
  type RetentionPolicyEntry,
  planConveyorRun,
  readStaleness,
  runConveyor,
} from './conveyor.js';
import { type DuckConnection, openDuckDb } from './duckdb.js';
import { computeManifestId, parseManifest } from './manifest.js';
import { manifestObjectKey, parseDataObjectKey } from './object-layout.js';
import { LocalObjectStore, type ObjectStore } from './object-store.js';
import { decidePrune } from './verify-archive.js';

const POLICY: RetentionPolicyEntry[] = [
  {
    relation: 'public.provider_offer_history',
    domain: 'markets',
    windowColumn: 'snapshot_at',
    hotRetentionDays: 45,
    sportColumn: 'sport_key',
    sports: ['nfl', 'nba'],
    orderBy: ['snapshot_at', 'id'],
    season: '2026',
  },
];

async function seedFixture(connection: DuckConnection): Promise<void> {
  await connection.run(`
    CREATE TABLE offers AS
    SELECT
      ('00000000-0000-4000-8000-' || lpad(CAST(i AS VARCHAR), 12, '0'))::UUID AS id,
      TIMESTAMPTZ '2026-08-06 00:00:00+00' + INTERVAL (i) MINUTE          AS snapshot_at,
      CASE WHEN i % 2 = 0 THEN 'nfl' ELSE 'nba' END                        AS sport_key,
      'evt-' || CAST(i % 7 AS VARCHAR)                                     AS provider_event_id
    FROM range(0, 1440) tbl(i)
  `);
}

const FIXED_NOW = new Date('2026-09-21T03:00:00.000Z');

interface Harness {
  connection: DuckConnection;
  store: LocalObjectStore;
  workDir: string;
  plan: ConveyorPlan;
  close: () => Promise<void>;
}

async function harness(): Promise<Harness> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-talk-warehouse-conveyor-test-'));
  const connection = await openDuckDb();
  await seedFixture(connection);
  return {
    connection,
    store: new LocalObjectStore(path.join(workDir, 'bucket'), 'unit-talk-archive-test'),
    workDir,
    // today - 45 - 1 = 2026-08-06, which is exactly the fixture's day.
    plan: planConveyorRun({ policy: POLICY, today: '2026-09-21' }),
    close: async () => {
      await connection.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    },
  };
}

function run(h: Harness, overrides: Partial<Parameters<typeof runConveyor>[0]> = {}) {
  return runConveyor({
    plan: h.plan,
    connection: h.connection,
    store: h.store,
    relationExpr: () => 'offers',
    exporterRepoSha: '0'.repeat(40),
    sampleSize: 10,
    now: () => FIXED_NOW,
    log: () => {},
    ...overrides,
  });
}

test('the planned window is the day that just fell out of hot retention', () => {
  const plan = planConveyorRun({ policy: POLICY, today: '2026-09-21' });
  assert.equal(plan.run_date, '2026-09-21');
  assert.equal(plan.items.length, 2, 'one window per sport per source per run');
  for (const item of plan.items) {
    assert.equal(item.date, '2026-08-06', 'today - hotRetentionDays - 1');
    assert.equal(item.source.window.start, '2026-08-06T00:00:00.000Z');
    assert.equal(item.source.window.end, '2026-08-07T00:00:00.000Z', 'exactly one day, half-open');
  }
  assert.deepEqual(
    plan.items.map((item) => item.target.kind === 'canonical' && item.target.sport),
    ['nfl', 'nba'],
  );
});

test('a run never processes more than one day per source, so a backlog stays visible', () => {
  // A conveyor that "catches up" by widening its window turns a backlog into a
  // single unbounded export — the exact failure the bounded reader exists to
  // prevent. Adding history must not change how much one run does.
  const plan = planConveyorRun({ policy: POLICY, today: '2027-01-01' });
  assert.equal(plan.items.length, 2);
  for (const item of plan.items) {
    const start = Date.parse(item.source.window.start);
    const end = Date.parse(item.source.window.end);
    assert.equal(end - start, 86_400_000);
  }
});

test('a backfill names its own day and nothing else moves', () => {
  const plan = planConveyorRun({ policy: POLICY, today: '2026-09-21', windowDate: '2026-06-01' });
  assert.deepEqual([...new Set(plan.items.map((i) => i.date))], ['2026-06-01']);
});

test('a negative or fractional retention is refused rather than planned around', () => {
  for (const hotRetentionDays of [-1, 1.5, Number.NaN]) {
    assert.throws(
      () => planConveyorRun({ policy: [{ ...POLICY[0], hotRetentionDays }], today: '2026-09-21' }),
      /hotRetentionDays/,
    );
  }
});

test('a run archives every planned window and writes the manifest last', async () => {
  const h = await harness();
  try {
    const result = await run(h);
    assert.equal(result.ok, true, JSON.stringify(result.items));
    assert.equal(result.archived, 2);
    assert.equal(result.failed, 0);
    assert.equal(result.alert, null);
    assert.equal(result.event, CONVEYOR_EVENT);

    for (const item of result.items) {
      assert.equal(item.status, 'archived');
      assert.equal(item.prune_eligible, true, 'a verified window is the only prune-eligible kind');
      assert.equal(item.source_row_count, 720);
      assert.equal(item.exported_row_count, 720);
    }

    // Every manifest in the bucket vouches for an object that is in the bucket.
    const manifestKeys = await h.store.list('manifests/');
    const written = manifestKeys.filter((key) => !key.startsWith('manifests/_conveyor/'));
    assert.equal(written.length, 2);
    for (const key of written) {
      const manifest = parseManifest((await h.store.get(key))!.toString('utf8'));
      assert.equal(manifest.verification.passed, true);
      assert.ok(await h.store.head(manifest.object.data_key), 'a manifest with no object is a lie');
      assert.equal(decidePrune(manifest).eligible, true);
    }
  } finally {
    await h.close();
  }
});

test('a second run over the same windows does nothing', async () => {
  const h = await harness();
  try {
    const first = await run(h);
    assert.equal(first.archived, 2);

    const keysAfterFirst = (await h.store.list('')).sort();
    const heads = new Map<string, number>();
    for (const key of keysAfterFirst) {
      heads.set(key, (await h.store.head(key))!.size);
    }

    const second = await run(h);
    assert.equal(second.skipped, 2, 'an already-verified window is re-read, not re-exported');
    assert.equal(second.archived, 0);
    assert.equal(second.failed, 0);

    const keysAfterSecond = (await h.store.list('')).sort();
    assert.deepEqual(
      keysAfterSecond.filter((key) => key !== CONVEYOR_HEARTBEAT_KEY),
      keysAfterFirst.filter((key) => key !== CONVEYOR_HEARTBEAT_KEY),
      'an idempotent run must create no new objects',
    );
    for (const key of keysAfterSecond) {
      if (key === CONVEYOR_HEARTBEAT_KEY) continue;
      assert.equal((await h.store.head(key))!.size, heads.get(key), `${key} was rewritten`);
    }
  } finally {
    await h.close();
  }
});

test('an interruption after upload leaves no manifest, and the retry completes it', async () => {
  const h = await harness();
  try {
    // Kill the run at the moment the data object has been written and nothing
    // has been verified: the window in which a naive conveyor would already
    // have recorded success.
    const failing: ObjectStore = {
      ...h.store,
      bucket: h.store.bucket,
      describe: () => h.store.describe(),
      put: async (key, body, contentType) => {
        if (key.startsWith('manifests/')) {
          throw new Error('interrupted before the manifest was written');
        }
        return h.store.put(key, body, contentType);
      },
      head: (key) => h.store.head(key),
      get: (key) => h.store.get(key),
      list: (prefix) => h.store.list(prefix),
      uriFor: (key) => h.store.uriFor(key),
      baseUri: () => h.store.baseUri(),
    };

    const interrupted = await run(h, { store: failing });
    assert.equal(interrupted.failed, 2, 'the run must report the interruption, not swallow it');
    assert.ok(interrupted.alert);
    assert.equal(interrupted.alert.severity, 'error');
    // The fake store refuses everything under `manifests/`, the heartbeat
    // included. The run must still return its result: observability failing is
    // not a reason to lose the record of what was archived.
    assert.ok(interrupted.heartbeat_error, 'a failed heartbeat is reported, not thrown');

    const orphanManifests = (await h.store.list('manifests/')).filter(
      (key) => !key.startsWith('manifests/_conveyor/'),
    );
    assert.deepEqual(orphanManifests, [], 'an unverified object must have no manifest vouching for it');

    const dataKeys = await h.store.list('canonical/');
    assert.equal(dataKeys.length, 2, 'the uploaded bytes are still there, invisible to the prune gate');

    // Nothing in the bucket can be pruned on the strength of that state. Each
    // data key is resolved to its manifest exactly as the conveyor resolves it,
    // and that lookup must not come back eligible.
    for (const key of dataKeys) {
      const parsed = parseDataObjectKey(key);
      assert.ok(parsed, `${key} must parse as a data object key`);
      const manifestKey = manifestObjectKey(parsed.target, computeManifestId(key));
      const body = await h.store.get(manifestKey);
      const manifest = body === null ? null : parseManifest(body.toString('utf8'));
      assert.equal(manifest, null, `${key} has a manifest although it was never verified`);
      assert.equal(decidePrune(manifest).eligible, false, `${key} must not be prune-eligible`);
    }

    // The retry finishes the job and produces the manifests.
    const retry = await run(h);
    assert.equal(retry.ok, true, JSON.stringify(retry.items));
    assert.equal(retry.archived, 2);
    const manifests = (await h.store.list('manifests/')).filter(
      (key) => !key.startsWith('manifests/_conveyor/'),
    );
    assert.equal(manifests.length, 2);
  } finally {
    await h.close();
  }
});

test('a failing window is recorded where the prune gate does not read it', async () => {
  const h = await harness();
  try {
    // A verification failure must leave an artifact an operator can find. It
    // must not leave one the prune gate would accept.
    const corrupting: ObjectStore = {
      ...h.store,
      bucket: h.store.bucket,
      describe: () => h.store.describe(),
      put: async (key, body, contentType) =>
        h.store.put(
          key,
          key.endsWith('.parquet') ? Buffer.concat([body, Buffer.from('tamper')]) : body,
          contentType,
        ),
      head: (key) => h.store.head(key),
      get: (key) => h.store.get(key),
      list: (prefix) => h.store.list(prefix),
      uriFor: (key) => h.store.uriFor(key),
      baseUri: () => h.store.baseUri(),
    };

    const result = await run(h, { store: corrupting });
    assert.equal(result.failed, 2);
    for (const item of result.items) {
      assert.equal(item.prune_eligible, false);
      assert.ok(item.failures.includes('checksum_verified') || item.failures.length > 0);
    }

    const keys = await h.store.list('manifests/');
    const failed = keys.filter((key) => key.endsWith('.failed.json'));
    const accepted = keys.filter(
      (key) => key.endsWith('.json') && !key.endsWith('.failed.json') && !key.startsWith('manifests/_conveyor/'),
    );
    assert.equal(failed.length, 2, 'the failure is written down for an operator');
    assert.deepEqual(accepted, [], 'and never under the key the prune gate reads');
  } finally {
    await h.close();
  }
});

test('the heartbeat is written even when every window fails', async () => {
  const h = await harness();
  try {
    const result = await run(h, { relationExpr: () => 'no_such_table' });
    assert.equal(result.failed, 2);
    const heartbeat = JSON.parse((await h.store.get(CONVEYOR_HEARTBEAT_KEY))!.toString('utf8'));
    assert.equal(heartbeat.ok, false);
    assert.equal(heartbeat.failed, 2);
    assert.equal(heartbeat.last_run_at, FIXED_NOW.toISOString());

    // "Failing" and "not running" are different states and must not be
    // conflated: a run that failed everything is still a run that happened.
    const verdict = await readStaleness(h.store, { now: FIXED_NOW });
    assert.equal(verdict.stale, false);
  } finally {
    await h.close();
  }
});

test('a missing or stale heartbeat reads as stale, never as unknown', async () => {
  const h = await harness();
  try {
    const missing = await readStaleness(h.store, { now: FIXED_NOW });
    assert.equal(missing.stale, true);
    assert.equal(missing.age_hours, null);

    await run(h);
    const fresh = await readStaleness(h.store, { now: FIXED_NOW });
    assert.equal(fresh.stale, false);
    assert.equal(fresh.age_hours, 0);

    const twoDaysLater = new Date(FIXED_NOW.getTime() + 48 * 3_600_000);
    const stale = await readStaleness(h.store, { now: twoDaysLater });
    assert.equal(stale.stale, true);
    assert.equal(stale.age_hours, 48);
    assert.ok(stale.reason.includes('36h threshold'));

    await h.store.put(CONVEYOR_HEARTBEAT_KEY, Buffer.from('{not json', 'utf8'), 'application/json');
    const broken = await readStaleness(h.store, { now: FIXED_NOW });
    assert.equal(broken.stale, true);
  } finally {
    await h.close();
  }
});
