import assert from 'node:assert/strict';
import test from 'node:test';
// Must precede every `next/*` import: this installs `globalThis.AsyncLocalStorage`,
// and Next's request storage singleton is created at module load.
import { FORGED_IDENTITY_HEADERS, withRequestContext } from './test-support/request-context';
import {
  UNAUTHENTICATED_ACTION_ERROR,
  requireAuthenticatedActor,
  resolveActorOrRefusal,
} from './require-actor';
import {
  PrivilegedAccessDeniedError,
  assertPrivilegedRequestAuthenticated,
  authenticateHeaderBag,
} from './request-auth';


function bag(values: Record<string, string>) {
  return {
    get(name: string): string | null {
      return values[name.toLowerCase()] ?? null;
    },
  };
}

test('a forged middleware actor header without credentials is refused', () => {
  withAuthEnv(
    {
      UNIT_TALK_APP_ENV: 'production',
      COMMAND_CENTER_AUTH_TOKEN: 'real-token',
    },
    () => {
      const result = authenticateHeaderBag(
        bag({
          'x-command-center-actor': 'attacker',
          'x-command-center-role': 'operator',
        }),
      );

      assert.equal(result.ok, false);
      assert.equal(result.ok ? null : result.code, 'COMMAND_CENTER_AUTH_REQUIRED');
    },
  );
});

test('valid bearer credentials are accepted without an actor header', () => {
  withAuthEnv(
    {
      UNIT_TALK_APP_ENV: 'production',
      COMMAND_CENTER_AUTH_TOKEN: 'real-token',
      COMMAND_CENTER_OPERATOR_IDENTITY: 'griff843',
    },
    () => {
      const result = authenticateHeaderBag(bag({ authorization: 'Bearer real-token' }));

      assert.deepEqual(result, {
        ok: true,
        actor: 'griff843',
        role: 'operator',
        method: 'bearer',
      });
    },
  );
});

test('valid basic credentials are accepted without an actor header', () => {
  withAuthEnv(
    {
      UNIT_TALK_APP_ENV: 'production',
      COMMAND_CENTER_AUTH_USERNAME: 'operator',
      COMMAND_CENTER_AUTH_PASSWORD: 'secret',
      COMMAND_CENTER_OPERATOR_IDENTITY: 'griff843',
    },
    () => {
      const credentials = Buffer.from('operator:secret').toString('base64');
      const result = authenticateHeaderBag(bag({ authorization: `Basic ${credentials}` }));

      assert.deepEqual(result, {
        ok: true,
        actor: 'griff843',
        role: 'operator',
        method: 'basic',
      });
    },
  );
});

test('development bypass is preserved and explicitly identified', () => {
  withAuthEnv(
    {
      NODE_ENV: 'development',
      COMMAND_CENTER_AUTH_MODE: 'disabled',
    },
    () => {
      assert.deepEqual(authenticateHeaderBag(bag({})), {
        ok: true,
        actor: 'command-center:dev-bypass',
        role: 'operator',
        method: 'dev_bypass',
      });
    },
  );
});

test('privileged assertion fails closed without a Next request context', async () => {
  await assert.rejects(
    () => assertPrivilegedRequestAuthenticated(),
    (error: unknown) => {
      assert.ok(error instanceof PrivilegedAccessDeniedError);
      assert.equal(error.code, 'COMMAND_CENTER_REQUEST_CONTEXT_UNAVAILABLE');
      return true;
    },
  );
});

function withAuthEnv(values: Record<string, string>, fn: () => void): void {
  const keys = [
    'NODE_ENV',
    'UNIT_TALK_APP_ENV',
    'COMMAND_CENTER_AUTH_MODE',
    'COMMAND_CENTER_AUTH_TOKEN',
    'COMMAND_CENTER_AUTH_USERNAME',
    'COMMAND_CENTER_AUTH_PASSWORD',
    'COMMAND_CENTER_OPERATOR_IDENTITY',
    'UNIT_TALK_COMMAND_CENTER_AUTH_MODE',
    'UNIT_TALK_COMMAND_CENTER_AUTH_TOKEN',
    'UNIT_TALK_COMMAND_CENTER_AUTH_USERNAME',
    'UNIT_TALK_COMMAND_CENTER_AUTH_PASSWORD',
    'UNIT_TALK_OPERATOR_RUNTIME_MODE',
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  for (const key of keys) delete process.env[key];
  Object.assign(process.env, values);

  try {
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('requireAuthenticatedActor refuses a request carrying forged identity headers', async () => {
  await withRequestAuthEnv(async () => {
    await assert.rejects(
      () => withRequestContext(FORGED_IDENTITY_HEADERS, () => requireAuthenticatedActor()),
      (error: unknown) => {
        assert.ok(error instanceof PrivilegedAccessDeniedError);
        assert.equal(error.code, 'COMMAND_CENTER_AUTH_REQUIRED');
        return true;
      },
    );
  });
});

test('resolveActorOrRefusal refuses a request carrying forged identity headers', async () => {
  await withRequestAuthEnv(async () => {
    const resolution = await withRequestContext(FORGED_IDENTITY_HEADERS, () =>
      resolveActorOrRefusal(),
    );

    assert.deepEqual(resolution, { ok: false, error: UNAUTHENTICATED_ACTION_ERROR });
  });
});

async function withRequestAuthEnv(fn: () => Promise<void>): Promise<void> {
  const previousAppEnv = process.env.UNIT_TALK_APP_ENV;
  const previousToken = process.env.COMMAND_CENTER_AUTH_TOKEN;
  process.env.UNIT_TALK_APP_ENV = 'production';
  process.env.COMMAND_CENTER_AUTH_TOKEN = 'real-token';
  try {
    await fn();
  } finally {
    if (previousAppEnv === undefined) delete process.env.UNIT_TALK_APP_ENV;
    else process.env.UNIT_TALK_APP_ENV = previousAppEnv;
    if (previousToken === undefined) delete process.env.COMMAND_CENTER_AUTH_TOKEN;
    else process.env.COMMAND_CENTER_AUTH_TOKEN = previousToken;
  }
}
