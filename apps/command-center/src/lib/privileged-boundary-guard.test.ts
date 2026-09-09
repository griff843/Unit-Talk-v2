import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import { PrivilegedAccessDeniedError } from './request-auth';
import { getGovernanceBoardSnapshot } from './governance-board';
import {
  SRC,
  importSpecifiers,
  isTestFile,
  resolveLocalSpecifier,
  walkSource as walk,
} from './test-support/source-walk';

const GUARD_CALL = /await\s+assertPrivilegedRequestAuthenticated\s*\(\s*\)\s*;/;

const BOUNDARIES = [
  { path: 'lib/data/client.ts', name: 'getDataClient' },
  { path: 'lib/data/preview.ts', name: 'proxyToApi' },
  { path: 'lib/data/model-performance.ts', name: 'getModelPerformance' },
  { path: 'lib/data/storage-health.ts', name: 'getStorageHealth' },
  { path: 'lib/governance-board.ts', name: 'getGovernanceBoardSnapshot' },
  { path: 'lib/data/runtime-truth.ts', name: 'getRuntimeTruth' },
  { path: 'lib/data/runtime-truth.ts', name: 'getRuntimeHealth' },
] as const;

function functionBody(source: string, name: string): string {
  const declaration = new RegExp(`(?:export\\s+)?async\\s+function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(declaration, `could not locate function declaration for ${name}`);

  let cursor = declaration.index + declaration[0].length;
  let parentheses = 1;
  while (cursor < source.length && parentheses > 0) {
    if (source[cursor] === '(') parentheses += 1;
    else if (source[cursor] === ')') parentheses -= 1;
    cursor += 1;
  }

  const open = source.indexOf('{', cursor);
  assert.notEqual(open, -1, `could not locate function body for ${name}`);
  let braces = 1;
  cursor = open + 1;
  while (cursor < source.length && braces > 0) {
    if (source[cursor] === '{') braces += 1;
    else if (source[cursor] === '}') braces -= 1;
    cursor += 1;
  }
  assert.equal(braces, 0, `unterminated function body for ${name}`);
  return source.slice(open + 1, cursor - 1);
}

for (const boundary of BOUNDARIES) {
  test(`${boundary.path}:${boundary.name} owns its privileged request assertion`, () => {
    const source = readFileSync(join(SRC, boundary.path), 'utf8');
    assert.match(
      functionBody(source, boundary.name),
      GUARD_CALL,
      `${boundary.path}:${boundary.name} lost its own authentication gate`,
    );
  });
}

test('governance snapshot refuses before reading manifests', async () => {
  await assert.rejects(
    () => getGovernanceBoardSnapshot({ manifestDirectory: '/definitely-not-a-manifest-directory' }),
    PrivilegedAccessDeniedError,
  );
});

/**
 * The ban has to cover all of `src`, not just `src/app`.
 *
 * A re-export placed in `lib/` or `components/` reaches a page just as
 * directly as one placed in `app/`, so walking only `app` left the boundary
 * open on the two directories most likely to hold a helper.
 */
const GOVERNANCE_INTERNAL_MODULE = 'lib/governance-board.internal.ts';

/** The only module allowed to import the unauthenticated reader. */
const GOVERNANCE_INTERNAL_OWNER = 'lib/governance-board.ts';

test('the governance import walk covers all of src, not just src/app', () => {
  const walked = walk(SRC).map((path) => relative(SRC, path));

  assert.ok(walked.includes('lib/governance-board.ts'), 'lib/ is not walked');
  assert.ok(walked.includes('components/CommandCenterShell.tsx'), 'components/ is not walked');
  assert.ok(walked.includes('app/page.tsx'), 'app/ is not walked');
  assert.ok(walked.includes(GOVERNANCE_INTERNAL_MODULE), 'the internal reader module is not walked');
});

/**
 * The ban is on the module, resolved from real import specifiers — not on the
 * identifier.
 *
 * A substring search for `readGovernanceBoardSnapshotUnauthenticated` was
 * defeated two ways with a green suite: an allow-listed owner re-exporting it
 * under an alias, and `import * as gb` plus a computed key
 * `gb['readGovernanceBoardSnapshot' + 'Unauthenticated']`. Neither contains the
 * banned identifier at the call site, and the second contains it nowhere in one
 * piece. Both, however, must name the module that holds the reader — an alias
 * has to import what it aliases, and a namespace object has to come from
 * somewhere — so banning the specifier closes the class rather than the two
 * spellings that were found.
 */
test('no module outside the owner imports the unauthenticated governance reader', () => {
  const internalFile = join(SRC, GOVERNANCE_INTERNAL_MODULE);
  const offenders: string[] = [];

  for (const file of walk(SRC)) {
    const path = relative(SRC, file);
    if (isTestFile(path) || path === GOVERNANCE_INTERNAL_MODULE) continue;

    for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
      if (resolveLocalSpecifier(file, specifier) !== internalFile) continue;
      if (path === GOVERNANCE_INTERNAL_OWNER) continue;
      offenders.push(`${path} imports ${specifier}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `code outside ${GOVERNANCE_INTERNAL_OWNER} reached the governance escape hatch: ${offenders.join(', ')}`,
  );
});

/**
 * The escape hatch must also not be reachable by name from the authenticated
 * facade's own exports, which is what made an alias re-export possible at all.
 */
test('the authenticated facade does not re-export the unauthenticated reader', async () => {
  const facade = await import('./governance-board');
  const exported = Object.keys(facade);

  // Non-vacuous: the namespace must really carry the facade's own exports,
  // otherwise "no export ends in Unauthenticated" would be true of an empty
  // object and would prove nothing.
  assert.ok(
    exported.includes('getGovernanceBoardSnapshot'),
    `governance-board namespace did not resolve its exports: ${exported.join(', ')}`,
  );

  assert.deepEqual(
    exported.filter((name) => /Unauthenticated$/.test(name)),
    [],
    `governance-board.ts re-exports the escape hatch: ${exported.join(', ')}`,
  );

  const source = readFileSync(join(SRC, GOVERNANCE_INTERNAL_OWNER), 'utf8');
  assert.doesNotMatch(
    source,
    /export\s*\{[^}]*readGovernanceBoardSnapshotUnauthenticated/,
    'governance-board.ts re-exports the unauthenticated reader',
  );
});
