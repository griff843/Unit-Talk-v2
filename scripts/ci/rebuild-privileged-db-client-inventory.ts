/**
 * Regenerate `privileged-db-client-inventory.json` from measurement.
 *
 * The inventory is a reviewed, checked-in artifact, but every field in it is
 * derived rather than typed. This script is how — so a reviewer can re-run it
 * and get the same file instead of taking the numbers on trust.
 *
 * Inputs, all measured:
 *  - which files constructed a client directly at the pre-fix SHA (`git show`
 *    at that SHA, then the same AST pass the guard uses)
 *  - which of those could reach a service-role credential (AST)
 *  - which are referenced by any import, npm script, workflow or doc
 *  - which still construct directly at HEAD (AST)
 *
 * Two judgements are NOT derived, and are listed here explicitly so they are
 * reviewable rather than buried: `READ_ONLY_DIRECT` (call sites left direct on
 * purpose) and `CROSS_LANE_OWNED` (files another open lane owns). Both are
 * re-checked by the guard on every run — see the disposition rules there.
 *
 *   pnpm ci:db-client-inventory            # regenerate from a55de402
 *   pnpm ci:db-client-inventory <base-sha> # regenerate from another base
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  REPO_ROOT,
  BOUNDARY_MODULE,
  findConstructorSites,
  scanTree,
  referencesPrivilegedCredential,
  listSourceFiles,
  type Inventory,
  type InventoryEntry,
} from './privileged-db-client-guard.js';

const BASE_REF = process.argv[2] ?? 'a55de402';
const BASE_SHA = execFileSync('git', ['rev-parse', BASE_REF], { encoding: 'utf8' }).trim();

function showAtBase(file: string): string | null {
  try {
    return execFileSync('git', ['show', `${BASE_SHA}:${file}`], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

// Files that constructed directly at the pre-fix SHA.
const baseFiles = execFileSync(
  'git',
  ['ls-tree', '-r', '--name-only', BASE_SHA, 'scripts', 'apps', 'packages'],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
)
  .split('\n')
  .filter((f) => /\.(m?[jt]sx?|cjs|cts|mts)$/u.test(f) && !f.endsWith('.d.ts'))
  .filter((f) => !f.includes('/dist/') && !f.includes('/.next/') && !f.includes('node_modules'));

const before = new Map<string, number>();
const privilegedBefore = new Set<string>();
for (const file of baseFiles) {
  const text = showAtBase(file);
  if (!text) continue;
  if (!/@supabase\/supabase-js|from ['"]pg['"]|from ['"]postgres['"]/u.test(text)) continue;
  const sites = findConstructorSites(file, text);
  if (sites.length === 0) continue;
  before.set(file, sites.length);
  if (referencesPrivilegedCredential(file, text)) privilegedBefore.add(file);
}

const afterFiles = new Set(scanTree().map((s) => s.file));

// --- reference analysis -----------------------------------------------------
const packageJson = readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8');
const workflows = execFileSync('bash', [
  '-c',
  'cat .github/workflows/*.yml 2>/dev/null || true',
], { encoding: 'utf8', cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 });
const docsAndOps = execFileSync('bash', [
  '-c',
  "grep -rho 'scripts/[A-Za-z0-9_./-]*' docs .claude package.json .github 2>/dev/null | sort -u || true",
], { encoding: 'utf8', cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 });

const allSources = listSourceFiles();
const importedBy = new Map<string, number>();
for (const file of allSources) {
  const text = readFileSync(path.join(REPO_ROOT, file), 'utf8');
  for (const target of before.keys()) {
    const stem = path.basename(target).replace(/\.[^.]+$/u, '');
    if (file === target) continue;
    if (new RegExp(`from ['"][^'"]*${stem}(\\.js)?['"]`, 'u').test(text)) {
      importedBy.set(target, (importedBy.get(target) ?? 0) + 1);
    }
  }
}

function isReferenced(file: string): boolean {
  if ((importedBy.get(file) ?? 0) > 0) return true;
  if (packageJson.includes(file)) return true;
  if (workflows.includes(file)) return true;
  if (docsAndOps.includes(file)) return true;
  return false;
}

// --- classify ---------------------------------------------------------------
// Owned by an open concurrent lane; recorded rather than edited.
const CROSS_LANE_OWNED = new Map<string, string>([
  ['scripts/shadow-scoring-runner.ts', 'UTV2-1629'],
]);

const READ_ONLY_DIRECT = new Set([
  'apps/command-center/src/components/ApiHealthMonitoring.tsx',
  'apps/command-center/src/components/PipelineLiveRefresh.tsx',
]);

const entries: InventoryEntry[] = [];
const files = new Set<string>([...before.keys(), ...afterFiles]);

for (const file of [...files].sort()) {
  const sitesBefore = before.get(file) ?? 0;
  const stillDirect = afterFiles.has(file);
  const referenced = isReferenced(file);

  if (file === BOUNDARY_MODULE) {
    entries.push({
      file,
      classification: 'behind-the-boundary',
      disposition: 'is-boundary',
      privileged: true,
      reason:
        'The boundary. The only module permitted to call a driver constructor; it ' +
        'resolves target identity and refuses a non-staging target from a restricted context.',
      referenced: true,
    });
    continue;
  }

  if (READ_ONLY_DIRECT.has(file)) {
    entries.push({
      file,
      classification: 'read-only',
      disposition: 'unprivileged-direct',
      reason:
        'Browser client component. Constructs an anon-key client for a realtime ' +
        'subscription and holds no service-role credential; importing @unit-talk/db ' +
        'here would pull the server data layer into the browser bundle. The guard ' +
        're-checks the no-privileged-credential premise every run.',
      sites_before: sitesBefore,
      referenced,
      privileged: false,
    });
    continue;
  }

  const owner = CROSS_LANE_OWNED.get(file);
  if (owner && stillDirect) {
    entries.push({
      file,
      classification: 'writable-privileged',
      disposition: 'deferred-cross-lane',
      reason:
        `Constructs a service-role client directly. ${owner} owns this file and has ` +
        'already changed it on its branch, so migrating it here would collide. Not ' +
        'reachable from any `pnpm test` entrypoint, which is why the deferral is ' +
        'survivable: rule 3 fails the build the moment that stops being true.',
      sites_before: sitesBefore,
      referenced,
      privileged: true,
      owner_issue: owner,
    });
    continue;
  }

  if (stillDirect) {
    entries.push({
      file,
      classification: 'writable-privileged',
      disposition: 'asserted-in-place',
      reason:
        'Uses the `postgres` driver against SUPABASE_DB_URL, so it cannot use the ' +
        'Supabase client constructor. Passes its connection string through the ' +
        "boundary's assertion instead of duplicating the rule.",
      sites_before: sitesBefore,
      referenced,
      privileged: true,
    });
    continue;
  }

  entries.push({
    file,
    classification: privilegedBefore.has(file)
      ? referenced
        ? 'writable-privileged'
        : 'dead'
      : 'read-only',
    disposition: 'migrated',
    reason: privilegedBefore.has(file)
      ? referenced
        ? 'Constructed a service-role client from environment variables. Now obtains it from the boundary.'
        : 'Constructed a service-role client from environment variables; nothing references this file. Migrated anyway — "unreferenced today" is not a durable property.'
      : 'Constructed a client without a service-role credential. Migrated for uniformity.',
    sites_before: sitesBefore,
    referenced,
    privileged: privilegedBefore.has(file),
  });
}

const inventory = {
  schema: 'privileged-db-client-inventory/v1',
  boundary_module: BOUNDARY_MODULE,
  generated_from_sha: BASE_SHA,
  method: {
    sites:
      'TypeScript AST. A construction site is a call or `new` whose callee resolves to ' +
      'a binding imported from @supabase/supabase-js, pg or postgres. Mentions in ' +
      'comments, string literals and regexes are not sites; aliased imports are.',
    classification:
      'writable-privileged = the file referenced a service-role credential ' +
      '(SUPABASE_SERVICE_ROLE_KEY / CI_ / V1_ / serviceRoleKey / service_role / ' +
      'SUPABASE_DB_URL / DATABASE_URL) at generated_from_sha, matched as an identifier, ' +
      'property or string literal via the AST. read-only = it did not. ' +
      'behind-the-boundary = it is the boundary. dead = writable-privileged AND ' +
      'unreferenced.',
    privileged:
      'true when the file could reach a service-role credential at generated_from_sha. ' +
      'Recorded separately from classification because `dead` would otherwise hide it: ' +
      'every `dead` entry here is also privileged, and was migrated for that reason.',
    referenced:
      'true when the file is imported by any source file under scripts/apps/packages, ' +
      'or named in package.json, .github/workflows/*.yml, docs/ or .claude/. ' +
      'Informational: every unreferenced file was migrated regardless.',
    enforcement:
      'The disposition, not the classification, is what scripts/ci/privileged-db-client-guard.ts ' +
      're-checks on every run. See that file for the obligation each disposition carries.',
  },
  entries,
} as Inventory & { method: Record<string, string> };

const out = path.join(REPO_ROOT, 'scripts/ci/privileged-db-client-inventory.json');
writeFileSync(out, `${JSON.stringify(inventory, null, 2)}\n`);

const counts = new Map<string, number>();
for (const e of entries) {
  const k = `${e.classification} / ${e.disposition}`;
  counts.set(k, (counts.get(k) ?? 0) + 1);
}
console.log(`entries: ${entries.length}`);
for (const [k, v] of [...counts].sort()) console.log(`  ${k}: ${v}`);
console.log(`sites before: ${[...before.values()].reduce((a, b) => a + b, 0)}`);
console.log(`files before: ${before.size}`);
console.log(`existsSync(out)=${existsSync(out)}`);
