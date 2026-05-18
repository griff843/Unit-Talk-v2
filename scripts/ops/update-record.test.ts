import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './shared.js';

function runUpdateRecord(args: string[]) {
  return spawnSync(
    process.execPath,
    [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'scripts/ops/update-record.ts', ...args],
    {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );
}

function withNote(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ut-update-record-'));
  const filePath = path.join(dir, 'note.md');
  fs.writeFileSync(filePath, contents, 'utf8');
  return filePath;
}

test('linear dry-run validates issue and comment file without posting', () => {
  const notePath = withNote('PR opened: https://github.com/unit-talk/unit-talk-v2/pull/1');
  const result = runUpdateRecord([
    '--target',
    'linear',
    '--issue',
    'UTV2-123',
    '--comment-file',
    notePath,
    '--status',
    'In Review',
    '--dry-run',
  ]);

  assert.strictEqual(result.status, 0);
  const payload = JSON.parse(result.stdout) as {
    ok: boolean;
    code: string;
    target: string;
    issue: string;
    status: string;
    dry_run: boolean;
  };
  assert.strictEqual(payload.ok, true);
  assert.strictEqual(payload.code, 'dry_run');
  assert.strictEqual(payload.target, 'linear');
  assert.strictEqual(payload.issue, 'UTV2-123');
  assert.strictEqual(payload.status, 'In Review');
  assert.strictEqual(payload.dry_run, true);
});

test('update-record rejects empty note files', () => {
  const notePath = withNote('   ');
  const result = runUpdateRecord([
    '--target',
    'linear',
    '--issue',
    'UTV2-123',
    '--note-file',
    notePath,
    '--dry-run',
  ]);

  assert.strictEqual(result.status, 1);
  const payload = JSON.parse(result.stdout) as { ok: boolean; code: string; message: string };
  assert.strictEqual(payload.ok, false);
  assert.match(payload.message, /Note file is empty/);
});
