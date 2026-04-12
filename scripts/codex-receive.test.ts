import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './ops/shared.js';

test('codex-receive no longer references legacy lane registry or verification gate identifiers', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'codex-receive.ts'), 'utf8');
  for (const banned of [
    'LANES_FILE',
    'readRegistry',
    'writeRegistry',
    'LaneEntry',
    'LaneRegistry',
    'skipTests',
    "['type-check']",
    "['test']",
  ]) {
    assert.ok(!source.includes(banned), `unexpected legacy identifier still present: ${banned}`);
  }
  assert.match(source, /ops:lane-link-pr/);
});

test('codex-receive rejects the removed --skip-tests flag', () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      'scripts/codex-receive.ts',
      '--',
      '--issue',
      'UTV2-999',
      '--branch',
      'codex/utv2-999-receive',
      '--pr',
      'https://github.com/example/unit-talk/pull/999',
      '--skip-tests',
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );

  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /--skip-tests flag is removed/i);
});
