/**
 * UTV2-1811 — every runtime `client.rpc()` dependency must exist in the governed schema.
 *
 * ## Why this exists
 *
 * `consume_rate_limit_bucket` was specified in a code comment on
 * SupabaseRpcApiRateLimitStore and then called for real, but it was never written into a
 * migration. Nothing noticed. Type-check could not: `rpc()` takes the function name as a
 * string. The unit suite could not: it supplies a fake client that implements the RPC
 * in-process, so the call site was exercised against a function that only ever existed
 * inside the test. Every gate was green while production returned 500 on every
 * authenticated submission, because the store fails closed on a missing function.
 *
 * The gap is structural, not specific to that one name: an `.rpc('x')` call site and the
 * migration defining `x` are two files that no tool relates to each other. This test
 * relates them. It reads the repository, not a database, so it runs in the ordinary
 * suite with no credentials and cannot be satisfied by a fixture.
 *
 * ## What it does not claim
 *
 * A `CREATE FUNCTION` in a migration is proof the name is *governed*, not proof that any
 * particular database currently has it — a migration can be unapplied, and the argument
 * list is not compared. Runtime existence and the exact signature are proven separately,
 * against a real PostgreSQL, in this lane's proof bundle. This test's job is narrower and
 * is the half that was missing: no call site may reference a function the repository
 * never defines.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Runtime source roots. Scripts and workflow tooling are out of scope: they are not the request path. */
const RUNTIME_ROOTS = ['apps', 'packages'];

const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase', 'migrations');

/**
 * Matches `.rpc('name'` with either quote style. Deliberately does not match a variable
 * (`client.rpc(fnName)`): this test can only speak about names present in the source, and
 * silently ignoring a dynamic name would be less honest than not claiming coverage of it.
 * A dynamic RPC name would show up as a gap in the "found at least the known set" assertion
 * below if it ever replaced one of these call sites.
 */
const RPC_CALL_PATTERN = /\.rpc\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g;

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

/** Directories that never carry request-path source. */
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'build', '.next', '.turbo', 'coverage', '.out']);

function walk(directory: string, out: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (SOURCE_EXTENSIONS.has(extname(entry))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Pre-existing gaps of exactly this class, found by this test's first run and tracked as
 * UTV2-1814. They are carried here rather than fixed because they belong to the parked
 * ingestor and worker, not to the submission path, and UTV2-1811 is bounded to the
 * rate-limit contract.
 *
 * This is an allowlist that cannot rot. The second test below asserts each entry is STILL
 * genuinely missing, so an entry left behind after its migration lands fails the suite and
 * forces its own deletion. An allowlist that only ever suppressed would quietly become the
 * place where this defect class goes to hide.
 */
const KNOWN_UNGOVERNED_RPCS = new Map<string, string>([
  [
    'list_provider_offer_history_partition_dates',
    'UTV2-1814: call site merged ahead of its migration, and UTV2-1736 defines ..._days not ..._dates',
  ],
  [
    'insert_certification_propagation_batch',
    'UTV2-1814: defined in no migration including the baseline replay root, and in neither live database',
  ],
]);

interface RpcCallSite {
  readonly fn: string;
  readonly file: string;
}

/**
 * Test files are excluded. A test may legitimately name an RPC that a fake client
 * implements — that is exactly the fixture this test exists to see past — so counting
 * test call sites would make the check assert its own blind spot.
 */
function isTestFile(path: string): boolean {
  return /\.test\.[cm]?tsx?$/.test(path);
}

function collectRpcCallSites(): RpcCallSite[] {
  const sites: RpcCallSite[] = [];
  for (const root of RUNTIME_ROOTS) {
    for (const file of walk(join(REPO_ROOT, root))) {
      if (isTestFile(file)) continue;
      const contents = readFileSync(file, 'utf8');
      for (const match of contents.matchAll(RPC_CALL_PATTERN)) {
        sites.push({ fn: match[1]!, file: relative(REPO_ROOT, file) });
      }
    }
  }
  return sites;
}

/**
 * Removes SQL comments so a commented-out definition cannot satisfy the parity check.
 *
 * This was a real defect in the first version of this test: the scan matched raw file text,
 * so a migration containing only
 *
 *   -- CREATE FUNCTION public.consume_rate_limit_bucket(...)
 *
 * would have registered the name as governed. That is the precise failure mode this whole
 * test exists to catch — a function that is described somewhere but never actually created —
 * so the check could have been satisfied by the very thing it is meant to detect.
 *
 * A regex cannot do this correctly, because `--` and the block-comment delimiters are
 * ordinary characters inside string literals and dollar-quoted bodies. So this walks the
 * text once, tracking which construct it is inside:
 *
 *   - single-quoted literals, where '' is an escaped quote rather than a terminator;
 *   - dollar-quoted bodies ($$ ... $$ or $tag$ ... $tag$), which is how every function body
 *     in this repository is written, and inside which -- is not a comment at all;
 *   - double-quoted identifiers, where "" is likewise an escaped quote;
 *   - line comments, ended by a newline;
 *   - block comments, which nest in PostgreSQL.
 *
 * Comment characters are replaced with spaces rather than removed, so offsets are preserved
 * and a stripped file stays line-for-line comparable with its source.
 *
 * Literal contents are deliberately KEPT. A `CREATE FUNCTION` inside a dollar-quoted body is
 * usually real, executable dynamic DDL (`EXECUTE format('CREATE FUNCTION ...')`), and this
 * check errs toward treating a name as governed rather than raising a false alarm on a call
 * site that is in fact backed. The narrower, correct reading — that only top-level DDL counts —
 * would need a real parser, which is out of proportion here. Comment stripping is the part
 * that closes the demonstrated hole.
 */
export function stripSqlComments(sql: string): string {
  const out = sql.split('');
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k += 1) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };

  let i = 0;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);

    if (two === '--') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }

    if (two === '/*') {
      // PostgreSQL block comments nest, so count depth rather than scanning for the first */.
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql.startsWith('/*', j)) {
          depth += 1;
          j += 2;
        } else if (sql.startsWith('*/', j)) {
          depth -= 1;
          j += 2;
        } else {
          j += 1;
        }
      }
      blank(i, j);
      i = j;
      continue;
    }

    if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i]!;
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === quote) {
          if (sql[j + 1] === quote) {
            j += 2; // doubled quote is an escape, not a terminator
            continue;
          }
          j += 1;
          break;
        }
        j += 1;
      }
      i = j;
      continue;
    }

    const dollar = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
    if (dollar) {
      const tag = dollar[0];
      const close = sql.indexOf(tag, i + tag.length);
      i = close === -1 ? sql.length : close + tag.length;
      continue;
    }

    i += 1;
  }

  return out.join('');
}

const CREATE_FUNCTION_PATTERN =
  /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?\s*\(/gi;

export function governedFunctionNamesIn(migrationsDir: string): Set<string> {
  const names = new Set<string>();
  for (const entry of readdirSync(migrationsDir)) {
    if (extname(entry) !== '.sql') continue;
    const executable = stripSqlComments(readFileSync(join(migrationsDir, entry), 'utf8'));
    for (const match of executable.matchAll(CREATE_FUNCTION_PATTERN)) {
      names.add(match[1]!);
    }
  }
  return names;
}

function governedFunctionNames(): Set<string> {
  return governedFunctionNamesIn(MIGRATIONS_DIR);
}

test('every runtime client.rpc() dependency is defined by a governed migration', () => {
  const sites = collectRpcCallSites();
  const governed = governedFunctionNames();

  const undefinedSites = sites.filter(
    (site) => !governed.has(site.fn) && !KNOWN_UNGOVERNED_RPCS.has(site.fn),
  );

  assert.deepEqual(
    undefinedSites.map((site) => `${site.fn} (called from ${site.file})`),
    [],
    'These RPCs are called at runtime but no migration under supabase/migrations/ defines them. ' +
      'A fail-closed store turns a missing function into a total outage on that path, so the ' +
      'call site must not ship ahead of the migration.',
  );
});

test('the parity scan actually finds call sites and function definitions', () => {
  // Without this, any regression that breaks the scan (a renamed directory, a changed call
  // style, an empty migrations read) would degrade into a green run over an empty set —
  // the same silent no-op class the check exists to prevent.
  const sites = collectRpcCallSites();
  const governed = governedFunctionNames();

  assert.ok(sites.length > 0, 'scan found no .rpc() call sites at all; the scan is broken, not the code');
  assert.ok(governed.size > 0, 'scan found no CREATE FUNCTION in supabase/migrations; the scan is broken');

  // The store's own dependency must be among what was scanned. This is the specific name
  // whose absence caused the production submission outage; if a future refactor stops the
  // scan from seeing it, that must fail loudly rather than reduce coverage in silence.
  assert.ok(
    sites.some((site) => site.fn === 'consume_rate_limit_bucket'),
    'consume_rate_limit_bucket is no longer visible to the scan; the rate limiter call site moved or changed shape',
  );
});

test('the known-gap allowlist is still describing real gaps', () => {
  // Deletes itself when the debt is paid: once a migration defines one of these, the entry
  // is no longer describing a gap and must go. Without this, the allowlist would silently
  // start suppressing a name that is fine, and the next regression under that name would
  // pass unnoticed.
  const governed = governedFunctionNames();
  const stale = [...KNOWN_UNGOVERNED_RPCS.keys()].filter((fn) => governed.has(fn));

  assert.deepEqual(
    stale,
    [],
    'A migration now defines these, so their allowlist entries in KNOWN_UNGOVERNED_RPCS are stale ' +
      'and must be deleted (see UTV2-1814).',
  );

  // An allowlist entry for a name nothing calls is equally dead weight, and would hide the
  // fact that the call site it was written for has since been removed.
  const sites = new Set(collectRpcCallSites().map((site) => site.fn));
  const unreferenced = [...KNOWN_UNGOVERNED_RPCS.keys()].filter((fn) => !sites.has(fn));

  assert.deepEqual(
    unreferenced,
    [],
    'No runtime code calls these any more, so their allowlist entries must be deleted (see UTV2-1814).',
  );
});


// ─────────────────────────────────────────────────────────────────────────────
// The scan's own correctness. A commented-out definition satisfying the parity check was a
// real defect in this file's first version: the check could have been satisfied by exactly
// the condition it exists to detect. These tests are the control for that, and they are
// written against fixtures rather than the repository so they assert the rule itself and
// not today's migration set.
// ─────────────────────────────────────────────────────────────────────────────

const EXECUTABLE_DEFINITION = `
CREATE TABLE public.rate_limit_buckets (key text PRIMARY KEY);

CREATE FUNCTION public.consume_rate_limit_bucket(
  p_key text, p_window_start timestamptz, p_window_expires_at timestamptz, p_limit integer)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN false;
END;
$$;
`;

function withMigrationsFixture<T>(files: Record<string, string>, run: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'utv2-1811-parity-'));
  try {
    for (const [name, contents] of Object.entries(files)) {
      writeFileSync(join(dir, name), contents, 'utf8');
    }
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a commented-out CREATE FUNCTION does not make a function governed', () => {
  // Line comment — the exact shape the PM named.
  const lineCommented = withMigrationsFixture(
    { '20260101000000_line.sql': '-- CREATE FUNCTION public.consume_rate_limit_bucket(p_key text)\n' },
    governedFunctionNamesIn,
  );
  assert.equal(
    lineCommented.has('consume_rate_limit_bucket'),
    false,
    'a line-commented definition was treated as governed; the parity check can be satisfied by the defect it detects',
  );

  // Block comment, including the nested case PostgreSQL actually supports.
  const blockCommented = withMigrationsFixture(
    {
      '20260101000000_block.sql': '/* CREATE FUNCTION public.consume_rate_limit_bucket(p_key text); */\n',
      '20260101000001_nested.sql':
        '/* outer /* inner */ CREATE FUNCTION public.nested_only_in_comment(p_key text); */\n',
    },
    governedFunctionNamesIn,
  );
  assert.equal(blockCommented.has('consume_rate_limit_bucket'), false, 'block-commented definition counted');
  assert.equal(blockCommented.has('nested_only_in_comment'), false, 'nested block comment terminated early');

  // A definition that is merely *described* in a comment above the real thing must not
  // rescue a migration whose executable half defines something else.
  const describedButNotCreated = withMigrationsFixture(
    {
      '20260101000000_described.sql':
        '-- This migration will eventually add:\n' +
        '--   CREATE FUNCTION public.not_yet_written(p_key text)\n' +
        'CREATE FUNCTION public.actually_written(p_key text) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;\n',
    },
    governedFunctionNamesIn,
  );
  assert.equal(describedButNotCreated.has('not_yet_written'), false, 'commented plan counted as governed');
  assert.equal(describedButNotCreated.has('actually_written'), true, 'real definition alongside a comment was lost');
});

test('a real executable CREATE FUNCTION is still governed', () => {
  const governed = withMigrationsFixture(
    { '20260101000000_real.sql': EXECUTABLE_DEFINITION },
    governedFunctionNamesIn,
  );
  assert.equal(
    governed.has('consume_rate_limit_bucket'),
    true,
    'the executable definition was not recognised; comment stripping is over-eager',
  );
});

test('commenting out the real definition flips the same fixture from governed to missing', () => {
  // The mutation, run as a test rather than described in prose: one fixture, one edit, and
  // the result must invert. A stripper that silently did nothing would pass the "real
  // definition is governed" test above and fail here.
  const real = withMigrationsFixture(
    { '20260101000000_real.sql': EXECUTABLE_DEFINITION },
    governedFunctionNamesIn,
  );
  const commented = withMigrationsFixture(
    {
      '20260101000000_real.sql': EXECUTABLE_DEFINITION.split('\n')
        .map((line) => `-- ${line}`)
        .join('\n'),
    },
    governedFunctionNamesIn,
  );

  assert.equal(real.has('consume_rate_limit_bucket'), true);
  assert.equal(
    commented.has('consume_rate_limit_bucket'),
    false,
    'commenting out the definition left it governed; the parity check does not distinguish code from comment',
  );
});

test('comment characters inside literals and function bodies are not treated as comments', () => {
  // The reason this needs a walker rather than a regex. Each of these would break a naive
  // strip: the body is dollar-quoted and contains --, and the literal contains /*.
  const governed = withMigrationsFixture(
    {
      '20260101000000_literals.sql': `
CREATE FUNCTION public.body_contains_dashes(p_key text)
RETURNS text
LANGUAGE plpgsql
AS $body$
BEGIN
  -- this is a comment inside a dollar-quoted body, and the $body$ tag must survive it
  RETURN 'a string with -- and /* inside it';
END;
$body$;

CREATE FUNCTION public.after_the_body(p_key text) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
`,
    },
    governedFunctionNamesIn,
  );

  assert.equal(governed.has('body_contains_dashes'), true, 'the first definition was lost');
  assert.equal(
    governed.has('after_the_body'),
    true,
    'a definition after a dollar-quoted body was lost, so the scan mis-tracked where the body ended',
  );
});

test('the repository migration set defines consume_rate_limit_bucket in executable SQL', () => {
  // Ties the fixture-level rule back to the actual deliverable: after comment stripping, the
  // real migration must still define the function this lane exists to add.
  assert.equal(
    governedFunctionNames().has('consume_rate_limit_bucket'),
    true,
    'consume_rate_limit_bucket is not defined in executable SQL under supabase/migrations/',
  );
});
