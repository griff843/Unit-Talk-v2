import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildSyncActions,
  loadFiberyPolicy,
  loadSyncMetadata,
  runFiberySync,
  validateSyncMetadata,
  type FiberyPolicy,
  type SyncContext,
} from './fibery-sync-lib.js';

function tempYaml(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ut-fibery-sync-'));
  const filePath = path.join(dir, 'sync.yml');
  fs.writeFileSync(filePath, contents, 'utf8');
  return filePath;
}

const context: SyncContext = {
  event: 'merge',
  prNumber: '42',
  prTitle: 'fix(api): UTV2-123 sync',
  prUrl: 'https://github.com/example/repo/pull/42',
  actor: 'codex',
  sha: 'abc123',
  repository: 'example/repo',
};

const policy: FiberyPolicy = {
  version: 1,
  fibery: {
    api_url_env: 'FIBERY_API_URL',
    api_token_env: 'FIBERY_API_TOKEN',
    dry_run_env: 'FIBERY_SYNC_DRY_RUN',
  },
  defaults: {
    append_only: true,
    note_separator: '\n\n---\n\n',
  },
  entities: {
    issues: {
      type: 'Issue',
      lookup_field: 'Public Id',
      note_field: 'Sync Notes',
      state_field: 'State',
      state_updates: {
        pr_open: 'In Review',
        merge: 'Done',
      },
    },
    findings: {
      type: 'Finding',
      lookup_field: 'Public Id',
      note_field: 'Sync Notes',
      state_updates: {},
    },
    controls: {
      type: 'Control',
      lookup_field: 'Public Id',
      note_field: 'Sync Notes',
      state_updates: {},
    },
    proofs: {
      type: 'Proof',
      lookup_field: 'Public Id',
      note_field: 'Sync Notes',
      state_updates: {},
    },
  },
};

test('sync metadata requires at least one issue ID', () => {
  const metadata = loadSyncMetadata(tempYaml('version: 1\nentities:\n  issues: []\n'));
  assert.match(validateSyncMetadata(metadata).join('\n'), /No implementation issue ID/);
});

test('sync metadata blocks multiple issues without explicit approval', () => {
  const metadata = loadSyncMetadata(tempYaml(`
version: 1
approval:
  allow_multiple_issues: false
entities:
  issues:
    - UTV2-123
    - UTV2-124
`));
  assert.match(validateSyncMetadata(metadata).join('\n'), /Multiple issue IDs/);
});

test('sync metadata accepts multiple issues with explicit approval flag', () => {
  const metadata = loadSyncMetadata(tempYaml(`
version: 1
approval:
  allow_multiple_issues: true
entities:
  issues:
    - UTV2-123
    - UTV2-124
`));
  assert.deepStrictEqual(validateSyncMetadata(metadata), []);
});

test('merge actions only set state for implementation issues', () => {
  const metadata = loadSyncMetadata(tempYaml(`
version: 1
entities:
  issues:
    - UTV2-123
  findings:
    - FINDING-9
  controls:
    - CTRL-9
  proofs:
    - PROOF-9
`));
  const actions = buildSyncActions(metadata, policy, context);
  assert.deepStrictEqual(
    actions.map((action) => [action.kind, action.id, action.state]),
    [
      ['issues', 'UTV2-123', 'Done'],
      ['findings', 'FINDING-9', null],
      ['controls', 'CTRL-9', null],
      ['proofs', 'PROOF-9', null],
    ],
  );
});

test('policy loader reads entity mappings', () => {
  const loaded = loadFiberyPolicy('.ops/fibery-policy.yml');
  assert.strictEqual(loaded.entities.issues.state_updates.pr_open, 'In Review');
  assert.strictEqual(loaded.entities.controls.state_updates.merge, undefined);
});

test('sync runner skips when sync-required bypass is explicitly configured', async () => {
  const metadata = loadSyncMetadata(tempYaml(`
version: 1
approval:
  skip_sync_required: true
entities:
  issues: []
`));
  const result = await runFiberySync({
    metadata,
    policy,
    context,
    dryRun: true,
    client: {
      appendNote: async () => {
        throw new Error('appendNote should not run');
      },
      setState: async () => {
        throw new Error('setState should not run');
      },
    } as never,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.code, 'fibery_sync_skipped');
  assert.match(result.comment_markdown, /Skipped:/);
});
