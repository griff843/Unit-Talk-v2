import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// @ts-expect-error -- the gate is plain ESM JavaScript with no type declarations;
// it is deliberately dependency-free so `verify` can run it before any build step.
import {
  E2E_ENV_FLAG,
  blockedDatabaseEnvSamples,
  QA_AUTH_BYPASS_ENV_FLAG,
  createContainedE2eEnv,
  isDirectExecution,
  resolveE2eGate,
  resolvePnpmInvocation,
  runE2eGate,
  runFixtureSuite,
} from '../scripts/run-e2e-gate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const gatePath = path.join(here, '..', 'scripts', 'run-e2e-gate.mjs');
const packageJsonPath = path.join(here, '..', 'package.json');
const silentWriter = { write: (_text: string) => true };

test('the e2e gate runs only on an exact "1"', () => {
  assert.equal(resolveE2eGate({ [E2E_ENV_FLAG]: '1' }).run, true);

  // Everything else must not run it. A permissive truthiness check would let a
  // stray value turn Playwright on inside a required check by accident.
  for (const value of ['', '0', 'true', 'yes', 'TRUE', ' 1', '1 ', 'on']) {
    assert.equal(
      resolveE2eGate({ [E2E_ENV_FLAG]: value }).run,
      false,
      `${JSON.stringify(value)} must not enable the e2e suite`,
    );
  }
  assert.equal(resolveE2eGate({}).run, false, 'an unset flag must not enable the e2e suite');
});

test('the gate says why it is not running, and names the flag that would', () => {
  const unset = resolveE2eGate({});
  assert.match(unset.reason, new RegExp(E2E_ENV_FLAG));
  const wrong = resolveE2eGate({ [E2E_ENV_FLAG]: 'true' });
  assert.match(wrong.reason, /not "1"/);
});

test('with the flag unset, the real launcher exits 0 and does not run playwright', () => {
  let stdout = '';
  let spawnCalled = false;
  const status = runE2eGate({
    env: {},
    platform: 'linux',
    spawnSyncFn: () => {
      spawnCalled = true;
      throw new Error('the disabled gate must not spawn');
    },
    stdout: { write: (text: string) => { stdout += text; return true; } },
    stderr: silentWriter,
  });
  assert.equal(status, 0);
  assert.equal(spawnCalled, false);
  assert.match(stdout, /smart-form e2e: not run/);
  assert.match(stdout, /playwright install chromium/);
  assert.doesNotMatch(stdout, /Running \d+ tests?/, 'it must not have started the suite');
});

test('entrypoint detection uses a file URL conversion instead of string concatenation', () => {
  const argvEntry = path.join(here, '..', 'scripts', 'run-e2e-gate.mjs');
  assert.equal(isDirectExecution(pathToFileURL(argvEntry).href, argvEntry), true);

  const windowsArgvEntry = String.raw`C:\Dev\Unit-Talk-v2\apps\smart-form\scripts\run-e2e-gate.mjs`;
  const windowsModuleUrl = 'file:///C:/Dev/Unit-Talk-v2/apps/smart-form/scripts/run-e2e-gate.mjs';
  assert.equal(
    isDirectExecution(
      windowsModuleUrl,
      windowsArgvEntry,
      () => new URL(windowsModuleUrl),
    ),
    true,
    'a Windows argv path must be compared after conversion to its canonical file URL',
  );
  assert.notEqual(windowsModuleUrl, `file://${windowsArgvEntry}`);

  const gateSource = readFileSync(gatePath, 'utf8');
  assert.match(
    gateSource,
    /if \(isDirectExecution\(import\.meta\.url, process\.argv\[1\]\)\)/u,
    'the executable entrypoint must use the portable comparison',
  );
  assert.doesNotMatch(gateSource, /import\.meta\.url === `file:\/\//u);
});

test('the launcher uses the repository pnpm invocation pattern on every platform', () => {
  assert.deepEqual(resolvePnpmInvocation('win32', ['test:e2e:fixture']), {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', 'pnpm', 'test:e2e:fixture'],
  });
  assert.deepEqual(resolvePnpmInvocation('linux', ['test:e2e:fixture']), {
    command: 'pnpm',
    args: ['test:e2e:fixture'],
  });
  assert.deepEqual(resolvePnpmInvocation('darwin', ['test:e2e:fixture']), {
    command: 'pnpm',
    args: ['test:e2e:fixture'],
  });
});

test('the contained child environment enables QA but does not forward database credentials', () => {
  const childEnv = createContainedE2eEnv({
    PATH: '/bin',
    SUPABASE_URL: 'https://staging.example.invalid',
    CI_SUPABASE_SECRET_KEY: 'secret',
    DATABASE_URL: 'postgres://production.example.invalid',
    ANOTHER_SERVICE_ROLE_TOKEN: 'secret',
  });

  assert.equal(childEnv.PATH, '/bin');
  assert.equal(childEnv[QA_AUTH_BYPASS_ENV_FLAG], '1');
  assert.equal(childEnv.UNIT_TALK_API_RUNTIME_MODE, 'fail_open');
  assert.equal(childEnv.UNIT_TALK_QA_SEED_ENABLED, 'true');
  assert.deepEqual(
    Object.keys(childEnv).filter((key) => /SUPABASE|DATABASE_URL|SERVICE_ROLE/iu.test(key)),
    [],
  );
});

test('with the flag set, the real launcher propagates a failing child status', () => {
  let invocation: { command?: string; args?: string[]; shell?: unknown } = {};
  const status = runE2eGate({
    env: { [E2E_ENV_FLAG]: '1' },
    platform: 'win32',
    spawnSyncFn: (command: string, args: string[], options: { shell?: unknown }) => {
      invocation = { command, args, shell: options.shell };
      return { status: 7, signal: null, output: [], pid: 1, stdout: null, stderr: null };
    },
    stdout: silentWriter,
    stderr: silentWriter,
  });

  assert.equal(status, 7, 'the real gate must return the failing child status verbatim');
  assert.deepEqual(invocation, {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', 'pnpm', 'test:e2e:fixture'],
    shell: undefined,
  });
});

test('the real launcher reports signal death as failure', () => {
  const status = runE2eGate({
    env: { [E2E_ENV_FLAG]: '1' },
    platform: 'linux',
    spawnSyncFn: () => ({
      status: null,
      signal: 'SIGTERM',
      output: [],
      pid: 1,
      stdout: null,
      stderr: null,
    }),
    stdout: silentWriter,
    stderr: silentWriter,
  });
  assert.equal(status, 1, 'a child killed by a signal must fail the gate');
});

test('the directly runnable fixture script uses the portable contained launcher', () => {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    scripts: Record<string, string>;
  };
  assert.equal(
    packageJson.scripts['test:e2e:fixture'],
    'node scripts/run-e2e-gate.mjs --fixture NEXT_PUBLIC_SMART_FORM_QA_AUTH_BYPASS=1',
  );

  const leakProbeKeys: string[] = blockedDatabaseEnvSamples();
  const leakProbeEnv = Object.fromEntries(
    leakProbeKeys.map((key) => [key, 'must-not-leak']),
  );

  let invocation: { command?: string; args?: string[]; env?: Record<string, string> } = {};
  const status = runFixtureSuite({
    env: { PATH: '/bin', ...leakProbeEnv },
    platform: 'win32',
    spawnSyncFn: (
      command: string,
      args: string[],
      options: { env?: Record<string, string> },
    ) => {
      invocation = { command, args, env: options.env };
      return { status: 0, signal: null, output: [], pid: 1, stdout: null, stderr: null };
    },
    stderr: silentWriter,
  });

  assert.equal(status, 0);
  assert.equal(invocation.command, 'cmd.exe');
  assert.deepEqual(invocation.args, [
    '/d',
    '/s',
    '/c',
    'pnpm',
    'exec',
    'playwright',
    'test',
    '-c',
    'playwright.config.ts',
    'e2e/phase-one.spec.ts',
    'e2e/smart-form-submission.spec.ts',
  ]);
  assert.equal(invocation.env?.[QA_AUTH_BYPASS_ENV_FLAG], '1');
  // Every branch of the runner's own denylist, not one hand-picked example.
  // The names come from `blockedDatabaseEnvSamples()`, which derives them from
  // `BLOCKED_DATABASE_ENV_KEY` itself, so widening the denylist widens this
  // assertion automatically and the two cannot drift apart.
  assert.ok(leakProbeKeys.length >= 3, 'the denylist must contribute probes, or this asserts nothing');
  for (const key of leakProbeKeys) {
    assert.equal(
      invocation.env?.[key],
      undefined,
      `${key} matches the runner's database-credential denylist and must not reach the child`,
    );
  }
});
