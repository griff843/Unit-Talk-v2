/**
 * Route entrypoints must resolve and fail closed when the request carries no
 * credentials — never 500, never fabricate a healthy or zeroed surface.
 *
 * These assertions used to name copy from a much earlier revision of the
 * pages ("Provider matrix", "Model economics at a glance") and had gone stale;
 * because the file matched neither glob in `package.json`, nothing reported
 * that. Rewritten against what the routes actually render now.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { serializeElementTree } from '../lib/test-support/element-tree';
import { FORGED_IDENTITY_HEADERS, withRequestContext } from '../lib/test-support/request-context';
import AgentsPage from './agents/page';
import ApiHealthPage from './api-health/page';
import EventsPage from './events/page';
import IntelligencePage from './intelligence/page';
import OpsPage from './ops/page';
import OverviewPage from './page';
import PicksPage from './picks/page';
import PipelinePage from './pipeline/page';

(globalThis as unknown as { React: typeof React }).React = React;

/**
 * The one render failure that belongs to the test host rather than the page: a
 * client component calling `useRouter` cannot be statically rendered outside
 * Next. A bare `catch` here turned *every* render error into a pass by falling
 * back to the element tree, so it is narrowed to that single cause.
 */
function isAppRouterUnmounted(error: unknown): boolean {
  return error instanceof Error && /app router to be mounted/i.test(error.message);
}

/**
 * Render a route inside a real request that carries no credentials.
 *
 * Running outside request scope instead would exercise
 * `authenticateCurrentRequest`'s "request context is unavailable" branch, which
 * also fails closed but is not the thing these routes are pinned for: it proves
 * nothing about a credential-less caller.
 *
 * The environment matters for a different, measured reason. Calling
 * `authenticateCommandCenterRequest` with no credentials returns
 * 503 `COMMAND_CENTER_AUTH_MISCONFIGURED` in a bare environment, under
 * `NODE_ENV=development` and under `NODE_ENV=test`, and 401
 * `COMMAND_CENTER_AUTH_REQUIRED` only with a production app-env and a
 * configured token. A refusal for want of configuration is not the refusal
 * these routes are pinned for, so the environment is set to make credentials
 * genuinely required and the refusal genuinely an authentication one. The
 * forged identity headers then make the request look like an operator to
 * anything that trusts a header.
 */
async function surface(render: () => Promise<React.ReactElement>): Promise<string> {
  const previous = {
    appEnv: process.env.UNIT_TALK_APP_ENV,
    token: process.env.COMMAND_CENTER_AUTH_TOKEN,
  };
  process.env.UNIT_TALK_APP_ENV = 'production';
  process.env.COMMAND_CENTER_AUTH_TOKEN = 'rebuild-test-token';

  try {
    return await withRequestContext(FORGED_IDENTITY_HEADERS, async () => {
      const element = await render();
      try {
        return renderToStaticMarkup(element);
      } catch (error) {
        if (!isAppRouterUnmounted(error)) throw error;
        return serializeElementTree(element);
      }
    });
  } finally {
    if (previous.appEnv === undefined) delete process.env.UNIT_TALK_APP_ENV;
    else process.env.UNIT_TALK_APP_ENV = previous.appEnv;
    if (previous.token === undefined) delete process.env.COMMAND_CENTER_AUTH_TOKEN;
    else process.env.COMMAND_CENTER_AUTH_TOKEN = previous.token;
  }
}

const FABRICATION = /All systems (?:healthy|operational)/i;

const UNAUTHENTICATED_ROUTES: Array<{
  name: string;
  render: () => Promise<React.ReactElement>;
  refusal: RegExp;
}> = [
  {
    name: 'overview',
    render: () => (OverviewPage as (props: Record<string, unknown>) => Promise<React.ReactElement>)({}),
    refusal: /Overview truth unavailable/,
  },
  {
    name: 'picks',
    render: () => (PicksPage as () => Promise<React.ReactElement>)(),
    refusal: /Active picks unavailable/,
  },
  {
    name: 'pipeline',
    render: () => (PipelinePage as () => Promise<React.ReactElement>)(),
    refusal: /Pipeline telemetry unavailable/,
  },
  {
    name: 'events',
    render: () => (EventsPage as () => Promise<React.ReactElement>)(),
    refusal: /Event replay unavailable/,
  },
  {
    name: 'api-health',
    render: () => (ApiHealthPage as () => Promise<React.ReactElement>)(),
    // `/api-health` mounts a client component that needs the app router, so
    // this route is checked against its element tree. `RuntimeTruthPanel` is
    // not invoked there; its refusal reaches the tree as the `error` prop.
    refusal: /Command Center authentication is required/,
  },
  {
    name: 'intelligence',
    render: () => (IntelligencePage as () => Promise<React.ReactElement>)(),
    refusal: /Intelligence data unavailable/,
  },
];

for (const route of UNAUTHENTICATED_ROUTES) {
  test(`${route.name} route fails closed without credentials instead of 500ing`, async () => {
    const html = await surface(route.render);

    assert.match(html, route.refusal, `${route.name} did not surface its refusal state`);
    assert.doesNotMatch(html, FABRICATION, `${route.name} fabricated a healthy surface`);
  });
}

test('agents route redirects to system health', () => {
  assert.throws(() => AgentsPage(), /NEXT_REDIRECT/);
});

test('ops route redirects to system health', () => {
  assert.throws(() => OpsPage(), /NEXT_REDIRECT/);
});
