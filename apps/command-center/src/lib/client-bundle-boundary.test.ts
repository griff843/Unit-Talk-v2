/**
 * `next build` is the only thing that enforces the server/client module split,
 * and CI's `build` is `tsc -b`, which never runs it. A `'use client'` module
 * that transitively reaches `next/headers` therefore compiled, type-checked
 * and tested green while the Docker image build failed.
 *
 * This walks the real import graph out of every client entrypoint so the
 * boundary is enforced by the suite, not only by the image build.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import {
  SRC,
  hasDirective,
  importSpecifiers,
  isTestFile,
  resolveLocalSpecifier as resolveLocal,
  walkSource as walk,
} from './test-support/source-walk';

/** Modules a client bundle can never contain, whatever the path to them. */
const SERVER_ONLY_MODULES = ['next/headers', 'server-only'];

/**
 * A `'use server'` module is a deliberate boundary: Next replaces it with an
 * action reference in the client bundle rather than inlining its code, so the
 * graph stops there. Anything else it reaches is server code by construction.
 */
function isServerActionModule(source: string): boolean {
  return hasDirective(source, 'use server');
}

const ALL_FILES = walk(SRC).filter((path) => !isTestFile(path));

const CLIENT_ENTRYPOINTS = ALL_FILES.filter((path) =>
  hasDirective(readFileSync(path, 'utf8'), 'use client'),
);

test('the client-entrypoint walk actually found client components', () => {
  const relativePaths = CLIENT_ENTRYPOINTS.map((path) => relative(SRC, path));
  assert.ok(relativePaths.length >= 10, `expected client components, found ${relativePaths.length}`);
  assert.ok(
    relativePaths.includes('components/CommandCenterShell.tsx'),
    'components/CommandCenterShell.tsx is not recognised as a client entrypoint',
  );
});

test('no client component transitively imports a server-only module', () => {
  const offenders: string[] = [];

  for (const entry of CLIENT_ENTRYPOINTS) {
    const seen = new Set<string>([entry]);
    const queue: Array<{ file: string; trail: string[] }> = [
      { file: entry, trail: [relative(SRC, entry)] },
    ];

    while (queue.length > 0) {
      const { file, trail } = queue.shift()!;
      const source = readFileSync(file, 'utf8');

      for (const specifier of importSpecifiers(source)) {
        if (SERVER_ONLY_MODULES.includes(specifier)) {
          offenders.push(`${[...trail, specifier].join(' -> ')}`);
          continue;
        }
        const resolved = resolveLocal(file, specifier);
        if (!resolved || seen.has(resolved)) continue;
        seen.add(resolved);
        if (isServerActionModule(readFileSync(resolved, 'utf8'))) continue;
        queue.push({ file: resolved, trail: [...trail, relative(SRC, resolved)] });
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `client bundles reach server-only modules:\n${offenders.join('\n')}`,
  );
});

/**
 * Direct pins on the two walker primitives the graph walk depends on.
 *
 * Both defects they close were silent: a specifier form the walk could not see,
 * and a directive match that stopped the walk early. Neither shows up as a
 * failure anywhere — the walk simply reports nothing.
 */
test('the specifier walk sees bare side-effect imports', () => {
  assert.deepEqual(importSpecifiers("import 'server-only';\n"), ['server-only']);
  assert.deepEqual(importSpecifiers("import 'next/headers';\n"), ['next/headers']);
  assert.deepEqual(importSpecifiers("import x from './a';\nimport './b';\n"), ['./a', './b']);
  // `import type` stays erased; a bare import has no type form to confuse it.
  assert.deepEqual(importSpecifiers("import type { A } from './a';\n"), []);
});

test('a mid-file string literal is not a module directive', () => {
  assert.equal(isServerActionModule("'use server';\nexport const a = 1;\n"), true);
  assert.equal(isServerActionModule('// lead\n\n"use server";\n'), true);
  assert.equal(isServerActionModule("/* c */ 'use client';\n'use server';\n"), true);
  assert.equal(isServerActionModule("export const names = [\n  'use server',\n];\n"), false);
  assert.equal(isServerActionModule("const x = 1;\n'use server';\n"), false);
});
