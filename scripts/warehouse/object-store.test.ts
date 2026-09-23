/**
 * WORK-2026092101 — object-store boundary.
 *
 * The local store is not a convenience: it is the substrate every fail-closed
 * verification test runs against, so it has to behave like the real thing in the
 * ways that matter — atomic writes, honest 404s, and a hard refusal of keys that
 * could address anything outside the bucket.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { WAREHOUSE_ENV_KEYS } from './config.js';
import { LocalObjectStore, createObjectStoreFromEnv, sha256Hex } from './object-store.js';

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'unit-talk-warehouse-store-'));
}

test('put/head/get round-trip', async () => {
  const root = tempRoot();
  try {
    const store = new LocalObjectStore(root);
    const body = Buffer.from('parquet-ish bytes');
    assert.equal(await store.head('canonical/markets/nfl/2026/2026-01-02/part-0000.parquet'), null);

    await store.put('canonical/markets/nfl/2026/2026-01-02/part-0000.parquet', body, 'application/x');
    const head = await store.head('canonical/markets/nfl/2026/2026-01-02/part-0000.parquet');
    assert.deepEqual(head, {
      key: 'canonical/markets/nfl/2026/2026-01-02/part-0000.parquet',
      size: body.byteLength,
    });
    const fetched = await store.get('canonical/markets/nfl/2026/2026-01-02/part-0000.parquet');
    assert.ok(fetched);
    assert.equal(sha256Hex(fetched), sha256Hex(body));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a missing object reads as absent, never as empty', async () => {
  const root = tempRoot();
  try {
    const store = new LocalObjectStore(root);
    assert.equal(await store.get('manifests/markets/2026-01-02/mnope.json'), null);
    assert.equal(await store.head('manifests/markets/2026-01-02/mnope.json'), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a write leaves no temporary file behind at the key', async () => {
  const root = tempRoot();
  try {
    const store = new LocalObjectStore(root);
    await store.put('a/b/c.parquet', Buffer.from('x'), 'application/x');
    const listed = await store.list('a');
    assert.deepEqual(listed, ['a/b/c.parquet']);
    assert.equal(
      listed.some((key) => key.endsWith('.tmp')),
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('overwriting a key replaces the whole object', async () => {
  const root = tempRoot();
  try {
    const store = new LocalObjectStore(root);
    await store.put('a/b.parquet', Buffer.from('first-and-longer'), 'application/x');
    await store.put('a/b.parquet', Buffer.from('second'), 'application/x');
    const body = await store.get('a/b.parquet');
    assert.equal(body?.toString('utf8'), 'second');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('refuses keys that could escape the bucket', async () => {
  const root = tempRoot();
  try {
    const store = new LocalObjectStore(root);
    for (const key of ['../escape.parquet', '/absolute.parquet', 'a//b.parquet', 'a\\b.parquet', '']) {
      await assert.rejects(
        () => store.put(key, Buffer.from('x'), 'application/x'),
        /unsafe object key|non-empty string/,
        `${JSON.stringify(key)} must be refused`,
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('list is recursive, sorted and scoped to the prefix', async () => {
  const root = tempRoot();
  try {
    const store = new LocalObjectStore(root);
    await store.put('canonical/markets/nfl/2026/2026-01-02/part-0000.parquet', Buffer.from('1'), 'x');
    await store.put('canonical/markets/nfl/2026/2026-01-03/part-0000.parquet', Buffer.from('2'), 'x');
    await store.put('raw/sgo/nfl/2026/2026-01-02/part-0000.parquet', Buffer.from('3'), 'x');

    assert.deepEqual(await store.list('canonical'), [
      'canonical/markets/nfl/2026/2026-01-02/part-0000.parquet',
      'canonical/markets/nfl/2026/2026-01-03/part-0000.parquet',
    ]);
    assert.deepEqual(await store.list('raw'), ['raw/sgo/nfl/2026/2026-01-02/part-0000.parquet']);
    assert.deepEqual(await store.list('nothing-here'), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('createObjectStoreFromEnv refuses rather than silently writing to a directory', () => {
  const resolved = createObjectStoreFromEnv({} as NodeJS.ProcessEnv);
  assert.equal(resolved.ok, false);
  assert.ok(!resolved.ok && resolved.missing.includes(WAREHOUSE_ENV_KEYS.bucket));
});

test('a local root is honoured only when set explicitly', () => {
  const root = tempRoot();
  try {
    const resolved = createObjectStoreFromEnv({
      [WAREHOUSE_ENV_KEYS.localRoot]: root,
    } as NodeJS.ProcessEnv);
    assert.ok(resolved.ok);
    assert.equal(resolved.ok && resolved.store.describe().kind, 'local');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an S3 store reports its identity without its credentials', () => {
  const resolved = createObjectStoreFromEnv({
    [WAREHOUSE_ENV_KEYS.endpoint]: 'https://fsn1.your-objectstorage.com',
    [WAREHOUSE_ENV_KEYS.region]: 'fsn1',
    [WAREHOUSE_ENV_KEYS.bucket]: 'unit-talk-archive',
    [WAREHOUSE_ENV_KEYS.accessKeyId]: 'AKIAEXAMPLEKEYID0001',
    [WAREHOUSE_ENV_KEYS.secretAccessKey]: 's3cr3t-value-not-a-placeholder',
  } as NodeJS.ProcessEnv);
  assert.ok(resolved.ok);
  const described = resolved.ok ? resolved.store.describe() : null;
  assert.equal(described?.kind, 's3');
  assert.equal(described?.bucket, 'unit-talk-archive');
  assert.equal(JSON.stringify(described).includes('s3cr3t'), false);
  assert.equal(resolved.ok && resolved.store.uriFor('a/b.parquet'), 's3://unit-talk-archive/a/b.parquet');
});
