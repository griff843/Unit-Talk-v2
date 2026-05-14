import assert from 'node:assert/strict';
import test from 'node:test';
import { collectDeployStaticChecks } from './deploy-check.js';

const deployEnvironment = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  UNIT_TALK_API_RUNTIME_MODE: 'fail_closed',
  UNIT_TALK_WORKER_RUNTIME_MODE: 'fail_closed',
  UNIT_TALK_INGESTOR_RUNTIME_MODE: 'fail_closed',
  UNIT_TALK_DISCORD_BOT_RUNTIME_MODE: 'fail_closed',
  UNIT_TALK_INGESTOR_AUTORUN: 'true',
  UNIT_TALK_WORKER_AUTORUN: 'true',
  UNIT_TALK_WORKER_DRY_RUN: 'false',
  UNIT_TALK_WORKER_MAX_CYCLES: '0',
  UNIT_TALK_INGESTOR_MAX_CYCLES: '2',
  UNIT_TALK_INGESTOR_API_KEY: 'ingestor-key',
  UNIT_TALK_BOT_API_KEY: 'bot-key',
} satisfies NodeJS.ProcessEnv;

test('deploy static checks require durable runtime env and hosted topology', () => {
  const checks = collectDeployStaticChecks(process.cwd(), deployEnvironment);

  assert.equal(checks.filter((check) => !check.passed).length, 0);
  assert.ok(checks.some((check) => check.name === 'compose restart api'));
  assert.ok(checks.some((check) => check.name === 'compose worker waits for api'));
  assert.ok(checks.some((check) => check.name === 'production image api'));
  assert.ok(checks.some((check) => check.name === 'production discord-bot waits for api'));
  assert.ok(checks.some((check) => check.name === 'deploy workflow rollback path'));
  assert.ok(checks.some((check) => check.name === 'package script api:start'));
  assert.ok(checks.some((check) => check.name === 'env UNIT_TALK_WORKER_DRY_RUN disabled'));
  assert.ok(checks.some((check) => check.name === 'env UNIT_TALK_INGESTOR_MAX_CYCLES avoids one-cycle ambiguity'));
});

test('deploy static checks fail closed when production runtime env is missing', () => {
  const checks = collectDeployStaticChecks(process.cwd(), {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  });

  const failedNames = checks.filter((check) => !check.passed).map((check) => check.name);
  assert.ok(failedNames.includes('env SUPABASE_ANON_KEY'));
  assert.ok(failedNames.includes('env UNIT_TALK_API_RUNTIME_MODE'));
  assert.ok(failedNames.includes('env UNIT_TALK_WORKER_RUNTIME_MODE'));
  assert.ok(failedNames.includes('env UNIT_TALK_INGESTOR_RUNTIME_MODE'));
  assert.ok(failedNames.includes('env UNIT_TALK_DISCORD_BOT_RUNTIME_MODE'));
  assert.ok(failedNames.includes('env UNIT_TALK_INGESTOR_API_KEY'));
  assert.ok(failedNames.includes('env UNIT_TALK_BOT_API_KEY'));
});

test('deploy static checks reject production worker dry-run and one-cycle autorun ambiguity', () => {
  const checks = collectDeployStaticChecks(process.cwd(), {
    ...deployEnvironment,
    UNIT_TALK_WORKER_DRY_RUN: 'true',
    UNIT_TALK_WORKER_MAX_CYCLES: '1',
    UNIT_TALK_INGESTOR_MAX_CYCLES: '1',
  });

  const failed = checks.filter((check) => !check.passed).map((check) => check.name);
  assert.ok(failed.includes('env UNIT_TALK_WORKER_DRY_RUN disabled'));
  assert.ok(failed.includes('env UNIT_TALK_WORKER_MAX_CYCLES avoids one-cycle ambiguity'));
  assert.ok(failed.includes('env UNIT_TALK_INGESTOR_MAX_CYCLES avoids one-cycle ambiguity'));
});
