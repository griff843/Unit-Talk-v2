import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createEventsHandler } from '../app/api/events/route';
import { createGovernanceLanesHandler } from '../app/api/governance/lanes/route';
import { APP, SRC, isTestFile, walkSource as walk } from './test-support/source-walk';

/**
 * The guard every route handler must reach before it reads anything.
 *
 * Middleware is a second line, not the only one: a route handler that
 * authenticates nothing is one matcher regression away from being open, which
 * is exactly the single-point-of-failure posture this issue exists to remove.
 */
const ROUTE_GUARD = /authenticateHeaderBag|assertPrivilegedRequestAuthenticated/;

const ROUTES = [
  {
    name: 'events',
    path: '/api/events',
    create: (onRead: () => void) => createEventsHandler(async () => {
      onRead();
      return { events: [], observedAt: '2026-09-05T12:00:00.000Z' };
    }),
  },
  {
    name: 'governance lanes',
    path: '/api/governance/lanes',
    create: (onRead: () => void) => createGovernanceLanesHandler(async () => {
      onRead();
      return {
        observedAt: '2026-09-05T12:00:00.000Z',
        sourceStatus: 'degraded',
        missingSources: [],
        activeLanes: [],
        blockedLanes: [],
        awaitingPmVerdict: [],
      };
    }),
  },
] as const;

for (const route of ROUTES) {
  test(`${route.name} route returns 401 without credentials and does not read data`, async () => {
    await withAuthEnv(
      { UNIT_TALK_APP_ENV: 'production', COMMAND_CENTER_AUTH_TOKEN: 'real-token' },
      async () => {
        let reads = 0;
        const response = await route.create(() => { reads += 1; })(
          new Request(`http://localhost${route.path}`),
        );
        assert.equal(response.status, 401);
        assert.equal(reads, 0);
        assert.deepEqual(await response.json(), { ok: false, error: 'Authentication required.' });
      },
    );
  });

  test(`${route.name} route preserves misconfiguration 503 without leaking guidance`, async () => {
    await withAuthEnv({ UNIT_TALK_APP_ENV: 'production' }, async () => {
      let reads = 0;
      const response = await route.create(() => { reads += 1; })(
        new Request(`http://localhost${route.path}`),
      );
      const body = await response.json() as { error?: string };
      assert.equal(response.status, 503);
      assert.equal(reads, 0);
      assert.equal(body.error, 'Command Center is unavailable.');
      assert.doesNotMatch(JSON.stringify(body), /COMMAND_CENTER_AUTH|configure|username|password/i);
    });
  });

  test(`${route.name} route accepts valid bearer credentials`, async () => {
    await withAuthEnv(
      { UNIT_TALK_APP_ENV: 'production', COMMAND_CENTER_AUTH_TOKEN: 'real-token' },
      async () => {
        let reads = 0;
        const response = await route.create(() => { reads += 1; })(
          new Request(`http://localhost${route.path}`, {
            headers: { authorization: 'Bearer real-token' },
          }),
        );
        assert.equal(response.status, 200);
        assert.equal(reads, 1);
      },
    );
  });
}

/**
 * Route handlers, enumerated rather than named.
 *
 * Naming two of them was the hole this closes: a new
 * `src/app/api/<anything>/route.ts` that authenticated nothing and spent the
 * operator key got no test at all, and the suite stayed green. The page walk in
 * `unauthenticated-page-reads.test.ts` already enumerates; route handlers now
 * do the same.
 */
const API_ROUTE_FILES = walk(join(APP, 'api')).filter(
  (path) => path.endsWith(`${sep}route.ts`) && !isTestFile(path),
);

function routePathOf(file: string): string {
  return `/${relative(APP, file).split(sep).slice(0, -1).join('/')}`;
}

/**
 * The path prefixes `middleware.ts` exempts from authentication outright.
 *
 * Read out of the middleware rather than restated here, so the exemption in
 * this control is the same fact as the exemption in production.
 */
const MIDDLEWARE_PUBLIC_PREFIXES: string[] = (() => {
  const source = readFileSync(join(SRC, 'middleware.ts'), 'utf8');
  const block = /const PUBLIC_PATH_PREFIXES\s*=\s*\[([\s\S]*?)\]/.exec(source);
  assert.ok(block, 'middleware.ts no longer declares PUBLIC_PATH_PREFIXES');
  return [...block[1]!.matchAll(/'([^']+)'/g)].map((match) => match[1]!);
})();

function isDeliberatelyPublic(routePath: string): boolean {
  return MIDDLEWARE_PUBLIC_PREFIXES.some(
    (prefix) => routePath === prefix || routePath.startsWith(`${prefix}/`),
  );
}

test('the route walk actually found the api route handlers', () => {
  const paths = API_ROUTE_FILES.map(routePathOf);
  assert.ok(paths.length >= 3, `expected Command Center api routes, found ${paths.length}`);
  for (const expected of ['/api/events', '/api/governance/lanes', '/api/health']) {
    assert.ok(paths.includes(expected), `${expected} is missing from the route walk`);
  }
});

test('every api route handler authenticates the request in its own source', () => {
  const offenders = API_ROUTE_FILES.filter(
    (file) => !ROUTE_GUARD.test(readFileSync(file, 'utf8')),
  ).map((file) => relative(SRC, file));

  assert.deepEqual(
    offenders,
    [],
    `route handlers that never authenticate the request: ${offenders.join(', ')}`,
  );
});

test('every api route handler is driven by an authentication case', () => {
  const discovered = API_ROUTE_FILES.map(routePathOf).sort();
  const driven: string[] = ROUTES.map((route) => route.path).sort();
  const publiclyExempt = discovered.filter(isDeliberatelyPublic).sort();

  // Pinned deliberately: a second unauthenticated route surface is a decision,
  // not a maintenance step, and must not become one by widening this list.
  assert.deepEqual(
    publiclyExempt,
    ['/api/health'],
    'the set of routes middleware serves without authentication changed',
  );

  assert.deepEqual(
    discovered.filter((path) => !driven.includes(path) && !publiclyExempt.includes(path)),
    [],
    'api routes with no authentication case; add one to ROUTES',
  );
  assert.deepEqual(
    driven.filter((path) => !discovered.includes(path)),
    [],
    'authentication cases naming a route the walk does not find',
  );
});

async function withAuthEnv(
  values: Record<string, string>,
  fn: () => Promise<void>,
): Promise<void> {
  const keys = [
    'NODE_ENV',
    'UNIT_TALK_APP_ENV',
    'COMMAND_CENTER_AUTH_MODE',
    'COMMAND_CENTER_AUTH_TOKEN',
    'COMMAND_CENTER_AUTH_USERNAME',
    'COMMAND_CENTER_AUTH_PASSWORD',
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
    await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
