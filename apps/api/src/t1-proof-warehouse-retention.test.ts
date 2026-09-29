import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('UTV2-1370: governed warehouse retention live-DB proof', () => {
  const repoRoot = [process.cwd(), path.resolve(process.cwd(), '../..')].find(
    (candidate) =>
      fs.existsSync(
        path.join(candidate, 'scripts/warehouse/retention-workflow.test.ts'),
      ),
  );
  assert.ok(repoRoot, 'could not locate repository root for retention proof');
  const result = spawnSync(
    'pnpm',
    ['exec', 'tsx', '--test', 'scripts/warehouse/retention-workflow.test.ts'],
    {
      cwd: repoRoot,
      env: process.env,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    },
  );

  assert.equal(
    result.status,
    0,
    `warehouse retention proof failed\n${result.stdout}\n${result.stderr}`,
  );
});
