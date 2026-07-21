import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FABLE_PILOT_STATE_PATH,
  readFablePilotState,
  evaluatePilotCaps,
  validateActivationDates,
  recordQualifyingTask,
  suspendPilot,
  activatePilot,
  rollbackPilot,
  type FablePilotState,
} from './fable-pilot-state.js';
import { ROOT } from './shared.js';

function makeTmpStateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fable-pilot-state-test-'));
}

function writeState(dir: string, contents: string, fileName = 'FABLE_PILOT_STATE.json'): string {
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, contents, 'utf8');
  return filePath;
}

function baseState(overrides: Partial<FablePilotState> = {}): FablePilotState {
  return {
    schema_version: 1,
    status: 'pending',
    activated_at: null,
    expires_at: null,
    max_tasks: 8,
    max_days: 30,
    usage_ceiling_usd: 150,
    task_count: 0,
    usage_used_usd: 0,
    qualifying_tasks: [],
    updated_at: '2026-07-21T00:00:00.000Z',
    updated_by: 'test',
    reason: 'test fixture',
    ...overrides,
  };
}

test('FABLE_PILOT_STATE_PATH points at the canonical docs/05_operations location', () => {
  assert.strictEqual(
    FABLE_PILOT_STATE_PATH,
    path.join(ROOT, 'docs', '05_operations', 'FABLE_PILOT_STATE.json'),
  );
});

test('the real shipped FABLE_PILOT_STATE.json exists, parses, and is status "pending" (pilot NOT activated)', () => {
  const result = readFablePilotState();
  assert.strictEqual(result.code, 'PILOT_PENDING');
  assert.strictEqual(result.ok, false);
  assert.ok(result.state);
  assert.strictEqual(result.state!.status, 'pending');
  assert.strictEqual(result.state!.activated_at, null);
  assert.strictEqual(result.state!.max_tasks, 8);
  assert.strictEqual(result.state!.max_days, 30);
});

test('readFablePilotState fails closed when the file is missing', () => {
  const dir = makeTmpStateDir();
  const missingPath = path.join(dir, 'FABLE_PILOT_STATE.json');
  const result = readFablePilotState(missingPath);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'PILOT_STATE_MISSING');
});

test('readFablePilotState fails closed on invalid JSON', () => {
  const dir = makeTmpStateDir();
  const filePath = writeState(dir, '{ not valid json');
  const result = readFablePilotState(filePath);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'PILOT_STATE_MALFORMED');
});

test('readFablePilotState fails closed on an invalid status value', () => {
  const dir = makeTmpStateDir();
  const filePath = writeState(dir, JSON.stringify(baseState({ status: 'ENABLED' as never })));
  const result = readFablePilotState(filePath);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'PILOT_STATE_MALFORMED');
});

test('readFablePilotState fails closed for each non-active status: pending, suspended, expired, rolled_back', () => {
  const dir = makeTmpStateDir();
  const cases: Array<[FablePilotState['status'], string]> = [
    ['pending', 'PILOT_PENDING'],
    ['suspended', 'PILOT_SUSPENDED'],
    ['expired', 'PILOT_EXPIRED'],
    ['rolled_back', 'PILOT_ROLLED_BACK'],
  ];
  for (const [status, expectedCode] of cases) {
    const filePath = writeState(dir, JSON.stringify(baseState({ status })), `state-${status}.json`);
    const result = readFablePilotState(filePath);
    assert.strictEqual(result.ok, false, `status ${status} should be ineligible`);
    assert.strictEqual(result.code, expectedCode);
  }
});

test('readFablePilotState returns ok:true only for status "active" AND within caps', () => {
  const dir = makeTmpStateDir();
  const now = new Date('2026-07-21T00:00:00.000Z');
  const activatedAt = now.toISOString();
  const filePath = writeState(
    dir,
    JSON.stringify(
      baseState({
        status: 'active',
        activated_at: activatedAt,
        expires_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        task_count: 2,
        usage_used_usd: 10,
      }),
    ),
  );
  const result = readFablePilotState(filePath);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.code, 'PILOT_ACTIVE_WITHIN_CAPS');
});

test('readFablePilotState fails closed when status says "active" but the task cap is already breached (status drift)', () => {
  const dir = makeTmpStateDir();
  const now = new Date('2026-07-21T00:00:00.000Z');
  const filePath = writeState(
    dir,
    JSON.stringify(
      baseState({
        status: 'active',
        activated_at: now.toISOString(),
        expires_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        task_count: 8,
      }),
    ),
  );
  const result = readFablePilotState(filePath);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'PILOT_CAPS_EXCEEDED');
  assert.ok(result.capsExceededReasons?.some((r) => r.includes('task cap')));
});

test('readFablePilotState fails closed when status says "active" but the 30-day window has elapsed', () => {
  const dir = makeTmpStateDir();
  const activatedAt = new Date('2026-01-01T00:00:00.000Z');
  const filePath = writeState(
    dir,
    JSON.stringify(
      baseState({
        status: 'active',
        activated_at: activatedAt.toISOString(),
        expires_at: new Date(activatedAt.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    ),
  );
  const result = readFablePilotState(filePath);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'PILOT_CAPS_EXCEEDED');
  assert.ok(result.capsExceededReasons?.some((r) => r.includes('day cap')));
});

test('readFablePilotState fails closed when status says "active" but the usage ceiling is exceeded', () => {
  const dir = makeTmpStateDir();
  const now = new Date('2026-07-21T00:00:00.000Z');
  const filePath = writeState(
    dir,
    JSON.stringify(
      baseState({
        status: 'active',
        activated_at: now.toISOString(),
        expires_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        usage_used_usd: 150,
        usage_ceiling_usd: 150,
      }),
    ),
  );
  const result = readFablePilotState(filePath);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'PILOT_CAPS_EXCEEDED');
  assert.ok(result.capsExceededReasons?.some((r) => r.includes('usage ceiling')));
});

test('evaluatePilotCaps is pure and never mutates the input state', () => {
  const state = baseState({ status: 'active', activated_at: '2026-07-21T00:00:00.000Z', task_count: 3 });
  const snapshot = JSON.stringify(state);
  evaluatePilotCaps(state, new Date('2026-07-22T00:00:00.000Z'));
  assert.strictEqual(JSON.stringify(state), snapshot);
});

test('recordQualifyingTask increments task_count and usage, and stays active when within caps', () => {
  const state = baseState({
    status: 'active',
    activated_at: '2026-07-21T00:00:00.000Z',
    expires_at: '2026-08-20T00:00:00.000Z',
  });
  const next = recordQualifyingTask(
    state,
    { taskId: 'UTV2-9001', triggerClass: 'live_state_root_cause', usageDeltaUsd: 5 },
    new Date('2026-07-22T00:00:00.000Z'),
  );
  assert.strictEqual(next.task_count, 1);
  assert.strictEqual(next.usage_used_usd, 5);
  assert.strictEqual(next.status, 'active');
  assert.strictEqual(next.qualifying_tasks.length, 1);
  assert.strictEqual(next.qualifying_tasks[0]!.task_id, 'UTV2-9001');
  // original untouched
  assert.strictEqual(state.task_count, 0);
});

test('recordQualifyingTask mechanically flips to "expired" the moment the 8th qualifying task lands', () => {
  const state = baseState({
    status: 'active',
    activated_at: '2026-07-21T00:00:00.000Z',
    expires_at: '2026-08-20T00:00:00.000Z',
    task_count: 7,
  });
  const next = recordQualifyingTask(
    state,
    { taskId: 'UTV2-9008', triggerClass: 'repeated_architecture_bounce', usageDeltaUsd: 1 },
    new Date('2026-07-22T00:00:00.000Z'),
  );
  assert.strictEqual(next.task_count, 8);
  assert.strictEqual(next.status, 'expired');
});

test('recordQualifyingTask mechanically flips to "expired" the moment usage crosses the ceiling', () => {
  const state = baseState({
    status: 'active',
    activated_at: '2026-07-21T00:00:00.000Z',
    expires_at: '2026-08-20T00:00:00.000Z',
    usage_used_usd: 149,
    usage_ceiling_usd: 150,
  });
  const next = recordQualifyingTask(
    state,
    { taskId: 'UTV2-9002', triggerClass: 'product_synthesis_no_precedent', usageDeltaUsd: 2 },
    new Date('2026-07-22T00:00:00.000Z'),
  );
  assert.strictEqual(next.status, 'expired');
});

test('recordQualifyingTask refuses to record against a non-active pilot (pending/suspended/expired/rolled_back)', () => {
  for (const status of ['pending', 'suspended', 'expired', 'rolled_back'] as const) {
    const state = baseState({ status });
    assert.throws(() =>
      recordQualifyingTask(state, { taskId: 'X', triggerClass: 'live_state_root_cause', usageDeltaUsd: 1 }),
    );
  }
});

test('suspendPilot sets status to suspended from any non-terminal status and is independent of caps', () => {
  for (const status of ['pending', 'active', 'expired'] as const) {
    const state = baseState({ status });
    const next = suspendPilot(state, 'operator brake', 'griff843');
    assert.strictEqual(next.status, 'suspended');
    assert.strictEqual(next.updated_by, 'griff843');
  }
});

test('suspendPilot refuses to suspend a rolled_back (terminal) pilot', () => {
  const state = baseState({ status: 'rolled_back' });
  assert.throws(() => suspendPilot(state, 'x', 'y'));
});

test('activatePilot only accepts a "pending" starting state and sets activated_at/expires_at', () => {
  const state = baseState({ status: 'pending' });
  const now = new Date('2026-07-21T00:00:00.000Z');
  const next = activatePilot(state, 'griff843', now);
  assert.strictEqual(next.status, 'active');
  assert.strictEqual(next.activated_at, now.toISOString());
  assert.strictEqual(
    next.expires_at,
    new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  );
});

test('activatePilot refuses to activate a non-pending pilot (active/suspended/expired/rolled_back)', () => {
  for (const status of ['active', 'suspended', 'expired', 'rolled_back'] as const) {
    const state = baseState({ status });
    assert.throws(() => activatePilot(state, 'griff843'));
  }
});

test('rollbackPilot is terminal: once rolled_back, activatePilot can never bring it back', () => {
  const state = baseState({ status: 'active' });
  const rolledBack = rollbackPilot(state, 'governance rollback', 'griff843');
  assert.strictEqual(rolledBack.status, 'rolled_back');
  assert.throws(() => activatePilot(rolledBack, 'griff843'));
});

// ── Activation-date fail-closed validation (UTV2-1569 PR #1292 Codex review finding) ──
// ── every malformed-input case gets its own explicit test, per the PM's required fix ──

test('validateActivationDates rejects a missing activated_at', () => {
  const state = baseState({ status: 'active', activated_at: null, expires_at: '2026-08-20T00:00:00.000Z' });
  const result = validateActivationDates(state);
  assert.strictEqual(result.ok, false);
  if (!result.ok) assert.match(result.message, /activated_at is missing or empty/);
});

test('validateActivationDates rejects an empty-string activated_at', () => {
  const state = baseState({ status: 'active', activated_at: '   ', expires_at: '2026-08-20T00:00:00.000Z' });
  const result = validateActivationDates(state);
  assert.strictEqual(result.ok, false);
  if (!result.ok) assert.match(result.message, /activated_at is missing or empty/);
});

test('validateActivationDates rejects an unparseable activated_at', () => {
  const state = baseState({ status: 'active', activated_at: 'not-a-date', expires_at: '2026-08-20T00:00:00.000Z' });
  const result = validateActivationDates(state);
  assert.strictEqual(result.ok, false);
  if (!result.ok) assert.match(result.message, /not a parseable date/);
});

test('validateActivationDates rejects a missing expires_at', () => {
  const state = baseState({ status: 'active', activated_at: '2026-07-21T00:00:00.000Z', expires_at: null });
  const result = validateActivationDates(state);
  assert.strictEqual(result.ok, false);
  if (!result.ok) assert.match(result.message, /expires_at is missing or empty/);
});

test('validateActivationDates rejects an unparseable expires_at', () => {
  const state = baseState({ status: 'active', activated_at: '2026-07-21T00:00:00.000Z', expires_at: 'garbage' });
  const result = validateActivationDates(state);
  assert.strictEqual(result.ok, false);
  if (!result.ok) assert.match(result.message, /not a parseable date/);
});

test('validateActivationDates rejects expires_at at or before activated_at', () => {
  const state = baseState({
    status: 'active',
    activated_at: '2026-07-21T00:00:00.000Z',
    expires_at: '2026-07-20T00:00:00.000Z',
  });
  const result = validateActivationDates(state);
  assert.strictEqual(result.ok, false);
  if (!result.ok) assert.match(result.message, /is not after activated_at/);
});

test('validateActivationDates rejects expires_at equal to activated_at', () => {
  const state = baseState({
    status: 'active',
    activated_at: '2026-07-21T00:00:00.000Z',
    expires_at: '2026-07-21T00:00:00.000Z',
  });
  const result = validateActivationDates(state);
  assert.strictEqual(result.ok, false);
});

test('validateActivationDates rejects expires_at inconsistent with activated_at + max_days', () => {
  const state = baseState({
    status: 'active',
    activated_at: '2026-07-21T00:00:00.000Z',
    expires_at: '2026-12-25T00:00:00.000Z', // nowhere near activated_at + 30 days
    max_days: 30,
  });
  const result = validateActivationDates(state);
  assert.strictEqual(result.ok, false);
  if (!result.ok) assert.match(result.message, /does not match activated_at \+ max_days/);
});

test('validateActivationDates accepts a well-formed, internally-consistent activation window', () => {
  const now = new Date('2026-07-21T00:00:00.000Z');
  const state = baseState({
    status: 'active',
    activated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    max_days: 30,
  });
  const result = validateActivationDates(state);
  assert.strictEqual(result.ok, true);
});

test('validateActivationDates tolerates small clock-skew/serialization drift (well within 5 minutes)', () => {
  const now = new Date('2026-07-21T00:00:00.000Z');
  const state = baseState({
    status: 'active',
    activated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000 + 60_000).toISOString(), // +1 minute
    max_days: 30,
  });
  const result = validateActivationDates(state);
  assert.strictEqual(result.ok, true);
});

test('readFablePilotState fails closed with PILOT_DATES_INVALID for every malformed activation-date case, even when the caps themselves would otherwise pass', () => {
  const dir = makeTmpStateDir();
  const cases: Array<[string, Partial<FablePilotState>]> = [
    ['missing activated_at', { activated_at: null, expires_at: '2026-08-20T00:00:00.000Z' }],
    ['unparseable activated_at', { activated_at: 'nope', expires_at: '2026-08-20T00:00:00.000Z' }],
    ['missing expires_at', { activated_at: '2026-07-21T00:00:00.000Z', expires_at: null }],
    ['unparseable expires_at', { activated_at: '2026-07-21T00:00:00.000Z', expires_at: 'nope' }],
    [
      'expires_at before activated_at',
      { activated_at: '2026-07-21T00:00:00.000Z', expires_at: '2026-07-01T00:00:00.000Z' },
    ],
    [
      'expires_at inconsistent with max_days',
      { activated_at: '2026-07-21T00:00:00.000Z', expires_at: '2027-01-01T00:00:00.000Z' },
    ],
  ];
  for (const [label, overrides] of cases) {
    const filePath = writeState(
      dir,
      JSON.stringify(baseState({ status: 'active', task_count: 1, usage_used_usd: 5, ...overrides })),
      `case-${label.replace(/\s+/g, '-')}.json`,
    );
    const result = readFablePilotState(filePath);
    assert.strictEqual(result.ok, false, `expected ${label} to be rejected`);
    assert.strictEqual(result.code, 'PILOT_DATES_INVALID', `expected ${label} to produce PILOT_DATES_INVALID`);
  }
});

test('evaluatePilotCaps itself (defense in depth, independent of readFablePilotState) treats a missing/unparseable activation date as a cap failure, never a silent no-op', () => {
  const missingDateState = baseState({ status: 'active', activated_at: null, task_count: 1 });
  const missingResult = evaluatePilotCaps(missingDateState);
  assert.strictEqual(missingResult.withinCaps, false);
  assert.ok(missingResult.reasons.some((r) => r.includes('activation date missing or unparseable')));

  const unparseableDateState = baseState({ status: 'active', activated_at: 'not-a-date', task_count: 1 });
  const unparseableResult = evaluatePilotCaps(unparseableDateState);
  assert.strictEqual(unparseableResult.withinCaps, false);
  assert.ok(unparseableResult.reasons.some((r) => r.includes('activation date missing or unparseable')));

  const unparseableExpiryState = baseState({
    status: 'active',
    activated_at: '2026-07-21T00:00:00.000Z',
    expires_at: 'garbage',
    task_count: 1,
  });
  const unparseableExpiryResult = evaluatePilotCaps(unparseableExpiryState);
  assert.strictEqual(unparseableExpiryResult.withinCaps, false);
  assert.ok(unparseableExpiryResult.reasons.some((r) => r.includes('expiry date unparseable')));
});
