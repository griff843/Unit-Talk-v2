#!/usr/bin/env node
// UTV2-1850 — the execution site for apps/smart-form's Playwright suite.
//
// The suite exists and works (`pnpm test:e2e:fixture`, 25 specs), and until this
// lane nothing ran it: UTV2-1847 rewrote the Playwright config but touched no
// package script and no workflow, and the three qa workflows each run the
// qa-agent's own Playwright project rather than this one.
//
// `verify:static` already invokes `pnpm --filter @unit-talk/smart-form verify`,
// so this package's own `verify` script is an execution site that is reached by
// the required `verify` check with no workflow edit. That is exactly why the
// wiring is gated rather than unconditional: running Playwright there would also
// require `playwright install chromium --with-deps` inside a REQUIRED check,
// which changes what that check does and how long it takes. `ci.yml` never
// mentions Playwright today. That is a decision about required-check behaviour,
// not a scripting detail, and UTV2-1850 acceptance 4 says explicitly that if it
// cannot be made defensibly within this lane's tier it is left opt-in and
// recorded rather than slipped in.
//
// So: the wiring is complete and fails closed the moment the flag is set, and
// setting it in CI is a separate, reviewable one-line change.
//
// Fail-closed direction matters here. The gate defaults to NOT running, which is
// a coverage decision, never a correctness one -- when it does run, a failing
// suite fails `verify`. It cannot report success for a suite that failed.

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const E2E_ENV_FLAG = 'UNIT_TALK_SMART_FORM_E2E';
export const QA_AUTH_BYPASS_ENV_FLAG = 'NEXT_PUBLIC_SMART_FORM_QA_AUTH_BYPASS';

const FIXTURE_MODE = '--fixture';
const QA_AUTH_BYPASS_ARGUMENT = `${QA_AUTH_BYPASS_ENV_FLAG}=1`;
const BLOCKED_DATABASE_ENV_KEY = /SUPABASE|DATABASE_URL|SERVICE_ROLE/iu;

/**
 * Pure. Decides whether the e2e suite runs, from the environment alone.
 *
 * Exactly `'1'` enables it. Anything else -- unset, empty, `'0'`, `'true'`,
 * `'yes'` -- does not. A permissive truthiness check would let a stray value
 * turn Playwright on inside a required check by accident, which is the thing
 * this gate exists to keep deliberate.
 */
export function resolveE2eGate(env) {
  const raw = env[E2E_ENV_FLAG];
  if (raw === '1') {
    return { run: true, reason: `${E2E_ENV_FLAG}=1` };
  }
  return {
    run: false,
    reason: raw === undefined
      ? `${E2E_ENV_FLAG} is not set`
      : `${E2E_ENV_FLAG} is ${JSON.stringify(raw)}, not "1"`,
  };
}

export function resolvePnpmInvocation(platform, args) {
  return platform === 'win32'
    ? { command: 'cmd.exe', args: ['/d', '/s', '/c', 'pnpm', ...args] }
    : { command: 'pnpm', args };
}

export function createContainedE2eEnv(env) {
  const childEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (!BLOCKED_DATABASE_ENV_KEY.test(key)) {
      childEnv[key] = value;
    }
  }
  return {
    ...childEnv,
    [QA_AUTH_BYPASS_ENV_FLAG]: '1',
    UNIT_TALK_API_RUNTIME_MODE: 'fail_open',
    UNIT_TALK_QA_SEED_ENABLED: 'true',
  };
}

function childExitCode(result, stderr) {
  if (result.error) {
    stderr.write(`smart-form e2e: failed to start playwright: ${result.error.message}\n`);
    return 1;
  }
  // A signal death has a null status. Treating that as success would report a
  // killed suite as a passing one, which is the failure this file must not have.
  return result.status === null ? 1 : result.status;
}

export function runE2eGate({
  env,
  platform,
  spawnSyncFn = spawnSync,
  stdout = process.stdout,
  stderr = process.stderr,
}) {
  const gate = resolveE2eGate(env);
  if (!gate.run) {
    stdout.write(
      `smart-form e2e: not run (${gate.reason}).\n`
      + `Set ${E2E_ENV_FLAG}=1 to run it. It requires a Playwright browser:\n`
      + '  pnpm exec playwright install chromium --with-deps\n',
    );
    return 0;
  }
  stdout.write(`smart-form e2e: running (${gate.reason})\n`);
  const invocation = resolvePnpmInvocation(platform, ['test:e2e:fixture']);
  const result = spawnSyncFn(invocation.command, invocation.args, {
    env: createContainedE2eEnv(env),
    stdio: 'inherit',
  });
  return childExitCode(result, stderr);
}

export function runFixtureSuite({
  env,
  platform,
  spawnSyncFn = spawnSync,
  stderr = process.stderr,
}) {
  const invocation = resolvePnpmInvocation(
    platform,
    [
      'exec',
      'playwright',
      'test',
      '-c',
      'playwright.config.ts',
      'e2e/phase-one.spec.ts',
      'e2e/smart-form-submission.spec.ts',
    ],
  );
  const result = spawnSyncFn(
    invocation.command,
    invocation.args,
    {
      env: createContainedE2eEnv(env),
      stdio: 'inherit',
    },
  );
  return childExitCode(result, stderr);
}

export function isDirectExecution(moduleUrl, argvEntry, toFileUrl = pathToFileURL) {
  return argvEntry !== undefined && moduleUrl === toFileUrl(argvEntry).href;
}

function main(args) {
  if (args[0] === FIXTURE_MODE) {
    if (args[1] !== QA_AUTH_BYPASS_ARGUMENT) {
      process.stderr.write(
        `smart-form e2e: ${FIXTURE_MODE} requires ${QA_AUTH_BYPASS_ARGUMENT}\n`,
      );
      return 1;
    }
    return runFixtureSuite({ env: process.env, platform: process.platform });
  }
  return runE2eGate({ env: process.env, platform: process.platform });
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  process.exit(main(process.argv.slice(2)));
}
