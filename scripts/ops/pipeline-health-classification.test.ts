import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateQueueHealth } from '@unit-talk/observability';
import {
  killSwitchKeyForTarget,
  partitionHeldPendingRows,
  partitionUnclaimableProcessing,
  resolveDeployedWorkerTargets,
} from './pipeline-health-classification.js';

const NOW = new Date('2026-09-27T14:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

// ── worker target resolution ──────────────────────────────────────────────

test('a fresh heartbeat names the deployed worker, even when the monitor env says otherwise', () => {
  const resolved = resolveDeployedWorkerTargets({
    heartbeats: [{ started_at: minutesAgo(1), details: { cycle: 66228, targets: ['discord:official-picks'] } }],
    envTargets: 'discord:canary',
    now: NOW,
    maxHeartbeatAgeMinutes: 10,
  });
  assert.equal(resolved.source, 'heartbeat');
  assert.deepEqual(resolved.targets, ['discord:official-picks']);
});

test('a heartbeat outside the window is not trusted; the explicit env value is used and says so', () => {
  const resolved = resolveDeployedWorkerTargets({
    heartbeats: [{ started_at: minutesAgo(11), details: { targets: ['discord:official-picks'] } }],
    envTargets: ' discord:best-bets , discord:best-bets ',
    now: NOW,
    maxHeartbeatAgeMinutes: 10,
  });
  assert.equal(resolved.source, 'env');
  assert.deepEqual(resolved.targets, ['discord:best-bets']);
  assert.match(resolved.note, /UNIT_TALK_DISTRIBUTION_TARGETS/);
});

test('with no usable heartbeat and no env value the target set is unknown — there is no canary default', () => {
  for (const envTargets of [undefined, '', ' , ']) {
    const resolved = resolveDeployedWorkerTargets({
      heartbeats: [],
      envTargets,
      now: NOW,
      maxHeartbeatAgeMinutes: 10,
    });
    assert.equal(resolved.source, 'unknown');
    assert.deepEqual(resolved.targets, []);
  }
});

test('malformed heartbeat details are skipped, and an older well-formed heartbeat in the window is used', () => {
  const resolved = resolveDeployedWorkerTargets({
    heartbeats: [
      { started_at: minutesAgo(1), details: { targets: [] } },
      { started_at: minutesAgo(2), details: { targets: ['discord:official-picks', 7] } },
      { started_at: minutesAgo(3), details: null },
      { started_at: minutesAgo(4), details: 'discord:official-picks' },
      { started_at: 'not-a-date', details: { targets: ['discord:x'] } },
      { started_at: minutesAgo(5), details: { targets: ['discord:official-picks'] } },
    ],
    envTargets: undefined,
    now: NOW,
    maxHeartbeatAgeMinutes: 10,
  });
  assert.equal(resolved.source, 'heartbeat');
  assert.equal(resolved.heartbeatAt, minutesAgo(5));
});

test('a heartbeat stamped in the future is not trusted', () => {
  const resolved = resolveDeployedWorkerTargets({
    heartbeats: [{ started_at: minutesAgo(-5), details: { targets: ['discord:official-picks'] } }],
    envTargets: undefined,
    now: NOW,
    maxHeartbeatAgeMinutes: 10,
  });
  assert.equal(resolved.source, 'unknown');
});

// ── kill switch ───────────────────────────────────────────────────────────

test('the kill-switch key mirrors the worker: discord:X → X, canary exempt, non-discord has none', () => {
  assert.equal(killSwitchKeyForTarget('discord:official-picks'), 'official-picks');
  assert.equal(killSwitchKeyForTarget('discord:canary'), null);
  assert.equal(killSwitchKeyForTarget('webhook:thing'), null);
});

const pendingOfficial = { id: 'p1', status: 'pending', target: 'discord:official-picks' };
const worker = ['discord:official-picks'];

test('a pending row on a polled target whose switch is killed is held', () => {
  const { held, rest } = partitionHeldPendingRows(
    [pendingOfficial],
    [{ target: 'official-picks', killed: true }],
    worker,
  );
  assert.deepEqual(held, [pendingOfficial]);
  assert.deepEqual(rest, []);
});

test('a pending row whose switch has no row is held, because the worker is fail-closed on a missing row', () => {
  const { held } = partitionHeldPendingRows([pendingOfficial], [], worker);
  assert.deepEqual(held, [pendingOfficial]);
});

test('a pending row whose switch is released is not held — its staleness is a real failure', () => {
  const { held, rest } = partitionHeldPendingRows(
    [pendingOfficial],
    [{ target: 'official-picks', killed: false }],
    worker,
  );
  assert.deepEqual(held, []);
  assert.deepEqual(rest, [pendingOfficial]);
});

test('an unreadable kill-switch table holds nothing, so every row keeps its critical treatment', () => {
  const { held, rest } = partitionHeldPendingRows([pendingOfficial], null, worker);
  assert.deepEqual(held, []);
  assert.deepEqual(rest, [pendingOfficial]);
});

test('a killed target the worker does not poll is not held — that row is stranded, not held', () => {
  const { held } = partitionHeldPendingRows(
    [{ id: 'p2', status: 'pending', target: 'discord:best-bets' }],
    [{ target: 'best-bets', killed: true }],
    worker,
  );
  assert.deepEqual(held, []);
});

test('canary pending rows are never held, and non-pending rows are never held', () => {
  const { held } = partitionHeldPendingRows(
    [
      { id: 'c1', status: 'pending', target: 'discord:canary' },
      { id: 'x1', status: 'processing', target: 'discord:official-picks' },
      { id: 'x2', status: 'dead_letter', target: 'discord:official-picks' },
    ],
    [],
    ['discord:official-picks', 'discord:canary'],
  );
  assert.deepEqual(held, []);
});

// ── unclaimable processing ────────────────────────────────────────────────

test('processing rows on unpolled targets are unclaimable; polled ones and other statuses stay', () => {
  const rows = [
    { id: 'u1', status: 'processing', target: 'discord:utv2-1497-canary-a' },
    { id: 'u2', status: 'processing', target: 'discord:official-picks' },
    { id: 'u3', status: 'pending', target: 'discord:utv2-1497-canary-a' },
  ];
  const { unclaimable, rest } = partitionUnclaimableProcessing(rows, worker);
  assert.deepEqual(unclaimable.map((r) => r.id), ['u1']);
  assert.deepEqual(rest.map((r) => r.id), ['u2', 'u3']);
});

test('with an unknown worker target set no processing row is classed unclaimable', () => {
  const rows = [{ id: 'u1', status: 'processing', target: 'discord:utv2-1497-canary-a' }];
  assert.deepEqual(partitionUnclaimableProcessing(rows, []).unclaimable, []);
});

// ── end to end against the real evaluator, on the 2026-09-26 queue shape ──

test('the production queue shape: the held row stops being critical, the real stranding stays critical', () => {
  const outbox = [
    { id: 'held', status: 'pending', target: 'discord:official-picks', createdAt: minutesAgo(5036) },
    { id: 'can1', status: 'pending', target: 'discord:canary', createdAt: minutesAgo(83207) },
    { id: 'proc', status: 'processing', target: 'discord:utv2-1497-canary-a', createdAt: minutesAgo(90000), claimedAt: minutesAgo(90000) },
  ].map((row) => ({ ...row, updatedAt: row.createdAt, attemptCount: 0 }));

  const { held, rest } = partitionHeldPendingRows(outbox, [{ target: 'official-picks', killed: true }], worker);
  const { unclaimable, rest: evaluated } = partitionUnclaimableProcessing(rest, worker);
  assert.deepEqual(held.map((r) => r.id), ['held']);
  assert.deepEqual(unclaimable.map((r) => r.id), ['proc']);

  const health = evaluateQueueHealth({
    observedAt: NOW.toISOString(),
    workerTargets: worker,
    lastSuccessfulDeliveryAt: minutesAgo(10959),
    outboxRows: evaluated,
  });
  const critical = health.alerts.filter((a) => a.level === 'critical');
  assert.ok(!critical.some((a) => a.code === 'processing_stale'), 'unclaimable rows must not raise processing_stale');
  assert.ok(!critical.some((a) => a.target === 'discord:official-picks'), 'the held row must raise no critical');
  assert.ok(
    !health.alerts.some((a) => /reroute|remove/.test(a.remediation ?? '') && a.target === 'discord:official-picks'),
    'nothing may advise rerouting a row held by the kill switch',
  );
  assert.ok(
    critical.some((a) => a.code === 'target_mismatch' && a.target === 'discord:canary'),
    'a pending row on a target no worker polls is still critical',
  );
  assert.equal(health.status, 'down');
});

test('mutation guard: fed the unfiltered rows, the evaluator raises exactly the false criticals removed above', () => {
  const outbox = [
    { id: 'held', status: 'pending', target: 'discord:official-picks', createdAt: minutesAgo(5036) },
    { id: 'proc', status: 'processing', target: 'discord:utv2-1497-canary-a', createdAt: minutesAgo(90000), claimedAt: minutesAgo(90000) },
  ].map((row) => ({ ...row, updatedAt: row.createdAt, attemptCount: 0 }));
  const unfiltered = evaluateQueueHealth({
    observedAt: NOW.toISOString(),
    workerTargets: worker,
    lastSuccessfulDeliveryAt: minutesAgo(10959),
    outboxRows: outbox,
  });
  assert.ok(unfiltered.alerts.some((a) => a.code === 'processing_stale'));
  assert.ok(unfiltered.alerts.some((a) => a.code === 'delivery_stale'));

  const { rest } = partitionHeldPendingRows(outbox, [{ target: 'official-picks', killed: true }], worker);
  const filtered = evaluateQueueHealth({
    observedAt: NOW.toISOString(),
    workerTargets: worker,
    lastSuccessfulDeliveryAt: minutesAgo(10959),
    outboxRows: partitionUnclaimableProcessing(rest, worker).rest,
  });
  assert.equal(filtered.status, 'healthy');
});
