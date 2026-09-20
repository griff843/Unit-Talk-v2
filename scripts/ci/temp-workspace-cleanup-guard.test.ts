/**
 * UTV2-1949 — mechanical guard for the temporary-workspace leak class.
 *
 * Core invariant 11: if a rule can be enforced mechanically, it must not live only
 * in prose. Repairing the 45 leaking call sites does nothing to stop the 46th, so
 * this guard fails the build when a test file creates a temporary directory with no
 * way to release it.
 *
 * A file satisfies the guard by either using `createTempWorkspace` from
 * `scripts/ops/temp-workspace.ts`, or performing its own removal (`rmSync`, `rm(`,
 * or an `after`/`afterEach` hook). It does not prescribe which.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Directories this guard governs. Deliberately bounded to the lane's scope. */
const SCANNED_ROOTS = ['scripts', 'apps'] as const;

const CREATES_TEMP_DIR = /\bmkdtemp(Sync)?\s*\(/;
const HAS_GOVERNED_HELPER = /createTempWorkspace/;
const HAS_OWN_CLEANUP = /\brmSync\s*\(|\bfs\.rm\s*\(|\brm\s*\(\s*[A-Za-z_]|\bafterEach\s*\(|\bafter\s*\(/;

/**
 * Leaks that exist on `main` and are outside UTV2-1949's pinned `file_scope_lock`,
 * which cannot be widened after lane-start. They are recorded here rather than
 * silently excluded, and this list is a **ratchet**: a file not on it that leaks
 * fails the guard, and a file on it that has been repaired also fails the guard, so
 * the list can only shrink and can never quietly go stale.
 *
 * Measured 2026-09-20. Together these account for roughly 15% of the observed /tmp
 * residue; the bulk of it is repaired by this lane.
 */
const KNOWN_REMAINDER: readonly string[] = [
  'apps/command-center/src/app/api/governance/lanes/route.test.ts',
  'scripts/audits/utv2-1397-evidence-flow-observation.test.ts',
  'scripts/evidence-truthworthiness/run-scoring.test.ts',
  'scripts/lane-contract.test.ts',
  'scripts/model-registry/run-registry-report.test.ts',
  'scripts/ops/fix-sync-yml.test.ts',
  'scripts/ops/readiness-refresh.test.ts',
  'scripts/ops/workflow-hardening.test.ts',
  'scripts/provenance/run-provenance-report.test.ts',
  'scripts/source-ledger/run-source-ledger-report.test.ts',
];

function collectTestFiles(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist') continue;
      collectTestFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
}

test('every governed test file that creates a temp directory can also release it', () => {
  const files: string[] = [];
  for (const root of SCANNED_ROOTS) {
    collectTestFiles(path.join(REPO_ROOT, root), files);
  }
  assert.ok(files.length > 0, 'the scan found no test files at all — the guard would be vacuous');

  const leaking = new Set<string>();
  let governed = 0;

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
    if (!CREATES_TEMP_DIR.test(source)) continue;
    governed += 1;
    if (HAS_GOVERNED_HELPER.test(source) || HAS_OWN_CLEANUP.test(source)) continue;
    leaking.add(rel);
  }

  // Membership in KNOWN_REMAINDER is evaluated against the whole scanned population,
  // not only against files that still create temp directories. A file that has been
  // fully repaired no longer matches CREATES_TEMP_DIR at all, so checking the ratchet
  // inside that loop would never fire for the exact case it exists to catch.
  const offenders = [...leaking].filter((rel) => !KNOWN_REMAINDER.includes(rel)).sort();
  const repairedRemainder = KNOWN_REMAINDER.filter((rel) => !leaking.has(rel)).sort();

  assert.ok(
    governed > 0,
    'no scanned test file creates a temp directory — the guard is not looking at the right population',
  );

  assert.deepEqual(
    offenders,
    [],
    `test files create temporary directories with no cleanup path (UTV2-1949). ` +
      `Use createTempWorkspace() from scripts/ops/temp-workspace.ts, or remove the ` +
      `directory yourself:\n  ${offenders.join('\n  ')}`,
  );

  assert.deepEqual(
    repairedRemainder,
    [],
    `these files are listed in KNOWN_REMAINDER but no longer leak. Remove them from ` +
      `the list — it is a shrink-only ratchet and a stale entry hides a real ` +
      `regression:\n  ${repairedRemainder.join('\n  ')}`,
  );
});
