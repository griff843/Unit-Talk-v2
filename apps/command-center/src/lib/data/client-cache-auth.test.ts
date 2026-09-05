import { AsyncLocalStorage } from 'node:async_hooks';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { RequestStore } from 'next/dist/server/app-render/work-unit-async-storage.external';
import type { WorkStore } from 'next/dist/server/app-render/work-async-storage.external';
import { withLoopbackSupabaseTarget, withWorkspaceEnvDefaults } from '../test-support/workspace-env';

test('cached service-role client reauthenticates every request', async () => {
  const runtime = globalThis as typeof globalThis & {
    AsyncLocalStorage: typeof AsyncLocalStorage;
  };
  runtime.AsyncLocalStorage = AsyncLocalStorage;

  const [{ getDataClient }, { PrivilegedAccessDeniedError }, unitStorage, workStorage, adapter] = await Promise.all([
    import('./client'),
    import('../request-auth'),
    import('next/dist/server/app-render/work-unit-async-storage.external'),
    import('next/dist/server/app-render/work-async-storage.external'),
    import('next/dist/server/web/spec-extension/adapters/headers'),
  ]);

  const restoreWorkspaceEnv = withWorkspaceEnvDefaults();
  const restoreSupabaseTarget = withLoopbackSupabaseTarget();
  const previousAppEnv = process.env.UNIT_TALK_APP_ENV;
  const previousToken = process.env.COMMAND_CENTER_AUTH_TOKEN;
  process.env.UNIT_TALK_APP_ENV = 'production';
  process.env.COMMAND_CENTER_AUTH_TOKEN = 'browser-token';

  const withRequestHeaders = <T>(requestHeaders: Headers, fn: () => T): T => {
    const store = {
      type: 'request',
      phase: 'render',
      headers: adapter.HeadersAdapter.seal(requestHeaders),
    } as RequestStore;
    const workStore = {
      isStaticGeneration: false,
      page: '/test/page',
      route: '/test',
    } as WorkStore;
    return workStorage.workAsyncStorage.run(
      workStore,
      () => unitStorage.workUnitAsyncStorage.run(store, fn),
    );
  };

  try {
    await withRequestHeaders(
      new Headers({ authorization: 'Bearer browser-token' }),
      () => getDataClient(),
    );

    await assert.rejects(
      () => withRequestHeaders(new Headers(), () => getDataClient()),
      (error: unknown) => {
        assert.ok(error instanceof PrivilegedAccessDeniedError);
        assert.equal(error.code, 'COMMAND_CENTER_AUTH_REQUIRED');
        return true;
      },
    );
  } finally {
    restoreSupabaseTarget();
    restoreWorkspaceEnv();
    if (previousAppEnv === undefined) delete process.env.UNIT_TALK_APP_ENV;
    else process.env.UNIT_TALK_APP_ENV = previousAppEnv;
    if (previousToken === undefined) delete process.env.COMMAND_CENTER_AUTH_TOKEN;
    else process.env.COMMAND_CENTER_AUTH_TOKEN = previousToken;
  }
});
