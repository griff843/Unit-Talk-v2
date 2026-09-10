import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();

function fixture(branch = 'codex/work-2026091099-hook-proof') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-free-hooks-'));
  const git = spawnSync('git', ['init', '-b', branch, dir], { encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  fs.mkdirSync(path.join(dir, 'docs/governance'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs/06_status/lanes'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.ops/work'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/governance/CONCURRENCY_CONFIG.json'), JSON.stringify({ executors: { claude: 3, codex: 5 } }));
  fs.writeFileSync(path.join(dir, '.ops/work/WORK-2026091099.md'), '# Local work\n');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  for (const name of ['curl', 'wget', 'gh', 'codex']) {
    fs.writeFileSync(path.join(bin, name), name === 'codex'
      ? '#!/bin/sh\necho codex-fixture\n'
      : '#!/bin/sh\necho unexpected-network >> "$NETWORK_MARKER"\nexit 89\n', { mode: 0o755 });
  }
  const env = { HOME: dir, PATH: `${bin}:${process.env.PATH}`, LINEAR_API_TOKEN: 'invalid-fixture-token', LINEAR_API_KEY: 'invalid-fixture-key', NETWORK_MARKER: path.join(dir, 'network-called') };
  return { dir, env, close: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function run(name: string, f: ReturnType<typeof fixture>, command = '') {
  const result = spawnSync('bash', [path.join(root, '.claude/hooks', name)], {
    cwd: f.dir, env: f.env, encoding: 'utf8', timeout: 15000,
    input: JSON.stringify({ tool_input: { command } }),
  });
  assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  assert.equal(fs.existsSync(f.env.NETWORK_MARKER), false, 'hooks must not invoke tracker/network tools');
  return result.stdout.trim();
}

test('commit hook accepts WORK and legacy identity without a tracker close marker', () => {
  for (const [branch, id] of [['codex/work-2026091099-hook-proof', 'WORK-2026091099'], ['codex/utv2-123-hook-proof', 'UTV2-123'], ['codex/uni-42-hook-proof', 'UNI-42']]) {
    const f = fixture(branch);
    try {
      assert.equal(run('commit-msg-linear-check.sh', f, `git commit -m "fix: ${id} hook proof"`), '');
      const message = JSON.parse(run('commit-msg-linear-check.sh', f, 'git commit -m "fix: missing identity"')).systemMessage;
      assert.match(message, new RegExp(id));
      assert.match(message, /Tracker close markers are optional/);
    } finally { f.close(); }
  }
});

test('post-merge hook directs repository closeout without requiring tracker transition', () => {
  const f = fixture();
  try {
    const output = JSON.parse(run('linear-sync-reminder.sh', f, 'gh pr merge 1555'));
    assert.match(output.systemMessage, /ops:lane-close/);
    assert.match(output.systemMessage, /Optional tracker mirroring is non-blocking/);
    assert.doesNotMatch(output.systemMessage, /pnpm linear:close|mark Linear issue Done/);
  } finally { f.close(); }
});

test('fresh and compacted hooks recover local work and mission without tracker access', () => {
  const f = fixture();
  try {
    const fresh = JSON.parse(run('session-start.sh', f)).systemMessage;
    assert.match(fresh, /WORK-2026091099/);
    assert.match(fresh, /mission intent\/spec\/plan/);
    assert.match(fresh, /no Linear required/);
    assert.match(fresh, /claude:0\/3 codex:0\/5/);
    const compact = JSON.parse(run('post-compact-reinjector.sh', f)).systemMessage;
    assert.match(compact, /mission intent\/spec\/plan/);
    assert.match(compact, /\.ops\/work\/<ID>\.md/);
    assert.match(compact, /No Linear required/);
    assert.match(compact, /claude:0\/3 codex:0\/5/);
  } finally { f.close(); }
});
