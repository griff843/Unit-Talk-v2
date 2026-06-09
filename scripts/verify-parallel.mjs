#!/usr/bin/env node
/**
 * verify:parallel — faster pnpm verify by running lint + type-check concurrently.
 *
 * Sequence:
 *   1. env:check          (fast gate — fail early if env bad)
 *   2. lint + type-check  (parallel — independent, largest wall-clock savers)
 *   3. build              (sequential — depends on type-check)
 *   4. test               (sequential — depends on build)
 *
 * Exit code mirrors pnpm verify: 0 = all pass, 1 = any failure.
 */

import { spawn } from 'node:child_process';

function run(cmd, args, label) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: false });
    child.on('close', (code) => {
      resolve({ label, code: code ?? 1 });
    });
    child.on('error', (err) => {
      process.stderr.write(`[verify:parallel] failed to spawn ${label}: ${err.message}\n`);
      resolve({ label, code: 1 });
    });
  });
}

function pnpm(script) {
  return run('pnpm', ['run', script], script);
}

async function main() {
  // Step 1: env:check (serial — must pass before anything else)
  const env = await pnpm('env:check');
  if (env.code !== 0) {
    process.stderr.write('[verify:parallel] env:check failed — aborting\n');
    process.exit(1);
  }

  // Step 2: lint + type-check in parallel
  const [lint, typeCheck] = await Promise.all([pnpm('lint'), pnpm('type-check')]);
  const step2Failures = [lint, typeCheck].filter((r) => r.code !== 0);
  if (step2Failures.length > 0) {
    process.stderr.write(`[verify:parallel] parallel checks failed: ${step2Failures.map((r) => r.label).join(', ')}\n`);
    process.exit(1);
  }

  // Step 3: build (sequential)
  const build = await pnpm('build');
  if (build.code !== 0) {
    process.stderr.write('[verify:parallel] build failed\n');
    process.exit(1);
  }

  // Step 4: test (sequential)
  const test = await pnpm('test');
  if (test.code !== 0) {
    process.stderr.write('[verify:parallel] test failed\n');
    process.exit(1);
  }

  process.stdout.write('[verify:parallel] all checks passed\n');
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`[verify:parallel] unexpected error: ${err?.stack ?? err}\n`);
  process.exit(1);
});
