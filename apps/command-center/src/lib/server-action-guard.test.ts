/**
 * Structural pin: every server action in the Command Center resolves the
 * middleware-issued actor before it does anything privileged.
 *
 * A server action is independently addressable. A POST carrying the
 * `Next-Action` header invokes the function directly — the page is not
 * rendered, and neither is the layout — so neither the page's own checks nor
 * the layout gate protects it. The middleware matcher was the only thing
 * standing in front of them, which is the defect this lane closes.
 *
 * Enumerating the actions from source rather than listing them by hand is the
 * point: a new unguarded action added next month fails here, which a fixed list
 * cannot do. Two real gaps were found this way and are fixed in this lane —
 * `actions/picks.ts` (a service-role read behind no check at all) and the inline
 * action in `model-health/page.tsx` (which also recorded the literal string
 * 'operator' as the acting identity).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(SRC, 'app');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const GUARD = /resolveActorOrRefusal|requireAuthenticatedActor|assertAuthenticatedActor/;

/**
 * Strip comments and string literals before looking for the guard.
 *
 * Mutation testing caught this: removing the real `resolveActorOrRefusal()`
 * call from `actions/picks.ts` left the suite green, because the file's own
 * docblock names the function and the raw-source regex matched the prose. A
 * check that a comment can satisfy constrains nothing. Only executable code
 * counts.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
}

interface ActionFile {
  readonly path: string;
  /** Names of exported async functions — the addressable server actions. */
  readonly exported: readonly string[];
  /** Inline `'use server'` functions declared inside a component file. */
  readonly inline: readonly string[];
  readonly guarded: boolean;
}

const ACTION_FILES: ActionFile[] = walk(APP)
  .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
  .filter(({ source }) => /['"]use server['"]/.test(source))
  .map(({ path, source }) => ({
    path: relative(SRC, path),
    exported: [...source.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]),
    inline: [...source.matchAll(/^async function (\w+)\([^)]*\)\s*\{\n\s*['"]use server['"]/gm)].map(
      (m) => m[1],
    ),
    guarded: GUARD.test(code(source)),
  }));

test('the walk actually found the server actions', () => {
  assert.ok(
    ACTION_FILES.length >= 6,
    `expected the Command Center server actions, found ${ACTION_FILES.length}`,
  );
  assert.ok(
    ACTION_FILES.some((f) => f.path === 'app/actions/picks.ts'),
    'actions/picks.ts is missing — it is the service-role read behind /picks/[id]',
  );
  assert.ok(
    ACTION_FILES.some((f) => f.inline.length > 0),
    'no inline "use server" function was found; the inline form must stay covered',
  );
});

for (const file of ACTION_FILES) {
  const actions = [...file.exported, ...file.inline];
  if (actions.length === 0) continue;

  test(`every server action in ${file.path} is behind the actor guard`, () => {
    assert.equal(
      file.guarded,
      true,
      `${file.path} declares server action(s) ${actions.join(', ')} but never resolves the ` +
        'middleware-issued actor. A Next-Action POST reaches them without rendering the page ' +
        'or layout, so nothing else authenticates the caller.',
    );
  });
}

test('no server action records a hard-coded operator identity', () => {
  // `actor: 'operator'` shipped in model-health/page.tsx: a fabricated identity
  // written into the same audit stream real operator writes land in, so an
  // auditor could not tell them apart. The authenticated actor is the only
  // acceptable value.
  const offenders = ACTION_FILES.filter(({ path }) =>
    /actor:\s*['"](operator|unknown|system|anonymous)['"]/.test(
      readFileSync(join(SRC, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' '),
    ),
  ).map((f) => f.path);

  assert.deepEqual(offenders, [], `hard-coded acting identity in: ${offenders.join(', ')}`);
});
