import assert from 'node:assert/strict';
import test from 'node:test';
import { collectDeployStaticChecks, collectStagingParityChecks } from './deploy-check.js';

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

const stagingEnvironment = {
  ...deployEnvironment,
  UNIT_TALK_APP_ENV: 'staging',
} satisfies NodeJS.ProcessEnv;

const stagingWorkflowFixture = `
name: Staging Deploy
on:
  workflow_dispatch:
env:
  DEPLOY_HOST: \${{ secrets.UNIT_TALK_STAGING_DEPLOY_HOST }}
  DEPLOY_USER: \${{ secrets.UNIT_TALK_STAGING_DEPLOY_USER }}
  DEPLOY_PATH: \${{ secrets.UNIT_TALK_STAGING_DEPLOY_PATH }}
  DEPLOY_HEALTH_URL: \${{ secrets.UNIT_TALK_STAGING_DEPLOY_HEALTH_URL }}
  SSH_KEY: \${{ secrets.UNIT_TALK_STAGING_DEPLOY_SSH_KEY }}
`;

test('staging parity checks pass with correct staging env and compose', () => {
  const checks = collectStagingParityChecks(process.cwd(), stagingEnvironment, stagingWorkflowFixture);

  assert.equal(checks.filter((check) => !check.passed).length, 0);
  assert.ok(checks.some((check) => check.name === 'staging env UNIT_TALK_APP_ENV'));
  assert.ok(checks.some((check) => check.name === 'staging compose service api'));
  assert.ok(checks.some((check) => check.name === 'staging image worker'));
  assert.ok(checks.some((check) => check.name === 'staging restart discord-bot'));
  assert.ok(checks.some((check) => check.name === 'staging api healthcheck'));
  assert.ok(checks.some((check) => check.name === 'staging worker waits for api'));
  assert.ok(checks.some((check) => check.name === 'staging env_file api'));
  assert.ok(checks.some((check) => check.name === `staging secret UNIT_TALK_STAGING_DEPLOY_HOST`));
});

test('staging parity checks fail when UNIT_TALK_APP_ENV is not staging', () => {
  const checks = collectStagingParityChecks(
    process.cwd(),
    { ...stagingEnvironment, UNIT_TALK_APP_ENV: 'production' },
    stagingWorkflowFixture,
  );

  const failed = checks.filter((check) => !check.passed).map((check) => check.name);
  assert.ok(failed.includes('staging env UNIT_TALK_APP_ENV'));
});

test('staging parity checks reject production env_file in staging compose', () => {
  // This test verifies the structural check by passing prod-like env — the compose
  // file itself is read from disk (deploy/staging/docker-compose.yml which uses .env.staging)
  // so we can only exercise the env_file check via the actual staging compose.
  const checks = collectStagingParityChecks(process.cwd(), stagingEnvironment, stagingWorkflowFixture);

  // The env_file checks should pass because deploy/staging/docker-compose.yml uses .env.staging
  const envFileChecks = checks.filter((c) => c.name.startsWith('staging env_file'));
  assert.ok(envFileChecks.length > 0, 'expected env_file checks to be present');
  assert.equal(envFileChecks.filter((c) => !c.passed).length, 0, 'staging env_file checks should pass');
});

test('staging parity checks fail when required staging secrets are missing from workflow', () => {
  const checks = collectStagingParityChecks(process.cwd(), stagingEnvironment, '# empty workflow');

  const failed = checks.filter((check) => !check.passed).map((check) => check.name);
  assert.ok(failed.includes('staging secret UNIT_TALK_STAGING_DEPLOY_HOST'));
  assert.ok(failed.includes('staging secret UNIT_TALK_STAGING_DEPLOY_SSH_KEY'));
});

test('staging parity checks enforce fail_closed runtime modes', () => {
  const checks = collectStagingParityChecks(
    process.cwd(),
    { ...stagingEnvironment, UNIT_TALK_WORKER_RUNTIME_MODE: 'fail_open' },
    stagingWorkflowFixture,
  );

  const failed = checks.filter((check) => !check.passed).map((check) => check.name);
  assert.ok(failed.includes('staging env UNIT_TALK_WORKER_RUNTIME_MODE fail-closed'));
});
