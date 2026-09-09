import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { GET, createGovernanceLanesHandler } from './route';
import { readGovernanceBoardSnapshotUnauthenticated } from '@/lib/governance-board.internal';

test('governance lanes endpoint exposes manifest facts without synthesizing unavailable data', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'utv2-governance-lanes-'));
  await writeFile(
    path.join(directory, 'UTV2-1484.json'),
    JSON.stringify({
      issue_id: 'UTV2-1484', tier: 'T2', status: 'started', branch: 'codex/utv2-1484-board',
      pr_url: null, commit_sha: null, heartbeat_at: '2026-07-14T12:00:00.000Z', blocked_by: [],
      truth_check_history: [],
    }),
  );
  await writeFile(
    path.join(directory, 'UTV2-1.json'),
    JSON.stringify({
      issue_id: 'UTV2-1', tier: 'T1', status: 'blocked', heartbeat_at: '2026-07-14T11:00:00.000Z',
      blocked_by: ['Awaiting PM'], truth_check_history: [{ verdict: 'fail' }],
      p0_protocol: { human_approval: { recorded: false } },
    }),
  );

  const snapshot = await readGovernanceBoardSnapshotUnauthenticated({ manifestDirectory: directory, observedAt: '2026-07-14T13:00:00.000Z' });

  assert.equal(snapshot.sourceStatus, 'degraded');
  assert.equal(snapshot.activeLanes.length, 1);
  assert.deepEqual(snapshot.activeLanes[0], {
    issueId: 'UTV2-1484', title: null, tier: 'T2', laneState: 'started', owner: null,
    branch: 'codex/utv2-1484-board', prUrl: null, mergeSha: null, truthCheck: 'not_run',
    pmVerdict: 'not_available', blockerReason: null, nextAction: null, updatedAt: '2026-07-14T12:00:00.000Z',
  });
  assert.equal(snapshot.blockedLanes[0]?.blockerReason, 'Awaiting PM');
  assert.equal(snapshot.blockedLanes[0]?.truthCheck, 'fail');
  assert.equal(snapshot.awaitingPmVerdict[0]?.issueId, 'UTV2-1');
});

test('governance lanes route declares no write handlers', async () => {
  const route = await import('./route');
  await withAuthEnv(
    { NODE_ENV: 'test', COMMAND_CENTER_AUTH_MODE: 'disabled' },
    async () => {
      const response = await createGovernanceLanesHandler(async () => ({
        observedAt: '2026-07-14T13:00:00.000Z',
        sourceStatus: 'degraded',
        missingSources: [],
        activeLanes: [],
        blockedLanes: [],
        awaitingPmVerdict: [],
      }))(new Request('http://localhost/api/governance/lanes'));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    },
  );
  assert.equal('POST' in route, false);
  assert.equal('PUT' in route, false);
  assert.equal('PATCH' in route, false);
  assert.equal('DELETE' in route, false);
});

test('governance lanes route refuses forged actor headers without credentials', async () => {
  await withAuthEnv(
    {
      UNIT_TALK_APP_ENV: 'production',
      COMMAND_CENTER_AUTH_TOKEN: 'real-token',
    },
    async () => {
      const response = await GET(
        new Request('http://localhost/api/governance/lanes', {
          headers: { 'x-command-center-actor': 'attacker' },
        }),
      );
      assert.equal(response.status, 401);
    },
  );
});

async function withAuthEnv(
  values: Record<string, string>,
  fn: () => Promise<void>,
): Promise<void> {
  const keys = [
    'NODE_ENV',
    'UNIT_TALK_APP_ENV',
    'COMMAND_CENTER_AUTH_MODE',
    'COMMAND_CENTER_AUTH_TOKEN',
    'COMMAND_CENTER_AUTH_USERNAME',
    'COMMAND_CENTER_AUTH_PASSWORD',
    'UNIT_TALK_COMMAND_CENTER_AUTH_MODE',
    'UNIT_TALK_COMMAND_CENTER_AUTH_TOKEN',
    'UNIT_TALK_COMMAND_CENTER_AUTH_USERNAME',
    'UNIT_TALK_COMMAND_CENTER_AUTH_PASSWORD',
    'UNIT_TALK_OPERATOR_RUNTIME_MODE',
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  for (const key of keys) delete process.env[key];
  Object.assign(process.env, values);

  try {
    await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
