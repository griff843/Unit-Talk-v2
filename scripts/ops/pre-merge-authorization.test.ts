import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './shared.js';
import {
  evaluatePreMergeAuthorization,
  isMergeGateGreenOnHead,
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

// ─────────────────────────────────────────────────────────────────────────────
// UTV2-1661: tier-aware pm-verdict requirement.
//
// `authorized` used to unconditionally AND in `pmVerdict.valid`, which
// double-gated T2/T3 PRs against a rule that only applies to T1. Per CLAUDE.md,
// only T1 requires a pm-verdict/v1 comment; T2 is satisfied by a GitHub review
// approval OR a verdict, and T3 by green CI alone -- and the "Merge Gate"
// required check (already evaluated above) is the ratified encoder of that
// per-tier OR-logic.
// ─────────────────────────────────────────────────────────────────────────────

function stateDeps(
  labels: string[],
  manifestTier: string | null = null,
): Pick<PreMergeAuthorizationDeps, 'fetchPullRequestState' | 'fetchLaneManifestAtHead'> {
  return {
    fetchPullRequestState: async () => ({
      headSha: CURRENT_HEAD_SHA,
      labels,
      headRef: 'codex/utv2-1661-tier-aware-merge-authorization',
    }),
    fetchLaneManifestAtHead: async () => (manifestTier === null ? null : { tier: manifestTier }),
  };
}

test('UTV2-1661 regression: a T2 PR with all required checks green and NO pm-verdict is authorized', async () => {
  const receipt = await evaluatePreMergeAuthorization(INPUT, {
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, GREEN_CHECK_RUNS),
    ...stateDeps(['tier:T2'], 'T2'),
    fetchComments: async () => [],
  });

  assert.strictEqual(receipt.authorized, true);
  assert.strictEqual(receipt.tier.resolved, 'T2');
  assert.strictEqual(receipt.tier.source, 'lane_manifest');
  assert.strictEqual(receipt.tier.pmVerdictRequired, false);
  // The T1-only message must not appear on a T2 PR -- that was the live symptom.
  assert.strictEqual(receipt.reason, undefined);
});

test('UTV2-1661: a T3 PR with all required checks green and no pm-verdict is authorized', async () => {
  const receipt = await evaluatePreMergeAuthorization(INPUT, {
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, GREEN_CHECK_RUNS),
    ...stateDeps(['tier:T3'], 'T3'),
    fetchComments: async () => [],
  });

  assert.strictEqual(receipt.authorized, true);
  assert.strictEqual(receipt.tier.resolved, 'T3');
  assert.strictEqual(receipt.tier.pmVerdictRequired, false);
});

test('UTV2-1661: a T1 PR with all required checks green but NO pm-verdict is still refused', async () => {
  const receipt = await evaluatePreMergeAuthorization(INPUT, {
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, GREEN_CHECK_RUNS),
    ...stateDeps(['tier:T1'], 'T1'),
    fetchComments: async () => [],
  });

  assert.strictEqual(receipt.authorized, false);
  assert.strictEqual(receipt.tier.resolved, 'T1');
  assert.strictEqual(receipt.tier.pmVerdictRequired, true);
});

test('UTV2-1661 fail-closed: an UNLABELLED PR is held to the strict T1 rule, not relaxed', async () => {
  const receipt = await evaluatePreMergeAuthorization(INPUT, {
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, GREEN_CHECK_RUNS),
    ...stateDeps([], null),
    fetchComments: async () => [],
  });

  assert.strictEqual(receipt.authorized, false);
  assert.strictEqual(receipt.tier.resolved, null);
  assert.strictEqual(receipt.tier.source, 'unresolved');
  assert.strictEqual(receipt.tier.pmVerdictRequired, true);
});

test('UTV2-1661 fail-closed: a malformed tier label does not resolve and does not relax the gate', async () => {
  const receipt = await evaluatePreMergeAuthorization(INPUT, {
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, GREEN_CHECK_RUNS),
    ...stateDeps(['tier:T4', 'tier-T2', 'T2'], null),
    fetchComments: async () => [],
  });

  assert.strictEqual(receipt.authorized, false);
  assert.strictEqual(receipt.tier.resolved, null);
  assert.strictEqual(receipt.tier.pmVerdictRequired, true);
});

test('UTV2-1661: tier never overrides required checks -- a T3 PR with a failing check is refused', async () => {
  const receipt = await evaluatePreMergeAuthorization(INPUT, {
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, [
      checkRun('Merge Gate', 'failure', 1),
      checkRun('Executor Result Validation', 'success', 2),
    ]),
    ...stateDeps(['tier:T3'], 'T3'),
    fetchComments: async () => [],
  });

  assert.strictEqual(receipt.authorized, false);
  assert.match(receipt.reason ?? '', /required checks missing or failing/);
});

test('UTV2-1661: the legacy fetchHeadSha dep surfaces no labels, so it stays on the strict path', async () => {
  const receipt = await evaluatePreMergeAuthorization(INPUT, {
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, GREEN_CHECK_RUNS),
    fetchHeadSha: async () => CURRENT_HEAD_SHA,
    fetchComments: async () => [],
  });

  assert.strictEqual(receipt.authorized, false);
  assert.strictEqual(receipt.tier.resolved, null);
  assert.strictEqual(receipt.tier.pmVerdictRequired, true);
});

test('UTV2-1661: a stale-SHA verdict on a T2 PR is recorded but is not merge-blocking', async () => {
  const receipt = await evaluatePreMergeAuthorization(INPUT, {
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, GREEN_CHECK_RUNS),
    ...stateDeps(['tier:T2'], 'T2'),
    fetchComments: async () => [pmVerdictComment(approvedVerdictBody(STALE_HEAD_SHA))],
  });

  assert.strictEqual(receipt.authorized, true);
  assert.strictEqual(receipt.pmVerdict.valid, false);
  assert.strictEqual(receipt.pmVerdict.parsedHeadSha, STALE_HEAD_SHA);
  assert.strictEqual(receipt.reason, undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// UTV2-1661 correction round. Two changes to the authority model:
//   (a) the tier comes from the LANE MANIFEST at the PR head; PR labels are
//       mirrored evidence only and can never be what relaxes T1 authority;
//   (b) relaxation additionally requires the exact `Merge Gate` context to be
//       present and green ON THE CURRENT HEAD, closing the relabel/check race.
// ─────────────────────────────────────────────────────────────────────────────

test('UTV2-1661: a T1 manifest with a mutable T2 label cannot relax authority', async () => {
  const receipt = await evaluatePreMergeAuthorization(INPUT, {
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, GREEN_CHECK_RUNS),
    ...stateDeps(['tier:T2'], 'T1'),
    fetchComments: async () => [],
  });

  assert.strictEqual(receipt.authorized, false, 'a label must never downgrade a T1 lane');
  assert.strictEqual(receipt.tier.resolved, 'T1');
  assert.strictEqual(receipt.tier.source, 'lane_manifest');
  assert.strictEqual(receipt.tier.labelTier, 'T2');
  assert.strictEqual(receipt.tier.pmVerdictRequired, true);
});

test('UTV2-1661: manifest/label disagreement fails closed even when both are non-T1', async () => {
  const receipt = await evaluatePreMergeAuthorization(INPUT, {
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, GREEN_CHECK_RUNS),
    ...stateDeps(['tier:T3'], 'T2'),
    fetchComments: async () => [],
  });

  assert.strictEqual(receipt.authorized, false, 'disagreement means the classification is unproven');
  assert.strictEqual(receipt.tier.labelDisagreement, true);
  assert.strictEqual(receipt.tier.pmVerdictRequired, true);
});

test('UTV2-1661: a T2 manifest with Merge Gate MISSING from required-check discovery fails closed', async () => {
  // Discovery returns only Executor Result Validation -- no Merge Gate identity at all.
  const receipt = await evaluatePreMergeAuthorization(INPUT, {
    ...depsWithCheckRuns(
      [{ context: 'Executor Result Validation', app_id: null }],
      [checkRun('Executor Result Validation', 'success', 2)],
    ),
    ...stateDeps(['tier:T2'], 'T2'),
    fetchComments: async () => [],
  });

  assert.strictEqual(receipt.authorized, false, 'an omitted Merge Gate must not silently relax the gate');
  assert.strictEqual(receipt.tier.mergeGateGreenOnHead, false);
  assert.strictEqual(receipt.tier.pmVerdictRequired, true);
});

test('UTV2-1661: a T2 manifest with an empty required-check set fails closed', async () => {
  const receipt = await evaluatePreMergeAuthorization(INPUT, {
    ...depsWithCheckRuns([], []),
    ...stateDeps(['tier:T2'], 'T2'),
    fetchComments: async () => [],
  });

  assert.strictEqual(receipt.authorized, false, 'an empty evidence set is not proof of a green Merge Gate');
  assert.strictEqual(receipt.tier.mergeGateGreenOnHead, false);
});

test('UTV2-1661: a T2 manifest with a stale / non-current-head Merge Gate fails closed', async () => {
  // Merge Gate is required but produced no run on THIS head, so it cannot be
  // bound to the current head -- exactly the relabel/check race being closed.
  const receipt = await evaluatePreMergeAuthorization(INPUT, {
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, [
      checkRun('Executor Result Validation', 'success', 2),
    ]),
    ...stateDeps(['tier:T2'], 'T2'),
    fetchComments: async () => [],
  });

  assert.strictEqual(receipt.authorized, false);
  assert.strictEqual(receipt.tier.mergeGateGreenOnHead, false);
  assert.strictEqual(receipt.tier.pmVerdictRequired, true);
});

test('UTV2-1661: a T2 manifest with a current-head GREEN Merge Gate and no verdict is authorized', async () => {
  const receipt = await evaluatePreMergeAuthorization(INPUT, {
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, GREEN_CHECK_RUNS),
    ...stateDeps(['tier:T2'], 'T2'),
    fetchComments: async () => [],
  });

  assert.strictEqual(receipt.authorized, true);
  assert.strictEqual(receipt.tier.mergeGateGreenOnHead, true);
  assert.strictEqual(receipt.tier.pmVerdictRequired, false);
  assert.strictEqual(receipt.reason, undefined);
});

test('UTV2-1661: a manifest read failure fails closed rather than relaxing', async () => {
  const receipt = await evaluatePreMergeAuthorization(INPUT, {
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, GREEN_CHECK_RUNS),
    fetchPullRequestState: async () => ({
      headSha: CURRENT_HEAD_SHA,
      labels: ['tier:T2'],
      headRef: 'codex/utv2-1661-tier-aware-merge-authorization',
    }),
    fetchLaneManifestAtHead: async () => {
      throw new Error('HTTP 401: Bad credentials');
    },
    fetchComments: async () => [],
  });

  assert.strictEqual(receipt.authorized, false);
  assert.strictEqual(receipt.tier.resolved, null);
  assert.strictEqual(receipt.tier.source, 'unresolved');
  assert.strictEqual(receipt.tier.pmVerdictRequired, true);
});

test('UTV2-1661: isMergeGateGreenOnHead is exact-identity and fails closed on ambiguity', () => {
  assert.strictEqual(isMergeGateGreenOnHead([{ context: 'Merge Gate', matched: true, passed: true }]), true);
  assert.strictEqual(isMergeGateGreenOnHead([{ context: 'Merge Gate', matched: true, passed: false }]), false);
  assert.strictEqual(isMergeGateGreenOnHead([{ context: 'Merge Gate', matched: false, passed: true }]), false);
  // "Merge Gate Evaluator" is the job name, never a substitute for the context.
  assert.strictEqual(
    isMergeGateGreenOnHead([{ context: 'Merge Gate Evaluator', matched: true, passed: true }]),
    false,
  );
  // Duplicate identities are ambiguous.
  assert.strictEqual(
    isMergeGateGreenOnHead([
      { context: 'Merge Gate', matched: true, passed: true },
      { context: 'Merge Gate', matched: true, passed: false },
    ]),
    false,
  );
  assert.strictEqual(isMergeGateGreenOnHead([]), false);
  assert.strictEqual(isMergeGateGreenOnHead(null), false);
});

test('UTV2-1661: the corrected lane manifest records the Codex executor identity, not claude', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'docs', '06_status', 'lanes', 'UTV2-1661.json'), 'utf8'),
  ) as { executor: string; created_by: string; branch: string };

  assert.strictEqual(manifest.executor, 'codex-cli');
  assert.strictEqual(manifest.created_by, 'codex-cli');
  assert.match(
    manifest.branch,
    /^codex\//,
    'the routing identity in the manifest must match the codex/ branch it runs on',
  );
});
