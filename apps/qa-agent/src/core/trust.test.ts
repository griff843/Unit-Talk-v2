import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { assertStorageState } from './auth-state.js';
import { calculateFinalVerdict } from './trust.js';
import { writeIssueReport } from './issue-reporter.js';
import { runPreflightChecks } from './preflight.js';
import { dailyOpsSkill } from '../adapters/unit-talk/surfaces/command-center/skills/daily-ops.js';
import { submitPickSkill } from '../adapters/unit-talk/surfaces/smart-form/skills/submit-pick.js';
import type {
  QAExpectationContext,
  QAPreflightCheck,
  QAPreflightContext,
  QAResult,
  SelectorResult,
} from './types.js';

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
  assert.match(result.message, /picks\.status/);
  assert.match(result.message, /validated -> queued -> posted -> settled/);
  assert.doesNotMatch(result.message, /lifecycle_state/);

  const verdict = calculateFinalVerdict({
    stepStatus: 'PASS',
    preflightResults: [],
    expectationResults: [{ ...result, hard: true }],
  });
  assert.equal(verdict.status, 'FAIL');
  assert.notEqual(verdict.status, 'PASS');
  assert.match(verdict.reason, /command_center_no_broken_lifecycle_signals/);
});

test('Smart Form auth/session 500 is classified as auth config failure', async () => {
  const expectation = submitPickSkill.expectations?.find((item) => (
    item.id === 'smart_form_session_no_500'
  ));
  assert.ok(expectation);

  const result = await expectation.evaluate({
    ...baseExpectationContext('smart_form', 'submit_pick', 'capper'),
    network: [{
      method: 'GET',
      url: 'http://localhost:4100/api/auth/session',
      status: 500,
    }],
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.severity, 'critical');
  assert.match(result.message, /AUTH_SECRET \/ NEXTAUTH_SECRET/);

  const issueReportDir = await mkdtemp(join(tmpdir(), 'qa-agent-'));
  try {
    const path = await writeIssueReport(baseResult({
      surface: 'smart_form',
      flow: 'submit_pick',
      persona: 'capper',
      expectationResults: [result],
      networkErrors: ['GET http://localhost:4100/api/auth/session - HTTP 500'],
    }), issueReportDir);
    assert.ok(path);
    const report = await readFile(path, 'utf-8');
    assert.match(report, /auth\/config failure|AUTH_SECRET \/ NEXTAUTH_SECRET|NextAuth config/i);
    assert.match(report, /form controls did not render because auth redirected before the form mounted/i);
  } finally {
    await rm(issueReportDir, { recursive: true, force: true });
  }
});

test('Smart Form login redirect before form render is not generic selector failure', async () => {
  const redirectExpectation = submitPickSkill.expectations?.find((item) => (
    item.id === 'smart_form_no_login_redirect_before_form'
  ));
  const controlsExpectation = submitPickSkill.expectations?.find((item) => (
    item.id === 'smart_form_controls_render'
  ));
  assert.ok(redirectExpectation);
  assert.ok(controlsExpectation);

  const selectorResults: SelectorResult[] = [
    selector('sportSelect', false),
    selector('marketSelect', false),
    selector('bookSelect', false),
    selector('submitButton', false),
    selector('authError', false),
  ];
  const redirectResult = await redirectExpectation.evaluate({
    ...baseExpectationContext('smart_form', 'submit_pick', 'capper'),
    page: { url: () => 'http://localhost:4100/login' } as never,
    selectorResults,
  });
  const controlsResult = await controlsExpectation.evaluate({
    ...baseExpectationContext('smart_form', 'submit_pick', 'capper'),
    selectorResults,
  });

  assert.equal(redirectResult.status, 'failed');
  assert.match(redirectResult.message, /redirect to \/login before Smart Form controls rendered/i);
  assert.equal(controlsResult.status, 'failed');
  assert.match(controlsResult.message, /Missing form controls: sportSelect, marketSelect, bookSelect, submitButton/);

  const dir = await mkdtemp(join(tmpdir(), 'qa-agent-'));
  try {
    const path = await writeIssueReport(baseResult({
      surface: 'smart_form',
      flow: 'submit_pick',
      persona: 'capper',
      expectationResults: [redirectResult, controlsResult],
      selectorResults,
      uxFriction: [
        'Sport selector not found or not visible',
        'Market type control not found',
        'Book/sportsbook selector not found',
      ],
    }), dir);
    assert.ok(path);
    const report = await readFile(path, 'utf-8');
    assert.match(report, /AUTH_SECRET \/ NEXTAUTH_SECRET/);
    assert.match(report, /auth redirected before the form mounted/);
    assert.doesNotMatch(report, /Recommended Fix[\s\S]*generic selector/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('preflight skip and force semantics are explicit', async () => {
  const checks: QAPreflightCheck[] = [{
    id: 'api_required',
    description: 'Required API dependency is reachable.',
    required: true,
    run: async () => ({
      id: 'api_required',
      status: 'failed' as const,
      required: true,
      message: 'API unavailable',
    }),
  }];

  const skipped = await runPreflightChecks(checks, basePreflightContext(), true);
  assert.deepEqual(skipped, [{
    id: 'api_required',
    status: 'skipped',
    required: true,
    message: 'Skipped by --skip-preflight.',
  }]);
  assert.equal(calculateFinalVerdict({
    stepStatus: 'PASS',
    preflightResults: skipped,
    expectationResults: [],
  }).status, 'PASS');

  const failed = await runPreflightChecks(checks, basePreflightContext(), false);
  const skippedVerdict = calculateFinalVerdict({
    stepStatus: 'PASS',
    preflightResults: failed,
    expectationResults: [],
  });
  assert.equal(skippedVerdict.status, 'SKIP');
  assert.match(skippedVerdict.reason, /Required preflight failed: api_required/);

  const forcedVerdict = calculateFinalVerdict({
    stepStatus: 'PASS',
    preflightResults: failed,
    expectationResults: [],
    force: true,
  });
  assert.equal(forcedVerdict.status, 'NEEDS_REVIEW');
  assert.match(forcedVerdict.reason, /api_required/);
});

test('persona storage state safety is enforced by gitignore and error guidance', async () => {
  const gitignore = await readFile(join(process.cwd(), '.gitignore'), 'utf-8');

  assert.match(gitignore, /^personas\/\*\.json$/m);
  assert.match(gitignore, /^!personas\/\*\.example\.json$/m);
  await assert.rejects(
    () => assertStorageState('unit-talk', 'vip'),
    /pnpm qa:auth --product unit-talk --persona vip/,
  );
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

function baseExpectationContext(
  surfaceId = 'command_center',
  _flow = 'daily_ops',
  personaId = 'operator',
): QAExpectationContext {
  return {
    page: { url: () => 'http://localhost/test' } as never,
    persona: { id: personaId, displayName: personaId, memberTier: 'operator', capabilities: [] },
    surface: { id: surfaceId, displayName: surfaceId, baseUrls: { local: '', staging: '', production: '' } },
    product: { id: 'unit-talk', displayName: 'Unit Talk', surfaces: {} },
    env: 'local' as const,
    skillResult: {
      status: 'PASS' as const,
      steps: [],
      consoleErrors: [],
      networkErrors: [],
      uxFriction: [],
    },
    preflightResults: [],
    selectorResults: [],
    consoleErrors: [],
    network: [],
  };
}

function basePreflightContext(): QAPreflightContext {
  return {
    persona: { id: 'operator', displayName: 'Operator', memberTier: 'operator', capabilities: [] },
    surface: { id: 'command_center', displayName: 'Command Center', baseUrls: { local: '', staging: '', production: '' } },
    product: { id: 'unit-talk', displayName: 'Unit Talk', surfaces: {} },
    env: 'local' as const,
  };
}

function selector(key: string, found: boolean): SelectorResult {
  return {
    key,
    preferred: `[data-testid="${key}"]`,
    preferredFound: found,
    found,
    recommendation: found ? undefined : `Add stable selector for ${key}`,
  };
}
