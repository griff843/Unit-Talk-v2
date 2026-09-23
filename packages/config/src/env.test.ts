import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { before, after } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  RuntimeConfigError,
  assertProductionRuntimeConfig,
  createRuntimeConfigFailureLogFields,
  loadEnvironment,
  parseSyndicateMachineMode,
  requireSupabaseEnvironment,
  type AppEnv,
} from './env.js';

// `loadEnvironment(rootDir)` merges file-parsed values with already-present
// process.env entries, with process.env taking precedence. These tests write
// fixture .env.example/.env/local.env files to a temp rootDir and assert on
// the merged result — but if the REAL repo's local.env is sourced in the
// caller's shell (as ops:preflight's T1 checks require), the real values leak
// through ambient process.env and override the fixtures, breaking the
// assertions below. Not a flake — a real ambient-env dependency, same class
// as the fix in submission-service.test.ts / server.test.ts / qa-seed.test.ts
// / worker-runtime.test.ts. Snapshot and clear every var this file's fixtures
// exercise so results don't depend on the caller's shell env.
const ISOLATED_ENV_KEYS = [
  'SGO_API_KEY',
  'SGO_API_KEY_FALLBACK',
  'SGO_API_KEYS',
  'UNIT_TALK_DISTRIBUTION_TARGETS',
  'UNIT_TALK_ENABLED_TARGETS',
  'UNIT_TALK_ROLLOUT_CONFIG',
  'UNIT_TALK_INGESTOR_DB_LOCK_TIMEOUT_MS',
  'UNIT_TALK_INGESTOR_DB_MAX_BATCH_SIZE',
  'UNIT_TALK_INGESTOR_DB_MERGE_CHUNK_SIZE',
  'UNIT_TALK_INGESTOR_DB_RETRY_BACKOFF_MS',
  'UNIT_TALK_INGESTOR_DB_RETRY_MAX_ATTEMPTS',
  'UNIT_TALK_INGESTOR_DB_STATEMENT_TIMEOUT_MS',
  'UNIT_TALK_INGESTOR_OFFPEAK_POLL_MS',
  'UNIT_TALK_INGESTOR_PEAK_END_HOUR_ET',
  'UNIT_TALK_INGESTOR_PEAK_POLL_MS',
  'UNIT_TALK_INGESTOR_PEAK_START_HOUR_ET',
  'UNIT_TALK_INGESTOR_PINNACLE_ONLY_PEAK',
  'UNIT_TALK_INGESTOR_SCHEDULING_ENABLED',
  'UNIT_TALK_PROVIDER_OFFER_STAGING_MODE',
  'UNIT_TALK_PROVIDER_PAYLOAD_ARCHIVE_DIR',
  'UNIT_TALK_PROVIDER_PAYLOAD_ARCHIVE_MODE',
  'SYNDICATE_MACHINE_ENABLED',
] as const;
const previousIsolatedEnv: Record<string, string | undefined> = {};
before(() => {
  for (const key of ISOLATED_ENV_KEYS) {
    previousIsolatedEnv[key] = process.env[key];
    delete process.env[key];
  }
});
after(() => {
  for (const key of ISOLATED_ENV_KEYS) {
    const value = previousIsolatedEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test('parseSyndicateMachineMode accepts only exact active and parked declarations', () => {
  assert.deepEqual(parseSyndicateMachineMode('true'), {
    mode: 'active',
    requestedValue: 'true',
  });
  assert.deepEqual(parseSyndicateMachineMode('false'), {
    mode: 'parked',
    requestedValue: 'false',
  });

  for (const invalidValue of [undefined, '', 'TRUE', 'False', ' true ', '0', 'enabled']) {
    assert.throws(
      () => parseSyndicateMachineMode(invalidValue),
      /SYNDICATE_MACHINE_ENABLED must be declared as exactly "true".*"false"/,
    );
  }
});

test('loadEnvironment preserves syndicate-machine padding for strict validation', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-talk-env-syndicate-mode-'));

  try {
    fs.writeFileSync(
      path.join(rootDir, '.env.example'),
      [
        'UNIT_TALK_LEGACY_WORKSPACE=C:\\\\dev\\\\unit-talk-production',
        'LINEAR_TEAM_KEY=UTV2',
        'LINEAR_TEAM_NAME=unit-talk-v2',
        'NOTION_WORKSPACE_NAME=unit-talk-v2',
        'SLACK_WORKSPACE_NAME=unit-talk-v2',
        'SYNDICATE_MACHINE_ENABLED= true ',
      ].join('\n'),
    );

    const env = loadEnvironment(rootDir);

    assert.equal(env.SYNDICATE_MACHINE_ENABLED, ' true ');
    assert.throws(
      () => parseSyndicateMachineMode(env.SYNDICATE_MACHINE_ENABLED),
      /SYNDICATE_MACHINE_ENABLED must be declared as exactly "true".*"false"/,
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('loadEnvironment preserves both configured SGO API keys in priority order', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-talk-env-'));

  fs.writeFileSync(
    path.join(rootDir, '.env.example'),
    [
      'UNIT_TALK_LEGACY_WORKSPACE=C:\\\\dev\\\\unit-talk-production',
      'LINEAR_TEAM_KEY=UTV2',
      'LINEAR_TEAM_NAME=unit-talk-v2',
      'NOTION_WORKSPACE_NAME=unit-talk-v2',
      'SLACK_WORKSPACE_NAME=unit-talk-v2',
      'SGO_API_KEY=template-key',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(rootDir, '.env'),
    ['SGO_API_KEY=primary-key', 'SGO_API_KEY=secondary-key'].join('\n'),
  );
  fs.writeFileSync(path.join(rootDir, 'local.env'), 'SGO_API_KEY_FALLBACK=fallback-key\n');

  const env = loadEnvironment(rootDir);

  assert.equal(env.SGO_API_KEY, 'secondary-key');
  assert.equal(env.SGO_API_KEY_FALLBACK, 'fallback-key');
  assert.deepEqual(env.SGO_API_KEYS, ['template-key', 'primary-key', 'secondary-key', 'fallback-key']);

  fs.rmSync(rootDir, { recursive: true, force: true });
});

test('loadEnvironment exposes provider-offer staging mode from env files', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-talk-env-stage-'));

  fs.writeFileSync(
    path.join(rootDir, '.env.example'),
    [
      'UNIT_TALK_LEGACY_WORKSPACE=C:\\\\dev\\\\unit-talk-production',
      'LINEAR_TEAM_KEY=UTV2',
      'LINEAR_TEAM_NAME=unit-talk-v2',
      'NOTION_WORKSPACE_NAME=unit-talk-v2',
      'SLACK_WORKSPACE_NAME=unit-talk-v2',
      'UNIT_TALK_PROVIDER_OFFER_STAGING_MODE=off',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(rootDir, '.env'),
    'UNIT_TALK_PROVIDER_OFFER_STAGING_MODE=stage_only\n',
  );

  const env = loadEnvironment(rootDir);

  assert.equal(env.UNIT_TALK_PROVIDER_OFFER_STAGING_MODE, 'stage_only');

  fs.rmSync(rootDir, { recursive: true, force: true });
});

test('loadEnvironment exposes promotion target runtime env vars', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-talk-env-targets-'));

  fs.writeFileSync(
    path.join(rootDir, '.env.example'),
    [
      'UNIT_TALK_LEGACY_WORKSPACE=C:\\\\dev\\\\unit-talk-production',
      'LINEAR_TEAM_KEY=UTV2',
      'LINEAR_TEAM_NAME=unit-talk-v2',
      'NOTION_WORKSPACE_NAME=unit-talk-v2',
      'SLACK_WORKSPACE_NAME=unit-talk-v2',
      'UNIT_TALK_DISTRIBUTION_TARGETS=discord:canary',
      'UNIT_TALK_ENABLED_TARGETS=best-bets',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(rootDir, 'local.env'),
    [
      'UNIT_TALK_DISTRIBUTION_TARGETS=discord:best-bets,discord:trader-insights',
      'UNIT_TALK_ENABLED_TARGETS=best-bets,trader-insights',
      'UNIT_TALK_ROLLOUT_CONFIG={"best-bets":{"rolloutPct":50}}',
    ].join('\n'),
  );

  const env = loadEnvironment(rootDir);

  assert.equal(env.UNIT_TALK_DISTRIBUTION_TARGETS, 'discord:best-bets,discord:trader-insights');
  assert.equal(env.UNIT_TALK_ENABLED_TARGETS, 'best-bets,trader-insights');
  assert.equal(env.UNIT_TALK_ROLLOUT_CONFIG, '{"best-bets":{"rolloutPct":50}}');

  fs.rmSync(rootDir, { recursive: true, force: true });
});

test('loadEnvironment exposes provider ingestion DB and archive policy env vars', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-talk-env-provider-policy-'));

  fs.writeFileSync(
    path.join(rootDir, '.env.example'),
    [
      'UNIT_TALK_LEGACY_WORKSPACE=C:\\\\dev\\\\unit-talk-production',
      'LINEAR_TEAM_KEY=UTV2',
      'LINEAR_TEAM_NAME=unit-talk-v2',
      'NOTION_WORKSPACE_NAME=unit-talk-v2',
      'SLACK_WORKSPACE_NAME=unit-talk-v2',
      'UNIT_TALK_INGESTOR_DB_STATEMENT_TIMEOUT_MS=15000',
      'UNIT_TALK_INGESTOR_DB_LOCK_TIMEOUT_MS=5000',
      'UNIT_TALK_INGESTOR_DB_MAX_BATCH_SIZE=500',
      'UNIT_TALK_INGESTOR_DB_MERGE_CHUNK_SIZE=250',
      'UNIT_TALK_INGESTOR_DB_RETRY_MAX_ATTEMPTS=2',
      'UNIT_TALK_INGESTOR_DB_RETRY_BACKOFF_MS=1000',
      'UNIT_TALK_PROVIDER_PAYLOAD_ARCHIVE_MODE=fail_open',
      'UNIT_TALK_PROVIDER_PAYLOAD_ARCHIVE_DIR=out/provider-payload-archive',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(rootDir, '.env'),
    [
      'UNIT_TALK_INGESTOR_DB_STATEMENT_TIMEOUT_MS=22000',
      'UNIT_TALK_INGESTOR_DB_LOCK_TIMEOUT_MS=7000',
      'UNIT_TALK_INGESTOR_DB_MAX_BATCH_SIZE=321',
      'UNIT_TALK_INGESTOR_DB_MERGE_CHUNK_SIZE=123',
      'UNIT_TALK_INGESTOR_DB_RETRY_MAX_ATTEMPTS=4',
      'UNIT_TALK_INGESTOR_DB_RETRY_BACKOFF_MS=2500',
      'UNIT_TALK_PROVIDER_PAYLOAD_ARCHIVE_MODE=fail_closed',
      'UNIT_TALK_PROVIDER_PAYLOAD_ARCHIVE_DIR=tmp/provider-archive',
    ].join('\n'),
  );

  const env = loadEnvironment(rootDir);

  assert.equal(env.UNIT_TALK_INGESTOR_DB_STATEMENT_TIMEOUT_MS, '22000');
  assert.equal(env.UNIT_TALK_INGESTOR_DB_LOCK_TIMEOUT_MS, '7000');
  assert.equal(env.UNIT_TALK_INGESTOR_DB_MAX_BATCH_SIZE, '321');
  assert.equal(env.UNIT_TALK_INGESTOR_DB_MERGE_CHUNK_SIZE, '123');
  assert.equal(env.UNIT_TALK_INGESTOR_DB_RETRY_MAX_ATTEMPTS, '4');
  assert.equal(env.UNIT_TALK_INGESTOR_DB_RETRY_BACKOFF_MS, '2500');
  assert.equal(env.UNIT_TALK_PROVIDER_PAYLOAD_ARCHIVE_MODE, 'fail_closed');
  assert.equal(env.UNIT_TALK_PROVIDER_PAYLOAD_ARCHIVE_DIR, 'tmp/provider-archive');

  fs.rmSync(rootDir, { recursive: true, force: true });
});

test('loadEnvironment exposes ingestor adaptive scheduling env vars (UTV2-1272)', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-talk-env-scheduling-'));

  fs.writeFileSync(
    path.join(rootDir, '.env.example'),
    [
      'UNIT_TALK_LEGACY_WORKSPACE=C:\\\\dev\\\\unit-talk-production',
      'LINEAR_TEAM_KEY=UTV2',
      'LINEAR_TEAM_NAME=unit-talk-v2',
      'NOTION_WORKSPACE_NAME=unit-talk-v2',
      'SLACK_WORKSPACE_NAME=unit-talk-v2',
      'UNIT_TALK_INGESTOR_SCHEDULING_ENABLED=false',
      'UNIT_TALK_INGESTOR_PEAK_POLL_MS=30000',
      'UNIT_TALK_INGESTOR_OFFPEAK_POLL_MS=300000',
      'UNIT_TALK_INGESTOR_PEAK_START_HOUR_ET=12',
      'UNIT_TALK_INGESTOR_PEAK_END_HOUR_ET=24',
      'UNIT_TALK_INGESTOR_PINNACLE_ONLY_PEAK=false',
    ].join('\n'),
  );
  // Deploy/container env overrides (the case that previously fell through the gap:
  // values set outside .env files but read via AppEnv at runtime).
  fs.writeFileSync(
    path.join(rootDir, 'local.env'),
    [
      'UNIT_TALK_INGESTOR_SCHEDULING_ENABLED=true',
      'UNIT_TALK_INGESTOR_PEAK_POLL_MS=15000',
      'UNIT_TALK_INGESTOR_OFFPEAK_POLL_MS=120000',
      'UNIT_TALK_INGESTOR_PEAK_START_HOUR_ET=18',
      'UNIT_TALK_INGESTOR_PEAK_END_HOUR_ET=23',
      'UNIT_TALK_INGESTOR_PINNACLE_ONLY_PEAK=true',
    ].join('\n'),
  );

  const env = loadEnvironment(rootDir);

  assert.equal(env.UNIT_TALK_INGESTOR_SCHEDULING_ENABLED, 'true');
  assert.equal(env.UNIT_TALK_INGESTOR_PEAK_POLL_MS, '15000');
  assert.equal(env.UNIT_TALK_INGESTOR_OFFPEAK_POLL_MS, '120000');
  assert.equal(env.UNIT_TALK_INGESTOR_PEAK_START_HOUR_ET, '18');
  assert.equal(env.UNIT_TALK_INGESTOR_PEAK_END_HOUR_ET, '23');
  assert.equal(env.UNIT_TALK_INGESTOR_PINNACLE_ONLY_PEAK, 'true');

  fs.rmSync(rootDir, { recursive: true, force: true });
});

test('assertProductionRuntimeConfig rejects ambiguous production autorun one-cycle mode', () => {
  assert.throws(
    () =>
      assertProductionRuntimeConfig(makeProductionEnv(), {
        service: 'ingestor',
        runtimeModeKey: 'UNIT_TALK_INGESTOR_RUNTIME_MODE',
        persistenceMode: 'database',
        dryRun: false,
        autorun: true,
        maxCyclesPerRun: 1,
        maxCyclesKey: 'UNIT_TALK_INGESTOR_MAX_CYCLES',
        prohibitSingleCycleAutorunInProduction: true,
      }),
    (error: unknown) => {
      assert.ok(error instanceof RuntimeConfigError);
      assert.equal(error.code, 'RUNTIME_AUTORUN_SINGLE_CYCLE_AMBIGUOUS');
      assert.deepEqual(error.missingKeys, ['UNIT_TALK_INGESTOR_MAX_CYCLES']);
      assert.match(
        error.message,
        /UNIT_TALK_INGESTOR_MAX_CYCLES=0.*or >1/i,
      );
      return true;
    },
  );
});

test('createRuntimeConfigFailureLogFields classifies missing database credentials without leaking secrets', () => {
  const error = new RuntimeConfigError({
    code: 'RUNTIME_REQUIRED_ENV_MISSING',
    service: 'api',
    missingKeys: ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
    message:
      'api production runtime is missing required env vars: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.',
  });

  const fields = createRuntimeConfigFailureLogFields(
    makeProductionEnv(),
    {
      service: 'api',
      runtimeModeKey: 'UNIT_TALK_API_RUNTIME_MODE',
      persistenceMode: 'in_memory',
      dryRun: false,
    },
    error,
  );

  assert.equal(fields.category, 'database_credentials');
  assert.equal(fields.service, 'api');
  assert.equal(fields.runtimeMode, 'fail_closed');
  assert.equal(fields.productionLike, true);
  assert.deepEqual(fields.missingKeys, [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]);
  assert.equal(JSON.stringify(fields).includes('super-secret'), false);
});

test('createRuntimeConfigFailureLogFields classifies missing service auth as service_auth', () => {
  const error = new RuntimeConfigError({
    code: 'RUNTIME_REQUIRED_ENV_MISSING',
    service: 'discord-bot',
    missingKeys: ['UNIT_TALK_BOT_API_KEY'],
    message:
      'discord-bot production runtime is missing required env vars: UNIT_TALK_BOT_API_KEY.',
  });

  const fields = createRuntimeConfigFailureLogFields(
    makeProductionEnv(),
    {
      service: 'discord-bot',
      runtimeModeKey: 'UNIT_TALK_DISCORD_BOT_RUNTIME_MODE',
      persistenceMode: 'not_applicable',
      dryRun: false,
    },
    error,
  );

  assert.equal(fields.category, 'service_auth');
  assert.equal(fields.runtimeMode, 'fail_closed');
  assert.deepEqual(fields.missingKeys, ['UNIT_TALK_BOT_API_KEY']);
});

function makeProductionEnv(): AppEnv {
  return {
    NODE_ENV: 'production',
    UNIT_TALK_APP_ENV: 'production',
    UNIT_TALK_ACTIVE_WORKSPACE: 'C:\\dev\\unit-talk-v2',
    UNIT_TALK_LEGACY_WORKSPACE: 'C:\\dev\\unit-talk-production',
    LINEAR_TEAM_KEY: 'UTV2',
    LINEAR_TEAM_NAME: 'unit-talk-v2',
    NOTION_WORKSPACE_NAME: 'unit-talk-v2',
    SLACK_WORKSPACE_NAME: 'unit-talk-v2',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'super-secret',
    UNIT_TALK_API_RUNTIME_MODE: 'fail_closed',
    UNIT_TALK_INGESTOR_RUNTIME_MODE: 'fail_closed',
    UNIT_TALK_DISCORD_BOT_RUNTIME_MODE: 'fail_closed',
  };
}

// ---------------------------------------------------------------------------
// UTV2-1923 -- Command Center production configuration
//
// Production Command Center could not start from the env file `deploy.yml`
// writes for it. The failure was serial and silent: the container reported one
// missing variable, and on being handed it reported the next. Six values were
// demanded in total, and the surface reads none of them.
//
// Five were workspace metadata (`UNIT_TALK_LEGACY_WORKSPACE`, `LINEAR_TEAM_*`,
// `NOTION_WORKSPACE_NAME`, `SLACK_WORKSPACE_NAME`) that no runtime service
// reads. The sixth was `SUPABASE_ANON_KEY`, demanded by the credential check
// even for a caller that opens the connection with the service-role key --
// while `deploy/production/nextjs-entrypoint.sh` states the opposite intent in
// its own comment: "the anon key is not a substitute and is not used".
// ---------------------------------------------------------------------------

const COMMAND_CENTER_ENV_ISOLATION = [
  'UNIT_TALK_LEGACY_WORKSPACE',
  'LINEAR_TEAM_KEY',
  'LINEAR_TEAM_NAME',
  'NOTION_WORKSPACE_NAME',
  'SLACK_WORKSPACE_NAME',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
];

/**
 * Runs `body` with process.env holding exactly `values` for the keys above and
 * nothing else, then restores. The repo's own local.env is commonly sourced in
 * the shell that runs these tests, so without this a real
 * `UNIT_TALK_LEGACY_WORKSPACE` leaks in and the assertion passes for the wrong
 * reason -- the same ambient-env trap the header of this file describes.
 */
function withOnly(values: Record<string, string>, body: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of COMMAND_CENTER_ENV_ISOLATION) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }

  try {
    body();
  } finally {
    for (const key of COMMAND_CENTER_ENV_ISOLATION) {
      const value = saved[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    for (const key of Object.keys(values)) {
      if (!COMMAND_CENTER_ENV_ISOLATION.includes(key)) {
        delete process.env[key];
      }
    }
  }
}

function emptyRoot(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `unit-talk-env-${label}-`));
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * The keys `deploy.yml` actually writes into `.env.command-center`, read out of
 * the workflow rather than restated here.
 *
 * Restating them would make this test agree with itself and prove nothing: the
 * defect was precisely that the file the workflow writes and the file the app
 * needs had drifted apart. Parsing the workflow is what couples the two, so
 * deleting a key from the printf below breaks this test.
 */
function commandCenterEnvKeysWrittenByDeployWorkflow(): string[] {
  const workflow = fs.readFileSync(
    path.join(REPO_ROOT, '.github', 'workflows', 'deploy.yml'),
    'utf8',
  );

  const blocks = workflow
    .split("cat > '$DEPLOY_PATH/.env.command-center'")
    .slice(0, -1)
    .map((chunk) => chunk.slice(chunk.lastIndexOf("printf '%s\\n' \\")));

  assert.ok(
    blocks.length >= 2,
    'expected deploy.yml to write .env.command-center in both the canary and promote jobs',
  );

  const keySets = blocks.map((block) =>
    [...block.matchAll(/^\s*"([A-Z0-9_]+)=/gm)].map((match) => match[1] as string),
  );

  // The canary and promote writers must not drift apart either -- that exact
  // divergence between two steps of one job was the 2026-09-16 edge outage.
  for (const keys of keySets) {
    assert.deepEqual(keys, keySets[0]);
  }

  return keySets[0] as string[];
}

test('the env file deploy.yml writes is sufficient for the Command Center data client', () => {
  const keys = commandCenterEnvKeysWrittenByDeployWorkflow();
  const rootDir = emptyRoot('cc-deploy-contract');

  // Every key the workflow writes, and nothing else. A container has no
  // local.env/.env/.env.example at its workspace root, so an empty rootDir is
  // the honest fixture: whatever the file does not carry does not exist.
  const written: Record<string, string> = {};
  for (const key of keys) {
    written[key] = key === 'SUPABASE_URL' ? 'https://example.supabase.co' : `value-for-${key}`;
  }

  try {
    withOnly(written, () => {
      const env = loadEnvironment(rootDir);
      const connection = requireSupabaseEnvironment(env, 'service_role');

      assert.equal(connection.role, 'service_role');
      assert.equal(connection.url, 'https://example.supabase.co');
      assert.equal(connection.key, written['SUPABASE_SERVICE_ROLE_KEY']);
    });
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }

  // The contract this test defends is that the workflow need not ship the anon
  // key to this surface. If that key is ever added to the writer, the entrypoint
  // comment saying it "is not used" has gone stale and both must be revisited.
  assert.ok(
    !keys.includes('SUPABASE_ANON_KEY'),
    'Command Center opens its connection with the service-role key; do not distribute the anon key to it',
  );
});

test('loadEnvironment does not demand workspace metadata no runtime service reads', () => {
  const rootDir = emptyRoot('cc-workspace-metadata');

  try {
    withOnly(
      {
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      },
      () => {
        const env = loadEnvironment(rootDir);

        assert.equal(env.UNIT_TALK_LEGACY_WORKSPACE, undefined);
        assert.equal(env.LINEAR_TEAM_KEY, undefined);
        assert.equal(env.LINEAR_TEAM_NAME, undefined);
        assert.equal(env.NOTION_WORKSPACE_NAME, undefined);
        assert.equal(env.SLACK_WORKSPACE_NAME, undefined);
      },
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('requireSupabaseEnvironment still fails closed on the credential each role uses', () => {
  const base: AppEnv = makeProductionEnv();

  // Service role: missing service-role key refuses, and the anon key present
  // alongside it is not accepted as a substitute.
  assert.throws(
    () =>
      requireSupabaseEnvironment(
        { ...base, SUPABASE_SERVICE_ROLE_KEY: undefined },
        'service_role',
      ),
    /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required/,
  );

  // Anon role: unchanged, and the service-role key is likewise no substitute.
  assert.throws(
    () => requireSupabaseEnvironment({ ...base, SUPABASE_ANON_KEY: undefined }, 'anon'),
    /SUPABASE_URL and SUPABASE_ANON_KEY are required/,
  );

  // A missing URL refuses for either role.
  for (const role of ['anon', 'service_role'] as const) {
    assert.throws(
      () => requireSupabaseEnvironment({ ...base, SUPABASE_URL: undefined }, role),
      /SUPABASE_URL and SUPABASE_/,
    );
  }

  // Each role returns its own key, never the other's.
  assert.equal(requireSupabaseEnvironment(base, 'anon').key, base.SUPABASE_ANON_KEY);
  assert.equal(
    requireSupabaseEnvironment(base, 'service_role').key,
    base.SUPABASE_SERVICE_ROLE_KEY,
  );
});
