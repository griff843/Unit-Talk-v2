import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { GET, getGovernanceBoardSnapshot } from './route';

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

  const snapshot = await getGovernanceBoardSnapshot({ manifestDirectory: directory, observedAt: '2026-07-14T13:00:00.000Z' });

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
  const response = await GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal('POST' in route, false);
  assert.equal('PUT' in route, false);
  assert.equal('PATCH' in route, false);
  assert.equal('DELETE' in route, false);
});
