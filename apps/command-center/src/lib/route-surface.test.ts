/**
 * Derives the affected route surface from the real route tree rather than from
 * a hand-written sample.
 *
 * The issue's first required outcome is to determine the FULL surface reachable
 * without the middleware — explicitly "do not assume /picks/[id] is the only
 * one; derive it from the matcher regex against the actual route tree". A list
 * of example paths cannot do that: it proves only what someone thought to
 * write down, and a route added tomorrow is not in it.
 *
 * So this walks `src/app`, converts every `page.tsx` and `route.ts` into the
 * pathname it serves, and asserts two things about each one:
 *
 *   1. it reaches the middleware at all, and
 *   2. for a dynamic segment, it still reaches the middleware when the segment
 *      value contains a dot.
 *
 * Point 2 is the actual defect. Under the previous matcher `/((?!.*\..*).*)`
 * every path in DOTTED below was silently exempt from authentication.
 *
 * This file fails if the matcher is reverted, and it also fails if someone adds
 * a new route that the matcher does not cover — which is the property a fixed
 * sample list cannot give.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../middleware.js';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');

/** Approximates Next's matching: each entry is a pattern anchored at both ends. */
function isMatched(pathname: string): boolean {
  return config.matcher.some((pattern) => new RegExp(`^${pattern}$`).test(pathname));
}

interface Route {
  /** Pathname as served, with dynamic segments left in `[id]` form. */
  readonly pathname: string;
  readonly kind: 'page' | 'handler';
  readonly dynamicSegments: readonly string[];
}

function collectRoutes(dir: string, segments: string[] = []): Route[] {
  const routes: Route[] = [];

  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      // Route groups `(name)` and private folders `_name` contribute no URL
      // segment. Everything else does, including `[id]` and `[...slug]`.
      const isGroup = entry.startsWith('(') && entry.endsWith(')');
      const isPrivate = entry.startsWith('_');
      routes.push(...collectRoutes(full, isGroup || isPrivate ? segments : [...segments, entry]));
      continue;
    }

    if (entry !== 'page.tsx' && entry !== 'route.ts') continue;

    routes.push({
      pathname: `/${segments.join('/')}`.replace(/\/+$/, '') || '/',
      kind: entry === 'page.tsx' ? 'page' : 'handler',
      dynamicSegments: segments.filter((s) => s.startsWith('[')),
    });
  }

  return routes;
}

const ROUTES = collectRoutes(APP_DIR);

test('the walk actually found the route tree', () => {
  // Guards against the whole file passing vacuously if the directory layout
  // moves: an empty walk would otherwise assert nothing at all.
  assert.ok(ROUTES.length >= 40, `expected the Command Center route tree, found ${ROUTES.length}`);
  assert.ok(ROUTES.some((r) => r.pathname === '/picks/[id]'), 'the known-vulnerable route is missing');
  assert.ok(ROUTES.some((r) => r.kind === 'handler'), 'no API route handlers were found');
});

// `/api/health` is deliberately public. It still reaches the middleware — the
// matcher no longer decides what is public; `isPublicPath` does, in tested code.
const PUBLIC_ROUTES = new Set(['/api/health']);

for (const route of ROUTES) {
  const concrete = route.pathname.replace(/\[\.\.\.([^\]]+)\]/g, 'a').replace(/\[([^\]]+)\]/g, 'a');

  test(`middleware is invoked for ${route.pathname}`, () => {
    assert.equal(
      isMatched(concrete),
      true,
      `${route.pathname} does not reach middleware, so nothing authenticates it`,
    );
  });

  if (route.dynamicSegments.length > 0) {
    const dotted = route.pathname
      .replace(/\[\.\.\.([^\]]+)\]/g, 'a.b')
      .replace(/\[([^\]]+)\]/g, 'a.b');

    test(`a dot in a dynamic segment does not exempt ${route.pathname}`, () => {
      assert.equal(
        isMatched(dotted),
        true,
        `${dotted} skips middleware entirely — this is the bypass, not a denial`,
      );
    });
  }
}

test('every route the walk found is either authenticated or a known public route', () => {
  // The complement of the assertions above, stated as a set so the surface is
  // reported rather than merely spot-checked.
  const unreached = ROUTES.map((r) => r.pathname).filter(
    (p) => !isMatched(p.replace(/\[\.\.\.([^\]]+)\]/g, 'a').replace(/\[([^\]]+)\]/g, 'a')),
  );

  assert.deepEqual(unreached, [], `routes that never reach middleware: ${unreached.join(', ')}`);

  for (const p of PUBLIC_ROUTES) {
    assert.ok(
      ROUTES.some((r) => r.pathname === p),
      `${p} is listed as public but is not a real route — the list has drifted`,
    );
  }
});
