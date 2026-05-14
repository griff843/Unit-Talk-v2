import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  RuntimeConfigError,
  assertProductionRuntimeConfig,
  createRuntimeConfigFailureLogFields,
  loadEnvironment,
  type AppEnv,
} from './env.js';

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
