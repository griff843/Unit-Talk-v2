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

test('worktree-setup is marked as deprecated', () => {
  const script = fs.readFileSync(path.join(ROOT, 'scripts', 'ops', 'worktree-setup.ps1'), 'utf8');
  assert.match(script, /Deprecated compatibility stub/i);
  assert.match(script, /main checkout/i);
});
