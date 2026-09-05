/**
 * Behavioural pin for page components that read the backend.
 *
 * The structural walks in `server-action-guard.test.ts` and
 * `privileged-boundary-guard.test.ts` cover server actions and the data
 * client. Neither could see a page component calling `server-api` directly,
 * which is how `/api-health` came to spend the operator API key on behalf of
 * an anonymous caller. This drives the real page functions under an
 * unauthenticated request and proves no outbound request leaves the operator
 * server at all.
 *
 * It enumerates every route entrypoint rather than naming pages. Two literals
 * out of fifty-six was the hole: a raw ungated `fetch` carrying
 * `Bearer ${process.env.UNIT_TALK_CC_API_KEY}` added to any unnamed page — no
 * new file, no named helper — passed the structural walk and every behavioural
 * case here, while an anonymous request spent the operator credential.
 * Enumerating subsumes the named-helper list: this asks what left the process,
 * not what the source said it would call.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Page modules are compiled with the classic JSX runtime and carry no React
// import of their own; render them the way Next does, with React in scope.
(globalThis as unknown as { React: typeof React }).React = React;
import { withRequestContext, FORGED_IDENTITY_HEADERS } from '../lib/test-support/request-context';
import { serializeElementTree } from '../lib/test-support/element-tree';
import {
  PAGE_FILES,
  dynamicSegments,
  hasDirective,
  routeOf,
} from '../lib/test-support/source-walk';

const API_KEY = 'unauthenticated-page-read-test-key';

interface Attempt {
  url: string;
  authorization: string | null;
}

interface RenderOutcome {
  html: string;
  attempts: Attempt[];
  /** Thrown while producing the element (a `redirect()` is one of these). */
  invokeError: unknown;
  /** True when static rendering refused because the app router is not mounted. */
  routerUnmounted: boolean;
}

/**
 * The one render failure that is a property of the test host rather than of
 * the page: a client component that calls `useRouter` cannot be statically
 * rendered outside Next. Every other render error is a real defect and must
 * fail, which a bare `catch {}` around `renderToStaticMarkup` did not do — it
 * turned any render error into a pass by falling back to the element tree.
 */
function isAppRouterUnmounted(error: unknown): boolean {
  return error instanceof Error && /app router to be mounted/i.test(error.message);
}

async function renderUnauthenticated(
  headerEntries: Record<string, string>,
  render: () => Promise<React.ReactElement>,
): Promise<RenderOutcome> {
  const originalFetch = globalThis.fetch;
  const previous = {
    appEnv: process.env.UNIT_TALK_APP_ENV,
    apiKey: process.env.UNIT_TALK_CC_API_KEY,
    token: process.env.COMMAND_CENTER_AUTH_TOKEN,
  };
  // A missing API key would make the call throw before it ever ran; that is an
  // unset key, not a refusal. Configure it so the call would really execute.
  process.env.UNIT_TALK_APP_ENV = 'production';
  process.env.UNIT_TALK_CC_API_KEY = API_KEY;
  process.env.COMMAND_CENTER_AUTH_TOKEN = 'page-read-test-token';

  const attempts: Attempt[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const headers = new Headers((init?.headers ?? {}) as HeadersInit);
    attempts.push({ url: String(input), authorization: headers.get('authorization') });
    return new Response(
      JSON.stringify({
        ok: true,
        status: 'healthy',
        warnings: ['leaked-warning'],
        runtimeMode: 'fail_closed',
        persistenceMode: 'database',
        observedAt: new Date().toISOString(),
        auth: { mode: 'bearer', enabled: true },
        work: { doingRealWork: true, reason: 'leaked-reason', workerTargets: ['leaked-target'], dryRun: false, lastWorkAt: null },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    return await withRequestContext(headerEntries, async (): Promise<RenderOutcome> => {
      let element: React.ReactElement;
      try {
        element = await render();
      } catch (error) {
        // A page that refuses by redirecting never produces an element. That
        // is a legitimate outcome; what still has to hold is that it drove no
        // backend read on the way there, which `attempts` records either way.
        return { html: '', attempts, invokeError: error, routerUnmounted: false };
      }

      // Some pages mount client components that need the app router, so static
      // rendering refuses on them; the element tree is what the RSC Flight
      // payload is serialized from, so scanning it is the honest fallback. The
      // error is reported rather than swallowed — a page whose render throws
      // must not silently count as a page that rendered clean.
      try {
        return {
          html: renderToStaticMarkup(element),
          attempts,
          invokeError: null,
          routerUnmounted: false,
        };
      } catch (error) {
        if (!isAppRouterUnmounted(error)) throw error;
        // The element tree is what the RSC Flight payload is serialized from,
        // so scanning it is the honest fallback for a router-mounted client
        // component — and only for that one cause.
        return {
          html: serializeElementTree(element),
          attempts,
          invokeError: null,
          routerUnmounted: true,
        };
      }
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of [
      ['UNIT_TALK_APP_ENV', previous.appEnv],
      ['UNIT_TALK_CC_API_KEY', previous.apiKey],
      ['COMMAND_CENTER_AUTH_TOKEN', previous.token],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/**
 * The two throws a route entrypoint is allowed to make.
 *
 * `attempts === []` alone scored a page that threw on import, or had no default
 * export, as "made no backend call" — the strongest possible pass for the
 * weakest possible reason, and it made the `typeof module.default === 'function'`
 * assertion inside `loadPage` dead code, since its failure was caught by the
 * same handler. Only a `redirect()` and the fail-closed privileged refusal are
 * legitimate; anything else is a defect and must fail here.
 */
function isRedirect(error: unknown): boolean {
  const digest = error instanceof Error ? Reflect.get(error, 'digest') : null;
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT');
}

function isPrivilegedRefusal(error: unknown): boolean {
  return error instanceof Error && error.name === 'PrivilegedAccessDeniedError';
}

function describeInvokeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return `${error.name}: ${error.message}`;
}

/**
 * `searchParams` keys the page's own source reads.
 *
 * Driving every route with an empty `searchParams` left any privileged read
 * behind an input branch unexecuted — `/decision/preview` only calls the
 * promotion preview when `pickId` is present, so an ungated fetch in that
 * branch passed the whole suite. Deriving the keys from the source keeps the
 * populated shape correct as the pages change, instead of a hand-kept list.
 */
function searchParamKeys(pageFile: string): string[] {
  const source = readFileSync(pageFile, 'utf8');
  const methods = new Set([
    'get', 'getAll', 'has', 'set', 'append', 'delete', 'sort', 'size',
    'keys', 'values', 'entries', 'forEach', 'toString', 'then', 'catch',
  ]);
  const keys = new Set<string>();
  for (const match of source.matchAll(
    /searchParams\s*\??\s*(?:\.\s*(\w+)|\[\s*['"]([\w-]+)['"]\s*\])/g,
  )) {
    const key = match[1] ?? match[2]!;
    if (!methods.has(key)) keys.add(key);
  }
  return [...keys].sort();
}

interface InputShape {
  readonly label: string;
  readonly searchParams: Record<string, string>;
}

/**
 * Input shapes to drive a route with: the empty one, plus a populated one
 * whenever the source reads any `searchParams` key.
 */
function inputShapes(pageFile: string): InputShape[] {
  const keys = searchParamKeys(pageFile);
  const shapes: InputShape[] = [{ label: 'no input', searchParams: {} }];
  if (keys.length > 0) {
    shapes.push({
      label: `searchParams ${keys.join(',')}`,
      searchParams: Object.fromEntries(keys.map((key) => [key, `test-${key}`])),
    });
  }
  return shapes;
}

type PageComponent = (props: unknown) => React.ReactElement | Promise<React.ReactElement>;

/** Load a route entrypoint and call it the way the App Router would. */
function loadPage(
  pageFile: string,
  searchParams: Record<string, string> = {},
): () => Promise<React.ReactElement> {
  return async () => {
    const module = (await import(pathToFileURL(pageFile).href)) as { default?: PageComponent };
    assert.ok(typeof module.default === 'function', `${routeOf(pageFile)} has no default export`);
    const params = Object.fromEntries(
      dynamicSegments(pageFile).map((segment) => [segment, `test-${segment}`]),
    );
    const props = {
      params: Promise.resolve(params),
      searchParams: Promise.resolve(searchParams),
    };

    // A `'use client'` page is a hook-bearing function component. Calling it
    // directly runs its hooks with no React dispatcher installed, which throws
    // a TypeError that has nothing to do with the page. Hand it to the renderer
    // as an element instead, the way Next does.
    if (hasDirective(readFileSync(pageFile, 'utf8'), 'use client')) {
      return React.createElement(
        module.default as React.FunctionComponent<Record<string, unknown>>,
        props as unknown as Record<string, unknown> & React.Attributes,
      );
    }
    return await module.default(props);
  };
}

const UNAUTHENTICATED_SHAPES = [
  ['no headers', {}],
  ['forged identity headers', FORGED_IDENTITY_HEADERS],
] as const;

test('the route enumeration actually found the app router pages', () => {
  const routes = PAGE_FILES.map(routeOf);
  assert.ok(routes.length >= 40, `expected Command Center routes, found ${routes.length}`);
  for (const route of ['/api-health', '/exceptions', '/settlement', '/model-health', '/']) {
    assert.ok(routes.includes(route), `${route} is missing from the route enumeration`);
  }
});

test('the input derivation actually reads searchParams out of the pages', () => {
  const preview = PAGE_FILES.find((path) => routeOf(path) === '/decision/preview');
  assert.ok(preview, '/decision/preview is no longer an app router page');
  assert.deepEqual(searchParamKeys(preview), ['pickId']);

  const populated = PAGE_FILES.filter((path) => inputShapes(path).length > 1).length;
  assert.ok(populated >= 15, `expected routes with derived input, found ${populated}`);
});

for (const pageFile of PAGE_FILES) {
  const route = routeOf(pageFile);
  for (const input of inputShapes(pageFile)) {
    for (const [label, headerEntries] of UNAUTHENTICATED_SHAPES) {
      test(`${route} drives no backend read for an unauthenticated request (${label}, ${input.label})`, async () => {
        const { attempts, invokeError } = await renderUnauthenticated(
          headerEntries,
          loadPage(pageFile, input.searchParams),
        );

        assert.ok(
          invokeError === null || isRedirect(invokeError) || isPrivilegedRefusal(invokeError),
          `${route} threw an unexpected error instead of rendering or refusing: ` +
            describeInvokeError(invokeError),
        );
        assert.deepEqual(
          attempts,
          [],
          `${route} performed ${attempts.length} outbound request(s) for an unauthenticated ` +
            `caller: ${attempts.map((attempt) => `${attempt.url} auth=${attempt.authorization}`).join(', ')}`,
        );
      });
    }
  }
}

/**
 * The two routes that actually rendered operator truth to an anonymous caller
 * keep their deeper assertions: they must render, without error, and without
 * any of the backend payload reaching the output.
 */
const LEAK_PINNED_ROUTES = ['/api-health', '/exceptions'] as const;

for (const route of LEAK_PINNED_ROUTES) {
  const pageFile = PAGE_FILES.find((path) => routeOf(path) === route);

  for (const [label, headerEntries] of UNAUTHENTICATED_SHAPES) {
    test(`${route} renders a refusal that leaks no backend payload (${label})`, async () => {
      assert.ok(pageFile, `${route} is no longer an app router page`);
      const { html, invokeError } = await renderUnauthenticated(headerEntries, loadPage(pageFile));

      assert.equal(invokeError, null, `${route} threw instead of rendering: ${String(invokeError)}`);
      assert.doesNotMatch(html, /leaked-reason|leaked-target|leaked-warning/);
      assert.ok(html.length > 0, `${route} rendered nothing`);
    });
  }
}
