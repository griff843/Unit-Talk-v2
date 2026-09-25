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
  DEFAULT_RETENTION_POLICY,
  type RetentionPolicyEntry,
  decideRetentionEligibility,
  planConveyorRun,
  readStaleness,
  runConveyor,
} from './conveyor.js';
import {
  BACKFILL_SOURCES,
  MAX_BACKFILL_WINDOWS,
  type BackfillLedger,
  type BackfillPlan,
  isPruneHeldRelation,
  planBackfill,
  runBackfill,
} from './backfill.js';
import { type DuckConnection, openDuckDb } from './duckdb.js';
import { type ArchiveManifestV1, computeManifestId, parseManifest } from './manifest.js';
import { dataObjectKey, manifestObjectKey, parseDataObjectKey } from './object-layout.js';
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

// ---------------------------------------------------------------------------
/*
 * WORK-2026092405 — the historical backfill, and the conveyor defects it found.
 *
 * Every test named in WAREHOUSE_HISTORICAL_BACKFILL_PLAN.md §7 lives here. The
 * ones that carry the most weight are the refusals: a range that is too wide,
 * a window that failed and must stop the run, a held source that must never
 * read as prune-eligible. A backfill that is merely able to succeed proves very
 * little; what makes it safe to dispatch against production is what it refuses.
 */

const BACKFILL_NOW = new Date('2026-09-25T04:17:00.000Z');
const TODAY = '2026-09-25';

/**
 * Three days of offers, 2026-05-11 to 2026-05-13, 240 rows each, in the
 * production history table's window column and ordering.
 */
async function seedOffers(connection: DuckConnection): Promise<void> {
  await connection.run(`
    CREATE TABLE offers AS
    SELECT
      ('00000000-0000-4000-8000-' || lpad(CAST(i AS VARCHAR), 12, '0'))::UUID AS id,
      TIMESTAMPTZ '2026-05-11 00:00:00+00' + INTERVAL (i * 6) MINUTE      AS snapshot_at,
      CASE WHEN i % 2 = 0 THEN 'nfl' ELSE 'nba' END                        AS sport_key,
      'evt-' || CAST(i % 7 AS VARCHAR)                                     AS provider_event_id
    FROM range(0, 720) tbl(i)
  `);
}

interface Workspace {
  connection: DuckConnection;
  store: LocalObjectStore;
  workDir: string;
  close: () => Promise<void>;
}

async function workspace(seed?: (connection: DuckConnection) => Promise<void>): Promise<Workspace> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-talk-warehouse-backfill-test-'));
  const connection = await openDuckDb();
  if (seed) await seed(connection);
  return {
    connection,
    store: new LocalObjectStore(path.join(workDir, 'bucket'), 'unit-talk-archive-test'),
    workDir,
    close: async () => {
      await connection.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    },
  };
}

// --- defect 1: the default policy must be able to produce a key -------------

test('DEFAULT_RETENTION_POLICY produces a valid key for the window it plans', () => {
  // The production policy itself, not a test copy of it: the defect was that
  // the conveyor tests used `season: '2026'` while the only real entry said
  // `'all'`, which the layout refuses.
  const plan = planConveyorRun({ policy: DEFAULT_RETENTION_POLICY, today: '2026-09-24' });
  assert.equal(plan.items.length, 1);
  const [item] = plan.items;
  assert.equal(item.date, '2026-08-09', 'today - 45 - 1');
  const key = dataObjectKey(item.target);
  assert.equal(key, 'canonical/markets/all/2026/2026-08-09/part-0000.parquet');
  assert.deepEqual(parseDataObjectKey(key)?.target, item.target, 'the key round-trips');
});

test('the default policy files a window under its own year, not the run year', () => {
  const plan = planConveyorRun({
    policy: DEFAULT_RETENTION_POLICY,
    today: '2027-01-10',
    windowDate: '2026-12-31',
  });
  assert.equal(dataObjectKey(plan.items[0].target), 'canonical/markets/all/2026/2026-12-31/part-0000.parquet');
});

test('a key that cannot be built is a failed window with a heartbeat, not an escaped throw', async () => {
  const ws = await workspace();
  try {
    // `season: 'all'` is exactly the entry that used to take the run down.
    const broken: RetentionPolicyEntry[] = [{ ...DEFAULT_RETENTION_POLICY[0], season: 'all' }];
    const plan = planConveyorRun({ policy: broken, today: '2026-09-24' });
    const result = await runConveyor({
      plan,
      connection: ws.connection,
      store: ws.store,
      relationExpr: () => 'offers',
      exporterRepoSha: '0'.repeat(40),
      now: () => BACKFILL_NOW,
      log: () => {},
    });
    assert.equal(result.ok, false);
    assert.equal(result.failed, 1);
    assert.ok(result.alert, 'a failed window raises the alert payload');
    const [item] = result.items;
    assert.equal(item.status, 'failed');
    assert.equal(item.data_key, null, 'no key was ever constructed');
    assert.equal(item.prune_eligible, false);
    assert.match(item.failures[0] ?? '', /season must be YYYY or YYYY-YY/);

    const heartbeat = JSON.parse((await ws.store.get(CONVEYOR_HEARTBEAT_KEY))!.toString('utf8'));
    assert.equal(heartbeat.ok, false);
    assert.equal(heartbeat.failed, 1);
  } finally {
    await ws.close();
  }
});

// --- the retention boundary a future prune must obey -------------------------

const HISTORY: RetentionPolicyEntry = DEFAULT_RETENTION_POLICY[0];
const HELD: RetentionPolicyEntry = { ...HISTORY, pruneHold: true };

/** Archive one window through the real conveyor and return its stored manifest. */
async function archivedManifest(
  ws: Workspace,
  entry: RetentionPolicyEntry,
  windowDate: string,
): Promise<ArchiveManifestV1> {
  const plan = planConveyorRun({ policy: [entry], today: TODAY, windowDate });
  const result = await runConveyor({
    plan,
    connection: ws.connection,
    store: ws.store,
    relationExpr: () => 'offers',
    exporterRepoSha: '0'.repeat(40),
    sampleSize: 10,
    now: () => BACKFILL_NOW,
    log: () => {},
  });
  assert.equal(result.ok, true, JSON.stringify(result.items));
  const key = manifestObjectKey(plan.items[0].target, computeManifestId(result.items[0].data_key!));
  return parseManifest((await ws.store.get(key))!.toString('utf8'));
}

test('a verified window older than hot retention is the only eligible kind', async () => {
  const ws = await workspace(seedOffers);
  try {
    const manifest = await archivedManifest(ws, HISTORY, '2026-05-11');
    const decision = decideRetentionEligibility({
      entry: HISTORY,
      windowDate: '2026-05-11',
      today: '2026-06-26', // 46 days later
      manifest,
    });
    assert.equal(decision.eligible, true, decision.reasons.join(', '));
    assert.deepEqual(decision.reasons, []);
    assert.equal(decision.data_key, manifest.object.data_key);
  } finally {
    await ws.close();
  }
});

test('retention refuses each missing condition, and names it', async () => {
  const ws = await workspace(seedOffers);
  try {
    const manifest = await archivedManifest(ws, HISTORY, '2026-05-11');
    const other = await archivedManifest(ws, HISTORY, '2026-05-12');
    const decide = (overrides: Partial<Parameters<typeof decideRetentionEligibility>[0]>) =>
      decideRetentionEligibility({
        entry: HISTORY,
        windowDate: '2026-05-11',
        today: '2026-06-26',
        manifest,
        ...overrides,
      });

    // Exactly 45 days old is still hot: the boundary is "older than", not "at".
    assert.deepEqual(decide({ today: '2026-06-25' }).reasons, ['within_hot_retention']);
    assert.deepEqual(decide({ manifest: null }).reasons, ['no_manifest']);
    assert.deepEqual(
      decide({ manifest: other }).reasons,
      ['manifest_window_mismatch'],
      'a verified manifest for another day vouches for nothing here',
    );
    assert.deepEqual(
      decide({ manifest: { ...manifest, source: { ...manifest.source, relation: 'public.other' } } }).reasons,
      ['manifest_window_mismatch'],
    );

    // Evaluated now, not trusted from upload time: a manifest whose verification
    // no longer holds is refused even though the window is old enough.
    const unverified = {
      ...manifest,
      verification: { ...manifest.verification, passed: false, failures: ['checksum_verified'] },
    };
    const refused = decide({ manifest: unverified });
    assert.equal(refused.eligible, false);
    assert.ok(refused.reasons.includes('manifest_not_verified:verification_not_passed'), refused.reasons.join(', '));
    assert.equal(decide({ manifest: { not: 'a manifest' } }).eligible, false);
  } finally {
    await ws.close();
  }
});

test('a pruneHold entry is never reported prune-eligible, whatever its manifest says', async () => {
  const ws = await workspace(seedOffers);
  try {
    const manifest = await archivedManifest(ws, HELD, '2026-05-11');
    // The manifest itself is perfect: verified, exact, and the window long cold.
    assert.equal(
      decideRetentionEligibility({ entry: HISTORY, windowDate: '2026-05-11', today: '2027-05-11', manifest })
        .eligible,
      true,
    );
    for (const today of ['2026-06-26', '2027-05-11', '2036-01-01']) {
      const decision = decideRetentionEligibility({ entry: HELD, windowDate: '2026-05-11', today, manifest });
      assert.equal(decision.eligible, false);
      assert.deepEqual(decision.reasons, ['prune_hold']);
    }

    // The conveyor's own result says the same, on the first run and on the skip.
    const plan = planConveyorRun({ policy: [HELD], today: TODAY, windowDate: '2026-05-11' });
    const rerun = await runConveyor({
      plan,
      connection: ws.connection,
      store: ws.store,
      relationExpr: () => 'offers',
      exporterRepoSha: '0'.repeat(40),
      now: () => BACKFILL_NOW,
      log: () => {},
    });
    assert.equal(rerun.items[0].status, 'skipped_already_verified');
    assert.equal(rerun.items[0].prune_hold, true);
    assert.equal(rerun.items[0].prune_eligible, false);
  } finally {
    await ws.close();
  }
});

// --- the planner ------------------------------------------------------------

test('a backfill range is refused when backwards, malformed, too wide or still hot', () => {
  const plan = (from: string, to: string, extra: { source?: string; maxWindows?: number } = {}) =>
    planBackfill({ source: 'provider_offer_history', from, to, today: TODAY, ...extra });

  assert.throws(() => plan('2026-05-12', '2026-05-11'), /is after to/);
  for (const bad of ['2026-5-11', '2026-02-30', 'yesterday', '']) {
    assert.throws(() => plan(bad, '2026-05-11'), /ISO dates/, `from ${JSON.stringify(bad)}`);
    assert.throws(() => plan('2026-05-11', bad), /ISO dates/, `to ${JSON.stringify(bad)}`);
  }
  // 2026-03-01 .. 2026-05-01 is 62 days; one more is refused, never trimmed.
  assert.equal(plan('2026-03-01', '2026-05-01').windows.length, MAX_BACKFILL_WINDOWS);
  assert.throws(() => plan('2026-02-28', '2026-05-01'), /63 windows, above the limit of 62/);
  // The caller's own cap is honoured, and cannot raise the ceiling.
  assert.throws(() => plan('2026-05-11', '2026-05-13', { maxWindows: 2 }), /3 windows, above the limit of 2/);
  for (const maxWindows of [0, -1, 1.5, 63, Number.NaN]) {
    assert.throws(() => plan('2026-05-11', '2026-05-11', { maxWindows }), /maxWindows must be/);
  }
  assert.throws(() => plan('2026-05-11', '2026-05-11', { source: 'public.picks' }), /source must be one of/);
  // 2026-08-10 is 46 days before 2026-09-25 and closed; 2026-08-11 is not.
  assert.equal(plan('2026-08-10', '2026-08-10').windows.length, 1);
  assert.throws(() => plan('2026-08-10', '2026-08-11'), /has not left hot retention/);
});

test('windows are planned oldest first, one UTC day each, every day in the range', () => {
  const plan = planBackfill({ source: 'provider_offer_history', from: '2026-06-28', to: '2026-07-02', today: TODAY });
  assert.deepEqual(
    plan.windows.map((window) => window.date),
    ['2026-06-28', '2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02'],
  );
  for (const window of plan.windows) {
    assert.equal(window.item.source.window.start, `${window.date}T00:00:00.000Z`);
    assert.equal(
      Date.parse(window.item.source.window.end) - Date.parse(window.item.source.window.start),
      86_400_000,
    );
  }
  assert.equal(plan.ledger_key, 'manifests/_backfill/provider_offer_history/2026-06-28_2026-07-02.json');
});

test('each source is filed under the key the plan names', () => {
  const history = planBackfill({ source: 'provider_offer_history', from: '2026-05-11', to: '2026-05-11', today: TODAY });
  assert.equal(history.windows[0].data_key, 'canonical/markets/all/2026/2026-05-11/part-0000.parquet');
  assert.match(history.windows[0].manifest_key, /^manifests\/markets\/2026-05-11\/m[0-9a-f]{24}\.json$/);
  assert.equal(history.prune_hold, false);

  const quarantine = planBackfill({
    source: 'provider_offers_legacy_quarantine',
    from: '2026-04-23',
    to: '2026-04-23',
    today: TODAY,
  });
  assert.equal(
    quarantine.windows[0].data_key,
    'raw/provider_offers_legacy/all/2026/2026-04-23/part-0000.parquet',
  );
  assert.match(
    quarantine.windows[0].manifest_key,
    /^manifests\/raw_provider_offers_legacy\/2026-04-23\/m[0-9a-f]{24}\.json$/,
  );
  assert.equal(quarantine.prune_hold, true);
  assert.equal(quarantine.relation, 'public.provider_offers_legacy_quarantine');
});

test('history and quarantine keys never collide, for any date', () => {
  // Four whole years, both directions: no data key and no manifest key of one
  // source is ever a key of the other. And history is exactly the key the daily
  // conveyor computes, so a backfilled day and a conveyor day are one archive.
  const keysFor = (entry: RetentionPolicyEntry, date: string) => {
    const [item] = planConveyorRun({ policy: [entry], today: TODAY, windowDate: date }).items;
    const data = dataObjectKey(item.target);
    return { data, manifest: manifestObjectKey(item.target, computeManifestId(data)) };
  };
  const history = new Set<string>();
  const quarantine = new Set<string>();
  const start = Date.parse('2024-01-01T00:00:00.000Z');
  for (let day = 0; day < 4 * 366; day += 1) {
    const date = new Date(start + day * 86_400_000).toISOString().slice(0, 10);
    const h = keysFor(BACKFILL_SOURCES.provider_offer_history, date);
    const q = keysFor(BACKFILL_SOURCES.provider_offers_legacy_quarantine, date);
    history.add(h.data).add(h.manifest);
    quarantine.add(q.data).add(q.manifest);

    const daily = planConveyorRun({ policy: DEFAULT_RETENTION_POLICY, today: TODAY, windowDate: date }).items[0];
    assert.equal(h.data, dataObjectKey(daily.target), `${date}: backfill and conveyor disagree`);
  }
  assert.equal(history.size, 2 * 4 * 366);
  assert.equal(quarantine.size, 2 * 4 * 366);
  for (const key of quarantine) {
    assert.equal(history.has(key), false, `${key} is claimed by both sources`);
  }
});

test('the quarantine is the only held source, and history is not held', () => {
  assert.equal(isPruneHeldRelation('public.provider_offers_legacy_quarantine'), true);
  assert.equal(isPruneHeldRelation('public.provider_offer_history'), false);
  assert.equal(BACKFILL_SOURCES.provider_offers_legacy_quarantine.pruneHold, true);
});

// --- the driver ---------------------------------------------------------------

function backfill(ws: Workspace, plan: BackfillPlan, overrides: Partial<Parameters<typeof runBackfill>[0]> = {}) {
  return runBackfill({
    plan,
    connection: ws.connection,
    store: ws.store,
    relationExpr: () => 'offers',
    exporterRepoSha: '0'.repeat(40),
    sampleSize: 10,
    now: () => BACKFILL_NOW,
    log: () => {},
    ...overrides,
  });
}

function historyPlan(from: string, to: string): BackfillPlan {
  return planBackfill({ source: 'provider_offer_history', from, to, today: TODAY });
}

async function readLedger(store: ObjectStore, plan: BackfillPlan): Promise<BackfillLedger> {
  return JSON.parse((await store.get(plan.ledger_key))!.toString('utf8')) as BackfillLedger;
}

/** A store that passes everything through, with `put` replaceable. */
function wrapStore(store: LocalObjectStore, put: ObjectStore['put']): ObjectStore {
  return {
    bucket: store.bucket,
    describe: () => store.describe(),
    put,
    head: (key) => store.head(key),
    get: (key) => store.get(key),
    list: (prefix) => store.list(prefix),
    uriFor: (key) => store.uriFor(key),
    baseUri: () => store.baseUri(),
  };
}

test('a backfill archives every window, verified, and records each in the ledger', async () => {
  const ws = await workspace(seedOffers);
  try {
    const plan = historyPlan('2026-05-11', '2026-05-13');
    const result = await backfill(ws, plan);
    assert.equal(result.ok, true, JSON.stringify(result.windows));
    assert.equal(result.complete, true);
    assert.equal(result.archived, 3);

    const ledger = await readLedger(ws.store, plan);
    assert.deepEqual(ledger.windows.map((w) => w.status), ['archived', 'archived', 'archived']);
    for (const window of ledger.windows) {
      assert.equal(window.source_row_count, 240);
      assert.equal(window.exported_row_count, 240);
      assert.ok((window.byte_size ?? 0) > 0);
      const manifest = parseManifest((await ws.store.get(window.manifest_key))!.toString('utf8'));
      assert.equal(decidePrune(manifest).eligible, true);
      assert.equal(manifest.object.data_key, window.data_key);
    }

    // The backfill's heartbeat is its own. It must not make a dead daily
    // conveyor read as alive.
    assert.ok(await ws.store.head(plan.heartbeat_key));
    assert.equal(await ws.store.head(CONVEYOR_HEARTBEAT_KEY), null);
  } finally {
    await ws.close();
  }
});

test('stop on first failure: window 2 fails, so window 3 is never exported', async () => {
  const ws = await workspace(seedOffers);
  try {
    const plan = historyPlan('2026-05-11', '2026-05-13');
    const [, second, third] = plan.windows;
    // Tamper with window 2's object in flight, so its verification fails.
    const tampering = wrapStore(ws.store, (key, body, contentType) =>
      ws.store.put(key, key === second.data_key ? Buffer.concat([body, Buffer.from('tamper')]) : body, contentType),
    );
    const touched: string[] = [];
    const result = await backfill(ws, plan, {
      store: tampering,
      relationExpr: (item) => {
        touched.push(item.date);
        return 'offers';
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.failed_window, '2026-05-12');
    assert.deepEqual(result.windows.map((w) => w.status), ['archived', 'failed', 'not_attempted']);
    assert.equal(result.not_attempted, 1);
    assert.equal(touched.includes(third.date), false, 'window 3 was planned into a conveyor run');
    assert.equal(await ws.store.head(third.data_key), null, 'window 3 was exported');
    assert.equal(await ws.store.head(third.manifest_key), null);
    assert.equal(await ws.store.head(second.manifest_key), null, 'a failed window has no accepted manifest');

    const ledger = await readLedger(ws.store, plan);
    assert.equal(ledger.ok, false);
    assert.equal(ledger.complete, false);
    assert.deepEqual(ledger.windows.map((w) => w.status), ['archived', 'failed', 'not_attempted']);
    assert.ok(ledger.windows[1].failures.length > 0, 'the ledger names why window 2 failed');
  } finally {
    await ws.close();
  }
});

test('a re-run skips verified windows and exports nothing', async () => {
  const ws = await workspace(seedOffers);
  try {
    const plan = historyPlan('2026-05-11', '2026-05-13');
    assert.equal((await backfill(ws, plan)).ok, true);
    const before = new Map<string, string>();
    for (const window of plan.windows) {
      before.set(window.data_key, (await ws.store.get(window.data_key))!.toString('base64'));
      before.set(window.manifest_key, (await ws.store.get(window.manifest_key))!.toString('base64'));
    }

    // A connection that refuses everything: the skip must not read the source.
    const refusing: DuckConnection = {
      run: async () => {
        throw new Error('the source was read during a verified skip');
      },
      all: async () => {
        throw new Error('the source was read during a verified skip');
      },
      close: async () => {},
    };
    const rerun = await backfill(ws, plan, { connection: refusing });
    assert.equal(rerun.ok, true, JSON.stringify(rerun.windows));
    assert.equal(rerun.skipped, 3);
    assert.equal(rerun.archived, 0);
    for (const [key, body] of before) {
      assert.equal((await ws.store.get(key))!.toString('base64'), body, `${key} was rewritten`);
    }
  } finally {
    await ws.close();
  }
});

test('an interrupted upload, with an object and no manifest, is re-exported and overwritten', async () => {
  const ws = await workspace(seedOffers);
  try {
    const plan = historyPlan('2026-05-11', '2026-05-11');
    const [window] = plan.windows;
    // The state a run killed between upload and verification leaves behind.
    await ws.store.put(window.data_key, Buffer.from('half-an-upload'), 'application/vnd.apache.parquet');
    assert.equal(await ws.store.head(window.manifest_key), null);

    const result = await backfill(ws, plan);
    assert.equal(result.ok, true, JSON.stringify(result.windows));
    assert.equal(result.windows[0].status, 'archived', 'an unmanifested object is not already done');
    assert.notEqual((await ws.store.get(window.data_key))!.toString(), 'half-an-upload');
    const manifest = parseManifest((await ws.store.get(window.manifest_key))!.toString('utf8'));
    assert.equal(decidePrune(manifest).eligible, true);
  } finally {
    await ws.close();
  }
});

test('an unparseable manifest is treated as absent, never as a pass', async () => {
  const ws = await workspace(seedOffers);
  try {
    const plan = historyPlan('2026-05-11', '2026-05-11');
    const [window] = plan.windows;
    await ws.store.put(window.manifest_key, Buffer.from('{not json', 'utf8'), 'application/json');
    const result = await backfill(ws, plan);
    assert.equal(result.windows[0].status, 'archived');
    assert.equal(
      decidePrune(parseManifest((await ws.store.get(window.manifest_key))!.toString('utf8'))).eligible,
      true,
    );
  } finally {
    await ws.close();
  }
});

test('a readable manifest that does not pass decidePrune is not a verified skip', async () => {
  const ws = await workspace(seedOffers);
  try {
    const plan = historyPlan('2026-05-11', '2026-05-11');
    const [window] = plan.windows;
    assert.equal((await backfill(ws, plan)).ok, true);
    // Well-formed, parseable, and no longer verified: the skip must re-decide
    // from the manifest's content, not from its mere presence.
    const stored = parseManifest((await ws.store.get(window.manifest_key))!.toString('utf8'));
    const unverified = {
      ...stored,
      verification: { ...stored.verification, passed: false, failures: ['sample_readback_match'] },
    };
    await ws.store.put(window.manifest_key, Buffer.from(JSON.stringify(unverified), 'utf8'), 'application/json');
    assert.doesNotThrow(() => parseManifest(JSON.stringify(unverified)), 'the tampered manifest still parses');

    const rerun = await backfill(ws, plan);
    assert.equal(rerun.windows[0].status, 'archived', 'an unverified manifest was trusted as done');
    assert.equal(
      decidePrune(parseManifest((await ws.store.get(window.manifest_key))!.toString('utf8'))).eligible,
      true,
    );
  } finally {
    await ws.close();
  }
});

test('an empty window is archived as a verified zero-row object with its manifest', async () => {
  const ws = await workspace(seedOffers);
  try {
    // 2026-05-14 holds no fixture rows: "this day was empty" becomes evidence.
    const plan = historyPlan('2026-05-14', '2026-05-14');
    const [window] = plan.windows;
    const result = await backfill(ws, plan);
    assert.equal(result.ok, true, JSON.stringify(result.windows));
    assert.equal(result.windows[0].status, 'archived');
    assert.equal(result.windows[0].source_row_count, 0);
    assert.equal(result.windows[0].exported_row_count, 0);
    assert.ok(await ws.store.head(window.data_key), 'a zero-row object exists');

    const manifest = parseManifest((await ws.store.get(window.manifest_key))!.toString('utf8'));
    assert.equal(manifest.source.row_count, 0);
    assert.equal(manifest.export.exported_row_count, 0);
    assert.equal(manifest.verification.passed, true);
    assert.equal(decidePrune(manifest).eligible, true);
  } finally {
    await ws.close();
  }
});

test('the quarantine archives under raw/, and its verified windows stay held', async () => {
  const ws = await workspace(seedOffers);
  try {
    const plan = planBackfill({
      source: 'provider_offers_legacy_quarantine',
      from: '2026-05-11',
      to: '2026-05-12',
      today: TODAY,
    });
    const result = await backfill(ws, plan);
    assert.equal(result.ok, true, JSON.stringify(result.windows));
    assert.equal(result.prune_hold, true);
    assert.deepEqual(await ws.store.list('canonical/'), [], 'nothing of the quarantine lands under canonical/');

    for (const window of plan.windows) {
      const manifest = parseManifest((await ws.store.get(window.manifest_key))!.toString('utf8'));
      assert.equal(manifest.source.relation, 'public.provider_offers_legacy_quarantine');
      assert.equal(decidePrune(manifest).eligible, true, 'the archive itself verified');
      const decision = decideRetentionEligibility({
        entry: BACKFILL_SOURCES.provider_offers_legacy_quarantine,
        windowDate: window.date,
        today: '2030-01-01',
        manifest,
      });
      assert.equal(decision.eligible, false);
      assert.deepEqual(decision.reasons, ['prune_hold']);
    }
  } finally {
    await ws.close();
  }
});
