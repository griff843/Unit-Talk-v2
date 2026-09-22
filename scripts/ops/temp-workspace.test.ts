import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  cleanupTempWorkspaces,
  createTempWorkspace,
  releaseTempWorkspace,
  trackedTempWorkspaces,
} from './temp-workspace.js';

test('createTempWorkspace makes a real directory under the OS temp dir', () => {
  const dir = createTempWorkspace('utv2-1949-unit-');
  try {
    assert.equal(fs.existsSync(dir), true);
    assert.equal(fs.statSync(dir).isDirectory(), true);
    assert.equal(path.dirname(dir), fs.realpathSync(os.tmpdir()));
    assert.ok(trackedTempWorkspaces().includes(dir));
  } finally {
    releaseTempWorkspace(dir);
  }
});

test('releaseTempWorkspace removes the directory and its contents', () => {
  const dir = createTempWorkspace('utv2-1949-release-');
  fs.writeFileSync(path.join(dir, 'nested.txt'), 'content');
  fs.mkdirSync(path.join(dir, 'sub', 'deeper'), { recursive: true });

  releaseTempWorkspace(dir);

  assert.equal(fs.existsSync(dir), false);
  assert.equal(trackedTempWorkspaces().includes(dir), false);
});

test('releaseTempWorkspace refuses a path this module did not create', () => {
  // The guarantee that makes this helper safe: it can only ever delete its own
  // directories, so it can never be turned into an arbitrary-path remover.
  const foreign = fs.mkdtempSync(path.join(os.tmpdir(), 'utv2-1949-foreign-'));
  try {
    releaseTempWorkspace(foreign);
    assert.equal(fs.existsSync(foreign), true, 'a foreign directory must survive');
  } finally {
    fs.rmSync(foreign, { recursive: true, force: true });
  }
});

test('cleanupTempWorkspaces removes every tracked directory and is idempotent', () => {
  const dirs = [
    createTempWorkspace('utv2-1949-bulk-a-'),
    createTempWorkspace('utv2-1949-bulk-b-'),
    createTempWorkspace('utv2-1949-bulk-c-'),
  ];

  cleanupTempWorkspaces();
  for (const dir of dirs) {
    assert.equal(fs.existsSync(dir), false);
  }
  assert.deepEqual(trackedTempWorkspaces(), []);

  cleanupTempWorkspaces();
  assert.deepEqual(trackedTempWorkspaces(), []);
});

test('BEHAVIOUR: a child process that throws still releases its workspace', () => {
  // This is the defect being repaired. A test that fails part-way through used to
  // leak its directory permanently; the exit hook must release it anyway.
  const marker = path.join(os.tmpdir(), `utv2-1949-exit-marker-${process.pid}.txt`);
  const script = `
    import { createTempWorkspace } from ${JSON.stringify(path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'temp-workspace.ts'))};
    import fs from 'node:fs';
    const dir = createTempWorkspace('utv2-1949-throwing-');
    fs.writeFileSync(${JSON.stringify(marker)}, dir);
    throw new Error('simulated test failure');
  `;
  const scriptPath = path.join(createTempWorkspace('utv2-1949-driver-'), 'throwing.ts');
  fs.writeFileSync(scriptPath, script);

  try {
    execFileSync(process.execPath, ['--import', 'tsx', scriptPath], { stdio: 'ignore' });
    assert.fail('the child process was expected to exit non-zero');
  } catch {
    // expected: the child threw
  }

  const leakedDir = fs.readFileSync(marker, 'utf8').trim();
  assert.ok(leakedDir.length > 0, 'the child must have reported the directory it created');
  assert.equal(
    fs.existsSync(leakedDir),
    false,
    `workspace ${leakedDir} survived a throwing process — the exit hook did not run`,
  );

  fs.rmSync(marker, { force: true });
  cleanupTempWorkspaces();
});
