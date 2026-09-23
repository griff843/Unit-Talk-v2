/**
 * WORK-2026092101 — fail-closed archive verification.
 *
 * This is the acceptance-critical file for the whole lane. Everything else can
 * be re-run; a prune cannot. The single property asserted here, five ways, is
 * that **a successful upload never makes a source partition prune-eligible**.
 *
 * Each case takes one genuinely archived partition that verifies and prunes,
 * then breaks exactly one thing about it and asserts two consequences: the
 * named check fails, and `decidePrune` refuses. Asserting only the first would
 * leave open the case where a check reports a failure nobody consults.
 *
 * The damage is always done to the object *in the store*, never to the local
 * file the exporter wrote, because the upload is the step that can lose data
 * and verifying the local copy would step over it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { type DuckConnection, openDuckDb } from './duckdb.js';
import { buildSelectSql, type SourceSpec, exportWindowToParquet } from './export-partition.js';
import {
  type ArchiveManifestV1,
  buildManifest,
  emptyVerification,
  isPruneEligible,
} from './manifest.js';
import type { ArchiveTarget } from './object-layout.js';
import { LocalObjectStore, sha256Hex } from './object-store.js';
import { applyVerification, compareSamples, decidePrune, verifyArchive } from './verify-archive.js';

const TARGET: ArchiveTarget = {
  kind: 'canonical',
  domain: 'markets',
  sport: 'nfl',
  season: '2026',
  date: '2026-09-14',
};

const FIXTURE_SOURCE: SourceSpec = {
  relation: 'offers',
  window: {
    column: 'snapshot_at',
    start: '2026-09-14T00:00:00.000Z',
    end: '2026-09-15T00:00:00.000Z',
  },
  filterColumn: 'sport_key',
  filterValue: 'nfl',
  orderBy: ['snapshot_at', 'id'],
};

async function seedFixture(connection: DuckConnection): Promise<void> {
  await connection.run(`
    CREATE TABLE offers AS
    SELECT
      ('00000000-0000-4000-8000-' || lpad(CAST(i AS VARCHAR), 12, '0'))::UUID AS id,
      TIMESTAMPTZ '2026-09-14 00:00:00+00' + INTERVAL (i) MINUTE          AS snapshot_at,
      CASE WHEN i % 2 = 0 THEN 'nfl' ELSE 'nba' END                        AS sport_key,
      'evt-' || CAST(i % 7 AS VARCHAR)                                     AS provider_event_id
    FROM range(0, 2880) tbl(i)
  `);
}

interface Harness {
  connection: DuckConnection;
  store: LocalObjectStore;
  manifest: ArchiveManifestV1;
  body: Buffer;
  sourceSample: (limit: number) => Promise<Array<Record<string, unknown>> | null>;
  workDir: string;
  close: () => Promise<void>;
}

/**
 * One genuine archive: export the window, upload the exact bytes, and build the
 * manifest from what was measured. Every case below starts from this and breaks
 * one thing, so a case can only fail for the reason it names.
 */
async function archiveOnePartition(): Promise<Harness> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-talk-warehouse-verify-test-'));
  const connection = await openDuckDb();
  await seedFixture(connection);

  const destination = path.join(workDir, 'part-0000.parquet');
  const exported = await exportWindowToParquet({
    connection,
    source: FIXTURE_SOURCE,
    destinationPath: destination,
  });

  const store = new LocalObjectStore(path.join(workDir, 'bucket'), 'unit-talk-archive-test');
  const manifest = buildManifest({
    target: TARGET,
    bucket: 'unit-talk-archive-test',
    sourceRelation: 'public.offers',
    sourcePartition: 'offers_p20260914',
    sourceRowCount: exported.sourceRowCount,
    window: FIXTURE_SOURCE.window,
    exportedRowCount: exported.exportedRowCount,
    byteSize: exported.byteSize,
    checksumSha256: exported.checksumSha256,
    columns: exported.columns,
    rowGroupSize: exported.rowGroupSize,
    exporterRepoSha: '0'.repeat(40),
    exportedAt: '2026-09-21T00:00:00.000Z',
  });

  const body = fs.readFileSync(destination);
  await store.put(manifest.object.data_key, body, 'application/vnd.apache.parquet');

  const sourceSample = async (limit: number) =>
    connection.all(`${buildSelectSql(FIXTURE_SOURCE)} LIMIT ${limit}`);

  return {
    connection,
    store,
    manifest,
    body,
    sourceSample,
    workDir,
    close: async () => {
      await connection.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    },
  };
}

/** Runs verification and folds it into the manifest, exactly as the conveyor does. */
async function verify(h: Harness, manifest = h.manifest) {
  const report = await verifyArchive({
    connection: h.connection,
    store: h.store,
    manifest,
    sourceSample: h.sourceSample,
    sampleSize: 25,
  });
  return { report, verified: applyVerification(manifest, report) };
}

function checkOk(report: { checks: Array<{ id: string; ok: boolean }> }, id: string): boolean {
  const check = report.checks.find((c) => c.id === id);
  assert.ok(check, `verification never ran check ${id}`);
  return check.ok;
}

test('a genuine archive verifies on every check and only then becomes prune-eligible', async () => {
  const h = await archiveOnePartition();
  try {
    const { report, verified } = await verify(h);
    assert.deepEqual(report.failures, [], 'an untampered archive must have nothing to report');
    assert.equal(report.passed, true);
    assert.equal(report.sample_readback_rows, 25);

    assert.equal(verified.verification.passed, true);
    assert.equal(verified.verification.verified_at !== null, true);

    const decision = decidePrune(verified);
    assert.equal(decision.eligible, true, decision.reasons.join(', '));
    assert.ok(decision.policy.includes('Any mismatch is an archive failure.'));
  } finally {
    await h.close();
  }
});

test('the un-verified manifest an exporter produces is never prune-eligible', async () => {
  const h = await archiveOnePartition();
  try {
    // This is the exact state right after a successful upload: bytes are in the
    // bucket, the PUT returned success, nothing has been verified.
    assert.deepEqual(h.manifest.verification, emptyVerification());
    const decision = decidePrune(h.manifest);
    assert.equal(decision.eligible, false);
    assert.ok(decision.reasons.includes('verification_not_passed'));
    assert.ok(decision.reasons.includes('recorded_failure:not_yet_verified'));
  } finally {
    await h.close();
  }
});

test('corrupted bytes in the bucket fail the checksum and block the prune', async () => {
  const h = await archiveOnePartition();
  try {
    // A single flipped byte in the middle of a row group. Length is unchanged,
    // so `object_exists` still passes and only the checksum can catch this.
    const corrupted = Buffer.from(h.body);
    const offset = Math.floor(corrupted.length / 2);
    corrupted[offset] = corrupted[offset] ^ 0xff;
    assert.notEqual(sha256Hex(corrupted), h.manifest.object.checksum_sha256);
    await h.store.put(h.manifest.object.data_key, corrupted, 'application/vnd.apache.parquet');

    const { report, verified } = await verify(h);
    assert.equal(checkOk(report, 'object_exists'), true, 'the size is unchanged, so only the hash can see this');
    assert.equal(checkOk(report, 'checksum_verified'), false);
    assert.equal(report.passed, false);
    assert.equal(verified.verification.sample_readback_rows, 0);
    assert.equal(decidePrune(verified).eligible, false);
  } finally {
    await h.close();
  }
});

test('an object that is not in the bucket fails object_exists and blocks the prune', async () => {
  const h = await archiveOnePartition();
  try {
    const objectPath = path.join(h.workDir, 'bucket', h.manifest.object.data_key);
    fs.rmSync(objectPath);

    const { report, verified } = await verify(h);
    assert.equal(checkOk(report, 'object_exists'), false);
    assert.equal(checkOk(report, 'checksum_verified'), false, 'nothing to hash is not a passing hash');
    assert.equal(checkOk(report, 'parquet_readable'), false);
    assert.equal(checkOk(report, 'sample_readback_match'), false);
    assert.equal(decidePrune(verified).eligible, false);
  } finally {
    await h.close();
  }
});

test('a short object fails the row count even when it is valid parquet', async () => {
  const h = await archiveOnePartition();
  try {
    // Re-export a strictly smaller window and upload it under the full
    // partition's key: valid Parquet, readable, self-consistent — and missing
    // rows the source still holds. Only counting catches this.
    const short = path.join(h.workDir, 'short.parquet');
    const shortExport = await exportWindowToParquet({
      connection: h.connection,
      source: {
        ...FIXTURE_SOURCE,
        window: { ...FIXTURE_SOURCE.window, end: '2026-09-14T06:00:00.000Z' },
      },
      destinationPath: short,
    });
    assert.ok(shortExport.exportedRowCount < h.manifest.source.row_count);

    const shortBody = fs.readFileSync(short);
    await h.store.put(h.manifest.object.data_key, shortBody, 'application/vnd.apache.parquet');

    // The manifest is re-stated with the truth about the uploaded bytes — size
    // and hash — so that only the row count is left to disagree.
    const manifest: ArchiveManifestV1 = {
      ...h.manifest,
      object: {
        ...h.manifest.object,
        byte_size: shortBody.length,
        checksum_sha256: sha256Hex(shortBody),
      },
    };

    const { report, verified } = await verify(h, manifest);
    assert.equal(checkOk(report, 'object_exists'), true);
    assert.equal(checkOk(report, 'checksum_verified'), true);
    assert.equal(checkOk(report, 'parquet_readable'), true, 'the file is perfectly valid parquet');
    assert.equal(checkOk(report, 'row_count_match'), false, 'and it is still missing rows');
    assert.equal(decidePrune(verified).eligible, false);
  } finally {
    await h.close();
  }
});

test('bytes that are not parquet fail the read-back even with a matching checksum', async () => {
  const h = await archiveOnePartition();
  try {
    const garbage = Buffer.from('this is not a parquet file'.repeat(64), 'utf8');
    await h.store.put(h.manifest.object.data_key, garbage, 'application/vnd.apache.parquet');
    const manifest: ArchiveManifestV1 = {
      ...h.manifest,
      object: {
        ...h.manifest.object,
        byte_size: garbage.length,
        checksum_sha256: sha256Hex(garbage),
      },
    };

    const { report, verified } = await verify(h, manifest);
    assert.equal(checkOk(report, 'object_exists'), true);
    assert.equal(checkOk(report, 'checksum_verified'), true, 'a hash proves transfer, not readability');
    assert.equal(checkOk(report, 'parquet_readable'), false);
    assert.equal(checkOk(report, 'sample_readback_match'), false);
    assert.equal(decidePrune(verified).eligible, false);
  } finally {
    await h.close();
  }
});

test('a source that disagrees with the archive fails the sample read-back', async () => {
  const h = await archiveOnePartition();
  try {
    // The archive is untouched and perfect. The *source* is what moved, which
    // is the real-world case: the window was not closed when it was exported.
    const drifted = async (limit: number) => {
      const rows = await h.sourceSample(limit);
      if (rows === null) return null;
      return rows.map((row, index) =>
        index === 3 ? { ...row, provider_event_id: 'evt-moved' } : row,
      );
    };

    const report = await verifyArchive({
      connection: h.connection,
      store: h.store,
      manifest: h.manifest,
      sourceSample: drifted,
      sampleSize: 25,
    });

    assert.equal(checkOk(report, 'checksum_verified'), true);
    assert.equal(checkOk(report, 'row_count_match'), true);
    assert.equal(checkOk(report, 'sample_readback_match'), false, 'identical counts are not identical rows');
    assert.equal(decidePrune(applyVerification(h.manifest, report)).eligible, false);
  } finally {
    await h.close();
  }
});

test('a source that cannot be read is a verification failure, not a skipped check', async () => {
  const h = await archiveOnePartition();
  try {
    const report = await verifyArchive({
      connection: h.connection,
      store: h.store,
      manifest: h.manifest,
      sourceSample: async () => null,
      sampleSize: 25,
    });
    assert.equal(checkOk(report, 'sample_readback_match'), false);
    assert.equal(report.passed, false);
    assert.equal(decidePrune(applyVerification(h.manifest, report)).eligible, false);
  } finally {
    await h.close();
  }
});

test('a non-empty partition that samples back zero rows does not pass', async () => {
  const h = await archiveOnePartition();
  try {
    const report = await verifyArchive({
      connection: h.connection,
      store: h.store,
      manifest: h.manifest,
      sourceSample: async () => [],
      sampleSize: 0,
    });
    // An empty source sample and an empty archive sample compare equal, so
    // without the non-empty guard this is the shape that passes vacuously.
    assert.equal(checkOk(report, 'sample_readback_match'), false);
    assert.equal(report.sample_readback_rows, 0);
    assert.equal(decidePrune(applyVerification(h.manifest, report)).eligible, false);
  } finally {
    await h.close();
  }
});

test('a manifest hand-edited to claim success cannot open the gate', async () => {
  const h = await archiveOnePartition();
  try {
    const { verified } = await verify(h);
    assert.equal(decidePrune(verified).eligible, true, 'precondition: this one really did verify');

    // Every boolean says yes. The counts underneath say no. `isPruneEligible`
    // re-compares them rather than trusting the flags it is handed.
    const forged: ArchiveManifestV1 = {
      ...verified,
      source: { ...verified.source, row_count: verified.source.row_count + 1 },
    };
    const decision = decidePrune(forged);
    assert.equal(decision.eligible, false);
    assert.ok(decision.reasons.includes('counts_disagree'));

    // And a recorded failure is not erasable by flipping `passed`.
    const alsoForged: ArchiveManifestV1 = {
      ...verified,
      verification: { ...verified.verification, failures: ['checksum_verified'] },
    };
    assert.equal(decidePrune(alsoForged).eligible, false);
    assert.equal(isPruneEligible(alsoForged).reasons.includes('recorded_failure:checksum_verified'), true);
  } finally {
    await h.close();
  }
});

test('a prune decision on something that is not a manifest refuses rather than throws', () => {
  for (const value of [null, undefined, {}, 'passed', 42, { verification: { passed: true } }]) {
    const decision = decidePrune(value);
    assert.equal(decision.eligible, false, `${JSON.stringify(value)} must not be prune-eligible`);
    assert.ok(decision.reasons.length > 0);
  }
});

test('compareSamples is positional, so reordered rows are a mismatch', () => {
  const a = [{ id: 1 }, { id: 2 }];
  assert.equal(compareSamples(a, [{ id: 1 }, { id: 2 }]).match, true);
  assert.equal(compareSamples(a, [{ id: 2 }, { id: 1 }]).match, false);
  assert.equal(compareSamples(a, [{ id: 1 }]).match, false, 'a prefix match is not a match');
  // Key order within a row is not row content.
  assert.equal(compareSamples([{ a: 1, b: 2 }], [{ b: 2, a: 1 }]).match, true);
});
