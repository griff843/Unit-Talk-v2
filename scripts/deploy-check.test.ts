import assert from 'node:assert/strict';
import test from 'node:test';
import { collectDeployStaticChecks } from './deploy-check.js';

const deployEnvironment = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  UNIT_TALK_API_RUNTIME_MODE: 'fail_closed',
  UNIT_TALK_INGESTOR_AUTORUN: 'true',
  UNIT_TALK_WORKER_AUTORUN: 'true',
} satisfies NodeJS.ProcessEnv;

test('deploy static checks require durable runtime env and hosted topology', () => {
  const checks = collectDeployStaticChecks(process.cwd(), deployEnvironment);

  assert.equal(checks.filter((check) => !check.passed).length, 0);
  assert.ok(checks.some((check) => check.name === 'compose restart api'));
  assert.ok(checks.some((check) => check.name === 'compose worker waits for api'));
  assert.ok(checks.some((check) => check.name === 'package script api:start'));
});

test('deploy static checks fail closed when production runtime env is missing', () => {
  const checks = collectDeployStaticChecks(process.cwd(), {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  });

  const failedNames = checks.filter((check) => !check.passed).map((check) => check.name);
  assert.deepEqual(failedNames, [
    'env UNIT_TALK_API_RUNTIME_MODE',
    'env UNIT_TALK_INGESTOR_AUTORUN',
    'env UNIT_TALK_WORKER_AUTORUN',
  ]);
});
