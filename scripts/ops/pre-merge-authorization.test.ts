import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluatePreMergeAuthorization,
  type PreMergeAuthorizationDeps,
  type PreMergeAuthorizationInput,
} from './pre-merge-authorization.js';
import {
  evaluateRequiredCheckResults,
  type GitHubCheckRun,
  type RequiredCheckIdentity,
} from './truth-check-lib.js';

const INPUT: PreMergeAuthorizationInput = {
  owner: 'griff843',
  repo: 'Unit-Talk-v2',
  prNumber: 1592,
  token: 'test-token',
};

const CURRENT_HEAD_SHA = '05abe4bf3f9c4870137d3dece41a30d1947ba1c3';
const STALE_HEAD_SHA = '17417b95a72c534b262c0cc2a6e3562627380de4';

function approvedVerdictBody(headSha: string, prNumber = INPUT.prNumber): string {
  return [
    'PM_VERDICT: APPROVED',
    'schema: pm-verdict/v1',
    'Issue: UTV2-1592',
    `PR: ${prNumber}`,
    `Head SHA: ${headSha}`,
  ].join('\n');
}

function pmVerdictComment(body: string, overrides: { login?: string; type?: string } = {}) {
  return {
    body,
    user: { login: overrides.login ?? 'griff843', type: overrides.type ?? 'User' },
    html_url: 'https://github.com/griff843/Unit-Talk-v2/pull/1592#issuecomment-1',
    created_at: '2026-07-26T00:00:00.000Z',
  };
}

function checkRun(name: string, conclusion: 'success' | 'failure', id: number): GitHubCheckRun {
  return {
    id,
    name,
    status: 'completed',
    conclusion,
    completed_at: '2026-07-26T00:05:00.000Z',
  };
}

/** Wires deps so the required-check evaluation runs through the real, exported
 * evaluateRequiredCheckResults matcher against a fixed set of check-runs --
 * this is what makes the "exact identity" tests below meaningful rather than
 * trivially injected. */
function depsWithCheckRuns(
  requiredChecks: RequiredCheckIdentity[],
  checkRuns: GitHubCheckRun[],
): Pick<PreMergeAuthorizationDeps, 'fetchRequiredCheckContexts' | 'fetchChecksForSha'> {
  return {
    fetchRequiredCheckContexts: async () => requiredChecks,
    fetchChecksForSha: async () =>
      evaluateRequiredCheckResults({ requiredChecks, statuses: [], checkRuns }),
  };
}

const GREEN_REQUIRED_CHECKS: RequiredCheckIdentity[] = [
  { context: 'Merge Gate', app_id: null },
  { context: 'Executor Result Validation', app_id: null },
];

const GREEN_CHECK_RUNS: GitHubCheckRun[] = [
  checkRun('Merge Gate', 'success', 1),
  checkRun('Executor Result Validation', 'success', 2),
];

test('green path: all required checks pass with exact identity and a valid current-head PM verdict authorizes the merge', async () => {
  const deps: PreMergeAuthorizationDeps = {
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, GREEN_CHECK_RUNS),
    fetchComments: async () => [pmVerdictComment(approvedVerdictBody(CURRENT_HEAD_SHA))],
    fetchHeadSha: async () => CURRENT_HEAD_SHA,
  };

  const receipt = await evaluatePreMergeAuthorization(INPUT, deps);

  assert.strictEqual(receipt.authorized, true);
  assert.strictEqual(receipt.headSha, CURRENT_HEAD_SHA);
  assert.strictEqual(receipt.pmVerdict.valid, true);
  assert.strictEqual(receipt.pmVerdict.parsedHeadSha, CURRENT_HEAD_SHA);
  assert.strictEqual(receipt.reason, undefined);
  assert.ok(receipt.requiredChecks.every((entry) => entry.passed));
});

test("reproduces a prior lane's incident as a fixture: a required context absent entirely (not failing -- missing) rejects the merge", async () => {
  // "Executor Result Validation" is required but never appears in the
  // check-run results at all (matched: false, source: null) -- exactly the
  // shape of that incident, as opposed to a context that ran and failed.
  const requiredChecks: RequiredCheckIdentity[] = [
    { context: 'Merge Gate', app_id: null },
    { context: 'Executor Result Validation', app_id: null },
  ];
  const checkRuns: GitHubCheckRun[] = [checkRun('Merge Gate', 'success', 1)];

  const deps: PreMergeAuthorizationDeps = {
    ...depsWithCheckRuns(requiredChecks, checkRuns),
    fetchComments: async () => [pmVerdictComment(approvedVerdictBody(CURRENT_HEAD_SHA))],
    fetchHeadSha: async () => CURRENT_HEAD_SHA,
  };

  const receipt = await evaluatePreMergeAuthorization(INPUT, deps);

  assert.strictEqual(receipt.authorized, false);
  assert.match(receipt.reason ?? '', /Executor Result Validation/);
  const missingEntry = receipt.requiredChecks.find((entry) => entry.context === 'Executor Result Validation');
  assert.ok(missingEntry, 'expected a receipt entry for Executor Result Validation');
  assert.strictEqual(missingEntry?.matched, false);
  assert.strictEqual(missingEntry?.source, null);
});

test('"Merge Gate Evaluator" succeeding is never accepted as a substitute for the "Merge Gate" check itself', async () => {
  // Only the job name "Merge Gate Evaluator" reports success; the actual
  // "Merge Gate" custom check context never appears. If these were ever
  // conflated, this would incorrectly authorize the merge.
  const requiredChecks: RequiredCheckIdentity[] = [{ context: 'Merge Gate', app_id: null }];
  const checkRuns: GitHubCheckRun[] = [checkRun('Merge Gate Evaluator', 'success', 9)];

  const deps: PreMergeAuthorizationDeps = {
    ...depsWithCheckRuns(requiredChecks, checkRuns),
    fetchComments: async () => [pmVerdictComment(approvedVerdictBody(CURRENT_HEAD_SHA))],
    fetchHeadSha: async () => CURRENT_HEAD_SHA,
  };

  const receipt = await evaluatePreMergeAuthorization(INPUT, deps);

  assert.strictEqual(receipt.authorized, false);
  const mergeGateEntry = receipt.requiredChecks.find((entry) => entry.context === 'Merge Gate');
  assert.strictEqual(mergeGateEntry?.matched, false);
  assert.strictEqual(mergeGateEntry?.passed, false);
  // The evaluator job must never even be reported against the required
  // "Merge Gate" context -- there is no candidate for it at all.
  assert.strictEqual(mergeGateEntry?.candidateId, null);
});

test('a malformed PM verdict (missing the Head SHA field) rejects the merge', async () => {
  const malformedBody = ['PM_VERDICT: APPROVED', 'schema: pm-verdict/v1', 'Issue: UTV2-1592', `PR: ${INPUT.prNumber}`].join(
    '\n',
  );
  const deps: PreMergeAuthorizationDeps = {
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, GREEN_CHECK_RUNS),
    fetchComments: async () => [pmVerdictComment(malformedBody)],
    fetchHeadSha: async () => CURRENT_HEAD_SHA,
  };

  const receipt = await evaluatePreMergeAuthorization(INPUT, deps);

  assert.strictEqual(receipt.authorized, false);
  assert.strictEqual(receipt.pmVerdict.valid, false);
  assert.match(receipt.reason ?? '', /Head SHA/);
});

test('a schema-valid PM verdict bound to a stale head SHA (a push landed after approval) rejects the merge', async () => {
  const deps: PreMergeAuthorizationDeps = {
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, GREEN_CHECK_RUNS),
    fetchComments: async () => [pmVerdictComment(approvedVerdictBody(STALE_HEAD_SHA))],
    fetchHeadSha: async () => CURRENT_HEAD_SHA,
  };

  const receipt = await evaluatePreMergeAuthorization(INPUT, deps);

  assert.strictEqual(receipt.authorized, false);
  assert.strictEqual(receipt.pmVerdict.valid, false);
  assert.strictEqual(receipt.pmVerdict.parsedHeadSha, STALE_HEAD_SHA);
  assert.strictEqual(receipt.headSha, CURRENT_HEAD_SHA);
  assert.match(receipt.reason ?? '', /stale/i);
});

test('race-prevention: the head SHA is re-fetched fresh on every call, and it is the last fetch performed before the decision', async () => {
  const shas = ['sha-from-first-call', 'sha-from-second-call'];
  let headShaCallIndex = 0;
  const fetchOrder: string[] = [];

  const deps: PreMergeAuthorizationDeps = {
    fetchRequiredCheckContexts: async () => {
      fetchOrder.push('requiredChecks');
      return GREEN_REQUIRED_CHECKS;
    },
    fetchComments: async () => {
      fetchOrder.push('comments');
      // Approve against whichever head SHA this call is about to resolve to,
      // so the only thing under test is freshness/ordering of the head-SHA
      // fetch itself, not verdict staleness.
      const sha = shas[headShaCallIndex];
      return [pmVerdictComment(approvedVerdictBody(sha))];
    },
    fetchChecksForSha: async () =>
      evaluateRequiredCheckResults({
        requiredChecks: GREEN_REQUIRED_CHECKS,
        statuses: [],
        checkRuns: GREEN_CHECK_RUNS.map((run) => ({ ...run })),
      }),
    fetchHeadSha: async () => {
      fetchOrder.push('headSha');
      const sha = shas[headShaCallIndex];
      headShaCallIndex += 1;
      return sha;
    },
  };

  const first = await evaluatePreMergeAuthorization(INPUT, deps);
  assert.strictEqual(first.headSha, 'sha-from-first-call');
  assert.strictEqual(first.authorized, true);

  const second = await evaluatePreMergeAuthorization(INPUT, deps);
  assert.strictEqual(second.headSha, 'sha-from-second-call');
  assert.strictEqual(second.authorized, true);

  // The head-SHA fetch must be the LAST fetch performed within each call --
  // proving the decision is made against the freshest possible state, not a
  // value captured earlier and left to go stale.
  assert.strictEqual(fetchOrder.length, 6);
  assert.deepStrictEqual(fetchOrder.slice(0, 3), ['requiredChecks', 'comments', 'headSha']);
  assert.deepStrictEqual(fetchOrder.slice(3, 6), ['requiredChecks', 'comments', 'headSha']);
});

test('allowAdminMergeGateBypass is never applied pre-merge: a Merge-Gate-only failure is not bypassed', async () => {
  // Mirrors the post-merge admin-bypass shape (only "Merge Gate"-family
  // checks missing) to prove that shape is NOT special-cased here the way
  // truth-check-lib's post-merge path special-cases it.
  const requiredChecks: RequiredCheckIdentity[] = [{ context: 'Merge Gate', app_id: null }];
  const checkRuns: GitHubCheckRun[] = [];

  const deps: PreMergeAuthorizationDeps = {
    ...depsWithCheckRuns(requiredChecks, checkRuns),
    fetchComments: async () => [pmVerdictComment(approvedVerdictBody(CURRENT_HEAD_SHA))],
    fetchHeadSha: async () => CURRENT_HEAD_SHA,
  };

  const receipt = await evaluatePreMergeAuthorization(INPUT, deps);

  assert.strictEqual(receipt.authorized, false);
  assert.match(receipt.reason ?? '', /Merge Gate/);
});

test('no pm-verdict/v1 comment at all rejects the merge even when required checks pass', async () => {
  const deps: PreMergeAuthorizationDeps = {
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, GREEN_CHECK_RUNS),
    fetchComments: async () => [],
    fetchHeadSha: async () => CURRENT_HEAD_SHA,
  };

  const receipt = await evaluatePreMergeAuthorization(INPUT, deps);

  assert.strictEqual(receipt.authorized, false);
  assert.strictEqual(receipt.pmVerdict.valid, false);
  assert.strictEqual(receipt.pmVerdict.commentUrl, null);
  assert.match(receipt.reason ?? '', /pm-verdict\/v1/);
});

test('an unresolvable head SHA fails closed instead of skipping the check', async () => {
  const deps: PreMergeAuthorizationDeps = {
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, GREEN_CHECK_RUNS),
    fetchComments: async () => [pmVerdictComment(approvedVerdictBody(CURRENT_HEAD_SHA))],
    fetchHeadSha: async () => null,
  };

  const receipt = await evaluatePreMergeAuthorization(INPUT, deps);

  assert.strictEqual(receipt.authorized, false);
  assert.ok(receipt.reason);
});
