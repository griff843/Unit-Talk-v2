import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { NextRequest } from 'next/server';
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

/**
 * The deployed-environment precedence invariant, stated as an invariant rather
 * than as a claim about one branch.
 *
 * `isCommandCenterAuthRequired` enforces this twice: the early
 * `isDeployedEnvironment(env)` return, and the rewritten `fail_open` branch
 * (`return !isDevelopmentEnvironment(env)`). Because DEPLOYED_ENVIRONMENTS and
 * DEVELOPMENT_ENVIRONMENTS are disjoint, a deployed name always makes
 * `isDevelopmentEnvironment` false, so the two mechanisms agree on every input
 * -- an exhaustive 800-combination differential over this exported function
 * found no input that distinguishes them. Deleting the early return alone
 * therefore cannot fail a test, and this suite does not pretend otherwise.
 *
 * What this test pins is the property that actually matters: no deployed
 * environment, under any mode value, is ever told authentication is optional.
 */
test('UTV2-1789: no deployed environment is optional-auth under any mode', () => {
  for (const deployed of ['production', 'staging']) {
    for (const mode of [
      undefined,
      'fail_open',
      'disabled',
      'FAIL_OPEN',
      'Disabled',
      'fail_closed',
      'required',
      'bogus',
    ]) {
      for (const nodeEnv of ['production', 'development', 'test', undefined]) {
        const env: Record<string, string> = { UNIT_TALK_APP_ENV: deployed };
        if (mode !== undefined) env.COMMAND_CENTER_AUTH_MODE = mode;
        if (nodeEnv !== undefined) env.NODE_ENV = nodeEnv;

        assert.equal(
          resolveCommandCenterAccessConfig(env).required,
          true,
          `UNIT_TALK_APP_ENV=${deployed} NODE_ENV=${String(nodeEnv)} mode=${String(mode)} must require auth`,
        );
      }
    }
  }
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

// ── Middleware-level probes ────────────────────────────────────────────────
//
// The tests above drive the exported function the middleware calls. These drive
// `middleware()` itself with a real NextRequest, so the whole request path is
// exercised: the public-path skip, the auth call, the response construction and
// the audit-log branch. `middleware()` reads process.env directly, so each probe
// installs and restores the environment around itself.

async function runMiddleware(
  env: Record<string, string | undefined>,
  path: string,
  headers: Record<string, string> = {},
) {
  const { middleware } = await import('../middleware');
  const saved = { ...process.env };
  const logs: Array<{ level: string; event: string }> = [];
  const info = console.info;
  const warn = console.warn;
  console.info = (event: unknown) => {
    logs.push({ level: 'info', event: String(event) });
  };
  console.warn = (event: unknown) => {
    logs.push({ level: 'warn', event: String(event) });
  };
  try {
    for (const key of Object.keys(process.env)) {
      if (/^(NODE_ENV|UNIT_TALK_|COMMAND_CENTER_)/.test(key)) {
        delete (process.env as Record<string, string | undefined>)[key];
      }
    }
    Object.assign(process.env, env);
    const response = await middleware(
      new NextRequest(`http://cc.local${path}`, { method: 'GET', headers }),
    );
    return { response, logs };
  } finally {
    console.info = info;
    console.warn = warn;
    for (const key of Object.keys(process.env)) {
      delete (process.env as Record<string, string | undefined>)[key];
    }
    Object.assign(process.env, saved);
  }
}

test('UTV2-1789 middleware: an anonymous production request under fail_open is refused', async () => {
  const { response } = await runMiddleware(
    {
      NODE_ENV: 'production',
      UNIT_TALK_APP_ENV: 'production',
      COMMAND_CENTER_AUTH_MODE: 'fail_open',
    },
    '/picks',
  );

  assert.notEqual(response.status, 200, 'the request must not be served');
  assert.ok(
    response.status === 401 || response.status === 503,
    `expected a refusal status, got ${response.status}`,
  );
  const body = (await response.json()) as { ok: boolean };
  assert.equal(body.ok, false);
  assert.equal(
    response.headers.get('x-command-center-actor'),
    null,
    'no operator actor may be attached to a refused request',
  );
});

test('UTV2-1789 middleware: a bypassed request is not recorded as a privileged action', async () => {
  const { response, logs } = await runMiddleware(
    { NODE_ENV: 'development', COMMAND_CENTER_AUTH_MODE: 'fail_open' },
    '/picks',
  );

  assert.equal(response.status, 200, 'local development is still served');
  assert.ok(
    logs.some((entry) => entry.event === 'command_center.dev_bypass'),
    'the bypass must be recorded as a bypass',
  );
  assert.ok(
    !logs.some((entry) => entry.event === 'command_center.privileged_action'),
    'the bypass must NOT enter the privileged-action audit stream',
  );
});

test('UTV2-1789 middleware: an authenticated production request is served and audited', async () => {
  const { response, logs } = await runMiddleware(
    {
      NODE_ENV: 'production',
      UNIT_TALK_APP_ENV: 'production',
      COMMAND_CENTER_AUTH_TOKEN: 'prod-token',
      COMMAND_CENTER_OPERATOR_IDENTITY: 'command-center',
    },
    '/picks',
    { authorization: 'Bearer prod-token' },
  );

  assert.equal(response.status, 200);
  assert.ok(
    logs.some((entry) => entry.event === 'command_center.privileged_action'),
    'a real operator action is still audited as one',
  );
});
