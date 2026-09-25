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
  classifyArchiveState,
  classifyPresence,
  describeConfig,
  RESEARCH_FORBIDDEN_ENV_KEYS,
  assertResearchEnvironment,
  resolveResearchObjectStoreConfig,
  redactSecrets,
  renderDoctorSummary,
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
    [WAREHOUSE_ENV_KEYS.readAccessKeyId]: 'READERKEYID00000001',
    [WAREHOUSE_ENV_KEYS.readSecretAccessKey]: 'reader-s3cr3t-value-0001',
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

// A scheduled run's configuration is one of three states, and only one may run.
// The two that may not must still be told apart: "nothing is provisioned yet" is
// an owner action, "half-provisioned" is a misconfiguration to fix.
const SOURCE_DSN = 'postgresql://warehouse_reader:pw-value-9f2@db.example.test:5432/postgres';

test('no archive key set at all is not_provisioned', () => {
  assert.equal(classifyArchiveState({}), 'not_provisioned');
  assert.equal(classifyArchiveState({ [WAREHOUSE_ENV_KEYS.bucket]: '   ' }), 'not_provisioned');
  // The local-development root is not an archive key and must not look like provisioning.
  assert.equal(classifyArchiveState({ [WAREHOUSE_ENV_KEYS.localRoot]: '/tmp/wh' }), 'not_provisioned');
});

test('a partial configuration is incomplete, whichever half is present', () => {
  assert.equal(classifyArchiveState(completeEnv()), 'incomplete', 'object store without source DSN');
  assert.equal(
    classifyArchiveState({ [WAREHOUSE_ENV_KEYS.sourceDsn]: SOURCE_DSN }),
    'incomplete',
    'source DSN without object store',
  );
  assert.equal(
    classifyArchiveState(completeEnv({ [WAREHOUSE_ENV_KEYS.sourceDsn]: SOURCE_DSN, [WAREHOUSE_ENV_KEYS.region]: undefined })),
    'incomplete',
  );
});

test('a placeholder is never counted as provisioned', () => {
  assert.equal(classifyArchiveState({ [WAREHOUSE_ENV_KEYS.bucket]: 'your-bucket' }), 'incomplete');
  assert.equal(
    classifyArchiveState(completeEnv({ [WAREHOUSE_ENV_KEYS.sourceDsn]: 'CHANGEME' })),
    'incomplete',
  );
});

test('only a complete object store plus source is ready', () => {
  const env = completeEnv({ [WAREHOUSE_ENV_KEYS.sourceDsn]: SOURCE_DSN });
  assert.equal(classifyArchiveState(env), 'ready');
  assert.equal(describeConfig(env).archive_state, 'ready');
  assert.equal(describeConfig({}).archive_state, 'not_provisioned');
});

test('every non-ready summary says nothing was archived, and none prints a value', () => {
  const envs: NodeJS.ProcessEnv[] = [
    {},
    completeEnv(),
    { [WAREHOUSE_ENV_KEYS.bucket]: 'your-bucket', [WAREHOUSE_ENV_KEYS.sourceDsn]: SOURCE_DSN },
  ];
  for (const env of envs) {
    const description = describeConfig(env);
    assert.notEqual(description.archive_state, 'ready');
    const summary = renderDoctorSummary(description);
    assert.match(summary, /No window was exported, uploaded, verified or manifested/);
    assert.match(summary, /nothing became prune-eligible/);
    assert.equal(/archived successfully|archive complete/i.test(summary), false);
    for (const value of Object.values(env)) {
      if (value) assert.equal(summary.includes(value), false, 'the summary must never carry a configured value');
    }
  }
  assert.match(renderDoctorSummary(describeConfig({})), /NOT PROVISIONED/);
  const incomplete = renderDoctorSummary(describeConfig(completeEnv()));
  assert.match(incomplete, /CONFIGURATION INCOMPLETE/);
  assert.ok(incomplete.includes(`- \`${WAREHOUSE_ENV_KEYS.sourceDsn}\`: missing`));
});

test('the ready summary does not claim an archive happened', () => {
  const summary = renderDoctorSummary(describeConfig(completeEnv({ [WAREHOUSE_ENV_KEYS.sourceDsn]: SOURCE_DSN })));
  assert.match(summary, /configuration ready/);
  assert.match(summary, /reported by the conveyor step, not by this check/);
});

// The research reader. A research job that runs with the writer present can
// write, so the read path refuses to start rather than ignoring the writer.
const WRITER_SECRET = 'wr1ter-s3cr3t-value-must-not-print';

function readerEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    [WAREHOUSE_ENV_KEYS.endpoint]: 'https://fsn1.your-objectstorage.com',
    [WAREHOUSE_ENV_KEYS.region]: 'fsn1',
    [WAREHOUSE_ENV_KEYS.bucket]: 'unit-talk-archive',
    [WAREHOUSE_ENV_KEYS.readAccessKeyId]: 'READERKEYID00000001',
    [WAREHOUSE_ENV_KEYS.readSecretAccessKey]: 'reader-s3cr3t-value-0001',
    ...overrides,
  } as NodeJS.ProcessEnv;
}

test('research resolves the reader key from its own names, never the writer names', () => {
  const resolved = resolveResearchObjectStoreConfig(readerEnv());
  assert.equal(resolved.ok, true);
  assert.ok(resolved.ok && resolved.config.accessKeyId === 'READERKEYID00000001');
  assert.ok(resolved.ok && resolved.config.secretAccessKey === 'reader-s3cr3t-value-0001');
  assert.doesNotThrow(() => assertResearchEnvironment(readerEnv()));

  // The writer names alone do not satisfy the reader: no fallback.
  const writerOnly = resolveResearchObjectStoreConfig(
    readerEnv({
      [WAREHOUSE_ENV_KEYS.readAccessKeyId]: undefined,
      [WAREHOUSE_ENV_KEYS.readSecretAccessKey]: undefined,
    }),
  );
  assert.equal(writerOnly.ok, false);
  assert.ok(!writerOnly.ok && writerOnly.missing.includes(WAREHOUSE_ENV_KEYS.readAccessKeyId));
});

test('research refuses to start with the writer present, naming it and never its value', () => {
  for (const key of [WAREHOUSE_ENV_KEYS.accessKeyId, WAREHOUSE_ENV_KEYS.secretAccessKey]) {
    const env = readerEnv({ [key]: WRITER_SECRET });
    const resolved = resolveResearchObjectStoreConfig(env);
    assert.equal(resolved.ok, false, `${key} present must refuse`);
    assert.ok(!resolved.ok && resolved.code === 'warehouse_research_credential_forbidden');
    assert.ok(!resolved.ok && resolved.message.includes(key), 'the refusal names the variable');
    assert.equal(JSON.stringify(resolved).includes(WRITER_SECRET), false, 'and never its value');
    assert.throws(
      () => assertResearchEnvironment(env),
      (error: Error) => error.message.includes(key) && !error.message.includes(WRITER_SECRET),
    );
    const description = describeConfig(env);
    assert.equal(description.research_ready, false);
    assert.deepEqual(description.research_forbidden_present, [key]);
    assert.equal(JSON.stringify(description).includes(WRITER_SECRET), false);
  }
});

test('research refuses beside any production database credential', () => {
  for (const key of RESEARCH_FORBIDDEN_ENV_KEYS) {
    const resolved = resolveResearchObjectStoreConfig(readerEnv({ [key]: 'production-credential-value' }));
    assert.equal(resolved.ok, false, `${key} present must refuse`);
    assert.ok(!resolved.ok && resolved.message.includes(key));
  }
  // A placeholder is still something someone set beside the reader: refused too.
  assert.equal(resolveResearchObjectStoreConfig(readerEnv({ SUPABASE_SERVICE_ROLE_KEY: 'CHANGEME' })).ok, false);
  assert.ok(RESEARCH_FORBIDDEN_ENV_KEYS.includes('SUPABASE_SERVICE_ROLE_KEY'));
  assert.ok(RESEARCH_FORBIDDEN_ENV_KEYS.includes(WAREHOUSE_ENV_KEYS.sourceDsn));
});

test('doctor reads the writer and the reader configurations apart', () => {
  // The conveyor's environment is archive-ready and, by construction, not a
  // research environment; the reader's is the reverse.
  const writer = describeConfig(completeEnv({ [WAREHOUSE_ENV_KEYS.sourceDsn]: SOURCE_DSN }));
  assert.equal(writer.archive_state, 'ready');
  assert.equal(writer.research_ready, false);

  // The shared endpoint, region and bucket are archive keys too, so a reader
  // environment is an incomplete archive environment -- never a ready one.
  const reader = describeConfig(readerEnv());
  assert.equal(reader.archive_state, 'incomplete');
  assert.equal(reader.research_ready, true);
  assert.deepEqual(reader.research_forbidden_present, []);
  assert.ok(reader.keys.find((k) => k.key === WAREHOUSE_ENV_KEYS.readSecretAccessKey)?.secret);
  assert.equal(JSON.stringify(reader).includes('reader-s3cr3t-value-0001'), false);
});

test('redactSecrets also removes the reader key and production credentials', () => {
  const env = readerEnv({ SUPABASE_SERVICE_ROLE_KEY: 'service-role-value-123' });
  const redacted = redactSecrets('reader-s3cr3t-value-0001 and service-role-value-123', env);
  assert.equal(redacted.includes('reader-s3cr3t-value-0001'), false);
  assert.equal(redacted.includes('service-role-value-123'), false);
});
