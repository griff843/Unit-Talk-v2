import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  BOUNDARY_MODULE,
  everySiteAsserted,
  findConstructorSites,
  loadInventory,
  referencesPrivilegedCredential,
  runGuard,
  scanTree,
  collectTestEntrypoints,
  reachableModules,
  type Inventory,
} from './privileged-db-client-guard.js';

// ---------------------------------------------------------------------------
// Site detection: what counts, and what a string cannot buy
// ---------------------------------------------------------------------------

test('a mention of createClient without a driver import is not a site', () => {
  const text = `
    // This module must never call createClient(url, key) directly.
    const FORBIDDEN = [/createClient\\s*\\(/, 'direct Supabase createClient() call'];
    export function createClient(a: string, b: string) { return { a, b }; }
    const local = createClient('x', 'y');
    export { FORBIDDEN, local };
  `;
  assert.deepEqual(findConstructorSites('scripts/decoy.ts', text), []);
});

test('an aliased driver import is still a site', () => {
  const text = `
    import { createClient as makeIt } from '@supabase/supabase-js';
    export const db = makeIt(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  `;
  const sites = findConstructorSites('scripts/aliased.ts', text);
  assert.equal(sites.length, 1);
  assert.equal(sites[0]?.callee, 'makeIt');
  assert.equal(sites[0]?.module, '@supabase/supabase-js');
});

test('a namespace driver import is still a site', () => {
  const text = `
    import * as supa from '@supabase/supabase-js';
    export const db = supa.createClient('u', 'k');
  `;
  const sites = findConstructorSites('scripts/ns.ts', text);
  assert.equal(sites.length, 1);
  assert.equal(sites[0]?.callee, 'supa.createClient');
});

test('a type-only driver import constructs nothing', () => {
  const text = `
    import type { SupabaseClient } from '@supabase/supabase-js';
    export type Db = SupabaseClient;
  `;
  assert.deepEqual(findConstructorSites('scripts/typeonly.ts', text), []);
});

test('a same-named export from a different module is not a site', () => {
  const text = `
    import { createClient } from './our-own-factory.js';
    export const db = createClient('u', 'k');
  `;
  assert.deepEqual(findConstructorSites('scripts/other-module.ts', text), []);
});

test('the postgres driver counts as a construction site', () => {
  const text = `
    import postgres from 'postgres';
    export const sql = postgres(process.env.SUPABASE_DB_URL!);
  `;
  const sites = findConstructorSites('scripts/pg.ts', text);
  assert.equal(sites.length, 1);
  assert.equal(sites[0]?.driver, 'postgres');
});

// ---------------------------------------------------------------------------
// Assertion and credential predicates
// ---------------------------------------------------------------------------

test('everySiteAsserted requires the assertion inside the construction call', () => {
  const asserted = `
    import postgres from 'postgres';
    import { assertPostgresConnectionAllowed } from '@unit-talk/db/privileged-client-boundary';
    export const sql = postgres(assertPostgresConnectionAllowed(url, 'x'), { max: 1 });
  `;
  assert.equal(everySiteAsserted('scripts/a.ts', asserted), true);

  // The assertion is imported and even called — but not on the value that is
  // handed to the driver. A proximity check would pass this.
  const nearby = `
    import postgres from 'postgres';
    import { assertPostgresConnectionAllowed } from '@unit-talk/db/privileged-client-boundary';
    assertPostgresConnectionAllowed(somethingElse, 'x');
    export const sql = postgres(url, { max: 1 });
  `;
  assert.equal(everySiteAsserted('scripts/b.ts', nearby), false);
});

test('referencesPrivilegedCredential reads the AST, not the prose', () => {
  const prose = `
    // Never read SUPABASE_SERVICE_ROLE_KEY here.
    export const key = process.env['SUPABASE_ANON_KEY'];
  `;
  assert.equal(referencesPrivilegedCredential('scripts/prose.ts', prose), null);

  const real = `export const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];`;
  assert.equal(
    referencesPrivilegedCredential('scripts/real.ts', real),
    'SUPABASE_SERVICE_ROLE_KEY',
  );
});

// ---------------------------------------------------------------------------
// Fixture trees: the guard must fail the pre-fix shape and pass the fixed one
// ---------------------------------------------------------------------------

interface Fixture {
  root: string;
  cleanup: () => void;
}

function makeFixture(files: Record<string, string>): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), 'utv2-1628-'));
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const PACKAGE_JSON = JSON.stringify({
  name: 'fixture',
  scripts: { test: 'pnpm test:unit', 'test:unit': 'tsx --test scripts/suite.test.ts' },
});

const EMPTY_INVENTORY: Inventory = {
  schema: 'privileged-db-client-inventory/v1',
  boundary_module: BOUNDARY_MODULE,
  entries: [],
};

const BOUNDARY_SOURCE = `
  import { createClient } from '@supabase/supabase-js';
  export function createPrivilegedClient(url: string, key: string) {
    return createClient(url, key);
  }
  export function assertPostgresConnectionAllowed(s: string) { return s; }
`;

test('PRE-FIX SHAPE: an unguarded constructor reachable from pnpm test fails', () => {
  const fixture = makeFixture({
    'package.json': PACKAGE_JSON,
    'scripts/suite.test.ts': `import { db } from './data.js';\nexport { db };`,
    'scripts/data.ts': `
      import { createClient } from '@supabase/supabase-js';
      export const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    `,
  });
  try {
    const result = runGuard({ root: fixture.root, inventory: EMPTY_INVENTORY });
    assert.equal(result.ok, false);
    assert.deepEqual(result.reachableFromTest, ['scripts/data.ts']);
    const kinds = new Set(result.findings.map((f) => f.kind));
    assert.ok(kinds.has('unclassified'), 'the site must be reported as unclassified');
    assert.ok(kinds.has('reachable-from-test'), 'the site must be reported as test-reachable');
  } finally {
    fixture.cleanup();
  }
});

test('FIXED SHAPE: the same tree routed through the boundary passes', () => {
  const fixture = makeFixture({
    'package.json': PACKAGE_JSON,
    'scripts/suite.test.ts': `import { db } from './data.js';\nexport { db };`,
    'scripts/data.ts': `
      import { createPrivilegedClient } from '@unit-talk/db/privileged-client-boundary';
      export const db = createPrivilegedClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    `,
    'packages/db/package.json': JSON.stringify({ name: '@unit-talk/db' }),
    [`packages/db/src/${path.basename(BOUNDARY_MODULE)}`]: BOUNDARY_SOURCE,
  });
  try {
    const result = runGuard({
      root: fixture.root,
      inventory: {
        ...EMPTY_INVENTORY,
        entries: [
          {
            file: BOUNDARY_MODULE,
            classification: 'behind-the-boundary',
            disposition: 'is-boundary',
            reason: 'fixture boundary',
          },
          {
            file: 'scripts/data.ts',
            classification: 'writable-privileged',
            disposition: 'migrated',
            reason: 'fixture caller',
          },
        ],
      },
    });
    assert.deepEqual(result.findings, []);
    assert.equal(result.ok, true);
    assert.deepEqual(result.reachableFromTest, []);
  } finally {
    fixture.cleanup();
  }
});

test('a migrated entry that quietly re-adds a direct constructor fails', () => {
  const fixture = makeFixture({
    'package.json': PACKAGE_JSON,
    'scripts/suite.test.ts': `export const x = 1;`,
    'scripts/data.ts': `
      import { createClient } from '@supabase/supabase-js';
      import { createPrivilegedClient } from '@unit-talk/db/privileged-client-boundary';
      export const ok = createPrivilegedClient('u', 'k');
      export const sneaky = createClient('u', 'k');
    `,
    'packages/db/package.json': JSON.stringify({ name: '@unit-talk/db' }),
    [`packages/db/src/${path.basename(BOUNDARY_MODULE)}`]: BOUNDARY_SOURCE,
  });
  try {
    const result = runGuard({
      root: fixture.root,
      inventory: {
        ...EMPTY_INVENTORY,
        entries: [
          {
            file: BOUNDARY_MODULE,
            classification: 'behind-the-boundary',
            disposition: 'is-boundary',
            reason: 'fixture boundary',
          },
          {
            file: 'scripts/data.ts',
            classification: 'writable-privileged',
            disposition: 'migrated',
            reason: 'fixture caller',
          },
        ],
      },
    });
    assert.equal(result.ok, false);
    assert.ok(result.findings.some((f) => f.kind === 'raw-in-migrated'));
  } finally {
    fixture.cleanup();
  }
});

test('a read-only exemption is refuted by a service-role credential in the file', () => {
  const fixture = makeFixture({
    'package.json': PACKAGE_JSON,
    'scripts/suite.test.ts': `export const x = 1;`,
    'scripts/widget.ts': `
      import { createClient } from '@supabase/supabase-js';
      export const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    `,
    'packages/db/package.json': JSON.stringify({ name: '@unit-talk/db' }),
    [`packages/db/src/${path.basename(BOUNDARY_MODULE)}`]: BOUNDARY_SOURCE,
  });
  try {
    const result = runGuard({
      root: fixture.root,
      inventory: {
        ...EMPTY_INVENTORY,
        entries: [
          {
            file: BOUNDARY_MODULE,
            classification: 'behind-the-boundary',
            disposition: 'is-boundary',
            reason: 'fixture boundary',
          },
          {
            file: 'scripts/widget.ts',
            classification: 'read-only',
            disposition: 'unprivileged-direct',
            reason: 'claims to be anon-only',
          },
        ],
      },
    });
    assert.equal(result.ok, false);
    assert.ok(result.findings.some((f) => f.kind === 'privileged-in-read-only'));
  } finally {
    fixture.cleanup();
  }
});

test('a cross-lane deferral without a named owner fails', () => {
  const fixture = makeFixture({
    'package.json': PACKAGE_JSON,
    'scripts/suite.test.ts': `export const x = 1;`,
    'scripts/owned.ts': `
      import { createClient } from '@supabase/supabase-js';
      export const db = createClient(url, key);
    `,
    'packages/db/package.json': JSON.stringify({ name: '@unit-talk/db' }),
    [`packages/db/src/${path.basename(BOUNDARY_MODULE)}`]: BOUNDARY_SOURCE,
  });
  try {
    const base = {
      ...EMPTY_INVENTORY,
      entries: [
        {
          file: BOUNDARY_MODULE,
          classification: 'behind-the-boundary' as const,
          disposition: 'is-boundary' as const,
          reason: 'fixture boundary',
        },
        {
          file: 'scripts/owned.ts',
          classification: 'writable-privileged' as const,
          disposition: 'deferred-cross-lane' as const,
          reason: 'another lane owns it',
        },
      ],
    };
    assert.ok(
      runGuard({ root: fixture.root, inventory: base }).findings.some(
        (f) => f.kind === 'deferral-without-owner',
      ),
    );

    const withOwner = {
      ...base,
      entries: [base.entries[0]!, { ...base.entries[1]!, owner_issue: 'UTV2-0000' }],
    };
    assert.equal(runGuard({ root: fixture.root, inventory: withOwner }).ok, true);
  } finally {
    fixture.cleanup();
  }
});

test('a deferral cannot survive becoming reachable from pnpm test', () => {
  const fixture = makeFixture({
    'package.json': PACKAGE_JSON,
    'scripts/suite.test.ts': `import { db } from './owned.js';\nexport { db };`,
    'scripts/owned.ts': `
      import { createClient } from '@supabase/supabase-js';
      export const db = createClient(url, key);
    `,
    'packages/db/package.json': JSON.stringify({ name: '@unit-talk/db' }),
    [`packages/db/src/${path.basename(BOUNDARY_MODULE)}`]: BOUNDARY_SOURCE,
  });
  try {
    const result = runGuard({
      root: fixture.root,
      inventory: {
        ...EMPTY_INVENTORY,
        entries: [
          {
            file: BOUNDARY_MODULE,
            classification: 'behind-the-boundary',
            disposition: 'is-boundary',
            reason: 'fixture boundary',
          },
          {
            file: 'scripts/owned.ts',
            classification: 'writable-privileged',
            disposition: 'deferred-cross-lane',
            reason: 'another lane owns it',
            owner_issue: 'UTV2-0000',
          },
        ],
      },
    });
    assert.equal(result.ok, false);
    assert.ok(result.findings.some((f) => f.kind === 'reachable-from-test'));
  } finally {
    fixture.cleanup();
  }
});

// ---------------------------------------------------------------------------
// The real repository
// ---------------------------------------------------------------------------

test('the checked-in inventory clears the repository as it stands', () => {
  const result = runGuard({ inventory: loadInventory() });
  assert.deepEqual(
    result.findings.map((f) => `${f.kind}: ${f.file}`),
    [],
  );
  assert.equal(result.ok, true);
});

test('nothing reachable from pnpm test constructs a client outside the boundary', () => {
  const entrypoints = collectTestEntrypoints();
  // Guard the guard: an empty or tiny entrypoint set would make the walk vacuous.
  assert.ok(
    entrypoints.length > 200,
    `expected the pnpm test entrypoint set to be large, got ${entrypoints.length}`,
  );
  const reachable = reachableModules(entrypoints);
  assert.ok(
    reachable.has('packages/db/src/client.ts'),
    'the walk must reach the db client, or it is not walking anything',
  );

  const offenders = scanTree()
    .map((site) => site.file)
    .filter((file) => file !== BOUNDARY_MODULE && reachable.has(file));
  assert.deepEqual(offenders, []);
});

test('every inventory entry names a real disposition and a reason', () => {
  const inventory = loadInventory();
  assert.equal(inventory.boundary_module, BOUNDARY_MODULE);
  for (const entry of inventory.entries) {
    assert.ok(entry.reason.length > 20, `${entry.file} has no substantive reason`);
    assert.ok(
      ['writable-privileged', 'read-only', 'behind-the-boundary', 'dead'].includes(
        entry.classification,
      ),
      `${entry.file} has an unknown classification`,
    );
  }
});
