import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateQueueHealth } from '@unit-talk/observability';
import {
  deadLetterBucket,
  killSwitchKeyForTarget,
  partitionDeadLetters,
  partitionHeldPendingRows,
  partitionUnclaimableProcessing,
  readAllPages,
  resolveDeployedWorkerTargets,
  type RangeQuery,
} from './pipeline-health-classification.js';
import { bucketDeadLetterRows } from './readiness-refresh.js';

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

// ── dead letters: the readiness gate's rule, not a local copy ─────────────

const deadLetterRows = [
  { id: 'd1', status: 'dead_letter', attempt_count: 0, last_error: 'proof-pick-blocked: source x is not a live source' },
  { id: 'd2', status: 'dead_letter', attempt_count: 3, last_error: 'operator-disposition: voided 2026-07-01' },
  { id: 'd3', status: 'dead_letter', attempt_count: 1, last_error: 'stale_pending_operator_review' },
  { id: 'd4', status: 'dead_letter', attempt_count: 2, last_error: 'governance_public_delivery_suppressed' },
  { id: 'd5', status: 'dead_letter', attempt_count: 0, last_error: null },
  { id: 'd6', status: 'dead_letter', attempt_count: 0, last_error: 'discord 500' },
  { id: 'd7', status: 'dead_letter', attempt_count: 4, last_error: 'discord 500' },
  { id: 'd8', status: 'dead_letter', attempt_count: 2, last_error: null },
  { id: 'd9', status: 'dead_letter', attempt_count: '2', last_error: 'discord 500' },
  { id: 'd10', status: 'dead_letter', last_error: '' },
];

test('dead-letter buckets match the readiness gate row for row, so the two can never disagree', () => {
  const partition = partitionDeadLetters(deadLetterRows);
  const gate = bucketDeadLetterRows(deadLetterRows);
  assert.equal(partition.governanceHold.length, gate.governanceHold);
  assert.equal(partition.unattemptedUnclassified.length, gate.unattemptedUnclassified);
  assert.equal(partition.trueFailure.length, gate.trueFailure);
  assert.deepEqual(partition.governanceHold.map((r) => r.id), ['d1', 'd2', 'd3', 'd4']);
  assert.deepEqual(partition.unattemptedUnclassified.map((r) => r.id), ['d5', 'd6']);
  assert.deepEqual(partition.trueFailure.map((r) => r.id), ['d7', 'd8', 'd9', 'd10']);
});

test('a recognised disposition is a governance hold even after delivery was attempted', () => {
  // The monitor's old local rule required attempt_count === 0 and called this a true failure.
  assert.equal(deadLetterBucket(deadLetterRows[1]), 'governance_hold');
});

test('a non-numeric or missing attempt count is treated as attempted (fail closed)', () => {
  assert.equal(deadLetterBucket({ status: 'dead_letter', attempt_count: '2', last_error: 'discord 500' }), 'true_failure');
  assert.equal(deadLetterBucket({ status: 'dead_letter', last_error: null }), 'true_failure');
});

test('rows that are not dead letters pass through untouched, in order', () => {
  const rows = [
    { id: 'p1', status: 'pending', attempt_count: 0, last_error: null },
    deadLetterRows[6],
    { id: 'x1', status: 'processing', attempt_count: 1, last_error: null },
  ];
  assert.deepEqual(partitionDeadLetters(rows).rest.map((r) => r.id), ['p1', 'x1']);
});

// ── paged reads past the PostgREST cap ────────────────────────────────────

type Row = { id: string };

/**
 * A PostgREST stand-in capped at `cap` rows per response. An id-ordered read is
 * stable; an unordered one is served in a different order on every request, as
 * a real heap scan may be, so unordered range pages overlap and skip rows.
 */
function fakeTable(size: number, cap = 1000) {
  const sorted: Row[] = Array.from({ length: size }, (_, i) => ({ id: `id-${String(i).padStart(6, '0')}` }));
  const log = { queries: 0, ordered: 0 };
  let seed = 7;
  const shuffled = () => {
    const copy = [...sorted];
    for (let i = copy.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const j = seed % (i + 1);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };
  const makeQuery = (): RangeQuery<Row> => {
    log.queries += 1;
    let orderedById = false;
    const query: RangeQuery<Row> = {
      order(column, options) {
        if (column === 'id' && options.ascending) orderedById = true;
        return query;
      },
      range(from, to) {
        if (orderedById) log.ordered += 1;
        const source = orderedById ? sorted : shuffled();
        const end = Math.min(to + 1, from + cap);
        return Promise.resolve({ data: source.slice(from, end), error: null });
      },
    };
    return query;
  };
  return { sorted, makeQuery, log };
}

test('a population larger than one response is read completely, once per row', async () => {
  const table = fakeTable(2500);
  const rows = await readAllPages(table.makeQuery);
  assert.equal(rows.length, 2500);
  assert.deepEqual(new Set(rows.map((r) => r.id)), new Set(table.sorted.map((r) => r.id)));
  assert.equal(table.log.queries, 4, 'three full pages and one empty page');
  assert.equal(table.log.ordered, table.log.queries, 'every page is id-ordered');
});

test('the fake is discriminating: unordered range pages lose rows, which is why the order is load-bearing', async () => {
  const table = fakeTable(2500);
  const seen = new Set<string>();
  for (let from = 0; from < 2500; from += 1000) {
    const { data } = await table.makeQuery().range(from, from + 999);
    for (const row of data ?? []) seen.add(row.id);
  }
  assert.ok(seen.size < 2500, `unordered paging should lose rows, got ${seen.size}`);
});

test('a page error is raised, never returned as a shorter population', async () => {
  const failing = (): RangeQuery<Row> => {
    const query: RangeQuery<Row> = {
      order: () => query,
      range: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
    };
    return query;
  };
  await assert.rejects(readAllPages(failing), /offset 0: boom/);
});
