import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateFiberyReadiness } from './fibery-check.js';
import { issueToManifestPath } from './shared.js';

const issueId = 'UTV2-999999';

function writeTempYaml(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ut-fibery-check-'));
  const filePath = path.join(dir, 'sync.yml');
  fs.writeFileSync(filePath, contents, 'utf8');
  return filePath;
}

function withManifest<T>(manifest: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
  const manifestPath = issueToManifestPath(issueId);
  const previous = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, 'utf8') : null;
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return run().finally(() => {
    if (previous === null) {
      fs.rmSync(manifestPath, { force: true });
    } else {
      fs.writeFileSync(manifestPath, previous, 'utf8');
    }
  });
}

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    issue_id: issueId,
    lane_type: 'codex-cli',
    tier: 'T2',
    worktree_path: process.cwd(),
    branch: 'codex/utv2-999999-fibery-check',
    base_branch: 'main',
    commit_sha: null,
    pr_url: null,
    files_changed: [],
    file_scope_lock: ['scripts/ops/fibery-check.ts'],
    expected_proof_paths: ['docs/06_status/proof/UTV2-999999/diff-summary.md'],
    status: 'started',
    started_at: '2026-04-26T00:00:00.000Z',
    heartbeat_at: '2026-04-26T00:00:00.000Z',
    closed_at: null,
    blocked_by: [],
    preflight_token: 'test-token',
    created_by: 'codex-cli',
    truth_check_history: [],
    reopen_history: [],
    ...overrides,
  };
}

test('Fibery readiness fails when lane manifest is missing', async () => {
  const result = await evaluateFiberyReadiness({
    issueId,
    syncFile: writeTempYaml(`
version: 1
approval:
  allow_multiple_issues: false
  skip_sync_required: false
entities:
  issues:
    - ${issueId}
  findings: []
  controls: []
  proofs:
    - PROOF-${issueId}
`),
    policyFile: '.ops/fibery-policy.yml',
    env: {},
  });

  assert.strictEqual(result.ok, false);
  assert.match(result.failures.join('\n'), /Missing lane manifest/);
});

test('Fibery readiness requires T1/T2 proof entities and active sync', async () => {
  await withManifest(manifest(), async () => {
    const result = await evaluateFiberyReadiness({
      issueId,
      syncFile: writeTempYaml(`
version: 1
approval:
  allow_multiple_issues: false
  skip_sync_required: true
entities:
  issues:
    - ${issueId}
  findings: []
  controls: []
  proofs: []
`),
      policyFile: '.ops/fibery-policy.yml',
      env: {},
    });

    assert.strictEqual(result.code, 'fibery_readiness_failed');
    assert.match(result.failures.join('\n'), /skip_sync_required: false/);
    assert.match(result.failures.join('\n'), /entities\.proofs/);
  });
});

test('Fibery readiness reports unverified when credentials are absent', async () => {
  await withManifest(manifest(), async () => {
    const result = await evaluateFiberyReadiness({
      issueId,
      syncFile: writeTempYaml(`
version: 1
approval:
  allow_multiple_issues: false
  skip_sync_required: false
entities:
  issues:
    - ${issueId}
  findings: []
  controls: []
  proofs:
    - PROOF-${issueId}
`),
      policyFile: '.ops/fibery-policy.yml',
      env: {},
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'fibery_readiness_unverified');
    assert.match(result.failures.join('\n'), /FIBERY_API_URL and FIBERY_API_TOKEN/);
  });
});
