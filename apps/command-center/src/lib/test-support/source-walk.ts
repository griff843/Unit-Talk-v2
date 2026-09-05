/**
 * Test-only: the single source walk every structural control shares.
 *
 * Three controls previously each carried their own copy of this walk, and two
 * of them hard-coded the files they cared about rather than enumerating. A
 * page added after the control was written was then covered by nothing. One
 * walk, exported once, means a new page or action is picked up by every
 * control that consumes it without anyone remembering to add it.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const APP = join(SRC, 'app');

/** Every `.ts`/`.tsx` file under `directory`, depth-first and name-sorted. */
export function walkSource(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory).sort()) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) out.push(...walkSource(full));
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

export function isTestFile(path: string): boolean {
  return path.endsWith('.test.ts') || path.endsWith('.test.tsx');
}

/** Every route entrypoint in the app router. */
export const PAGE_FILES: readonly string[] = walkSource(APP).filter((path) =>
  path.endsWith(`${sep}page.tsx`),
);

/** The route a `page.tsx` serves, e.g. `app/intel/teams/page.tsx` -> `/intel/teams`. */
export function routeOf(pageFile: string): string {
  const segments = relative(APP, pageFile).split(sep).slice(0, -1);
  return `/${segments.join('/')}`;
}

/** Dynamic segments of a route, e.g. `/picks/[id]` -> `['id']`. */
export function dynamicSegments(pageFile: string): string[] {
  return relative(APP, pageFile)
    .split(sep)
    .slice(0, -1)
    .filter((segment) => segment.startsWith('[') && segment.endsWith(']'))
    .map((segment) => segment.replace(/^\[+|\]+$/g, '').replace(/^\.\.\./, ''));
}

/**
 * Directives in a module's prologue.
 *
 * Anchoring matters: `/^\s*['"]use server['"]/m` matches a plain string
 * literal `'use server',` sitting inside an array anywhere in the file, which
 * made an ordinary module look like an action boundary and hid its entire
 * downstream import graph. Only leading comments and whitespace may precede a
 * directive, and the run ends at the first statement that is not one.
 */
export function modulePrologue(source: string): string[] {
  const directives: string[] = [];
  let rest = source;
  for (;;) {
    const trimmed = rest.replace(/^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)+/, '');
    const match = /^(['"])((?:[^'"\\]|\\.)*)\1\s*;?/.exec(trimmed);
    if (!match) return directives;
    directives.push(match[2]!);
    rest = trimmed.slice(match[0].length);
  }
}

export function hasDirective(source: string, directive: string): boolean {
  return modulePrologue(source).includes(directive);
}

/**
 * Value-import specifiers in a module.
 *
 * `import type` is erased before bundling and is not an edge. The bare
 * side-effect form has no `from`, so a pattern requiring one cannot see
 * `import 'server-only';` at all — which is the only form that import takes.
 */
export function importSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?!type\s)[\s\S]*?from\s*['"]([^'"]+)['"]/g),
    ...source.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]\s*;?/g),
    ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map((match) => match[1]!);
}

/** Resolve an in-repo specifier to a file, or null for a bare package. */
export function resolveLocalSpecifier(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier);
  else return null;

  // NodeNext-style specifiers name the emitted `.js`; the source is `.ts`.
  const rewritten = base.endsWith('.js') ? base.slice(0, -3) : base;
  for (const candidate of [
    `${rewritten}.ts`,
    `${rewritten}.tsx`,
    base,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}
