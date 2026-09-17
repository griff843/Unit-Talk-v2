import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../shared.js';

for (const identity of ['WORK-999929', 'UTV2-999929', 'UNI-999929']) {
  test(`truth-check CLI retains merge refusal without tracker for ${identity}`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-free-truth-'));
    try {
      assert.equal(spawnSync('git', ['init', '-q', '-b', 'main', root]).status, 0);
      fs.copyFileSync(path.join(ROOT, '.env.example'), path.join(root, '.env.example'));
      const schemas = path.join(root, 'docs/05_operations/schemas');
      fs.cpSync(path.join(ROOT, 'docs/05_operations/schemas'), schemas, { recursive: true });
      fs.mkdirSync(path.join(root, 'docs/06_status/lanes'), { recursive: true });
      fs.mkdirSync(path.join(root, '.ops/leases'), { recursive: true });
      const manifest = {
        schema_version: 1, issue_id: identity, tracker_ref: 'UTV2-999929',
        lane_type: 'codex-cli', executor: 'codex-cli', tier: 'T3',
        worktree_path: root, branch: `codex/${identity.toLowerCase()}-fixture`, base_branch: 'main',
        commit_sha: 'a'.repeat(40), pr_url: 'https://github.com/fixture/repo/pull/99',
        files_changed: ['README.md'], file_scope_lock: ['README.md'], expected_proof_paths: [],
        status: 'merged', started_at: '2026-09-10T00:00:00.000Z',
        heartbeat_at: '2026-09-10T00:00:00.000Z', closed_at: null, blocked_by: [],
        preflight_token: '.out/ops/preflight/fixture.json', created_by: 'codex-cli',
        truth_check_history: [], reopen_history: [],
      };
      const manifestPath = path.join(root, 'docs/06_status/lanes', `${identity}.json`);
      const bytes = JSON.stringify(manifest);
      fs.writeFileSync(manifestPath, bytes);
      const marker = path.join(root, 'tracker-called');
      const preload = path.join(root, 'network-fixture.cjs');
      fs.writeFileSync(preload, `
        const fs = require('node:fs');
        globalThis.fetch = async input => {
          const url = String(input);
          if (url.includes('linear.app')) {
            fs.writeFileSync(${JSON.stringify(marker)}, url);
            throw new Error(process.env.LINEAR_API_TOKEN || 'missing token');
          }
          if (url === 'https://api.github.com/repos/fixture/repo/pulls/99') {
            return new Response(JSON.stringify({ merged: false, merge_commit_sha: null,
              head: {sha: 'b'.repeat(40)}, base: {sha: 'c'.repeat(40)}, labels: [] }), {status: 200});
          }
          if (!url.startsWith('https://api.github.com/')) throw new Error('unexpected external host');
          return new Response(JSON.stringify({message: 'fixture unavailable'}), {status: 404});
        };
      `);
      for (const token of [undefined, 'invalid', 'timeout', 'deleted-issue', 'issue-cap-reached']) {
        const env = { ...process.env, GITHUB_TOKEN: 'fixture-github-token', LINEAR_API_TOKEN: token,
          LINEAR_API_KEY: token };
        const result = spawnSync(process.execPath, [
          '--require', preload, '--import', path.join(ROOT, 'node_modules/tsx/dist/loader.mjs'),
          path.join(ROOT, 'scripts/ops/truth-check.ts'), identity, '--json', '--dry-run',
        ], { cwd: root, env, encoding: 'utf8', timeout: 30000 });
        assert.equal(fs.existsSync(marker), false, 'default closeout must never request tracker data');
        assert.notEqual(result.status, 0, 'an unmerged PR cannot close');
        const resultJson = JSON.parse(result.stdout);
        const checks = resultJson.checks as Array<{id: string; status: string; detail: string}>;
        for (const id of ['L1', 'L2', 'L3', 'L4']) {
          assert.equal(checks.find(check => check.id === id)?.status, 'skip', result.stdout + result.stderr);
        }
        assert.equal(checks.find(check => check.id === 'G2')?.status, 'fail', result.stdout);
        assert.equal(fs.readFileSync(manifestPath, 'utf8'), bytes, 'dry-run preserves the manifest');
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}