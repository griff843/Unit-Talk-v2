import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  authenticateCommandCenterRequest,
  resolveCommandCenterAccessConfig,
} from './server-api';

/**
 * UTV2-1789.
 *
 * The defect these tests pin: `isCommandCenterAuthRequired` read
 * COMMAND_CENTER_AUTH_MODE *before* it read the deployment environment, so a
 * single `fail_open` turned authentication off everywhere -- including
 * production. `apps/command-center/.env.example` shipped exactly that value, so
 * the wide-open configuration was the one a deployment was most likely to copy.
 *
 * Every case below drives the real exported entry point the middleware calls.
 * None of them assert on the shape of the helper; they assert on the answer an
 * anonymous HTTP request actually gets.
 */

/** An anonymous request: no Authorization header at all. */
const ANONYMOUS = new Headers();

function authenticate(env: Record<string, string>) {
  return authenticateCommandCenterRequest({ headers: ANONYMOUS, env });
}

test('UTV2-1789: fail_open cannot open production', () => {
  const result = authenticate({
    NODE_ENV: 'production',
    UNIT_TALK_APP_ENV: 'production',
    COMMAND_CENTER_AUTH_MODE: 'fail_open',
  });

  assert.equal(result.ok, false, 'anonymous production request must be refused');
});

test('UTV2-1789: fail_open cannot open staging', () => {
  const result = authenticate({
    NODE_ENV: 'production',
    UNIT_TALK_APP_ENV: 'staging',
    COMMAND_CENTER_AUTH_MODE: 'fail_open',
  });

  assert.equal(result.ok, false, 'anonymous staging request must be refused');
});

test('UTV2-1789: every mode alias that used to disable auth is inert in production', () => {
  for (const mode of ['fail_open', 'disabled', 'FAIL_OPEN', 'Disabled']) {
    for (const variable of [
      'COMMAND_CENTER_AUTH_MODE',
      'UNIT_TALK_COMMAND_CENTER_AUTH_MODE',
      'UNIT_TALK_OPERATOR_RUNTIME_MODE',
    ]) {
      const result = authenticate({
        NODE_ENV: 'production',
        UNIT_TALK_APP_ENV: 'production',
        [variable]: mode,
      });

      assert.equal(
        result.ok,
        false,
        `${variable}=${mode} must not admit an anonymous production request`,
      );
    }
  }
});

test('UTV2-1789: a deployed environment with no credentials refuses rather than admits', () => {
  const result = authenticate({
    NODE_ENV: 'production',
    UNIT_TALK_APP_ENV: 'production',
  });

  assert.equal(result.ok, false);
  // 503, not 401: the deployment is misconfigured, and saying so is honest.
  // What matters for this lane is only that it is not `ok`.
  assert.equal(result.code, 'COMMAND_CENTER_AUTH_MISCONFIGURED');
});

test('UTV2-1789: an unlabelled runtime is treated as deployed, not as development', () => {
  // No NODE_ENV, no UNIT_TALK_APP_ENV. Previously this fell through to `false`
  // (auth not required). An unlabelled process is far more likely to be a
  // misconfigured deployment than a developer's laptop.
  const result = authenticate({ COMMAND_CENTER_AUTH_MODE: 'fail_open' });

  assert.equal(result.ok, false, 'an unlabelled runtime must require auth');
});

test('UTV2-1789: a production runtime is never told auth is optional', () => {
  const config = resolveCommandCenterAccessConfig({
    NODE_ENV: 'production',
    UNIT_TALK_APP_ENV: 'production',
    COMMAND_CENTER_AUTH_MODE: 'fail_open',
  });

  assert.equal(config.required, true);
});

test('UTV2-1789: valid production credentials still authenticate', () => {
  // The fix must not be a blanket refusal. A correctly configured production
  // deployment has to keep working, or the control would be proven by a change
  // that simply breaks the app.
  const result = authenticateCommandCenterRequest({
    headers: new Headers({ authorization: 'Bearer prod-token' }),
    env: {
      NODE_ENV: 'production',
      UNIT_TALK_APP_ENV: 'production',
      COMMAND_CENTER_AUTH_TOKEN: 'prod-token',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok === true ? result.auth.method : null, 'bearer');
});

test('UTV2-1789: a wrong production token is refused', () => {
  const result = authenticateCommandCenterRequest({
    headers: new Headers({ authorization: 'Bearer not-the-token' }),
    env: {
      NODE_ENV: 'production',
      UNIT_TALK_APP_ENV: 'production',
      COMMAND_CENTER_AUTH_TOKEN: 'prod-token',
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'COMMAND_CENTER_AUTH_INVALID');
});

test('UTV2-1789: the dev bypass still works where it is meant to', () => {
  const result = authenticate({
    NODE_ENV: 'development',
    COMMAND_CENTER_AUTH_MODE: 'fail_open',
  });

  assert.equal(result.ok, true, 'local development must not need credentials');
  assert.equal(
    result.ok === true ? result.auth.method : null,
    'dev_bypass',
    'and it must be labelled as a bypass, not as a real operator identity',
  );
});

test('UTV2-1789: the dev bypass is unreachable when development also names a deployed env', () => {
  // A runtime that claims both is not development. `UNIT_TALK_APP_ENV` naming a
  // real deployment wins over a NODE_ENV left at development by a build.
  const result = authenticate({
    NODE_ENV: 'development',
    UNIT_TALK_APP_ENV: 'production',
    COMMAND_CENTER_AUTH_MODE: 'fail_open',
  });

  assert.equal(result.ok, false);
});

test('UTV2-1789: development can still opt INTO fail-closed', () => {
  const result = authenticate({
    NODE_ENV: 'development',
    COMMAND_CENTER_AUTH_MODE: 'fail_closed',
  });

  assert.equal(result.ok, false);
});

test('UTV2-1789: an empty environment requires auth', () => {
  // No mode, no NODE_ENV, no UNIT_TALK_APP_ENV -- nothing at all. This is the
  // bare default, and it must land on "require authentication". Kept separate
  // from the unlabelled-runtime case above because that one sets a mode and so
  // exercises a different branch.
  const result = authenticate({});

  assert.equal(result.ok, false);
});

test('UTV2-1789: .env.example does not ship a value that disables auth', () => {
  // The shipped example file is the artifact that actually caused the exposure:
  // it carried COMMAND_CENTER_AUTH_MODE=fail_open, so the most-copied
  // configuration in the repo was the open one. Assert on the file, because the
  // code fix alone does not stop the next person from copying a bad default
  // into a variable this app has not yet been taught to ignore.
  const example = readFileSync(
    new URL('../../.env.example', import.meta.url),
    'utf8',
  );

  const modeLines = example
    .split('\n')
    .filter((line) => /^[A-Z_]*AUTH_MODE=/.test(line.trim()));

  assert.ok(modeLines.length > 0, 'expected an auth mode line to assert on');
  for (const line of modeLines) {
    assert.ok(
      !/=\s*(fail_open|disabled)\s*$/i.test(line),
      `.env.example must not default to an auth-disabling mode: ${line}`,
    );
  }
});
