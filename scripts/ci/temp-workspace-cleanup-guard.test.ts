/**
 * UTV2-1949 — mechanical guard for the temporary-workspace leak class.
 *
 * Core invariant 11: if a rule can be enforced mechanically, it must not live only
 * in prose. Repairing the leaking call sites does nothing to stop the next one, so
 * this guard fails the build when a test allocates a temporary directory that
 * nothing can release.
 *
 * **The question is asked per allocation, not per file.** An earlier draft of this
 * guard asked only whether a cleanup token appeared anywhere in the same file. That
 * was reviewed and rejected, correctly: `scripts/ops/execution-packet.test.ts`
 * allocates roots at lines 164 and 188 with no teardown, and unrelated `fs.rmSync`
 * calls 2,700 lines later made the whole file read as clean. The heuristic reported
 * green while `/tmp` kept growing. It also under-counted the population by more than
 * half — 10 files by the old token test, 14 files and 28 allocations by this one.
 *
 * Classification lives in `temp-workspace-allocations.ts` and is syntactic (TypeScript
 * AST, no type-checker), so it runs inside `pnpm test` without a build.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeFile, analyzeSource, collectTestFiles } from './temp-workspace-allocations.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Directories this guard governs. Deliberately bounded to the lane's scope. */
const SCANNED_ROOTS = ['scripts', 'apps'] as const;

/**
 * Unreleased allocations that exist on `main` and are outside UTV2-1949's pinned
 * `file_scope_lock`, which cannot be widened after lane-start.
 *
 * The value is the **exact count** of unreleased allocations in that file, so this is
 * a ratchet in both directions: adding a new leak to an already-listed file fails the
 * guard, and repairing one without updating the ledger also fails it. A file absent
 * from this map must have zero. The counts can only be lowered, never raised, without
 * a deliberate edit that a reviewer will see.
 *
 * Measured 2026-09-20 at 28 unreleased allocations across 14 files, out of 248 total
 * allocations in 370 scanned test files (189 released, 31 transferred to a caller).
 */
const KNOWN_REMAINDER: Readonly<Record<string, number>> = {
  'apps/command-center/src/app/api/governance/lanes/route.test.ts': 1,
  'scripts/audits/utv2-1397-evidence-flow-observation.test.ts': 4,
  'scripts/evidence-truthworthiness/run-scoring.test.ts': 1,
  'scripts/lane-contract.test.ts': 2,
  'scripts/model-registry/run-registry-report.test.ts': 1,
  'scripts/ops/execution-packet.test.ts': 7,
  'scripts/ops/fix-sync-yml.test.ts': 1,
  'scripts/ops/lane-close.test.ts': 2,
  'scripts/ops/readiness-refresh.test.ts': 1,
  'scripts/ops/t2-proof-bundle.test.ts': 2,
  'scripts/ops/verify-semaphore.test.ts': 1,
  'scripts/ops/workflow-hardening.test.ts': 3,
  'scripts/provenance/run-provenance-report.test.ts': 1,
  'scripts/source-ledger/run-source-ledger-report.test.ts': 1,
};

test('every temp-directory allocation in a governed test can be released', () => {
  const files: string[] = [];
  for (const root of SCANNED_ROOTS) {
    collectTestFiles(path.join(REPO_ROOT, root), files);
  }
  assert.ok(files.length > 0, 'the scan found no test files at all — the guard would be vacuous');

  const unreleasedByFile = new Map<string, { count: number; detail: string[] }>();
  let totalAllocations = 0;

  for (const file of files) {
    for (const allocation of analyzeFile(REPO_ROOT, file)) {
      totalAllocations += 1;
      if (allocation.verdict !== 'unreleased') continue;
      const entry = unreleasedByFile.get(allocation.file) ?? { count: 0, detail: [] };
      entry.count += 1;
      entry.detail.push(`${allocation.file}:${allocation.line} — ${allocation.reason}`);
      unreleasedByFile.set(allocation.file, entry);
    }
  }

  assert.ok(
    totalAllocations > 0,
    'no scanned test file allocates a temp directory — the guard is not looking at the right population',
  );

  // New or worsened leaks: anything above the number this file records for that path.
  const regressions: string[] = [];
  for (const [file, entry] of [...unreleasedByFile].sort()) {
    const allowed = KNOWN_REMAINDER[file] ?? 0;
    if (entry.count > allowed) {
      regressions.push(
        `${file}: ${entry.count} unreleased allocation(s), ledger allows ${allowed}\n    ` +
          entry.detail.join('\n    '),
      );
    }
  }

  assert.deepEqual(
    regressions,
    [],
    `temporary directories are allocated with no way to release them (UTV2-1949).\n` +
      `Bind the result and remove it in the same scope, or use createTempWorkspace() ` +
      `from scripts/ops/temp-workspace.ts:\n\n  ${regressions.join('\n\n  ')}`,
  );

  // Stale ledger entries: a path that has been repaired, or improved, below its
  // recorded count. The ledger must shrink with the debt or it stops meaning anything.
  const stale: string[] = [];
  for (const [file, allowed] of Object.entries(KNOWN_REMAINDER).sort()) {
    const actual = unreleasedByFile.get(file)?.count ?? 0;
    if (actual < allowed) {
      stale.push(`${file}: ledger says ${allowed}, actual ${actual}`);
    }
  }

  assert.deepEqual(
    stale,
    [],
    `KNOWN_REMAINDER is stale. These paths now leak less than the ledger records — ` +
      `lower the count (or delete the entry at zero) so a later regression cannot hide ` +
      `underneath it:\n  ${stale.join('\n  ')}`,
  );
});

/**
 * Classification tests. These pin the behaviour the file-wide token heuristic got
 * wrong, so it cannot be reintroduced: a cleanup somewhere else in the file must not
 * absolve an allocation that has none.
 */
const verdicts = (source: string): string[] =>
  analyzeSource('fixture.test.ts', source).map((a) => `${a.line}:${a.verdict}`);

test('REGRESSION: a cleanup elsewhere in the file does not absolve an untorn-down allocation', () => {
  // This is the shape of scripts/ops/execution-packet.test.ts, which the previous
  // file-wide heuristic passed: an allocation with no teardown, and a later,
  // unrelated allocation that does clean up after itself. The two share a variable
  // name on purpose — that is precisely the case a file-wide scan cannot tell apart,
  // and mutating the analyser back to a file-wide scope must fail this test.
  const source = [
    "test('leaks', () => {",
    "  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a-'));",
    '  use(root);',
    '});',
    "test('clean', () => {",
    "  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'b-'));",
    '  try { use(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }',
    '});',
  ].join('\n');

  assert.deepEqual(verdicts(source), ['2:unreleased', '6:released']);
});

test('an allocation released in its own scope is clean', () => {
  const source = [
    "test('x', (t) => {",
    "  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a-'));",
    '  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));',
    '});',
  ].join('\n');

  assert.deepEqual(verdicts(source), ['2:released']);
});

test('an allocation returned to a caller transfers ownership rather than leaking', () => {
  const source = [
    'function makeRepo() {',
    "  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a-'));",
    '  return { repoRoot };',
    '}',
  ].join('\n');

  assert.deepEqual(verdicts(source), ['2:escapes']);
});

test('an allocation assigned to an outer binding is released by a sibling hook', () => {
  const source = [
    'let tmpDir;',
    "before(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a-')); });",
    'after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });',
  ].join('\n');

  assert.deepEqual(verdicts(source), ['2:released']);
});

test('an allocation wrapped before binding is owned by the binding it flows into', () => {
  const source = [
    'function withTempFile(run) {',
    "  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'a-')), 'q.md');",
    '  try { run(filePath); } finally { fs.rmSync(path.dirname(filePath), { recursive: true, force: true }); }',
    '}',
  ].join('\n');

  assert.deepEqual(verdicts(source), ['2:released']);
});

test('an allocation passed inline into a consumer is unreleased', () => {
  const source = [
    "test('x', () => {",
    "  const result = generate(input(), { root: fs.mkdtempSync(path.join(os.tmpdir(), 'a-')) });",
    '  assert.ok(result);',
    '});',
  ].join('\n');

  assert.deepEqual(verdicts(source), ['2:unreleased']);
});

test('a directory from the governed helper is not a raw allocation at all', () => {
  assert.deepEqual(verdicts("const dir = createTempWorkspace('a-');"), []);
});
