import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './shared.js';

test('fix-sync-yml leaves legacy sync.yml untouched when a per-issue file exists', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fix-sync-yml-'));
  fs.mkdirSync(path.join(repoRoot, '.ops', 'sync'), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, '.ops', 'sync.yml'),
    'version: 1\nentities:\n  issues:\n    - UTV2-000\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(repoRoot, '.ops', 'sync', 'UTV2-123.yml'),
    'version: 1\nentities:\n  issues:\n    - UTV2-123\n',
    'utf8',
  );

  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'ops', 'fix-sync-yml.mjs'), 'UTV2-123'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        UT_REPO_ROOT: repoRoot,
      },
    },
  );

  assert.strictEqual(result.status, 0);
  assert.match(result.stderr, /Deprecated:/);
  assert.match(result.stderr, /leaving legacy \.ops\/sync\.yml untouched/i);
  assert.strictEqual(
    fs.readFileSync(path.join(repoRoot, '.ops', 'sync.yml'), 'utf8'),
    'version: 1\nentities:\n  issues:\n    - UTV2-000\n',
  );
});

// UTV2-1638 triage: this test previously asserted that worktree-setup.ps1 is a
// "Deprecated compatibility stub". It is not, and there is no sign it ever was
// on any commit reachable from main -- the file is a live 61-line script whose
// last functional change was UTV2-1062. The deprecation was either planned and
// never carried out, or carried out and reverted; either way the assertion
// described an intention rather than the repository, so it failed permanently
// and kept the file out of `pnpm test`.
//
// Replaced with assertions on the two invariants the script actually exists to
// enforce, both of which are real regressions if they are lost:
//   1. it refuses to run in the main checkout (lane isolation), and
//   2. it refuses a junctioned/symlinked node_modules and does a real frozen
//      install, so dependency state is never shared between lanes.
test('worktree-setup enforces lane isolation and unshared node_modules', () => {
  const script = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'worktree-setup.ps1'), 'utf8');

  // 1. Never operate on the main checkout.
  assert.match(script, /Lane setup must run in an isolated lane cwd, not the main checkout/i);

  // 2. node_modules must be real, not a reparse point shared with another tree.
  assert.match(script, /ReparsePoint/);
  assert.match(script, /node_modules must not be a junction or symlink in the lane cwd/i);

  // 3. A real, reproducible install -- not a copy or a link.
  assert.match(script, /pnpm install --frozen-lockfile --dir \$WorktreePath/);
});
