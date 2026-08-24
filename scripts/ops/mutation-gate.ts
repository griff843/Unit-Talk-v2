/**
 * ops:mutation-gate — prove that new tests actually test something.
 *
 * Why this exists: a green suite is not evidence. On this program, three
 * separate correction cycles shipped tests that passed whether or not the code
 * they claimed to cover was present -- including tests guarding a NUL byte that
 * crashed executor dispatch, and a dry-run purity guard that survived deleting
 * the guard entirely. Each was caught only by someone reverting the code by hand
 * and noticing the suite stayed green.
 *
 * The check: for every source file changed in this branch, revert it to its base
 * version, run the suites that changed alongside it, and require at least one to
 * FAIL. If everything still passes with the change reverted, the tests do not
 * cover the change.
 *
 * This is deliberately coarse. It cannot tell you a test is GOOD; it can only
 * tell you a test is not VACUOUS. That is the failure mode that actually shipped.
 *
 * Usage:
 *   pnpm ops:mutation-gate [--base origin/main] [--json]
 *
 * Exit codes: 0 = every change is covered · 1 = uncovered change · 2 = precondition
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

interface Result {
  source: string;
  suites: string[];
  covered: boolean;
  detail: string;
}

function sh(command: string, args: string[], cwd?: string): { out: string; code: number } {
  const r = spawnSync(command, args, { encoding: 'utf8', cwd, timeout: 600_000 });
  return { out: `${r.stdout ?? ''}${r.stderr ?? ''}`, code: r.status ?? 1 };
}

const argv = process.argv.slice(2);
const baseIndex = argv.indexOf('--base');
const base = baseIndex >= 0 ? (argv[baseIndex + 1] ?? 'origin/main') : 'origin/main';
const asJson = argv.includes('--json');

const root = sh('git', ['rev-parse', '--show-toplevel']).out.trim() || process.cwd();

const dirty = sh('git', ['status', '--porcelain'], root).out.trim();
if (dirty) {
  process.stdout.write(
    `${JSON.stringify({ ok: false, code: 'PRECONDITION_FAILED', message: 'Working tree must be clean -- this gate reverts files in place and restores them. Commit or stash first.' }, null, 2)}\n`,
  );
  process.exit(2);
}

const changed = sh('git', ['diff', '--name-only', `${base}...HEAD`], root)
  .out.split('\n')
  .map((f) => f.trim())
  .filter(Boolean);

const changedTests = changed.filter((f) => /\.test\.ts$/u.test(f));
const changedSources = changed.filter(
  (f) => /\.ts$/u.test(f) && !/\.test\.ts$/u.test(f) && !f.startsWith('docs/'),
);

if (changedSources.length === 0) {
  const payload = { ok: true, code: 'NO_SOURCE_CHANGES', message: 'No source files changed; nothing to mutate.' };
  process.stdout.write(asJson ? `${JSON.stringify(payload, null, 2)}\n` : '[mutation-gate] no source changes\n');
  process.exit(0);
}

if (changedTests.length === 0) {
  const payload = {
    ok: false,
    code: 'NO_TEST_CHANGES',
    message: `${changedSources.length} source file(s) changed with no test changes. A behaviour change with no new coverage cannot be proven non-vacuous.`,
    changed_sources: changedSources,
  };
  process.stdout.write(asJson ? `${JSON.stringify(payload, null, 2)}\n` : `[mutation-gate] BLOCKED: ${payload.message}\n`);
  process.exit(1);
}

const results: Result[] = [];

for (const source of changedSources) {
  const abs = path.join(root, source);
  if (!fs.existsSync(abs)) continue;

  // Suites to run: the sibling suite for this file if it changed, else all
  // changed suites in the same directory.
  const sibling = source.replace(/\.ts$/u, '.test.ts');
  const suites = changedTests.includes(sibling)
    ? [sibling]
    : changedTests.filter((t) => path.dirname(t) === path.dirname(source));

  if (suites.length === 0) {
    results.push({ source, suites: [], covered: false, detail: 'no changed test suite in the same directory' });
    continue;
  }

  const original = fs.readFileSync(abs, 'utf8');
  const baseVersion = sh('git', ['show', `${base}:${source}`], root);

  if (baseVersion.code !== 0) {
    // New file with no base version -- deleting it is the equivalent mutation.
    results.push({ source, suites, covered: true, detail: 'new file (no base version to revert to); skipped' });
    continue;
  }

  let covered = false;
  let detail = '';
  try {
    fs.writeFileSync(abs, baseVersion.out);
    for (const suite of suites) {
      const run = sh('pnpm', ['exec', 'tsx', '--test', path.join(root, suite)], root);
      const failMatch = /^# fail (\d+)/mu.exec(run.out);
      const failures = failMatch ? Number(failMatch[1]) : 0;
      if (failures > 0 || run.code !== 0) {
        covered = true;
        detail = `${suite} fails with ${source} reverted (${failures} failing)`;
        break;
      }
    }
    if (!covered) {
      detail = `every suite still passes with ${source} reverted to ${base} -- the tests do not cover this change`;
    }
  } finally {
    fs.writeFileSync(abs, original);
  }

  results.push({ source, suites, covered, detail });
}

// Restoration is non-negotiable: verify it rather than assume it.
const afterDirty = sh('git', ['status', '--porcelain'], root).out.trim();
if (afterDirty) {
  process.stdout.write(
    `${JSON.stringify({ ok: false, code: 'RESTORE_FAILED', message: 'Files were not fully restored after mutation. Inspect immediately.', dirty: afterDirty }, null, 2)}\n`,
  );
  process.exit(2);
}

const uncovered = results.filter((r) => !r.covered);
const payload = {
  ok: uncovered.length === 0,
  code: uncovered.length === 0 ? 'ALL_CHANGES_COVERED' : 'VACUOUS_COVERAGE',
  base,
  results,
  ...(uncovered.length > 0
    ? { remediation: 'Add a test that fails when the change is reverted. A test that passes either way proves nothing.' }
    : {}),
};

if (asJson) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
} else {
  process.stdout.write(`[mutation-gate] vs ${base}\n`);
  for (const r of results) {
    process.stdout.write(`  ${r.covered ? '[COVERED]' : '[VACUOUS]'} ${r.source} — ${r.detail}\n`);
  }
  process.stdout.write(uncovered.length === 0 ? '  VERDICT: every source change is covered\n' : `  VERDICT: ${uncovered.length} uncovered change(s)\n`);
}
process.exit(uncovered.length === 0 ? 0 : 1);
