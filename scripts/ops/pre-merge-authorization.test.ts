import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './shared.js';
import {
  evaluatePreMergeAuthorization,
  isMergeGateGreenOnHead,
  defaultFetchLaneManifestAtHead,
  decodeLaneManifestPayload,
  resolveTierFromManifest,
  pmVerdictRequiredForTier,
  LaneManifestLookupError,
  type PreMergeAuthorizationDeps,
  type PreMergeAuthorizationInput,
  resolveBootstrapTier,
  isBootstrapDiffInScope,
  BOOTSTRAP_ALLOWED_FILES,
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

// RMA/v1: `Merge Gate` required but with no run on THIS head. Required-check
// evaluation fails on it AND `mergeGateGreenOnHead` is false, so the verdict
// requirement stays in force -- the fixture for every "the defect still blocks"
// counterpart below.
const NO_MERGE_GATE_ON_HEAD: GitHubCheckRun[] = [checkRun('Executor Result Validation', 'success', 2)];

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

  // The defect is still detected and recorded. Whether it BLOCKS is RMA/v1's
  // question, not this module's: a green `Merge Gate` on this exact head means
  // the ratified gate already decided the verdict was not required here.
  assert.strictEqual(receipt.pmVerdict.valid, false);
  assert.strictEqual(receipt.authorized, true);

  const withoutGate = await evaluatePreMergeAuthorization(INPUT, {
    ...deps,
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, NO_MERGE_GATE_ON_HEAD),
  });
  assert.strictEqual(withoutGate.authorized, false);
  assert.match(withoutGate.reason ?? '', /Head SHA/);
});

test('a schema-valid PM verdict bound to a stale head SHA (a push landed after approval) rejects the merge', async () => {
  const deps: PreMergeAuthorizationDeps = {
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, GREEN_CHECK_RUNS),
    fetchComments: async () => [pmVerdictComment(approvedVerdictBody(STALE_HEAD_SHA))],
    fetchHeadSha: async () => CURRENT_HEAD_SHA,
  };

  const receipt = await evaluatePreMergeAuthorization(INPUT, deps);

  assert.strictEqual(receipt.pmVerdict.valid, false);
  assert.strictEqual(receipt.pmVerdict.parsedHeadSha, STALE_HEAD_SHA);
  assert.strictEqual(receipt.headSha, CURRENT_HEAD_SHA);
  assert.strictEqual(receipt.authorized, true, 'Merge Gate is green on this head, so RMA already decided');

  const withoutGate = await evaluatePreMergeAuthorization(INPUT, {
    ...deps,
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, NO_MERGE_GATE_ON_HEAD),
  });
  assert.strictEqual(withoutGate.authorized, false);
  assert.match(withoutGate.reason ?? '', /stale/i);
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

test('RMA/v1: a missing pm-verdict blocks exactly when Merge Gate is not green on this head', async () => {
  const deps: PreMergeAuthorizationDeps = {
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, GREEN_CHECK_RUNS),
    fetchComments: async () => [],
    fetchHeadSha: async () => CURRENT_HEAD_SHA,
  };

  const receipt = await evaluatePreMergeAuthorization(INPUT, deps);

  assert.strictEqual(receipt.pmVerdict.valid, false);
  assert.strictEqual(receipt.pmVerdict.commentUrl, null);
  // A diff that needed a verdict could not have produced a green Merge Gate on
  // this head, so demanding one again here only blocks the `auto` diffs the
  // gate deliberately cleared.
  assert.strictEqual(receipt.authorized, true);

  const withoutGate = await evaluatePreMergeAuthorization(INPUT, {
    ...deps,
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, NO_MERGE_GATE_ON_HEAD),
  });
  assert.strictEqual(withoutGate.authorized, false);
  assert.match(withoutGate.reason ?? '', /pm-verdict\/v1/);
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

test('RMA/v1: a T1 manifest is recorded but no longer decides -- Merge Gate does', async () => {
  // Pre-RMA this was refused on the manifest tier alone. Under RMA the reserved
  // surfaces decide, and a `human` diff cannot have produced the green
  // `Merge Gate` this fixture asserts: the gate itself required the label and
  // the head-bound verdict before going green.
  const receipt = await evaluatePreMergeAuthorization(INPUT, {
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, GREEN_CHECK_RUNS),
    ...stateDeps(['tier:T1'], 'T1'),
    fetchComments: async () => [],
  });

  assert.strictEqual(receipt.authorized, true);
  assert.strictEqual(receipt.tier.resolved, 'T1', 'the tier is still recorded for diagnostics');
  assert.strictEqual(receipt.tier.pmVerdictRequired, false);

  const withoutGate = await evaluatePreMergeAuthorization(INPUT, {
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, NO_MERGE_GATE_ON_HEAD),
    ...stateDeps(['tier:T1'], 'T1'),
    fetchComments: async () => [],
  });
  assert.strictEqual(withoutGate.authorized, false);
  assert.strictEqual(withoutGate.tier.pmVerdictRequired, true);
});

test('RMA/v1: an unlabelled, manifest-less PR is the normal case, not a fail-closed one', async () => {
  // The mission-native shape: no tier label, no lane manifest, nothing to look
  // one up by. Pre-RMA this was unmergeable through the sanctioned wrapper
  // however green it was -- the deadlock this change exists to remove.
  const receipt = await evaluatePreMergeAuthorization(INPUT, {
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, GREEN_CHECK_RUNS),
    ...stateDeps([], null),
    fetchComments: async () => [],
  });

  assert.strictEqual(receipt.authorized, true);
  assert.strictEqual(receipt.tier.resolved, null);
  assert.strictEqual(receipt.tier.source, 'unresolved');
  assert.strictEqual(receipt.tier.pmVerdictRequired, false);
});

test('RMA/v1: a malformed tier label neither resolves nor changes the decision', async () => {
  const receipt = await evaluatePreMergeAuthorization(INPUT, {
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, GREEN_CHECK_RUNS),
    ...stateDeps(['tier:T4', 'tier-T2', 'T2'], null),
    fetchComments: async () => [],
  });

  assert.strictEqual(receipt.tier.resolved, null);
  assert.strictEqual(receipt.authorized, true, 'labels are not an input to merge authority any more');

  const withoutGate = await evaluatePreMergeAuthorization(INPUT, {
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, NO_MERGE_GATE_ON_HEAD),
    ...stateDeps(['tier:T4', 'tier-T2', 'T2'], null),
    fetchComments: async () => [],
  });
  assert.strictEqual(withoutGate.authorized, false);
  assert.strictEqual(withoutGate.tier.pmVerdictRequired, true);
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

test('RMA/v1: the legacy fetchHeadSha dep surfaces no labels, and no longer needs to', async () => {
  const receipt = await evaluatePreMergeAuthorization(INPUT, {
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, GREEN_CHECK_RUNS),
    fetchHeadSha: async () => CURRENT_HEAD_SHA,
    fetchComments: async () => [],
  });

  assert.strictEqual(receipt.tier.resolved, null);
  assert.strictEqual(receipt.authorized, true);
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

test('RMA/v1: manifest/label disagreement is still recorded, and no longer decides', async () => {
  // Both halves of the old rule -- "a label may not downgrade a T1 lane" and
  // "disagreement is unproven classification" -- protected a tier input that
  // merge authority no longer reads. The receipt keeps reporting the
  // disagreement; what it cannot do is block a diff Merge Gate cleared.
  const receipt = await evaluatePreMergeAuthorization(INPUT, {
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, GREEN_CHECK_RUNS),
    ...stateDeps(['tier:T2'], 'T1'),
    fetchComments: async () => [],
  });

  assert.strictEqual(receipt.tier.resolved, 'T1');
  assert.strictEqual(receipt.tier.source, 'lane_manifest');
  assert.strictEqual(receipt.tier.labelTier, 'T2');
  assert.strictEqual(receipt.tier.labelDisagreement, true);
  assert.strictEqual(receipt.authorized, true);

  const withoutGate = await evaluatePreMergeAuthorization(INPUT, {
    ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, NO_MERGE_GATE_ON_HEAD),
    ...stateDeps(['tier:T3'], 'T2'),
    fetchComments: async () => [],
  });
  assert.strictEqual(withoutGate.authorized, false);
  assert.strictEqual(withoutGate.tier.labelDisagreement, true);
  assert.strictEqual(withoutGate.tier.pmVerdictRequired, true);
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

test('RMA/v1: a manifest read failure is recorded and no longer decides', async () => {
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

  // A manifest read failure no longer changes the decision, because the
  // manifest no longer feeds it. The receipt still records the failure to
  // resolve, and `Merge Gate` remains the thing that must be green.
  assert.strictEqual(receipt.tier.resolved, null);
  assert.strictEqual(receipt.tier.source, 'unresolved');
  assert.strictEqual(receipt.authorized, true);
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

// ─────────────────────────────────────────────────────────────────────────────
// UTV2-1661 production-wiring round. The default fetchLaneManifestAtHead used
// to be `async () => null`, so real CLI execution could never resolve a T2/T3
// manifest and the original double-gate survived in production even though the
// injected-fixture tests all passed. These exercise the DEFAULT path.
// ─────────────────────────────────────────────────────────────────────────────

const MANIFEST_INPUT = { ...INPUT, issueId: 'UTV2-1661', headSha: CURRENT_HEAD_SHA };

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

function withStubbedFetch<T>(stub: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

test('UTV2-1661 default path: reads the manifest at the EXACT head SHA, not the branch ref', async () => {
  let requestedUrl = '';
  const manifest = await withStubbedFetch(
    (async (url: string) => {
      requestedUrl = String(url);
      return jsonResponse(200, { content: b64({ issue_id: 'UTV2-1661', tier: 'T2' }) });
    }) as unknown as typeof fetch,
    () => defaultFetchLaneManifestAtHead(MANIFEST_INPUT),
  );

  assert.strictEqual(resolveTierFromManifest(manifest), 'T2');
  assert.match(requestedUrl, /docs\/06_status\/lanes\/UTV2-1661\.json/);
  assert.match(
    requestedUrl,
    new RegExp(`ref=${CURRENT_HEAD_SHA}`),
    'the manifest must be pinned to the exact head SHA -- a branch ref moves',
  );
});

test('UTV2-1661 default path: a confirmed 404 resolves to unresolved/strict, not an error', async () => {
  const manifest = await withStubbedFetch(
    (async () => jsonResponse(404, { message: 'Not Found' })) as unknown as typeof fetch,
    () => defaultFetchLaneManifestAtHead(MANIFEST_INPUT),
  );

  assert.strictEqual(manifest, null);
  assert.strictEqual(resolveTierFromManifest(manifest), null);
  // RMA/v1: an absent manifest no longer forces a verdict. Merge authority is
  // decided once, by Merge Gate, from what the diff touches -- and a
  // mission-native branch has no tracker id to look a manifest up by at all, so
  // keying the requirement off manifest absence would block every such PR
  // permanently. The requirement now rests entirely on Merge Gate's own
  // head-bound result.
  assert.strictEqual(
    pmVerdictRequiredForTier({ manifestTier: null, labelTier: 'T2', mergeGateGreenOnHead: true }),
    false,
    'with Merge Gate green on this exact head, the RMA decision is already satisfied',
  );
  assert.strictEqual(
    pmVerdictRequiredForTier({ manifestTier: null, labelTier: 'T2', mergeGateGreenOnHead: false }),
    true,
    'without a green Merge Gate on this head, the requirement stays in force',
  );
});

test('RMA/v1: no tier value can relax the verdict requirement on its own', () => {
  for (const manifestTier of [null, 'T1', 'T2', 'T3'] as const) {
    for (const labelTier of [null, 'T1', 'T2', 'T3'] as const) {
      assert.strictEqual(
        pmVerdictRequiredForTier({ manifestTier, labelTier, mergeGateGreenOnHead: false }),
        true,
        `tier ${manifestTier}/${labelTier} must not relax the requirement without a green Merge Gate`,
      );
      assert.strictEqual(
        pmVerdictRequiredForTier({ manifestTier, labelTier, mergeGateGreenOnHead: true }),
        false,
        `tier ${manifestTier}/${labelTier} must not re-impose it once Merge Gate is green on head`,
      );
    }
  }
});

for (const status of [401, 403, 429, 500, 502, 503]) {
  test(`UTV2-1661 default path: HTTP ${status} fails closed rather than resolving a tier`, async () => {
    await assert.rejects(
      withStubbedFetch(
        (async () => jsonResponse(status, { message: 'nope' })) as unknown as typeof fetch,
        () => defaultFetchLaneManifestAtHead(MANIFEST_INPUT),
      ),
      (error: unknown) => {
        assert.ok(error instanceof LaneManifestLookupError);
        assert.strictEqual(error.code, 'lane_manifest_lookup_failed');
        return true;
      },
    );
  });
}

test('UTV2-1661 default path: a network failure fails closed', async () => {
  await assert.rejects(
    withStubbedFetch(
      (async () => {
        throw new Error('could not resolve host: api.github.com');
      }) as unknown as typeof fetch,
      () => defaultFetchLaneManifestAtHead(MANIFEST_INPUT),
    ),
    LaneManifestLookupError,
  );
});

test('UTV2-1661 default path: malformed base64 / JSON / identity mismatch each fail closed', () => {
  assert.throws(
    () => decodeLaneManifestPayload({ content: '' }, 'UTV2-1661'),
    LaneManifestLookupError,
    'an empty body is not a tier',
  );
  assert.throws(
    () => decodeLaneManifestPayload({ content: Buffer.from('not json', 'utf8').toString('base64') }, 'UTV2-1661'),
    LaneManifestLookupError,
    'a malformed manifest is an unknown tier, not a T2/T3 one',
  );
  assert.throws(
    () => decodeLaneManifestPayload({ content: b64({ issue_id: 'UTV2-9999', tier: 'T3' }) }, 'UTV2-1661'),
    LaneManifestLookupError,
    'a manifest for a different issue must never supply this lane its tier',
  );
});

test('UTV2-1661 integration: the default path drives a real T2 authorization end-to-end', async () => {
  const receipt = await withStubbedFetch(
    (async () => jsonResponse(200, { content: b64({ issue_id: 'UTV2-1661', tier: 'T2' }) })) as unknown as typeof fetch,
    () =>
      evaluatePreMergeAuthorization(INPUT, {
        ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, GREEN_CHECK_RUNS),
        // NOTE: fetchLaneManifestAtHead deliberately NOT injected -- this
        // exercises the production default that previously returned null.
        fetchPullRequestState: async () => ({
          headSha: CURRENT_HEAD_SHA,
          labels: ['tier:T2'],
          headRef: 'codex/utv2-1661-tier-aware-merge-authorization',
        }),
        fetchComments: async () => [],
      }),
  );

  assert.strictEqual(receipt.authorized, true, 'the default production path must resolve T2 and relax the verdict');
  assert.strictEqual(receipt.tier.resolved, 'T2');
  assert.strictEqual(receipt.tier.source, 'lane_manifest');
  assert.strictEqual(receipt.tier.mergeGateGreenOnHead, true);
});

test('RMA/v1 integration: the default manifest path still resolves the tier for the receipt', async () => {
  const receipt = await withStubbedFetch(
    (async () => jsonResponse(200, { content: b64({ issue_id: 'UTV2-1661', tier: 'T1' }) })) as unknown as typeof fetch,
    () =>
      evaluatePreMergeAuthorization(INPUT, {
        ...depsWithCheckRuns(GREEN_REQUIRED_CHECKS, GREEN_CHECK_RUNS),
        fetchPullRequestState: async () => ({
          headSha: CURRENT_HEAD_SHA,
          labels: ['tier:T2'],
          headRef: 'codex/utv2-1661-tier-aware-merge-authorization',
        }),
        fetchComments: async () => [],
      }),
  );

  assert.strictEqual(receipt.tier.resolved, 'T1');
  assert.strictEqual(receipt.tier.labelDisagreement, true);
  assert.strictEqual(receipt.authorized, true, 'the resolved tier is diagnostic, not authority');
});

// ── UTV2-1619 capability 19: bootstrap identity in the merge wrapper ──────────
// The merge wrapper is a second, independent authority. These assertions exist
// because a bootstrap PR passed every required check and was still refused here,
// which reintroduced the deadlock at the final step.

const BOOTSTRAP_NOW = new Date('2026-08-05T00:00:00Z');

function bootstrapDoc(overrides: Record<string, unknown> = {}) {
  return {
    authorizations: [
      {
        issue_id: 'UTV2-1619',
        lane_type: 'governance',
        tier: 'T2',
        authorized_by: 'griff843',
        authorized_at: '2026-08-05',
        expires_at: '2026-09-05',
        milestone: 'Milestone 1',
        reason: 'admission dependency',
        ...overrides,
      },
    ],
  };
}

test('BMW-1: a matching unexpired governance identity resolves the tier', () => {
  assert.strictEqual(
    resolveBootstrapTier({ doc: bootstrapDoc(), issueId: 'UTV2-1619', now: BOOTSTRAP_NOW }),
    'T2',
  );
});

test('BMW-2: an identity for a different issue does not resolve', () => {
  assert.strictEqual(
    resolveBootstrapTier({ doc: bootstrapDoc(), issueId: 'UTV2-1620', now: BOOTSTRAP_NOW }),
    null,
  );
});

test('BMW-3: a non-governance identity does not resolve', () => {
  assert.strictEqual(
    resolveBootstrapTier({
      doc: bootstrapDoc({ lane_type: 'runtime' }),
      issueId: 'UTV2-1619',
      now: BOOTSTRAP_NOW,
    }),
    null,
  );
});

test('BMW-4: an expired identity does not resolve', () => {
  assert.strictEqual(
    resolveBootstrapTier({
      doc: bootstrapDoc({ expires_at: '2026-08-04' }),
      issueId: 'UTV2-1619',
      now: BOOTSTRAP_NOW,
    }),
    null,
  );
});

test('BMW-5: an invalid tier does not resolve', () => {
  for (const tier of ['T4', 'high', '', 'TX']) {
    assert.strictEqual(
      resolveBootstrapTier({
        doc: bootstrapDoc({ tier }),
        issueId: 'UTV2-1619',
        now: BOOTSTRAP_NOW,
      }),
      null,
      `tier ${JSON.stringify(tier)} must not resolve`,
    );
  }
});

test('BMW-6: two active identities fail closed rather than selecting one', () => {
  const doc = {
    authorizations: [
      ...bootstrapDoc().authorizations,
      { ...bootstrapDoc().authorizations[0], issue_id: 'UTV2-1620' },
    ],
  };
  assert.strictEqual(
    resolveBootstrapTier({ doc, issueId: 'UTV2-1619', now: BOOTSTRAP_NOW }),
    null,
  );
});

test('BMW-7: a missing or empty document does not resolve', () => {
  assert.strictEqual(resolveBootstrapTier({ doc: null, issueId: 'UTV2-1619', now: BOOTSTRAP_NOW }), null);
  assert.strictEqual(
    resolveBootstrapTier({ doc: { authorizations: [] }, issueId: 'UTV2-1619', now: BOOTSTRAP_NOW }),
    null,
  );
});

test('BMW-8: the diff-scope constraint accepts only bootstrap-related paths', () => {
  assert.strictEqual(
    isBootstrapDiffInScope([
      'docs/governance/BOOTSTRAP_AUTHORIZATIONS.json',
      '.github/workflows/merge-gate.yml',
      'scripts/ops/bootstrap-authorization.ts',
      'docs/06_status/proof/UTV2-1619/verification.md',
      'package.json',
    ]),
    true,
  );
});

test('BMW-9: any application or runtime file refuses the head fallback', () => {
  for (const intruder of [
    'apps/worker/src/index.ts',
    'packages/domain/src/scoring.ts',
    'supabase/migrations/0001_x.sql',
    'docs/06_status/proof/UTV2-1620/verification.md',
  ]) {
    assert.strictEqual(
      isBootstrapDiffInScope(['docs/governance/BOOTSTRAP_AUTHORIZATIONS.json', intruder]),
      false,
      `${intruder} must refuse the head fallback`,
    );
  }
});

test('BMW-10: an empty changed-file list proves nothing and is refused', () => {
  assert.strictEqual(isBootstrapDiffInScope([]), false);
});

test('BMW-11: the merge wrapper allowlist admits no application or runtime path', () => {
  for (const entry of BOOTSTRAP_ALLOWED_FILES) {
    for (const prefix of ['apps/', 'packages/', 'supabase/', 'infra/']) {
      assert.ok(!entry.startsWith(prefix), `${entry} must not be allowlisted`);
    }
  }
});
