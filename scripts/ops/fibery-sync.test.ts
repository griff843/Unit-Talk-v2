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
import { FiberyClient } from './fibery-client.js';

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

test('FiberyClient creates missing Unit Talk issue shells before primitive note append', async () => {
  const requests: unknown[] = [];
  const originalFetch = globalThis.fetch;
  let queryCount = 0;
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Array<{ command: string; args: unknown }>;
    requests.push(body);
    const command = body[0]?.command;
    let payload: unknown[];
    if (command === 'fibery.entity/query') {
      queryCount += 1;
      payload = queryCount === 1
        ? [{ success: true, result: [] }]
        : [{ success: true, result: [{ 'fibery/id': 'issue-1', 'Sync Notes': '' }] }];
    } else {
      payload = [{ success: true, result: {} }];
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const client = new FiberyClient({
      apiUrl: 'https://fibery.example',
      token: 'token',
    });
    const result = await client.appendNote(
      {
        type: 'Unit Talk/Issue',
        lookup_field: 'Unit Talk/Identifier',
        note_field: 'Sync Notes',
      },
      'UTV2-668',
      'sync note',
      '\n\n---\n\n',
    );

    assert.strictEqual(result.operation, 'append_note');
    assert.deepStrictEqual(
      requests
        .flatMap((request) => request as Array<{ command: string }>)
        .map((entry) => entry.command),
      ['fibery.entity/query', 'fibery.entity/create', 'fibery.entity/query', 'fibery.entity/update'],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FiberyClient does not select or update Fibery document note fields as primitives', async () => {
  const requests: unknown[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Array<{ command: string; args: unknown }>;
    requests.push(body);
    const payload = [{ success: true, result: [{ 'fibery/id': 'issue-1' }] }];
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const client = new FiberyClient({
      apiUrl: 'https://fibery.example',
      token: 'token',
    });
    const result = await client.appendNote(
      {
        type: 'Unit Talk/Issue',
        lookup_field: 'Unit Talk/Identifier',
        note_field: 'Unit Talk/Description',
      },
      'UTV2-668',
      'sync note',
      '\n\n---\n\n',
    );

    assert.strictEqual(result.operation, 'append_note');
    assert.match(result.detail, /document field/);
    assert.deepStrictEqual(
      requests
        .flatMap((request) => request as Array<{ command: string }>)
        .map((entry) => entry.command),
      ['fibery.entity/query'],
    );
    const query = (requests[0] as Array<{ args: { query: { 'q/select': string[] } } }>)[0].args.query;
    assert.deepStrictEqual(query['q/select'], ['fibery/id', 'Unit Talk/Identifier']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FiberyClient resolves workflow states before updating workflow/state', async () => {
  const requests: unknown[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Array<{ command: string; args: unknown }>;
    requests.push(body);
    const command = body[0]?.command;
    let payload: unknown[];
    if (command === 'fibery.entity/query' && requests.length === 1) {
      payload = [{ success: true, result: [{ 'fibery/id': 'issue-1' }] }];
    } else if (command === 'fibery.entity/query') {
      payload = [{ success: true, result: [{ 'fibery/id': 'state-review', 'enum/name': 'In Review' }] }];
    } else {
      payload = [{ success: true, result: {} }];
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const client = new FiberyClient({
      apiUrl: 'https://fibery.example',
      token: 'token',
    });
    const result = await client.setState(
      {
        type: 'Unit Talk/Issue',
        lookup_field: 'Unit Talk/Identifier',
        note_field: 'Unit Talk/Description',
        state_field: 'workflow/state',
      },
      'UTV2-668',
      'In Review',
    );

    assert.strictEqual(result.operation, 'set_state');
    assert.deepStrictEqual(
      requests
        .flatMap((request) => request as Array<{ command: string }>)
        .map((entry) => entry.command),
      ['fibery.entity/query', 'fibery.entity/query', 'fibery.entity/update'],
    );
    const stateQuery = (requests[1] as Array<{ args: { query: { 'q/from': string } } }>)[0].args.query;
    assert.strictEqual(stateQuery['q/from'], 'workflow/state_Unit Talk/Issue');
    const update = (requests[2] as Array<{ args: { entity: Record<string, unknown> } }>)[0].args.entity;
    assert.deepStrictEqual(update['workflow/state'], { 'fibery/id': 'state-review' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
