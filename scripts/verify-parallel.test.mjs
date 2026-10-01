import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  boundedTail,
  runVerification,
  verificationLogPath,
} from './verify-parallel.mjs';

test('boundedTail limits failure output without changing the full log content', () => {
  const output = Array.from(
    { length: 80 },
    (_, index) => `line-${index + 1}`,
  ).join('\n');
  assert.strictEqual(boundedTail(output, 3), 'line-78\nline-79\nline-80');
});

test('verification log path is stable and filesystem safe', () => {
  const root = path.join(os.tmpdir(), 'unit-talk-verify-root');
  assert.strictEqual(
    verificationLogPath(root, new Date('2026-09-29T12:34:56.789Z')),
    path.join(root, '.out', 'verify', 'verify-2026-09-29T12-34-56-789Z.log'),
  );
});

test('verification wrapper preserves the child exit code and complete output', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-talk-verify-'));
  const result = await runVerification({
    root,
    command: process.execPath,
    args: ['-e', 'console.log("full-output-marker"); process.exit(7)'],
    now: new Date('2026-09-29T00:00:00.000Z'),
  });

  assert.strictEqual(result.code, 7);
  assert.match(fs.readFileSync(result.logPath, 'utf8'), /full-output-marker/);
});
