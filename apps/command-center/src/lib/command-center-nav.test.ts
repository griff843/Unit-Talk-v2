import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import {
  COMMAND_CENTER_ROUTES,
  getPrimaryCommandCenterRoutes,
  getPrimaryRouteForPath,
  getRouteMeta,
  getWorkspaceRoutes,
} from './command-center-nav.js';

const APP_DIR = resolve(process.cwd(), 'src/app');

function collectPageRoutes(directory = APP_DIR): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) routes.push(...collectPageRoutes(path));
    if (entry.isFile() && entry.name === 'page.tsx') {
      const parent = relative(APP_DIR, directory).split(sep).filter(Boolean).join('/');
      routes.push(parent.length > 0 ? `/${parent}` : '/');
    }
  }
  return routes.sort();
}

test('the route registry classifies every page exactly once', () => {
  const pageRoutes = collectPageRoutes();
  const registeredRoutes = COMMAND_CENTER_ROUTES.map((route) => route.href).sort();

  // Phase 0 found 55 routes. The authoritative Settlement workflow is the
  // one deliberate addition, producing a 56-route post-consolidation inventory.
  assert.equal(pageRoutes.length, 56);
  assert.equal(new Set(registeredRoutes).size, registeredRoutes.length);
  assert.deepEqual(registeredRoutes, pageRoutes);
  assert.ok(COMMAND_CENTER_ROUTES.every((route) => route.classificationReason.trim().length > 0));
});

test('only the six authorized operator workflows are primary navigation', () => {
  assert.deepEqual(
    getPrimaryCommandCenterRoutes().map(({ href, label }) => ({ href, label })),
    [
      { href: '/', label: 'Overview' },
      { href: '/review', label: 'Review' },
      { href: '/picks', label: 'Active Picks' },
      { href: '/settlement', label: 'Settlement' },
      { href: '/exceptions', label: 'Exceptions' },
      { href: '/api-health', label: 'System Health' },
    ],
  );
  assert.ok(COMMAND_CENTER_ROUTES.filter((route) => !route.primary).every((route) => route.primaryIcon === undefined));
});

test('detail, duplicate, and stub routes resolve to their authoritative parent', () => {
  assert.equal(getRouteMeta('/picks/pick-123')?.href, '/picks/[id]');
  assert.equal(getPrimaryRouteForPath('/picks/pick-123'), '/picks');
  assert.equal(getPrimaryRouteForPath('/operations/results'), '/settlement');
  assert.equal(getPrimaryRouteForPath('/fire-board'), '/exceptions');
  assert.equal(getPrimaryRouteForPath('/events'), null);
});

test('secondary workspace navigation is derived from the route registry', () => {
  assert.deepEqual(
    getWorkspaceRoutes('intelligence').map((route) => route.href),
    ['/performance', '/intelligence/attribution', '/intelligence/calibration', '/intelligence/roi'],
  );
  assert.deepEqual(
    getWorkspaceRoutes('decision').map((route) => route.href),
    ['/decision/board-queue', '/decision/board', '/decision/hedges', '/decision/preview', '/decision/routing', '/decision/scores'],
  );
});
