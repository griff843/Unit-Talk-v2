import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { assertStorageState } from './auth-state.js';
import { calculateFinalVerdict } from './trust.js';
import { writeIssueReport } from './issue-reporter.js';
import { dailyOpsSkill } from '../adapters/unit-talk/surfaces/command-center/skills/daily-ops.js';
import type { QAResult } from './types.js';

test('verdict calculation fails when a critical expectation fails', () => {
  const verdict = calculateFinalVerdict({
    stepStatus: 'PASS',
    preflightResults: [],
    expectationResults: [{
      id: 'command_center_no_broken_lifecycle_signals',
      status: 'failed',
      severity: 'critical',
      message: 'BROKEN lifecycle signals detected',
    }],
  });

  assert.equal(verdict.status, 'FAIL');
  assert.match(verdict.reason, /command_center_no_broken_lifecycle_signals/);
});

test('required preflight failure produces SKIP unless forced', () => {
  const preflightResults = [{
    id: 'operator_health_reachable',
    status: 'failed' as const,
    required: true,
    message: 'operator unavailable',
  }];

  assert.equal(calculateFinalVerdict({
    stepStatus: 'PASS',
    preflightResults,
    expectationResults: [],
  }).status, 'SKIP');

  assert.equal(calculateFinalVerdict({
    stepStatus: 'PASS',
    preflightResults,
    expectationResults: [],
    force: true,
  }).status, 'NEEDS_REVIEW');
});

test('missing persona storage state gives clear auth seeding command', async () => {
  await assert.rejects(
    () => assertStorageState('unit-talk', 'capper'),
    /pnpm qa:auth --product unit-talk --persona capper/,
  );
});

test('issue report includes failed expectations and targeted Smart Form auth recommendation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qa-agent-'));
  try {
    const result = baseResult({
      surface: 'smart_form',
      flow: 'submit_pick',
      persona: 'capper',
      expectationResults: [{
        id: 'smart_form_session_no_500',
        status: 'failed',
        severity: 'critical',
        message: '/api/auth/session returned HTTP 500',
      }],
      networkErrors: ['GET http://localhost:4100/api/auth/session - HTTP 500'],
    });
    const path = await writeIssueReport(result, dir);
    assert.ok(path);
    const report = await readFile(path, 'utf-8');
    assert.match(report, /Failed Expectations/);
    assert.match(report, /smart_form_session_no_500/);
    assert.match(report, /AUTH_SECRET \/ NEXTAUTH_SECRET/);
    assert.match(report, /auth redirected before the form mounted/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Smart Form redirect-before-form-render classification appears in issue report', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qa-agent-'));
  try {
    const result = baseResult({
      surface: 'smart_form',
      flow: 'submit_pick',
      persona: 'capper',
      expectationResults: [{
        id: 'smart_form_no_login_redirect_before_form',
        status: 'failed',
        severity: 'critical',
        message: 'Unexpected redirect to /login before Smart Form controls rendered.',
      }],
    });
    const path = await writeIssueReport(result, dir);
    assert.ok(path);
    const report = await readFile(path, 'utf-8');
    assert.match(report, /form controls did not render because auth redirected before the form mounted/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Command Center BROKEN lifecycle expectation fails hard', async () => {
  const expectation = dailyOpsSkill.expectations?.find((item) => (
    item.id === 'command_center_no_broken_lifecycle_signals'
  ));
  assert.ok(expectation);

  const result = await expectation.evaluate({
    page: {
      locator: () => ({
        innerText: async () => 'submission BROKEN scoring BROKEN promotion BROKEN',
        count: async () => 3,
      }),
    } as never,
    persona: { id: 'operator', displayName: 'Operator', memberTier: 'operator', capabilities: [] },
    surface: { id: 'command_center', displayName: 'Command Center', baseUrls: { local: '', staging: '', production: '' } },
    product: { id: 'unit-talk', displayName: 'Unit Talk', surfaces: {} },
    env: 'local',
    skillResult: {
      status: 'PASS',
      steps: [],
      consoleErrors: [],
      networkErrors: [],
      uxFriction: [],
    },
    preflightResults: [],
    selectorResults: [],
    consoleErrors: [],
    network: [],
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.severity, 'critical');
  assert.match(result.message, /validated -> queued -> posted -> settled/);
});

function baseResult(overrides: Partial<QAResult>): QAResult {
  return {
    schema: 'experience-qa/v1',
    runId: 'run-test',
    product: 'unit-talk',
    surface: 'command_center',
    persona: 'operator',
    flow: 'daily_ops',
    environment: 'local',
    headSha: 'abc123',
    timestamp: '2026-04-26T00:00:00.000Z',
    mode: 'fast',
    status: 'FAIL',
    verdictReason: 'Hard expectation failed.',
    preflightResults: [],
    steps: [],
    expectationResults: [],
    observations: [],
    selectorResults: [],
    screenshots: [],
    consoleErrors: [],
    networkErrors: [],
    networkObservations: [],
    uxFriction: [],
    durationMs: 1,
    ...overrides,
  };
}
