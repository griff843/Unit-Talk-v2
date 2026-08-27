import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ISSUE_ID,
  RUN_TYPE,
  AUDIT_ENTITY_TYPE,
  addDays,
  buildProvisioningSql,
  computeCoverage,
  dayFromPartitionName,
  evaluatePreExpiry,
  partitionNameForDay,
  runPartitionCoverageCheck,
  type AuditSink,
  type SystemRunSink,
} from './partition-provisioner.ts';

function daysFrom(start: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => addDays(start, index));
}

interface RecordedSink {
  runs: SystemRunSink;
  audit: AuditSink;
  started: { runType: string; details: Record<string, unknown> }[];
  completed: { runId: string; status: string; details?: Record<string, unknown> | undefined }[];
  audited: { entityType: string; action: string; payload: Record<string, unknown> }[];
}

function recordingSink(): RecordedSink {
  const started: RecordedSink['started'] = [];
  const completed: RecordedSink['completed'] = [];
  const audited: RecordedSink['audited'] = [];
  return {
    started,
    completed,
    audited,
    runs: {
      async startRun(input) {
        started.push({ runType: input.runType, details: input.details });
        return { id: `run-${started.length}` };
      },
      async completeRun(input) {
        completed.push(input);
        return null;
      },
    },
    audit: {
      async record(input) {
        audited.push({
          entityType: input.entityType,
          action: input.action,
          payload: input.payload,
        });
        return null;
      },
    },
  };
}

test('partitionNameForDay and dayFromPartitionName round-trip', () => {
  assert.equal(partitionNameForDay('2026-07-01'), 'provider_offer_history_p20260701');
  assert.equal(dayFromPartitionName('provider_offer_history_p20260701'), '2026-07-01');
  assert.equal(dayFromPartitionName('provider_offer_history_pXXXXXXXX'), null);
  assert.throws(() => partitionNameForDay('20260701'), /invalid day/);
});

test('computeCoverage counts only the unbroken forward run', () => {
  const report = computeCoverage({
    today: '2026-08-27',
    existingPartitionDays: daysFrom('2026-08-27', 10),
  });
  assert.equal(report.forwardDaysRemaining, 10);
  assert.equal(report.coveredThroughDay, '2026-09-05');
  assert.deepEqual(report.missingDays, []);
});

test('a partition on the far side of a gap does not count as coverage', () => {
  // Three covered days, a one-day hole, then a hundred more days. Ingestion
  // still fails on the hole, so forward coverage is 3 — not 103.
  const report = computeCoverage({
    today: '2026-08-27',
    existingPartitionDays: [...daysFrom('2026-08-27', 3), ...daysFrom('2026-08-31', 100)],
  });
  assert.equal(report.forwardDaysRemaining, 3);
  assert.equal(report.coveredThroughDay, '2026-08-29');
  assert.deepEqual(report.missingDays, ['2026-08-30']);
});

test('today uncovered means zero forward coverage', () => {
  const report = computeCoverage({
    today: '2026-08-27',
    existingPartitionDays: daysFrom('2026-05-02', 60),
  });
  assert.equal(report.forwardDaysRemaining, 0);
  assert.equal(report.coveredThroughDay, null);
});

test('evaluatePreExpiry fires on exactly the thresholds it names', () => {
  const thresholds = { warnDays: 30, criticalDays: 14 };
  const at = (remaining: number) =>
    evaluatePreExpiry(
      computeCoverage({ today: '2026-08-27', existingPartitionDays: daysFrom('2026-08-27', remaining) }),
      thresholds,
    ).level;

  assert.equal(at(31), 'OK');
  assert.equal(at(30), 'WARNING'); // exact warn boundary
  assert.equal(at(15), 'WARNING');
  assert.equal(at(14), 'CRITICAL'); // exact critical boundary
  assert.equal(at(0), 'CRITICAL');
});

test('evaluatePreExpiry rejects an inverted threshold pair', () => {
  assert.throws(
    () =>
      evaluatePreExpiry(computeCoverage({ today: '2026-08-27', existingPartitionDays: [] }), {
        warnDays: 5,
        criticalDays: 10,
      }),
    /criticalDays must be <= warnDays/,
  );
});

test('an induced pre-expiry condition reaches the real operations sink', async () => {
  const sink = recordingSink();
  const result = await runPartitionCoverageCheck({
    // 10 days of forward coverage — below the 14-day critical threshold.
    listPartitionDays: async () => daysFrom('2026-08-27', 10),
    runs: sink.runs,
    audit: sink.audit,
    now: new Date('2026-08-27T00:00:00.000Z'),
  });

  assert.equal(result.verdict.level, 'CRITICAL');

  // The predicate returning CRITICAL is not the assertion under test — reaching
  // the sink is. Both sink writes must have happened.
  assert.equal(result.sinkWrites.systemRun, true);
  assert.equal(result.sinkWrites.auditLog, true);

  assert.equal(sink.started.length, 1);
  assert.equal(sink.started[0]?.runType, RUN_TYPE);

  assert.equal(sink.audited.length, 1);
  assert.equal(sink.audited[0]?.entityType, AUDIT_ENTITY_TYPE);
  assert.equal(sink.audited[0]?.action, 'partition_coverage.critical');
  assert.equal(sink.audited[0]?.payload.issue_id, ISSUE_ID);
  assert.equal(sink.audited[0]?.payload.forward_days_remaining, 10);

  // A CRITICAL verdict must not be recorded as a succeeded run.
  assert.equal(sink.completed.length, 1);
  assert.equal(sink.completed[0]?.status, 'failed');
});

test('an OK condition still writes a receipt, and records the run as succeeded', async () => {
  const sink = recordingSink();
  const result = await runPartitionCoverageCheck({
    listPartitionDays: async () => daysFrom('2026-08-27', 90),
    runs: sink.runs,
    audit: sink.audit,
    now: new Date('2026-08-27T00:00:00.000Z'),
  });

  assert.equal(result.verdict.level, 'OK');
  assert.equal(sink.audited[0]?.action, 'partition_coverage.ok');
  assert.equal(sink.completed[0]?.status, 'succeeded');
});

test('sink failure propagates instead of being swallowed', async () => {
  const sink = recordingSink();
  await assert.rejects(
    runPartitionCoverageCheck({
      listPartitionDays: async () => daysFrom('2026-08-27', 1),
      runs: sink.runs,
      audit: {
        async record() {
          throw new Error('audit sink unavailable');
        },
      },
      now: new Date('2026-08-27T00:00:00.000Z'),
    }),
    /audit sink unavailable/,
  );
  // Fail closed: the run must not have been completed as succeeded behind a
  // sink that never received the receipt.
  assert.equal(sink.completed.length, 0);
});

test('buildProvisioningSql emits reversible, DEFAULT-free DDL and never executes', () => {
  const sql = buildProvisioningSql('2026-07-01', '2026-11-24');
  assert.match(sql, /PARTITION OF public\.provider_offer_history/);
  assert.match(sql, /IF to_regclass\('public\.' \|\| v_name\) IS NOT NULL THEN CONTINUE/);
  // Strip comment lines before asserting on the DDL itself: the header comment
  // legitimately mentions DEFAULT in order to say there isn't one.
  const executable = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  assert.doesNotMatch(executable, /DEFAULT/i);
  assert.doesNotMatch(executable, /DROP/i);
  assert.throws(() => buildProvisioningSql('2026-11-24', '2026-07-01'), /throughDay must be >= fromDay/);
});
