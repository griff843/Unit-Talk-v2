/**
 * UTV2-1624 — fixtures for executable wiring coverage.
 *
 * Every assertion here is about the *logic* of the reachability graph, never
 * about the live repository's current counts. Counts are re-derived by the tool;
 * these fixtures prove the derivation is correct.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const requireFromTest = createRequire(import.meta.url);
const {
  buildWiringReport,
  splitCommandSegments,
  tokenize,
  expandGlob,
  expandTestArgument,
  isExecutableTestFile,
  summarizeWiringReport,
} = requireFromTest('./executable-wiring.ts') as typeof import('./executable-wiring.js');

const TEST_BODY = "import test from 'node:test';\ntest('t', () => {});\n";
const HELPER_BODY = 'export const fixturePick = { id: "abc" };\n';

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'utv2-wiring-'));
}

function write(root: string, relativePath: string, content: string): string {
  const fullPath = join(root, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
  return fullPath;
}

interface FixtureOptions {
  rootScripts?: Record<string, string>;
  packages?: Record<string, { name: string; scripts: Record<string, string> }>;
  files?: Record<string, string>;
  workflows?: Record<string, string>;
  baseline?: unknown;
}

/** Build a miniature workspace with its own package graph. */
function fixture(options: FixtureOptions = {}): string {
  const root = tempRoot();
  write(
    root,
    'package.json',
    JSON.stringify({ name: 'fixture-root', scripts: options.rootScripts ?? {} }, null, 2),
  );
  write(root, 'pnpm-workspace.yaml', 'packages:\n  - apps/*\n  - packages/*\n');

  for (const [dir, manifest] of Object.entries(options.packages ?? {})) {
    write(root, `${dir}/package.json`, JSON.stringify(manifest, null, 2));
  }
  for (const [file, content] of Object.entries(options.files ?? {})) {
    write(root, file, content);
  }
  for (const [file, content] of Object.entries(options.workflows ?? {})) {
    write(root, `.github/workflows/${file}`, content);
  }
  if (options.baseline !== undefined) {
    write(root, 'docs/05_operations/executable-wiring-baseline.json', JSON.stringify(options.baseline, null, 2));
  }
  return root;
}

function statusOf(report: ReturnType<typeof buildWiringReport>, path: string): string | undefined {
  return report.tests.find(entry => entry.path === path)?.status;
}

function capabilityStatusOf(report: ReturnType<typeof buildWiringReport>, path: string): string | undefined {
  return report.capabilities.find(entry => entry.path === path)?.status;
}

/* -------------------------------------------------------------------------- */
/* Command parsing primitives                                                 */
/* -------------------------------------------------------------------------- */

test('splitCommandSegments splits on every shell operator without breaking quotes', () => {
  assert.deepEqual(splitCommandSegments('pnpm a && pnpm b'), ['pnpm a', 'pnpm b']);
  assert.deepEqual(splitCommandSegments('pnpm a; pnpm b | grep x'), ['pnpm a', 'pnpm b', 'grep x']);
  assert.deepEqual(splitCommandSegments('pnpm a || pnpm b'), ['pnpm a', 'pnpm b']);
  assert.deepEqual(splitCommandSegments('echo "a && b" && pnpm c'), ['echo "a && b"', 'pnpm c']);
  assert.deepEqual(splitCommandSegments('pnpm a\npnpm b'), ['pnpm a', 'pnpm b']);
});

test('tokenize keeps quoted arguments as single tokens', () => {
  assert.deepEqual(tokenize('tsx --test --test-name-pattern "a b" x.test.ts'), [
    'tsx',
    '--test',
    '--test-name-pattern',
    'a b',
    'x.test.ts',
  ]);
});

/* -------------------------------------------------------------------------- */
/* Glob expansion                                                             */
/* -------------------------------------------------------------------------- */

test('expandGlob expands a single-star glob to the files that exist', () => {
  const root = fixture({
    files: {
      'src/a.test.ts': TEST_BODY,
      'src/b.test.ts': TEST_BODY,
      'src/nested/c.test.ts': TEST_BODY,
      'src/notatest.ts': HELPER_BODY,
    },
  });

  assert.deepEqual(expandGlob('src/*.test.ts', root), ['src/a.test.ts', 'src/b.test.ts']);
  assert.deepEqual(expandGlob('src/**/*.test.ts', root, { globstar: true }), [
    'src/a.test.ts',
    'src/b.test.ts',
    'src/nested/c.test.ts',
  ]);
});

test('expandTestArgument models POSIX sh, which collapses ** to one path segment', () => {
  const root = fixture({
    files: {
      'src/one/a.test.ts': TEST_BODY,
      'src/one/two/b.test.ts': TEST_BODY,
    },
  });

  const expanded = expandTestArgument('src/**/*.test.ts', root);
  assert.deepEqual(expanded.files, ['src/one/a.test.ts']);
  assert.deepEqual(expanded.shadowed, ['src/one/two/b.test.ts']);
});

test('expandTestArgument falls back to recursive globbing when the shell matches nothing', () => {
  const root = fixture({ files: { 'src/one/two/b.test.ts': TEST_BODY } });

  const expanded = expandTestArgument('src/**/*.test.ts', root);
  assert.deepEqual(expanded.files, ['src/one/two/b.test.ts']);
  assert.deepEqual(expanded.shadowed, []);
});

/* -------------------------------------------------------------------------- */
/* Reachability                                                               */
/* -------------------------------------------------------------------------- */

test('counts are derived from the graph, not hardcoded, and an unreachable test file is detected', () => {
  const root = fixture({
    rootScripts: {
      verify: 'pnpm test',
      test: 'tsx --test src/wired.test.ts',
    },
    files: {
      'src/wired.test.ts': TEST_BODY,
      'src/orphan.test.ts': TEST_BODY,
    },
  });

  const report = buildWiringReport({ root, baselinePath: null });

  assert.equal(report.totals.test_files, 2);
  assert.equal(report.totals.required_reachable, 1);
  assert.equal(report.totals.unwired, 1);
  assert.equal(report.totals.unwired_new, 1);
  assert.equal(statusOf(report, 'src/wired.test.ts'), 'required-reachable');
  assert.equal(statusOf(report, 'src/orphan.test.ts'), 'unwired');
  assert.equal(report.verdict, 'FAIL');
  assert.ok(report.findings.some(f => f.code === 'WIRING_TEST_UNWIRED_NEW' && f.subject === 'src/orphan.test.ts'));
});

test('a chained root-to-workspace script resolves and emits the exact execution path', () => {
  const root = fixture({
    rootScripts: {
      verify: 'pnpm verify:static',
      'verify:static': 'pnpm lint && pnpm test',
      lint: 'eslint .',
      test: 'pnpm test:apps',
      'test:apps': 'pnpm --filter @fixture/api test',
    },
    packages: {
      'apps/api': { name: '@fixture/api', scripts: { test: 'tsx --test src/deep.test.ts' } },
    },
    files: { 'apps/api/src/deep.test.ts': TEST_BODY },
  });

  const report = buildWiringReport({ root, baselinePath: null });
  const entry = report.tests.find(item => item.path === 'apps/api/src/deep.test.ts');

  assert.equal(entry?.status, 'required-reachable');
  assert.equal(entry?.command, 'pnpm verify');
  assert.equal(
    entry?.reached_by,
    'pnpm verify -> verify:static -> test -> test:apps -> @fixture/api:test -> tsx --test',
  );
});

test('reachability is never inferred from filename similarity', () => {
  const root = fixture({
    rootScripts: {
      verify: 'pnpm test',
      test: 'tsx --test src/merge-risk.test.ts',
    },
    files: {
      'src/merge-risk.test.ts': TEST_BODY,
      // Same stem, different directory: must NOT inherit reachability.
      'other/merge-risk.test.ts': TEST_BODY,
    },
  });

  const report = buildWiringReport({ root, baselinePath: null });

  assert.equal(statusOf(report, 'src/merge-risk.test.ts'), 'required-reachable');
  assert.equal(statusOf(report, 'other/merge-risk.test.ts'), 'unwired');
});

test('a test reachable only from a non-required command is optional-reachable with its named command', () => {
  const root = fixture({
    rootScripts: { verify: 'pnpm lint', lint: 'eslint .' },
    packages: {
      'packages/invariants': {
        name: '@fixture/invariants',
        scripts: { test: 'tsx --test src/proof.test.ts' },
      },
    },
    files: { 'packages/invariants/src/proof.test.ts': TEST_BODY },
  });

  const report = buildWiringReport({ root, baselinePath: null });
  const entry = report.tests.find(item => item.path === 'packages/invariants/src/proof.test.ts');

  assert.equal(entry?.status, 'optional-reachable');
  assert.equal(entry?.command, 'pnpm --filter @fixture/invariants test');
  assert.equal(report.totals.required_reachable, 0);
  assert.equal(report.totals.optional_reachable, 1);
});

test('workflow run blocks that execute tests outside package scripts count as reachable', () => {
  const root = fixture({
    rootScripts: { verify: 'pnpm lint', lint: 'eslint .' },
    files: { 'scripts/nightly.test.ts': TEST_BODY },
    workflows: {
      'nightly.yml': 'jobs:\n  nightly:\n    steps:\n      - run: pnpm exec tsx --test scripts/nightly.test.ts\n',
    },
  });

  const report = buildWiringReport({ root, baselinePath: null });
  const entry = report.tests.find(item => item.path === 'scripts/nightly.test.ts');

  assert.equal(entry?.status, 'optional-reachable');
  assert.equal(entry?.command, '.github/workflows/nightly.yml');
});

test('a non-test runner subcommand never marks the whole tree reachable', () => {
  // Regression: `npx playwright install chromium` was read as "playwright
  // discovers every spec in the repo", which made 131 dead tests look alive.
  const root = fixture({
    rootScripts: { verify: 'pnpm lint', lint: 'eslint .' },
    files: { 'apps/web/e2e/checkout.spec.ts': TEST_BODY },
    workflows: {
      'qa.yml': 'jobs:\n  qa:\n    steps:\n      - run: npx playwright install chromium --with-deps\n',
    },
  });

  const report = buildWiringReport({ root, baselinePath: null });

  assert.equal(statusOf(report, 'apps/web/e2e/checkout.spec.ts'), 'unwired');
});

test('a test-file-shaped fixture that registers no tests is not treated as executable', () => {
  const root = fixture({
    rootScripts: { verify: 'pnpm lint', lint: 'eslint .' },
    files: {
      'src/pick.test.ts': HELPER_BODY,
      'src/real.test.ts': TEST_BODY,
    },
  });

  const report = buildWiringReport({ root, baselinePath: null });

  assert.equal(statusOf(report, 'src/pick.test.ts'), 'fixture-helper-not-executable');
  assert.equal(statusOf(report, 'src/real.test.ts'), 'unwired');
  assert.equal(report.totals.fixture_helper, 1);
  assert.equal(isExecutableTestFile(root, 'src/pick.test.ts'), false);
  assert.equal(isExecutableTestFile(root, 'src/real.test.ts'), true);
});

/* -------------------------------------------------------------------------- */
/* Baseline ledger                                                            */
/* -------------------------------------------------------------------------- */

function baselineFixture(entries: unknown[], maxEntries: number): string {
  return fixture({
    rootScripts: { verify: 'pnpm lint', lint: 'eslint .' },
    files: { 'src/orphan.test.ts': TEST_BODY },
    baseline: {
      schema_version: 1,
      required_roots: ['verify'],
      tests: { max_entries: maxEntries, entries },
      capabilities: { max_entries: 0, entries: [] },
    },
  });
}

test('a complete baseline entry suppresses the unwired failure but stays visible', () => {
  const root = baselineFixture(
    [
      {
        path: 'src/orphan.test.ts',
        disposition: 'phase-b-wiring',
        owner: 'claude-governance',
        issue: 'UTV2-1624',
        expiry: '2099-01-01',
      },
    ],
    1,
  );

  const report = buildWiringReport({ root });

  assert.equal(report.verdict, 'PASS');
  assert.equal(report.totals.unwired, 1);
  assert.equal(report.totals.unwired_new, 0);
  assert.equal(report.totals.unwired_baselined, 1);
});

test('a baseline entry that loses its owner, issue or expiry fails', () => {
  for (const missing of ['owner', 'issue', 'expiry'] as const) {
    const entry: Record<string, string> = {
      path: 'src/orphan.test.ts',
      disposition: 'phase-b-wiring',
      owner: 'claude-governance',
      issue: 'UTV2-1624',
      expiry: '2099-01-01',
    };
    delete entry[missing];

    const report = buildWiringReport({ root: baselineFixture([entry], 1) });

    assert.equal(report.verdict, 'FAIL', `missing ${missing} must fail`);
    assert.ok(
      report.findings.some(f => f.code === 'WIRING_BASELINE_TEST_ENTRY_INCOMPLETE'),
      `missing ${missing} must raise WIRING_BASELINE_TEST_ENTRY_INCOMPLETE`,
    );
  }
});

test('a baseline entry with an unapproved disposition fails', () => {
  const report = buildWiringReport({
    root: baselineFixture(
      [
        {
          path: 'src/orphan.test.ts',
          disposition: 'we-will-get-to-it',
          owner: 'claude-governance',
          issue: 'UTV2-1624',
          expiry: '2099-01-01',
        },
      ],
      1,
    ),
  });

  assert.equal(report.verdict, 'FAIL');
  assert.ok(report.findings.some(f => f.code === 'WIRING_BASELINE_TEST_ENTRY_INCOMPLETE'));
});

test('the baseline may shrink but never grow beyond max_entries', () => {
  const root = fixture({
    rootScripts: { verify: 'pnpm lint', lint: 'eslint .' },
    files: { 'src/a.test.ts': TEST_BODY, 'src/b.test.ts': TEST_BODY },
    baseline: {
      schema_version: 1,
      required_roots: ['verify'],
      tests: {
        max_entries: 1,
        entries: [
          { path: 'src/a.test.ts', disposition: 'phase-b-wiring', owner: 'o', issue: 'UTV2-1624', expiry: '2099-01-01' },
          { path: 'src/b.test.ts', disposition: 'phase-b-wiring', owner: 'o', issue: 'UTV2-1624', expiry: '2099-01-01' },
        ],
      },
      capabilities: { max_entries: 0, entries: [] },
    },
  });

  const report = buildWiringReport({ root });

  assert.equal(report.verdict, 'FAIL');
  assert.ok(report.findings.some(f => f.code === 'WIRING_BASELINE_TESTS_GREW'));
});

test('a baseline entry that is now reachable is stale and must be removed', () => {
  const root = fixture({
    rootScripts: { verify: 'pnpm test', test: 'tsx --test src/orphan.test.ts' },
    files: { 'src/orphan.test.ts': TEST_BODY },
    baseline: {
      schema_version: 1,
      required_roots: ['verify'],
      tests: {
        max_entries: 5,
        entries: [
          {
            path: 'src/orphan.test.ts',
            disposition: 'phase-b-wiring',
            owner: 'o',
            issue: 'UTV2-1624',
            expiry: '2099-01-01',
          },
          {
            path: 'src/deleted.test.ts',
            disposition: 'phase-b-wiring',
            owner: 'o',
            issue: 'UTV2-1624',
            expiry: '2099-01-01',
          },
        ],
      },
      capabilities: { max_entries: 0, entries: [] },
    },
  });

  const report = buildWiringReport({ root });
  const stale = report.findings.filter(f => f.code === 'WIRING_BASELINE_TEST_ENTRY_STALE');

  assert.equal(report.verdict, 'FAIL');
  assert.deepEqual(stale.map(f => f.subject).sort(), ['src/deleted.test.ts', 'src/orphan.test.ts']);
});

test('an expired baseline entry warns rather than blocking every merge in the program', () => {
  const report = buildWiringReport({
    root: baselineFixture(
      [
        {
          path: 'src/orphan.test.ts',
          disposition: 'quarantined',
          owner: 'claude-governance',
          issue: 'UTV2-1624',
          expiry: '2000-01-01',
        },
      ],
      1,
    ),
  });

  assert.equal(report.verdict, 'PASS');
  assert.equal(statusOf(report, 'src/orphan.test.ts'), 'quarantined');
  assert.ok(report.findings.some(f => f.code === 'WIRING_BASELINE_TEST_ENTRY_EXPIRED' && f.severity === 'warn'));
});

/* -------------------------------------------------------------------------- */
/* Capability reachability                                                    */
/* -------------------------------------------------------------------------- */

function capabilityFixture(overrides: FixtureOptions = {}): FixtureOptions {
  return {
    rootScripts: { verify: 'pnpm lint', lint: 'eslint .', 'ops:wired': 'tsx scripts/ops/wired.ts' },
    files: {
      'scripts/ops/wired.ts': 'export const wired = true;\n',
      'scripts/ops/orphan.ts': 'export const orphan = true;\n',
      ...(overrides.files ?? {}),
    },
    ...overrides,
  };
}

test('an active ops capability with no executable reference and no disposition fails', () => {
  const report = buildWiringReport({ root: fixture(capabilityFixture()), baselinePath: null });

  assert.equal(capabilityStatusOf(report, 'scripts/ops/wired.ts'), 'wired-command');
  assert.equal(capabilityStatusOf(report, 'scripts/ops/orphan.ts'), 'orphan');
  assert.equal(report.verdict, 'FAIL');
  assert.ok(
    report.findings.some(f => f.code === 'WIRING_CAPABILITY_ORPHAN' && f.subject === 'scripts/ops/orphan.ts'),
  );
});

test('a documentation-only reference is not sufficient for a capability claimed as automated', () => {
  const options = capabilityFixture();
  const root = fixture({
    ...options,
    files: {
      ...options.files,
      'docs/05_operations/RUNBOOK.md': 'Run scripts/ops/orphan.ts by hand when the queue stalls.\n',
    },
  });

  const report = buildWiringReport({ root, baselinePath: null });
  const entry = report.capabilities.find(item => item.path === 'scripts/ops/orphan.ts');

  assert.equal(entry?.status, 'orphan');
  assert.deepEqual(entry?.doc_references, ['doc:docs/05_operations/RUNBOOK.md']);
  assert.ok(report.findings.some(f => f.code === 'WIRING_CAPABILITY_ORPHAN'));
});

test('an orphan capability with an allowed disposition, owner, issue and expiry passes', () => {
  const options = capabilityFixture();
  const root = fixture({
    ...options,
    baseline: {
      schema_version: 1,
      required_roots: ['verify'],
      tests: { max_entries: 0, entries: [] },
      capabilities: {
        max_entries: 1,
        entries: [
          {
            path: 'scripts/ops/orphan.ts',
            disposition: 'manual-diagnostic',
            owner: 'claude-governance',
            issue: 'UTV2-1624',
            expiry: '2099-01-01',
          },
        ],
      },
    },
  });

  const report = buildWiringReport({ root });

  assert.equal(capabilityStatusOf(report, 'scripts/ops/orphan.ts'), 'baselined');
  assert.equal(report.verdict, 'PASS');
});

test('a capability dispositioned with an unapproved value still fails', () => {
  const options = capabilityFixture();
  const root = fixture({
    ...options,
    baseline: {
      schema_version: 1,
      required_roots: ['verify'],
      tests: { max_entries: 0, entries: [] },
      capabilities: {
        max_entries: 1,
        entries: [
          {
            path: 'scripts/ops/orphan.ts',
            disposition: 'someday',
            owner: 'claude-governance',
            issue: 'UTV2-1624',
            expiry: '2099-01-01',
          },
        ],
      },
    },
  });

  const report = buildWiringReport({ root });

  assert.equal(report.verdict, 'FAIL');
  assert.ok(report.findings.some(f => f.code === 'WIRING_BASELINE_CAPABILITY_ENTRY_INCOMPLETE'));
});

test('a capability imported only by an unwired test is still an orphan; wiring that test covers it', () => {
  const files = {
    'scripts/ops/guard.ts': 'export const guard = true;\n',
    'scripts/ops/guard.test.ts': `import test from 'node:test';\nimport { guard } from './guard.js';\ntest('guard', () => { void guard; });\n`,
  };

  const unwiredRoot = fixture({ rootScripts: { verify: 'pnpm lint', lint: 'eslint .' }, files });
  const unwiredReport = buildWiringReport({ root: unwiredRoot, baselinePath: null });
  assert.equal(capabilityStatusOf(unwiredReport, 'scripts/ops/guard.ts'), 'orphan');

  const wiredRoot = fixture({
    rootScripts: { verify: 'pnpm test', test: 'tsx --test scripts/ops/guard.test.ts' },
    files,
  });
  const wiredReport = buildWiringReport({ root: wiredRoot, baselinePath: null });
  assert.equal(capabilityStatusOf(wiredReport, 'scripts/ops/guard.ts'), 'test-covered-library');
  assert.equal(wiredReport.verdict, 'PASS');
});

/* -------------------------------------------------------------------------- */
/* Receipts                                                                   */
/* -------------------------------------------------------------------------- */

test('the report separates tool/parser failures from implementation findings', () => {
  const root = fixture({ rootScripts: { verify: 'pnpm lint', lint: 'eslint .' } });
  write(root, '.github/workflows/broken.yml', 'jobs: [\n  unbalanced\n');

  const report = buildWiringReport({ root, baselinePath: null });

  assert.equal(report.parser_errors.length, 1);
  assert.equal(report.parser_errors[0]?.subject, '.github/workflows/broken.yml');
  assert.equal(report.verdict, 'FAIL');
  assert.ok(summarizeWiringReport(report).some(line => line.startsWith('[TOOL-FAILURE]')));
});

test('the human summary reports totals, baseline size and the required roots it used', () => {
  const root = fixture({
    rootScripts: { verify: 'pnpm test', test: 'tsx --test src/a.test.ts' },
    files: { 'src/a.test.ts': TEST_BODY },
  });

  const lines = summarizeWiringReport(buildWiringReport({ root, baselinePath: null }));

  assert.ok(lines[0]?.includes('required_roots=verify'));
  assert.ok(lines[1]?.includes('total=1'));
  assert.ok(lines[1]?.includes('required-reachable=1'));
  assert.ok(lines[3]?.includes('baseline tests=0/0'));
});
