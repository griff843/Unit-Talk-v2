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
import { readFileSync, readdirSync, statSync } from 'node:fs';
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

function governedFunctionNames(): Set<string> {
  const names = new Set<string>();
  const pattern = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?\s*\(/gi;
  for (const entry of readdirSync(MIGRATIONS_DIR)) {
    if (extname(entry) !== '.sql') continue;
    const contents = readFileSync(join(MIGRATIONS_DIR, entry), 'utf8');
    for (const match of contents.matchAll(pattern)) {
      names.add(match[1]!);
    }
  }
  return names;
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
