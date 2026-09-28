import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildManifest, serializeManifest } from './manifest.js';
import { LocalObjectStore, sha256Hex } from './object-store.js';
import {
  requireSource,
  resolveRetentionDsn,
  verifyRetentionEvidence,
} from './retention.js';
import { openDuckDb, quote } from './duckdb.js';

async function archivedWindow(date = '2026-06-14') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retention-unit-'));
  const parquet = path.join(root, 'one.parquet');
  const duck = await openDuckDb();
  try {
    await duck.run(
      `CREATE TABLE archived(id UUID, snapshot_at TIMESTAMPTZ, source_run_id UUID)`,
    );
    await duck.run(
      `INSERT INTO archived VALUES ('11111111-1111-4111-8111-111111111111', '${date}T12:00:00Z', NULL)`,
    );
    await duck.run(
      `COPY archived TO ${quote(parquet)} (FORMAT PARQUET, COMPRESSION ZSTD)`,
    );
  } finally {
    await duck.close();
  }
  const bytes = fs.readFileSync(parquet);
  const store = new LocalObjectStore(
    path.join(root, 'bucket'),
    'warehouse-archive',
  );
  const manifest = buildManifest({
    target: {
      kind: 'canonical',
      domain: 'markets',
      sport: 'all',
      season: '2026',
      date,
    },
    bucket: 'warehouse-archive',
    sourceRelation: 'public.provider_offer_history',
    sourceRowCount: 1,
    window: {
      column: 'snapshot_at',
      start: `${date}T00:00:00.000Z`,
      end: '2026-06-15T00:00:00.000Z',
    },
    exportedRowCount: 1,
    byteSize: bytes.length,
    checksumSha256: sha256Hex(bytes),
    columns: [
      { name: 'id', type: 'UUID' },
      { name: 'snapshot_at', type: 'TIMESTAMP WITH TIME ZONE' },
      { name: 'source_run_id', type: 'UUID' },
    ],
    rowGroupSize: 10_000,
    exporterRepoSha: 'abcdef1234567',
    exportedAt: '2026-06-16T00:00:00.000Z',
  });
  manifest.verification = {
    verified_at: '2026-06-16T00:01:00.000Z',
    object_exists: true,
    row_count_match: true,
    checksum_verified: true,
    parquet_readable: true,
    sample_readback_rows: 1,
    sample_readback_match: true,
    passed: true,
    failures: [],
  };
  await store.put(
    manifest.object.data_key,
    bytes,
    'application/vnd.apache.parquet',
  );
  await store.put(
    manifest.object.manifest_key,
    Buffer.from(serializeManifest(manifest)),
    'application/json',
  );
  return { root, store, manifest };
}

test('retention allowlist excludes quarantine and operational truth', () => {
  assert.equal(
    requireSource('provider_offer_history'),
    'provider_offer_history',
  );
  assert.throws(
    () => requireSource('provider_offers_legacy_quarantine'),
    /not in the governed retention allowlist/,
  );
  assert.throws(
    () => requireSource('picks'),
    /not in the governed retention allowlist/,
  );
  assert.throws(
    () => requireSource('audit_log'),
    /not in the governed retention allowlist/,
  );
});

test('phase DSN resolution refuses broad and cross-phase credentials', () => {
  assert.equal(
    resolveRetentionDsn('plan', {
      UNIT_TALK_WAREHOUSE_RETENTION_PLAN_DSN: 'postgres://planner',
    }),
    'postgres://planner',
  );
  assert.throws(
    () =>
      resolveRetentionDsn('execute', {
        UNIT_TALK_WAREHOUSE_RETENTION_EXECUTE_DSN: 'postgres://executor',
        SUPABASE_DB_URL: 'postgres://broad',
      }),
    /SUPABASE_DB_URL/,
  );
  assert.throws(
    () =>
      resolveRetentionDsn('execute', {
        UNIT_TALK_WAREHOUSE_RETENTION_EXECUTE_DSN: 'postgres://executor',
        UNIT_TALK_WAREHOUSE_RETENTION_PLAN_DSN: 'postgres://planner',
      }),
    /UNIT_TALK_WAREHOUSE_RETENTION_PLAN_DSN/,
  );
});

test('evidence is independently read, hashed and counted through the reader path', async (t) => {
  const h = await archivedWindow();
  t.after(() => fs.rmSync(h.root, { recursive: true, force: true }));
  const result = await verifyRetentionEvidence({
    store: h.store,
    source: 'provider_offer_history',
    date: '2026-06-14',
    now: new Date('2026-09-28T12:00:00.000Z'),
    includeRows: true,
  });
  assert.equal(result.manifest.manifest_id, h.manifest.manifest_id);
  assert.match(result.manifestSha256, /^[0-9a-f]{64}$/);
  assert.equal(result.rows?.length, 1);
  assert.equal(result.rows?.[0]?.id, '11111111-1111-4111-8111-111111111111');
});

test('missing or mutated archive evidence refuses before a database is opened', async (t) => {
  const h = await archivedWindow();
  t.after(() => fs.rmSync(h.root, { recursive: true, force: true }));
  await h.store.put(
    h.manifest.object.data_key,
    Buffer.from('corrupt'),
    'application/octet-stream',
  );
  await assert.rejects(
    verifyRetentionEvidence({
      store: h.store,
      source: 'provider_offer_history',
      date: '2026-06-14',
      now: new Date('2026-09-28T12:00:00.000Z'),
    }),
    /byte size|checksum/,
  );

  const empty = new LocalObjectStore(path.join(h.root, 'empty'));
  await assert.rejects(
    verifyRetentionEvidence({
      store: empty,
      source: 'provider_offer_history',
      date: '2026-06-14',
      now: new Date('2026-09-28T12:00:00.000Z'),
    }),
    /manifest is missing/,
  );
});
