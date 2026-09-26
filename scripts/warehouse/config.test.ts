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
  PRODUCTION_CREDENTIAL_ENV_KEYS,
  REDACTION_FAILED_EVENT,
  SECRET_ENV_KEYS,
  WAREHOUSE_ENV_KEYS,
  formatRedactedJson,
  redactForPersistence,
  redactLogEvent,
  redactMessage,
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

// --- PM bounce on #1650: the full production alias inventory, and one redaction boundary ---

/**
 * Every production credential name the repository reads, with where it is read.
 * The PM named the first three as missing from the refusal inventory.
 */
const PRODUCTION_ALIASES: Record<string, string> = {
  SUPABASE_DATABASE_URL: 'scripts/db-inspect/lib.ts, scripts/ops/disk-growth-report.ts',
  HETZNER_DATABASE_URL: 'scripts/ops/disk-growth-report.ts, scripts/ops/compare-databases.ts',
  SUPABASE_ANON_KEY: 'packages/config/src/env.ts',
  SUPABASE_SERVICE_ROLE_KEY: 'packages/config/src/env.ts',
  SUPABASE_ACCESS_TOKEN: '.env.example, scripts/disk-growth-alert.ts',
  V1_SUPABASE_SERVICE_ROLE_KEY: 'scripts/shadow-clv-parity.ts',
  SUPABASE_DB_URL: 'workflow secret; scripts/db-inspect/lib.ts',
  SUPABASE_DB_POOLER_URL: 'workflow secret',
  SUPABASE_DB_PASSWORD: 'scripts/generate-types.mjs',
  DATABASE_URL: 'scripts/db-inspect/lib.ts, scripts/ops/disk-growth-report.ts',
  POSTGRES_URL: 'scripts/ci/schema-roundtrip-hash.ts',
  EXPECTED_DATABASE_URL: 'scripts/ops/compare-databases.ts',
  ACTUAL_DATABASE_URL: 'scripts/ops/compare-databases.ts',
  LIVE_DATABASE_URL: 'scripts/ops/compare-databases.ts',
};

test('research refuses beside every repository-supported production credential alias', () => {
  for (const [key, where] of Object.entries(PRODUCTION_ALIASES)) {
    assert.ok(PRODUCTION_CREDENTIAL_ENV_KEYS.includes(key), `${key} (${where}) is missing from the inventory`);
    assert.ok(RESEARCH_FORBIDDEN_ENV_KEYS.includes(key), `${key} (${where}) is not refused`);
    const resolved = resolveResearchObjectStoreConfig(readerEnv({ [key]: 'production-credential-value' }));
    assert.equal(resolved.ok, false, `${key} present must refuse a research command`);
    assert.ok(!resolved.ok && resolved.message.includes(key));
    assert.equal(resolved.ok, false);
    assert.equal(JSON.stringify(resolved).includes('production-credential-value'), false);
    assert.throws(() => assertResearchEnvironment(readerEnv({ [key]: 'production-credential-value' })));
  }
});

test('the PM-named aliases are each refused on their own', () => {
  for (const key of ['SUPABASE_DATABASE_URL', 'HETZNER_DATABASE_URL', 'SUPABASE_ANON_KEY']) {
    const description = describeConfig(readerEnv({ [key]: 'value-that-must-refuse' }));
    assert.equal(description.research_ready, false, `${key} alone must make research not ready`);
    assert.deepEqual(description.research_forbidden_present, [key]);
  }
});

test('the reader key itself is never in the refusal inventory', () => {
  assert.equal(RESEARCH_FORBIDDEN_ENV_KEYS.includes(WAREHOUSE_ENV_KEYS.readAccessKeyId), false);
  assert.equal(RESEARCH_FORBIDDEN_ENV_KEYS.includes(WAREHOUSE_ENV_KEYS.readSecretAccessKey), false);
});

/** Representative secrets, one per shape the redactor must remove. */
const REPRESENTATIVE_SECRETS = {
  uriPassword: 'uri-pass-7Q2x',
  poolerPassword: 'pooler-pass-K9m',
  libpqPassword: 'libpq-pass-Zr4',
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlLXZhbHVl',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretPair: 'wJalrXUtnFEMI-K7MDENG-bPxRfiCY',
  tokenPair: 'tok-3f9a1c2b7d',
  bearer: 'bearer-opaque-8c1d2e',
  supabasePat: 'sbp_0123456789abcdef0123456789',
  envOnly: 'opaque-env-only-value-51b7',
};

function secretBearingText(s = REPRESENTATIVE_SECRETS): string {
  return [
    `connect to postgresql://postgres.zfzdnfwdarxucxtaojxm:${s.uriPassword}@aws-0-us-east-2.pooler.supabase.com:6543/postgres failed`,
    `retry via postgres://reader:${s.poolerPassword}@db.example.test/postgres`,
    `host=db.example.test user=reader password=${s.libpqPassword} sslmode=require`,
    `apikey: ${s.jwt}`,
    `S3 error for AccessKeyId ${s.accessKeyId}`,
    `SecretAccessKey=${s.secretPair}`,
    `https://bucket.example/obj?token=${s.tokenPair}&x=1`,
    `Authorization: Bearer ${s.bearer}`,
    `management API refused ${s.supabasePat}`,
    `driver echoed ${s.envOnly} verbatim`,
  ].join('; ');
}

function assertNoSecret(serialized: string, label: string, s = REPRESENTATIVE_SECRETS): void {
  for (const [name, value] of Object.entries(s)) {
    assert.equal(serialized.includes(value), false, `${label}: ${name} leaked`);
  }
}

test('redactSecrets removes every representative credential shape', () => {
  const env = { HETZNER_DATABASE_URL: REPRESENTATIVE_SECRETS.envOnly } as NodeJS.ProcessEnv;
  const redacted = redactSecrets(secretBearingText(), env);
  assertNoSecret(redacted, 'redactSecrets');
  assert.ok(redacted.includes('[redacted:HETZNER_DATABASE_URL]'), 'an inventory value is named by its key');
  // What the operator needs to read the failure survives.
  assert.ok(redacted.includes('aws-0-us-east-2.pooler.supabase.com'));
  assert.ok(redacted.includes('sslmode=require'));
});

test('redactSecrets substitutes the value of every inventory alias present in the environment', () => {
  for (const key of PRODUCTION_CREDENTIAL_ENV_KEYS) {
    const value = `inventory-value-for-${key.toLowerCase()}`;
    const redacted = redactSecrets(`error: ${value}`, { [key]: value } as NodeJS.ProcessEnv);
    assert.equal(redacted.includes(value), false, `${key}'s value survived redaction`);
  }
});

test('redactLogEvent redacts strings at any depth, including keys and Error values', () => {
  const event = {
    event: 'warehouse.backfill',
    failures: [secretBearingText()],
    nested: { deeper: [{ error: new Error(secretBearingText()) }] },
    [`key=${REPRESENTATIVE_SECRETS.tokenPair}`]: 1,
  };
  const out = redactLogEvent(event, { SUPABASE_DATABASE_URL: REPRESENTATIVE_SECRETS.envOnly });
  assertNoSecret(JSON.stringify(out), 'redactLogEvent');
  assert.equal(out.event, 'warehouse.backfill');
});

test('redactLogEvent fails closed to fixed text when redaction throws', () => {
  const circular: Record<string, unknown> = { failures: [secretBearingText()] };
  circular.self = circular;
  assert.deepEqual(redactLogEvent(circular, {}), { ...REDACTION_FAILED_EVENT });

  const hostile = {
    get failures(): string {
      throw new Error(secretBearingText());
    },
  };
  const out = formatRedactedJson(hostile, undefined, {});
  assertNoSecret(out, 'hostile getter');
  assert.deepEqual(JSON.parse(out), { ...REDACTION_FAILED_EVENT });

  let deep: Record<string, unknown> = { failures: [secretBearingText()] };
  for (let i = 0; i < 64; i += 1) deep = { deep };
  assert.deepEqual(redactLogEvent(deep, {}), { ...REDACTION_FAILED_EVENT });
});

test('redactMessage fails closed on text it cannot process', () => {
  const env = new Proxy({} as NodeJS.ProcessEnv, {
    ownKeys: () => {
      throw new Error('env unavailable');
    },
  });
  const out = redactMessage(secretBearingText(), env);
  assertNoSecret(out, 'redactMessage');
  assert.match(out, /withheld/);
});

test('redactForPersistence removes secrets at any depth and throws rather than persisting on failure', () => {
  const env = { HETZNER_DATABASE_URL: 'postgres://u:env-only-9f3@h/db' } as NodeJS.ProcessEnv;
  const record = {
    windows: [{ failures: ['connect postgres://svc:pw-9f3@db.example.test:5432/x failed', 'echo postgres://u:env-only-9f3@h/db'] }],
  };
  const out = redactForPersistence(record, env);
  const text = JSON.stringify(out);
  assert.equal(text.includes('pw-9f3'), false);
  assert.equal(text.includes('env-only-9f3'), false);
  assert.match(text, /db\.example\.test/);
  assert.equal(out.windows[0].failures.length, 2);

  const circular: Record<string, unknown> = { a: 1 };
  circular.self = circular;
  assert.throws(() => redactForPersistence(circular, env));
});
