/**
 * Structural and behavioural pins for independently addressable server
 * actions. The source walk catches a missing guard cheaply; direct invocation
 * proves an unauthenticated request is refused before outbound I/O.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { createRequire } from 'node:module';
import type { SubmissionDraft } from './pick-builder-model';
import {
  FORGED_ACTOR_SENTINEL,
  FORGED_AUTHENTICATED_IDENTITY_HEADERS,
  FORGED_IDENTITY_HEADERS,
  withRequestContext,
} from './test-support/request-context';
import {
  APP,
  PAGE_FILES,
  SRC,
  hasDirective,
  isTestFile,
  walkSource as walk,
} from './test-support/source-walk';
import { withLoopbackSupabaseTarget, withWorkspaceEnvDefaults } from './test-support/workspace-env';

/** These test files transpile to CJS, so module discovery has to be synchronous. */
const requireModule = createRequire(import.meta.url);

const UNAUTHENTICATED_ACTION_ERROR =
  'Unauthenticated: valid Command Center credentials are required';

const GUARD = /resolveActorOrRefusal|requireAuthenticatedActor|assertPrivilegedRequestAuthenticated/;

/**
 * Strip comments and string literals before looking for the guard.
 *
 * A docblock or error string mentioning a guard must never satisfy the check.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
}

interface Action {
  readonly path: string;
  readonly name: string;
  readonly kind: 'exported' | 'inline';
  /** `null` when the declaration could not be located; that is a failure, not a skip. */
  readonly body: string | null;
}

/** Index just past the parameter list that starts at `cursor` (inside it). */
function endOfParameters(executable: string, cursor: number): number {
  let parentheses = 1;
  while (cursor < executable.length && parentheses > 0) {
    if (executable[cursor] === '(') parentheses += 1;
    else if (executable[cursor] === ')') parentheses -= 1;
    cursor += 1;
  }
  return cursor;
}

/**
 * Index of the `{` that opens the body, skipping any return-type annotation.
 *
 * A naive `indexOf('{')` lands inside `Promise<{ ... }>` and truncates the
 * body to the type literal, which silently hides everything the function
 * actually does. Bracket depth over `<([{` keeps the annotation out.
 */
function openingBrace(executable: string, afterParameters: number): number {
  let cursor = afterParameters;
  let depth = 0;
  while (cursor < executable.length) {
    const character = executable[cursor];
    if (character === '{' && depth === 0) return cursor;
    if (character === '<' || character === '(' || character === '[' || character === '{') depth += 1;
    else if (character === '>' || character === ')' || character === ']' || character === '}') {
      depth -= 1;
      if (depth < 0) return -1;
    } else if (character === ';' && depth === 0) return -1;
    cursor += 1;
  }
  return -1;
}

/** Index just past the `}` closing a body whose `{` sits at `open`. */
function endOfBody(executable: string, open: number): number {
  let braces = 1;
  let cursor = open + 1;
  while (cursor < executable.length && braces > 0) {
    if (executable[cursor] === '{') braces += 1;
    else if (executable[cursor] === '}') braces -= 1;
    cursor += 1;
  }
  return braces === 0 ? cursor : -1;
}

/** Body of a `{ ... }` block whose `{` is the first non-space char at `cursor`. */
function bracedBodyFrom(executable: string, cursor: number): string | null {
  let index = cursor;
  while (index < executable.length && /\s/.test(executable[index]!)) index += 1;
  if (executable[index] !== '{') return null;
  const close = endOfBody(executable, index);
  return close === -1 ? null : executable.slice(index + 1, close - 1);
}

/**
 * Index of the `=>` that separates an arrow function's parameters from its
 * body, scanning from `cursor` at bracket depth zero, or -1.
 */
function arrowToken(executable: string, cursor: number): number {
  let depth = 0;
  for (let index = cursor; index < executable.length - 1; index += 1) {
    const character = executable[index]!;
    if (character === '(' || character === '[' || character === '{') depth += 1;
    else if (character === ')' || character === ']' || character === '}') {
      depth -= 1;
      if (depth < 0) return -1;
    } else if (depth === 0 && character === '=' && executable[index + 1] === '>') return index;
    else if (depth === 0 && character === ';') return -1;
  }
  return -1;
}

/**
 * The executable body of `name` as declared in `source`, or `null`.
 *
 * Discovery is by module export, so this must cope with every spelling a
 * registered server action can take, not only `export async function`. A
 * declaration form this cannot read returns `null` and fails the structural
 * test loudly rather than dropping the action out of the walk.
 */
function functionBody(source: string, name: string): string | null {
  const executable = code(source);

  // `async function name(...)` — declaration, exported inline or via a list.
  const declaration = new RegExp(
    `(?:export\\s+)?(?:default\\s+)?async\\s+function\\s+${name}\\s*\\(`,
  ).exec(executable);
  if (declaration) {
    const afterParameters = endOfParameters(
      executable,
      declaration.index + declaration[0].length,
    );
    const open = openingBrace(executable, afterParameters);
    if (open === -1) return null;
    const close = endOfBody(executable, open);
    if (close === -1) return null;
    return executable.slice(open + 1, close - 1);
  }

  // `const name = async (...) => ...` / `= async function (...) {...}`.
  const binding = new RegExp(
    `(?:export\\s+)?(?:const|let|var)\\s+${name}\\s*(?::[^=]*)?=\\s*`,
  ).exec(executable);
  if (!binding) return null;
  const afterEquals = binding.index + binding[0].length;

  const expression = new RegExp(`^async\\s+function\\s*\\w*\\s*\\(`).exec(
    executable.slice(afterEquals),
  );
  if (expression) {
    const afterParameters = endOfParameters(executable, afterEquals + expression[0].length);
    const open = openingBrace(executable, afterParameters);
    if (open === -1) return null;
    const close = endOfBody(executable, open);
    if (close === -1) return null;
    return executable.slice(open + 1, close - 1);
  }

  const arrow = arrowToken(executable, afterEquals);
  if (arrow === -1) return null;
  const braced = bracedBodyFrom(executable, arrow + 2);
  if (braced !== null) return braced;

  // Concise arrow body: everything up to the end of the statement.
  let cursor = arrow + 2;
  let depth = 0;
  while (cursor < executable.length) {
    const character = executable[cursor]!;
    if (character === '(' || character === '[' || character === '{') depth += 1;
    else if (character === ')' || character === ']' || character === '}') {
      depth -= 1;
      if (depth < 0) break;
    } else if (depth === 0 && character === ';') break;
    cursor += 1;
  }
  return executable.slice(arrow + 2, cursor);
}

/**
 * Server actions, discovered from what each `'use server'` module actually
 * exports rather than from declaration syntax.
 *
 * A syntax walk sees `export async function name`, and nothing else. An
 * exported async arrow (`export const name = async () => {}`) and a deferred
 * export list (`async function name() {}; export { name }`) are both registered
 * by Next exactly as the first form is — both appear in
 * `.next/server/server-reference-manifest.json` — and both were invisible here.
 * Because the completeness test below is bidirectional against this set, an
 * action the walk could not see got no structural test and no behavioural test
 * at all. Enumerating the module's own exports closes the form class rather
 * than two spellings, and needs no maintenance when a third appears.
 */
const ACTIONS: Action[] = [];
for (const path of walk(APP)) {
  if (isTestFile(path)) continue;
  const source = readFileSync(path, 'utf8');

  if (hasDirective(source, 'use server')) {
    const module = requireModule(path) as Record<string, unknown>;
    for (const name of Object.keys(module)) {
      if (typeof module[name] !== 'function') continue;
      ACTIONS.push({
        path: relative(SRC, path),
        name,
        kind: 'exported',
        body: functionBody(source, name),
      });
    }
  }

  for (const match of source.matchAll(
    /^async function (\w+)\([^)]*\)\s*\{\n\s*['"]use server['"]/gm,
  )) {
    ACTIONS.push({
      path: relative(SRC, path),
      name: match[1]!,
      kind: 'inline',
      body: functionBody(source, match[1]!),
    });
  }
}

test('the walk actually found the server actions', () => {
  assert.ok(ACTIONS.length >= 10, `expected Command Center server actions, found ${ACTIONS.length}`);
  assert.ok(
    ACTIONS.some((action) => action.path === 'app/actions/picks.ts'),
    'actions/picks.ts is missing',
  );
  assert.ok(ACTIONS.some((action) => action.path === 'app/actions/model-health.ts'));
});

for (const action of ACTIONS) {
  test(`${action.path}:${action.name} reaches the actor guard in its own body`, () => {
    assert.ok(
      action.body !== null,
      `${action.path}:${action.name} is an exported server action whose declaration this ` +
        'control could not read, so its guard cannot be checked; teach functionBody the form',
    );
    assert.match(
      action.body,
      GUARD,
      `${action.path}:${action.name} is independently addressable but its own body does not ` +
        'authenticate the request',
    );
  });
}

test('no server action records a hard-coded operator identity', () => {
  const offenders = ACTIONS.filter(({ body }) =>
    /actor:\s*['"](operator|unknown|system|anonymous)['"]/.test(body ?? ''),
  ).map(({ path, name }) => `${path}:${name}`);

  assert.deepEqual(offenders, [], `hard-coded acting identity in: ${offenders.join(', ')}`);
});

function refusalError(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const error = Reflect.get(value, 'error');
  return typeof error === 'string' ? error : null;
}

const validModelHealthForm = () => {
  const form = new FormData();
  form.set('modelId', 'model-1');
  form.set('action', 'acknowledge');
  form.set('reason', 'reviewed');
  return form;
};

/**
 * Run `fn` under a request that carries `headerEntries` and no credentials.
 *
 * Sealing an empty header bag was the hole: the original vulnerability was a
 * caller-supplied `x-command-center-actor` header being trusted, and a request
 * with no headers at all can never exercise that. Every behavioural case below
 * therefore runs twice — bare, and with the forged identity headers.
 */
async function withUnauthenticatedRequest<T>(
  fn: () => T,
  headerEntries: Record<string, string> = {},
): Promise<T> {
  return withRequestContext(headerEntries, fn);
}

const BEHAVIOURAL_ACTIONS: Array<{
  path: string;
  name: string;
  invoke: () => Promise<unknown>;
  assertRefusal: (value: unknown) => void;
}> = [
  {
    path: 'app/actions/board.ts',
    name: 'writeSystemPicks',
    invoke: async () => (await import('../app/actions/board')).writeSystemPicks(),
    assertRefusal: (value) => assert.equal(refusalError(value), UNAUTHENTICATED_ACTION_ERROR),
  },
  {
    path: 'app/actions/execution.ts',
    name: 'submitBuiltPick',
    invoke: async () => (await import('../app/actions/execution')).submitBuiltPick({} as SubmissionDraft),
    assertRefusal: (value) => assert.equal(refusalError(value), UNAUTHENTICATED_ACTION_ERROR),
  },
  {
    path: 'app/actions/intervention.ts',
    name: 'retryDelivery',
    invoke: async () => (await import('../app/actions/intervention')).retryDelivery('pick-1', 'retry'),
    assertRefusal: (value) => assert.equal(refusalError(value), UNAUTHENTICATED_ACTION_ERROR),
  },
  {
    path: 'app/actions/intervention.ts',
    name: 'rerunPromotion',
    invoke: async () => (await import('../app/actions/intervention')).rerunPromotion('pick-1', 'rerun'),
    assertRefusal: (value) => assert.equal(refusalError(value), UNAUTHENTICATED_ACTION_ERROR),
  },
  {
    path: 'app/actions/intervention.ts',
    name: 'overridePromotion',
    invoke: async () => (await import('../app/actions/intervention')).overridePromotion('pick-1', 'suppress', 'suppress'),
    assertRefusal: (value) => assert.equal(refusalError(value), UNAUTHENTICATED_ACTION_ERROR),
  },
  {
    path: 'app/actions/intervention.ts',
    name: 'requeueDelivery',
    invoke: async () => (await import('../app/actions/intervention')).requeueDelivery('pick-1'),
    assertRefusal: (value) => assert.equal(refusalError(value), UNAUTHENTICATED_ACTION_ERROR),
  },
  {
    path: 'app/actions/picks.ts',
    name: 'loadPickDetail',
    invoke: async () => (await import('../app/actions/picks')).loadPickDetail('pick-1'),
    assertRefusal: (value) => assert.equal(value, null),
  },
  {
    path: 'app/actions/review.ts',
    name: 'reviewPick',
    invoke: async () => (await import('../app/actions/review')).reviewPick('pick-1', 'approve', 'approved'),
    assertRefusal: (value) => assert.equal(refusalError(value), UNAUTHENTICATED_ACTION_ERROR),
  },
  {
    path: 'app/actions/review.ts',
    name: 'bulkReviewPicks',
    invoke: async () => (await import('../app/actions/review')).bulkReviewPicks(['pick-1'], 'approve', 'approved'),
    assertRefusal: (value) => assert.equal(refusalError(value), UNAUTHENTICATED_ACTION_ERROR),
  },
  {
    path: 'app/actions/settle.ts',
    name: 'settlePick',
    invoke: async () => (await import('../app/actions/settle')).settlePick('pick-1', 'win'),
    assertRefusal: (value) => assert.equal(refusalError(value), UNAUTHENTICATED_ACTION_ERROR),
  },
  {
    path: 'app/operations/discord/actions.ts',
    name: 'setDeliveryKillSwitch',
    invoke: async () => (await import('../app/operations/discord/actions')).setDeliveryKillSwitch('discord:canary', true, 'test'),
    assertRefusal: (value) => assert.equal(refusalError(value), UNAUTHENTICATED_ACTION_ERROR),
  },
  {
    path: 'app/actions/model-health.ts',
    name: 'submitModelHealthDecision',
    invoke: async () => (await import('../app/actions/model-health')).submitModelHealthDecision(validModelHealthForm()),
    assertRefusal: (value) => {
      assert.ok(value instanceof Error);
      assert.match(String(Reflect.get(value, 'digest')), /Unauthenticated/);
    },
  },
];

/**
 * Every independently addressable action must be driven behaviourally, not
 * only walked structurally.
 *
 * The structural walk is what discovers actions; this ties the behavioural
 * table to it, so an action added tomorrow fails here until it is driven under
 * both the unauthenticated and the authenticated-forged-header cases below
 * rather than silently being covered by neither.
 */
test('every discovered server action is driven behaviourally', () => {
  const discovered = ACTIONS.filter((action) => action.kind === 'exported')
    .map((action) => `${action.path}:${action.name}`)
    .sort();
  const driven = BEHAVIOURAL_ACTIONS.map((action) => `${action.path}:${action.name}`).sort();

  assert.deepEqual(
    discovered.filter((entry) => !driven.includes(entry)),
    [],
    'server actions with no behavioural case; add one to BEHAVIOURAL_ACTIONS',
  );
  assert.deepEqual(
    driven.filter((entry) => !discovered.includes(entry)),
    [],
    'behavioural cases naming an action the walk does not find',
  );
});

const UNAUTHENTICATED_REQUEST_SHAPES: Array<{ label: string; headers: Record<string, string> }> = [
  { label: 'no headers', headers: {} },
  { label: 'forged identity headers', headers: FORGED_IDENTITY_HEADERS },
];

for (const shape of UNAUTHENTICATED_REQUEST_SHAPES)
for (const action of BEHAVIOURAL_ACTIONS) {
  test(`${action.name} refuses an unauthenticated request before fetch (${shape.label})`, async () => {
    const originalFetch = globalThis.fetch;
    const previousAppEnv = process.env.UNIT_TALK_APP_ENV;
    const previousToken = process.env.COMMAND_CENTER_AUTH_TOKEN;
    process.env.UNIT_TALK_APP_ENV = 'production';
    process.env.COMMAND_CENTER_AUTH_TOKEN = 'server-action-test-token';
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ ok: true, data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    try {
      let outcome: unknown;
      try {
        outcome = await withUnauthenticatedRequest(action.invoke, shape.headers);
      } catch (error) {
        outcome = error;
      }
      action.assertRefusal(outcome);
      assert.equal(fetchCalls, 0, `${action.name} performed outbound fetch before refusal`);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousAppEnv === undefined) delete process.env.UNIT_TALK_APP_ENV;
      else process.env.UNIT_TALK_APP_ENV = previousAppEnv;
      if (previousToken === undefined) delete process.env.COMMAND_CENTER_AUTH_TOKEN;
      else process.env.COMMAND_CENTER_AUTH_TOKEN = previousToken;
    }
  });
}


/**
 * Authenticated caller, forged `x-command-center-actor`.
 *
 * Every case above is unauthenticated, so all of them are satisfied by an
 * action that calls the guard, ignores its answer, and records
 * `headers().get('x-command-center-actor')` instead. That mutation is invisible
 * to a refusal test: the request is refused when it should be, and impersonates
 * when it is not. Because `COMMAND_CENTER_AUTH_TOKEN` is one shared bearer, the
 * recorded actor is the only thing distinguishing operators, so what actually
 * reaches the backend is the whole audit-integrity story.
 */
const CREDENTIAL_PROVEN_ACTOR = 'credential-proven-operator';
const AUTHENTICATED_TEST_TOKEN = 'server-action-authenticated-test-token';

interface OutboundRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string | null;
}

/** Identity-bearing values in an outbound request: header and body fields. */
function recordedIdentities(request: OutboundRequest): Array<{ field: string; value: string }> {
  const found: Array<{ field: string; value: string }> = [];
  for (const [name, value] of Object.entries(request.headers)) {
    if (/identity|actor|operator|user/i.test(name)) found.push({ field: `header ${name}`, value });
  }
  if (request.body) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(request.body);
    } catch {
      parsed = null;
    }
    const visit = (node: unknown, trail: string) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach((entry, index) => visit(entry, `${trail}[${index}]`));
        return;
      }
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        const path = trail ? `${trail}.${key}` : key;
        if (typeof value === 'string' && /^(?:actor|.*(?:By|_by))$/.test(key)) {
          found.push({ field: `body ${path}`, value });
        }
        visit(value, path);
      }
    };
    visit(parsed, '');
  }
  return found;
}

async function invokeAuthenticatedWithForgedActor(
  invoke: () => Promise<unknown>,
): Promise<{ outcome: unknown; outbound: OutboundRequest[] }> {
  const originalFetch = globalThis.fetch;
  const keys = [
    'UNIT_TALK_APP_ENV',
    'COMMAND_CENTER_AUTH_TOKEN',
    'COMMAND_CENTER_OPERATOR_IDENTITY',
    'UNIT_TALK_CC_API_KEY',
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const restoreWorkspaceEnv = withWorkspaceEnvDefaults();
  const restoreSupabaseTarget = withLoopbackSupabaseTarget();

  process.env.UNIT_TALK_APP_ENV = 'production';
  process.env.COMMAND_CENTER_AUTH_TOKEN = AUTHENTICATED_TEST_TOKEN;
  process.env.COMMAND_CENTER_OPERATOR_IDENTITY = CREDENTIAL_PROVEN_ACTOR;
  process.env.UNIT_TALK_CC_API_KEY = 'authenticated-actor-test-key';

  const outbound: OutboundRequest[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers((init?.headers ?? {}) as HeadersInit).forEach((value, name) => {
      headers[name] = value;
    });
    outbound.push({
      url: String(input),
      headers,
      body: typeof init?.body === 'string' ? init.body : null,
    });
    return new Response(JSON.stringify({ ok: true, data: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    let outcome: unknown;
    try {
      outcome = await withRequestContext(
        {
          authorization: `Bearer ${AUTHENTICATED_TEST_TOKEN}`,
          ...FORGED_AUTHENTICATED_IDENTITY_HEADERS,
        },
        invoke,
      );
    } catch (error) {
      outcome = error;
    }
    return { outcome, outbound };
  } finally {
    globalThis.fetch = originalFetch;
    restoreSupabaseTarget();
    restoreWorkspaceEnv();
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

for (const action of BEHAVIOURAL_ACTIONS) {
  test(`${action.path}:${action.name} records the credential-proven actor, not a forged header`, async () => {
    const { outcome, outbound } = await invokeAuthenticatedWithForgedActor(action.invoke);

    assert.notEqual(
      refusalError(outcome),
      UNAUTHENTICATED_ACTION_ERROR,
      `${action.name} refused a validly authenticated request; the forged-actor case proves nothing`,
    );

    for (const request of outbound) {
      // A distinctive prefix, not the whole value: an action that truncated the
      // forged header (`forged.slice(0, 24)`) or appended it to a URL still
      // carried the caller's claim to the backend, and a full-value match let
      // both through. Nothing legitimate contains this prefix.
      assert.ok(
        !JSON.stringify(request).includes(FORGED_ACTOR_SENTINEL.slice(0, 12)),
        `${action.name} carried the caller-supplied actor into ${request.url}: ` +
          `${request.body ?? JSON.stringify(request.headers)}`,
      );
      for (const identity of recordedIdentities(request)) {
        assert.equal(
          identity.value,
          CREDENTIAL_PROVEN_ACTOR,
          `${action.name} sent ${identity.field}=${identity.value} to ${request.url}; ` +
            `the credential proved ${CREDENTIAL_PROVEN_ACTOR}`,
        );
      }
    }
  });
}

/**
 * The forged-actor cases are only worth their run time if the actions actually
 * reach the backend under them. An action that silently stopped issuing any
 * outbound request would pass every loop above vacuously.
 *
 * Hermeticity: `loadPickDetail` reaches the backend through `getDataClient`,
 * which resolves `SUPABASE_*` before any request is built, so this test used to
 * depend on the ambient checkout environment — green locally, red in CI, on
 * environment alone rather than on behaviour. `invokeAuthenticatedWithForgedActor`
 * now calls `withLoopbackSupabaseTarget`, which *overrides* the Supabase target
 * with a literal loopback address for the duration of the call. `decideTarget`
 * in `packages/db/src/privileged-client-boundary.ts` allows loopback explicitly
 * as provably isolated, and `globalThis.fetch` is stubbed for the same window,
 * so the request is built and captured without leaving the process and without
 * any real database being reachable in either direction.
 *
 * What this test does and does not establish: it establishes that each action
 * issues an outbound request under an authenticated caller, which is what makes
 * the forged-actor loops above non-vacuous. It establishes nothing about what a
 * real backend would do with that request — the response is a stub.
 */
test('the authenticated forged-actor cases actually reach the backend', async () => {
  const silent: string[] = [];
  for (const action of BEHAVIOURAL_ACTIONS) {
    const { outbound } = await invokeAuthenticatedWithForgedActor(action.invoke);
    if (outbound.length === 0) silent.push(`${action.path}:${action.name}`);
  }

  assert.deepEqual(
    silent,
    [],
    `actions made no outbound request under an authenticated caller, so their ` +
      `forged-actor case asserts nothing: ${silent.join(', ')}`,
  );
});

/**
 * Page components are the other independently addressable server surface.
 *
 * `route-surface.test.ts` and `privileged-boundary-guard.test.ts` both stop at
 * `lib/data`, so a `page.tsx` that calls `server-api` directly — which is how
 * `/api-health` spent the operator API key for anonymous callers — is invisible
 * to them. Any page function that reaches the backend without going through a
 * gated `lib/data` boundary must own its own assertion.
 */
const PRIVILEGED_BACKEND_HELPERS =
  /\b(?:fetchRuntimeTruth|fetchRuntimeHealth|resolveCommandCenterApiHeaders)\b/g;

interface FunctionRange {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly body: string;
}

/** Body ranges of every function declaration in already-stripped source. */
function functionRanges(executable: string): FunctionRange[] {
  const ranges: FunctionRange[] = [];
  const declaration = /(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = declaration.exec(executable)) !== null) {
    const afterParameters = endOfParameters(executable, match.index + match[0].length);
    const open = openingBrace(executable, afterParameters);
    if (open === -1) continue;
    const close = endOfBody(executable, open);
    if (close === -1) continue;
    ranges.push({
      name: match[1]!,
      start: open + 1,
      end: close - 1,
      body: executable.slice(open + 1, close - 1),
    });
  }
  return ranges;
}

function withoutImports(executable: string): string {
  // Keep offsets stable: blank the import statements rather than remove them.
  return executable.replace(/^\s*import\b[^;]*;/gm, (statement) => ' '.repeat(statement.length));
}

test('the page walk actually found route entrypoints', () => {
  const relativePaths = PAGE_FILES.map((path) => relative(SRC, path));
  assert.ok(relativePaths.length >= 40, `expected Command Center pages, found ${relativePaths.length}`);
  assert.ok(relativePaths.includes('app/api-health/page.tsx'), 'app/api-health/page.tsx is missing');
  assert.ok(relativePaths.includes('app/exceptions/page.tsx'), 'app/exceptions/page.tsx is missing');
  assert.ok(relativePaths.includes('app/model-health/page.tsx'), 'app/model-health/page.tsx is missing');
});

test('no page reaches the backend directly without its own request assertion', () => {
  const offenders: string[] = [];

  for (const path of PAGE_FILES) {
    const executable = withoutImports(code(readFileSync(path, 'utf8')));
    const ranges = functionRanges(executable);
    PRIVILEGED_BACKEND_HELPERS.lastIndex = 0;
    let use: RegExpExecArray | null;
    while ((use = PRIVILEGED_BACKEND_HELPERS.exec(executable)) !== null) {
      const index = use.index;
      const containing = ranges
        .filter((range) => index >= range.start && index < range.end)
        .sort((a, b) => b.start - a.start)[0];
      if (!containing) {
        offenders.push(`${relative(SRC, path)}:<module scope> uses ${use[0]}`);
        continue;
      }
      if (!GUARD.test(containing.body)) {
        offenders.push(`${relative(SRC, path)}:${containing.name} uses ${use[0]}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'page components reached the backend without authenticating the request: ' +
      offenders.join(', '),
  );
});
