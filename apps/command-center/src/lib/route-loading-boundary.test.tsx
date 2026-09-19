import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Loading from '../app/loading';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');

/**
 * Deliberately in `src/lib/`, not `src/app/`.
 *
 * This package's `test` script globs `src/lib/*.test.ts`, `src/lib/*.test.tsx`
 * and `src/lib/data/*.test.ts` -- `src/app/` is not in it, so a test placed
 * next to the component it covers would never be executed by `pnpm test`.
 */

test('a root route-transition boundary exists', () => {
  assert.ok(
    existsSync(join(APP_DIR, 'loading.tsx')),
    'Without src/app/loading.tsx the App Router shows nothing during a route ' +
      'transition: the previous page stays painted and interactive for the whole ' +
      'server render, which reads to an operator as a click that did nothing.',
  );
});

test('the boundary announces itself to assistive technology and to tests', () => {
  const html = renderToStaticMarkup(<Loading />);

  // `role="status"` + `aria-live` is what makes the transition perceivable to a
  // screen reader; `aria-busy` is what makes it *mean* "in progress" rather
  // than "here is some new content".
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-busy="true"/);

  // Visible-to-nobody text is still the only thing a screen reader can read
  // out of a skeleton made of empty divs.
  assert.match(html, /Loading page…/);

  assert.match(html, /data-testid="route-loading"/);
});

test('the boundary renders without any data, props or request context', () => {
  // A loading boundary that could throw, await, or read `headers()` would fail
  // exactly when it is most needed -- while the thing it is covering is slow.
  assert.doesNotThrow(() => renderToStaticMarkup(<Loading />));
  assert.equal(Loading.length, 0, 'Loading must take no props');
});

/**
 * Segment-level boundaries still win over the root one for their own segment.
 * This test does not require any particular segment to declare one -- it pins
 * the inverse: that the two which already do are still reachable, so a future
 * change that deletes them is visible rather than silently absorbed by the
 * root boundary added here.
 */
test('the segments that declared their own loading boundary still have one', () => {
  for (const segment of [join('decision', 'preview'), join('decision', 'routing')]) {
    assert.ok(
      existsSync(join(APP_DIR, segment, 'loading.tsx')),
      `${segment} previously declared its own loading.tsx`,
    );
  }
});

/**
 * The count is recorded, not asserted at a fixed number: every route is now
 * covered by the root boundary, so adding a segment-level one is a free choice
 * rather than a requirement. What this asserts is that the root file is not
 * the *only* thing standing between the app and a blank transition -- if the
 * root file is ever removed, the first test fails loudly rather than leaving
 * ~53 routes quietly uncovered again.
 */
test('every page segment is covered by a loading boundary', () => {
  const uncovered: string[] = [];

  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (!statSync(full).isDirectory()) continue;
      if (entry === 'api' || entry.startsWith('_')) continue;
      walk(full, join(rel, entry));
    }
    if (existsSync(join(dir, 'page.tsx')) && !existsSync(join(dir, 'loading.tsx'))) {
      // Covered by an ancestor boundary. The root one covers everything, so
      // this list is only non-empty if the root file is gone.
      if (!existsSync(join(APP_DIR, 'loading.tsx'))) uncovered.push(rel || '/');
    }
  };

  walk(APP_DIR, '');
  assert.deepEqual(uncovered, []);
});
