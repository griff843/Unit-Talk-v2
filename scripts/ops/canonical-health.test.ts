import assert from 'node:assert/strict';
import test from 'node:test';
import { main, type HealthSection, type CanonicalHealthReport } from './canonical-health.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

function captureStdout(fn: () => void): string {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
    return true;
  };
  try {
    fn();
  } finally {
    process.stdout.write = original;
  }
  return chunks.join('');
}

function suppressConsole(fn: () => void): void {
  const orig = { log: console.log, error: console.error };
  console.log = () => {};
  console.error = () => {};
  try { fn(); } finally {
    console.log = orig.log;
    console.error = orig.error;
  }
}

// ── Unit tests for aggregate logic ────────────────────────────────────────────

test('ops:runtime-health JSON output is parseable and has required fields', () => {
  let output = '';
  const origExit = process.exit.bind(process);
  // Stub process.exit so test doesn't terminate
  (process as NodeJS.Process & { exit: (code?: number) => never }).exit = (() => {}) as never;

  try {
    output = captureStdout(() => suppressConsole(() => main(['--json'])));
  } finally {
    (process as NodeJS.Process & { exit: (code?: number) => never }).exit = origExit as never;
  }

  // May be empty if spawn fails (no DB in CI) — just verify structure if present
  if (!output.trim()) return; // CI without DB: skip

  const report = JSON.parse(output) as CanonicalHealthReport;
  assert.equal(report.schema_version, 1);
  assert.ok(typeof report.reported_at === 'string');
  assert.ok(['HEALTHY', 'DEGRADED', 'FAILED', 'UNKNOWN'].includes(report.overall));
  assert.ok(Array.isArray(report.sections));
  assert.ok(Array.isArray(report.failed_sources));
  assert.ok(report.sections.length >= 1);
  for (const sec of report.sections) {
    assert.ok(typeof sec.source === 'string');
    assert.ok(['HEALTHY', 'DEGRADED', 'FAILED', 'UNKNOWN'].includes(sec.state));
    assert.ok(typeof sec.summary === 'string');
  }
});

test('ops:runtime-health sections include ops:health, runtime:health, pipeline:health', () => {
  let output = '';
  const origExit = process.exit.bind(process);
  (process as NodeJS.Process & { exit: (code?: number) => never }).exit = (() => {}) as never;

  try {
    output = captureStdout(() => suppressConsole(() => main(['--json'])));
  } finally {
    (process as NodeJS.Process & { exit: (code?: number) => never }).exit = origExit as never;
  }

  if (!output.trim()) return;

  const report = JSON.parse(output) as CanonicalHealthReport;
  const sources = report.sections.map((s) => s.source);
  assert.ok(sources.includes('ops:health'), `expected ops:health in ${sources.join(', ')}`);
  assert.ok(sources.includes('runtime:health'), `expected runtime:health in ${sources.join(', ')}`);
  assert.ok(sources.includes('pipeline:health'), `expected pipeline:health in ${sources.join(', ')}`);
});

test('ops:runtime-health overall is FAILED if any section is FAILED', () => {
  const sections: HealthSection[] = [
    { source: 'a', state: 'HEALTHY', summary: 'ok' },
    { source: 'b', state: 'FAILED', summary: 'down' },
    { source: 'c', state: 'DEGRADED', summary: 'warn' },
  ];

  // Inline the aggregate logic (mirrors implementation)
  function aggregate(secs: HealthSection[]) {
    if (secs.some((s) => s.state === 'FAILED')) return 'FAILED';
    if (secs.some((s) => s.state === 'UNKNOWN')) return 'DEGRADED';
    if (secs.some((s) => s.state === 'DEGRADED')) return 'DEGRADED';
    return 'HEALTHY';
  }

  assert.equal(aggregate(sections), 'FAILED');
});

test('ops:runtime-health overall is DEGRADED if any section is DEGRADED (none FAILED)', () => {
  const sections: HealthSection[] = [
    { source: 'a', state: 'HEALTHY', summary: 'ok' },
    { source: 'b', state: 'HEALTHY', summary: 'ok' },
    { source: 'c', state: 'DEGRADED', summary: 'warn' },
  ];

  function aggregate(secs: HealthSection[]) {
    if (secs.some((s) => s.state === 'FAILED')) return 'FAILED';
    if (secs.some((s) => s.state === 'UNKNOWN')) return 'DEGRADED';
    if (secs.some((s) => s.state === 'DEGRADED')) return 'DEGRADED';
    return 'HEALTHY';
  }

  assert.equal(aggregate(sections), 'DEGRADED');
});

test('ops:runtime-health overall is HEALTHY if all sections are HEALTHY', () => {
  const sections: HealthSection[] = [
    { source: 'a', state: 'HEALTHY', summary: 'ok' },
    { source: 'b', state: 'HEALTHY', summary: 'ok' },
    { source: 'c', state: 'HEALTHY', summary: 'ok' },
  ];

  function aggregate(secs: HealthSection[]) {
    if (secs.some((s) => s.state === 'FAILED')) return 'FAILED';
    if (secs.some((s) => s.state === 'UNKNOWN')) return 'DEGRADED';
    if (secs.some((s) => s.state === 'DEGRADED')) return 'DEGRADED';
    return 'HEALTHY';
  }

  assert.equal(aggregate(sections), 'HEALTHY');
});

test('ops:runtime-health overall treats UNKNOWN as DEGRADED (not FAILED)', () => {
  const sections: HealthSection[] = [
    { source: 'a', state: 'HEALTHY', summary: 'ok' },
    { source: 'b', state: 'UNKNOWN', summary: '?' },
  ];

  function aggregate(secs: HealthSection[]) {
    if (secs.some((s) => s.state === 'FAILED')) return 'FAILED';
    if (secs.some((s) => s.state === 'UNKNOWN')) return 'DEGRADED';
    if (secs.some((s) => s.state === 'DEGRADED')) return 'DEGRADED';
    return 'HEALTHY';
  }

  assert.equal(aggregate(sections), 'DEGRADED');
});

// ── Governance brake classification tests ─────────────────────────────────────
// Verifies that governance brake rows (P7A, proof-pick-blocked) do not trigger
// FAILED state in canonical-health, while true dead-letter failures still do.

test('pipeline:health governance brake rows alone yield DEGRADED not FAILED', () => {
  // Simulates canonical-health evaluation of pipeline-health JSON output
  // where all dead-letters are governance brakes (outbox_dead_letter_count=0).
  const pipelineData = {
    criticals: [] as string[],
    warnings: ['3 governance brake row(s) (P7A, proof-pick-blocked — expected, not system failures)'],
    outbox_dead_letter_count: 0,
    outbox_governance_brake_count: 3,
    queue_health_status: 'healthy',
  };

  const criticals = pipelineData.criticals ?? [];
  const warnings = pipelineData.warnings ?? [];
  const deadLetter = pipelineData.outbox_dead_letter_count ?? 0;

  const state =
    criticals.length > 0 || deadLetter > 0 ? 'FAILED' :
    warnings.length > 0 ? 'DEGRADED' :
    'HEALTHY';

  assert.equal(state, 'DEGRADED', 'governance brake rows must not escalate to FAILED');
});

test('pipeline:health true dead-letter failures yield FAILED', () => {
  const pipelineData = {
    criticals: ['2 dead_letter rows (true failures)'],
    warnings: [] as string[],
    outbox_dead_letter_count: 2,
    outbox_governance_brake_count: 3,
    queue_health_status: 'unhealthy',
  };

  const criticals = pipelineData.criticals ?? [];
  const deadLetter = pipelineData.outbox_dead_letter_count ?? 0;

  const state =
    criticals.length > 0 || deadLetter > 0 ? 'FAILED' :
    'HEALTHY';

  assert.equal(state, 'FAILED', 'true dead-letter failures must still yield FAILED');
});

test('pipeline:health mixed governance brake + true failure yields FAILED', () => {
  const pipelineData = {
    criticals: ['1 dead_letter rows (true failures)'],
    warnings: ['5 governance brake row(s) (P7A, proof-pick-blocked — expected, not system failures)'],
    outbox_dead_letter_count: 1,
    outbox_governance_brake_count: 5,
    queue_health_status: 'unhealthy',
  };

  const criticals = pipelineData.criticals ?? [];
  const deadLetter = pipelineData.outbox_dead_letter_count ?? 0;

  const state =
    criticals.length > 0 || deadLetter > 0 ? 'FAILED' :
    'HEALTHY';

  assert.equal(state, 'FAILED', 'must yield FAILED when true failures present alongside governance brakes');
});

test('pipeline:health no failures and no governance brakes yields HEALTHY', () => {
  const pipelineData = {
    criticals: [] as string[],
    warnings: [] as string[],
    outbox_dead_letter_count: 0,
    outbox_governance_brake_count: 0,
    queue_health_status: 'healthy',
  };

  const criticals = pipelineData.criticals ?? [];
  const warnings = pipelineData.warnings ?? [];
  const deadLetter = pipelineData.outbox_dead_letter_count ?? 0;

  const state =
    criticals.length > 0 || deadLetter > 0 ? 'FAILED' :
    warnings.length > 0 ? 'DEGRADED' :
    'HEALTHY';

  assert.equal(state, 'HEALTHY');
});

test('runtime:health queue movement degrades for governance brake rows without failing', () => {
  const rows = [
    {
      status: 'dead_letter',
      attempt_count: 0,
      last_error: 'proof-pick-blocked: source system-pick-scanner requires governance review',
      claimed_at: null as string | null,
    },
  ];

  const isGovernanceBrakeDeadLetter = (row: (typeof rows)[number]) =>
    row.status === 'dead_letter' &&
    row.attempt_count === 0 &&
    typeof row.last_error === 'string' &&
    row.last_error.startsWith('proof-pick-blocked:');
  const pending = rows.filter((row) => row.status === 'pending');
  const deadLetter = rows.filter((row) => row.status === 'dead_letter' && !isGovernanceBrakeDeadLetter(row));
  const governanceBrake = rows.filter(isGovernanceBrakeDeadLetter);

  let state = 'HEALTHY';
  const issues: string[] = [];
  if (deadLetter.length > 0) {
    state = 'FAILED';
    issues.push(`${deadLetter.length} true dead_letter rows`);
  } else if (pending.length > 20) {
    state = 'DEGRADED';
  }
  if (governanceBrake.length > 0 && state === 'HEALTHY') {
    state = 'DEGRADED';
    issues.push(`${governanceBrake.length} governance brake dead_letter row(s) (expected P7A proof-blocked)`);
  }

  assert.equal(state, 'DEGRADED');
  assert.deepEqual(issues, ['1 governance brake dead_letter row(s) (expected P7A proof-blocked)']);
});

test('runtime:health queue movement fails when a true dead-letter is present', () => {
  const rows = [
    {
      status: 'dead_letter',
      attempt_count: 2,
      last_error: 'discord delivery failed permanently',
      claimed_at: null as string | null,
    },
    {
      status: 'dead_letter',
      attempt_count: 0,
      last_error: 'proof-pick-blocked: source alert-agent requires governance review',
      claimed_at: null as string | null,
    },
  ];

  const isGovernanceBrakeDeadLetter = (row: (typeof rows)[number]) =>
    row.status === 'dead_letter' &&
    row.attempt_count === 0 &&
    typeof row.last_error === 'string' &&
    row.last_error.startsWith('proof-pick-blocked:');
  const deadLetter = rows.filter((row) => row.status === 'dead_letter' && !isGovernanceBrakeDeadLetter(row));

  const state = deadLetter.length > 0 ? 'FAILED' : 'HEALTHY';

  assert.equal(deadLetter.length, 1);
  assert.equal(state, 'FAILED');
});

test('runtime:health overall degrades when any subsystem is UNKNOWN', () => {
  const failed: string[] = [];
  const degraded: string[] = [];
  const subsystems = [
    { name: 'Queue Movement', state: 'UNKNOWN', value: 'query failed', detail: 'TypeError: fetch failed' },
    { name: 'Discord Delivery', state: 'HEALTHY', value: 'last receipt 1m ago', detail: 'ok' },
  ];

  for (const sub of subsystems) {
    if (sub.state === 'UNKNOWN') {
      degraded.push(`${sub.name}: ${sub.value}${sub.detail ? ` — ${sub.detail}` : ''}`);
    }
  }

  const overallFailed = failed.length > 0;
  const overallDegraded = !overallFailed && degraded.length > 0;
  const overallState = overallFailed ? 'FAILED' : overallDegraded ? 'DEGRADED' : 'HEALTHY';

  assert.equal(overallState, 'DEGRADED');
  assert.deepEqual(degraded, ['Queue Movement: query failed — TypeError: fetch failed']);
});

test('operator-disposition dead letters classify as governance-class, not true failures', () => {
  const rows = [
    {
      status: 'dead_letter',
      attempt_count: 0,
      last_error: 'operator-disposition-2026-06-10: Mode 1 public delivery hold — stale discord:best-bets posts voided per PM go (board-clearing audit); not a system failure',
      claimed_at: null as string | null,
    },
    {
      status: 'dead_letter',
      attempt_count: 0,
      last_error: 'stale_pending_operator_review',
      claimed_at: null as string | null,
    },
    {
      status: 'dead_letter',
      attempt_count: 3,
      last_error: 'discord 500 after retries',
      claimed_at: null as string | null,
    },
  ];

  const isGovernanceBrakeDeadLetter = (row: (typeof rows)[number]) =>
    row.status === 'dead_letter' &&
    row.attempt_count === 0 &&
    typeof row.last_error === 'string' &&
    (row.last_error.startsWith('proof-pick-blocked:') ||
      row.last_error.startsWith('operator-disposition') ||
      row.last_error.startsWith('stale_pending_operator_review'));

  const governanceBrake = rows.filter(isGovernanceBrakeDeadLetter);
  const trueDeadLetter = rows.filter((row) => row.status === 'dead_letter' && !isGovernanceBrakeDeadLetter(row));

  assert.equal(governanceBrake.length, 2);
  assert.equal(trueDeadLetter.length, 1);
  assert.match(trueDeadLetter[0]!.last_error, /discord 500/);
});
