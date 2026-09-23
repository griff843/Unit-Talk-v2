/**
 * WORK-2026092101 — warehouse configuration and secret handling.
 *
 * Two properties are asserted here and both are safety properties: incomplete
 * configuration fails closed rather than degrading to a no-op upload, and no
 * code path in this module can be made to hand back a secret value. A warehouse
 * that "succeeds" with no bucket configured produces a prune gate guarding an
 * archive that does not exist.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SECRET_ENV_KEYS,
  WAREHOUSE_ENV_KEYS,
  classifyPresence,
  describeConfig,
  redactSecrets,
  resolveObjectStoreConfig,
  resolveSourceDsn,
} from './config.js';

function completeEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    [WAREHOUSE_ENV_KEYS.endpoint]: 'https://fsn1.your-objectstorage.com',
    [WAREHOUSE_ENV_KEYS.region]: 'fsn1',
    [WAREHOUSE_ENV_KEYS.bucket]: 'unit-talk-archive',
    [WAREHOUSE_ENV_KEYS.accessKeyId]: 'AKIAEXAMPLEKEYID0001',
    [WAREHOUSE_ENV_KEYS.secretAccessKey]: 's3cr3t-value-not-a-placeholder',
    ...overrides,
  } as NodeJS.ProcessEnv;
}

test('a complete environment resolves', () => {
  const resolved = resolveObjectStoreConfig(completeEnv());
  assert.equal(resolved.ok, true);
  assert.ok(resolved.ok && resolved.config.bucket === 'unit-talk-archive');
  assert.ok(resolved.ok && resolved.config.forcePathStyle === true, 'path style defaults on');
});

test('every required key is individually required', () => {
  for (const field of ['endpoint', 'region', 'bucket', 'accessKeyId', 'secretAccessKey'] as const) {
    const key = WAREHOUSE_ENV_KEYS[field];
    const resolved = resolveObjectStoreConfig(completeEnv({ [key]: undefined }));
    assert.equal(resolved.ok, false, `${key} missing must fail closed`);
    assert.ok(!resolved.ok && resolved.missing.includes(key));
  }
});

test('a placeholder counts as missing', () => {
  for (const placeholder of ['your-bucket', 'CHANGEME', '<bucket>', 'TODO', 'xxxx', 'none']) {
    const resolved = resolveObjectStoreConfig(
      completeEnv({ [WAREHOUSE_ENV_KEYS.bucket]: placeholder }),
    );
    assert.equal(resolved.ok, false, `${placeholder} must not be accepted as a bucket name`);
  }
  assert.equal(classifyPresence(undefined), 'missing');
  assert.equal(classifyPresence('   '), 'missing');
  assert.equal(classifyPresence('replace-me'), 'placeholder');
  assert.equal(classifyPresence('unit-talk-archive'), 'present');
});

test('path style can be turned off explicitly and only explicitly', () => {
  const off = resolveObjectStoreConfig(
    completeEnv({ [WAREHOUSE_ENV_KEYS.forcePathStyle]: 'false' }),
  );
  assert.ok(off.ok && off.config.forcePathStyle === false);
  const other = resolveObjectStoreConfig(
    completeEnv({ [WAREHOUSE_ENV_KEYS.forcePathStyle]: 'no' }),
  );
  assert.ok(other.ok && other.config.forcePathStyle === true);
});

test('the source DSN is required for anything that reads the operational database', () => {
  assert.equal(resolveSourceDsn({}).ok, false);
  assert.equal(
    resolveSourceDsn({ [WAREHOUSE_ENV_KEYS.sourceDsn]: 'postgres://ro@host/db' } as NodeJS.ProcessEnv)
      .ok,
    true,
  );
});

test('describeConfig reports presence and never a value', () => {
  const env = completeEnv({
    [WAREHOUSE_ENV_KEYS.sourceDsn]: 'postgresql://reader:hunter2@db.example/postgres',
  });
  const description = describeConfig(env);
  const serialized = JSON.stringify(description);

  for (const secretKey of SECRET_ENV_KEYS) {
    const value = env[secretKey];
    assert.ok(value, `${secretKey} should be set in this fixture`);
    assert.equal(
      serialized.includes(value),
      false,
      `describeConfig leaked the value of ${secretKey}`,
    );
  }
  assert.equal(description.object_store_ready, true);
  assert.equal(description.source_ready, true);
  assert.ok(description.keys.find((k) => k.key === WAREHOUSE_ENV_KEYS.bucket)?.presence === 'present');
  assert.ok(description.keys.find((k) => k.key === WAREHOUSE_ENV_KEYS.secretAccessKey)?.secret);
});

test('describeConfig does not print even the non-secret values', () => {
  const env = completeEnv();
  const serialized = JSON.stringify(describeConfig(env));
  assert.equal(serialized.includes('unit-talk-archive'), false);
  assert.equal(serialized.includes('fsn1.your-objectstorage.com'), false);
});

test('redactSecrets removes configured values and embedded URI credentials', () => {
  const env = completeEnv({
    [WAREHOUSE_ENV_KEYS.sourceDsn]: 'postgresql://reader:hunter2@db.example/postgres',
  });
  const message = `connect failed for postgresql://reader:hunter2@db.example/postgres using s3cr3t-value-not-a-placeholder`;
  const redacted = redactSecrets(message, env);
  assert.equal(redacted.includes('hunter2'), false);
  assert.equal(redacted.includes('s3cr3t-value-not-a-placeholder'), false);
});

test('redactSecrets still strips inline credentials when nothing is configured', () => {
  const redacted = redactSecrets('postgres://someone:letmein@host:5432/db', {});
  assert.equal(redacted.includes('letmein'), false);
  assert.ok(redacted.includes('[redacted]'));
});
