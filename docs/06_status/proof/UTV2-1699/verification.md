# PROOF: UTV2-1699

MERGE_SHA: 6c67131294141c4f4be1acd6f16f94b8c6614a76

Lane: claude / `claude/utv2-1699-lane-maximizer-discovery-repair`
Tier: T1 (Tier C path — `scripts/ops/lane-maximizer.ts`)
Proof Artifact: docs/06_status/proof/UTV2-1699/verification.md

## Verification

ASSERTIONS:

- [x] AC1 — a no-argument invocation queries the canonical Linear candidate source; with eligible candidates present a bare invocation does not return an empty board.
- [x] AC2 — the eligible population is not capped at 10; cursor pagination retrieves the full set and a candidate beyond the first page is discovered.
- [x] AC3 — an injected candidate-source failure exits non-zero with `candidate_discovery_failed`; empty arrays with exit 0 are impossible on that path.
- [x] AC4 — an injected active-lane read failure exits non-zero with the DISTINCT code `active_lane_discovery_failed` and a different remediation.
- [x] AC5 — a genuinely zero-candidate run still exits 0 with a real report.
- [x] AC6 — active lanes resolve through the canonical resolver; a PR-head-only manifest fixture is counted against capacity and enforces OVERLAP.
- [x] AC7 — every one of the four controls is proven by executed mutation: the mutation was applied, the named regression FAILED, the mutation was reverted and the regression PASSED. Literal output below.
- [x] AC8 — `ranking_score` / `ranking_reasons` for a fixed candidate set are byte-identical before and after this change, measured against the pre-change implementation at base `e48106fc9a5eb5904b322833d0968da5ae0b0665`.

Commands executed for this proof (all in the lane worktree):

- `pnpm verify` (env:check + lint + type-check + build + test + verify:static + verify:commands + test:live-db)
- `pnpm type-check`
- `pnpm test`
- `pnpm exec tsx --test scripts/ops/lane-maximizer.test.ts`
- `pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1699` (r-level-check)
- `pnpm ops:proof-check --issue UTV2-1699`

## Runtime Verification

EVIDENCE:

### 1. Full regression file — `pnpm exec tsx --test scripts/ops/lane-maximizer.test.ts`

```text
ok 58 - UTV2-1699 AC1: a bare invocation queries the canonical Linear candidate source
ok 59 - UTV2-1699 AC2: candidate discovery paginates past the first page
ok 60 - UTV2-1699 AC2: a truncated page walk fails closed instead of returning a partial population
ok 61 - UTV2-1699 AC3: candidate-source failure exits non-zero with a candidate-discovery code
ok 62 - UTV2-1699 AC3: a Linear auth failure fails closed as candidate discovery
ok 63 - UTV2-1699 AC4: active-lane discovery failure exits non-zero with a DISTINCT code
ok 64 - UTV2-1699 AC4: an unreadable lane manifest is a failure, not a smaller board
ok 65 - UTV2-1699 AC5: a genuinely empty candidate population still exits 0
ok 66 - UTV2-1699 AC6: a PR-head-only lane manifest is counted as active
ok 67 - UTV2-1699 AC8: ranking output is unchanged for a fixed candidate set
# tests 67
# suites 0
# pass 67
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

56 pre-existing tests plus 11 new UTV2-1699 regressions. `# fail 0`.

## Mutation matrix (AC7)

Each control was broken deliberately, the named regression executed and observed to
FAIL, then the mutation reverted and the regression observed to PASS. The mutations
were applied to `scripts/ops/lane-maximizer.ts` only; the test file was never touched
during the matrix.

| # | Mutation | Regression that must fail | Observed under mutation | Observed after revert |
|---|---|---|---|---|
| M1 | Restore the `catch` that empties both populations | AC3 and AC4 | `# fail 4` (4/4 failed) | `# fail 0` (4/4 passed) |
| M2 | Restore the `else -> parseCandidatesArg(argv)` fallthrough | AC1 | `# fail 1` | `# fail 0` |
| M3 | Restore the hard limit of 10 (single un-paginated page) | AC2 | `# fail 2` | `# fail 0` |
| M4 | Revert to the local-manifest-only `readActiveLanes` | AC6 | `# fail 1` | `# fail 0` |

### M1 — restore the fail-open catch that empties both populations

Mutation applied (`git diff scripts/ops/lane-maximizer.ts`):

```diff
diff --git a/scripts/ops/lane-maximizer.ts b/scripts/ops/lane-maximizer.ts
index 10b49de2..36ac9e2b 100644
--- a/scripts/ops/lane-maximizer.ts
+++ b/scripts/ops/lane-maximizer.ts
@@ -1352,37 +1352,21 @@ export async function runMaximizerCli(
 ): Promise<MaximizerCliOutcome> {
   const source = resolveCandidateSource(argv);
 
-  let candidates: CandidateLane[];
+  // MUTATION M1: restored the pre-UTV2-1699 catch that empties both populations.
+  let candidates: CandidateLane[] = [];
+  let activeLanes: LaneManifest[] = [];
   try {
     candidates = deps.fetchCandidates
       ? await deps.fetchCandidates(argv)
       : await defaultFetchCandidates(argv, deps.linear);
-  } catch (error) {
-    return errorOutcome(
-      'candidate_discovery_failed',
-      source,
-      `Could not read the ${source} candidate source, so the dispatchable population is unknown. ` +
-        'Refusing to report an unknown candidate population as an empty board. ' +
-        `Cause: ${error instanceof Error ? error.message : String(error)}`,
-      source === 'linear'
-        ? 'Restore LINEAR_API_TOKEN/LINEAR_API_KEY and network access to api.linear.app, then retry. An unknown board is never treated as an empty one.'
-        : 'Repair the supplied candidate source (queue file or --candidates payload), then retry. An unknown board is never treated as an empty one.',
-    );
-  }
-
-  let activeLanes: LaneManifest[];
-  try {
     activeLanes = deps.resolveActiveLanes
       ? deps.resolveActiveLanes(deps.activeLaneDiscovery)
       : resolveActiveLanesCanonically(deps.activeLaneDiscovery);
   } catch (error) {
-    return errorOutcome(
-      'active_lane_discovery_failed',
-      source,
-      error instanceof ActiveLaneDiscoveryError || error instanceof Error
-        ? error.message
-        : 'Could not resolve the active-lane set from open pull requests.',
-      'Restore `gh` authentication and network access and repair any unreadable lane manifest, then retry. Capacity, singleton, and file-scope conflict checks are unsafe against an unknown active board.',
+    candidates = [];
+    activeLanes = [];
+    process.stderr.write(
+      `[lane-maximizer] ${error instanceof Error ? error.message : String(error)}\n`,
     );
   }
 
```

Command:

```bash
pnpm exec tsx --test --test-name-pattern 'UTV2-1699 AC3|UTV2-1699 AC4' scripts/ops/lane-maximizer.test.ts
```

Literal output UNDER THE MUTATION — the regression FAILS:

```text
TAP version 13
# [lane-maximizer] Linear candidate query failed: Linear HTTP 503 Service Unavailable
# [lane-maximizer] Linear team resolve failed: Linear HTTP 401 Unauthorized
# [lane-maximizer] Linear candidate query failed: Linear HTTP 503 Service Unavailable
# [lane-maximizer] Could not enumerate open pull requests, so the active-lane set is unknown. Refusing to treat an unknown board as an empty one.
# [lane-maximizer] Could not read the local lane-manifest population, so the active-lane set is unknown. Refusing to treat an unreadable local board as an empty one.
# Subtest: UTV2-1699 AC3: candidate-source failure exits non-zero with a candidate-discovery code
not ok 1 - UTV2-1699 AC3: candidate-source failure exits non-zero with a candidate-discovery code
  ---
  duration_ms: 26.958916
  type: 'test'
  location: '/home/griff843/code/Unit-Talk-v2/.out/worktrees/claude__utv2-1699-lane-maximizer-discovery-repair/scripts/ops/lane-maximizer.test.ts:4:5559'
  failureType: 'testCodeFailure'
  error: |-
    a candidate-source failure must never exit 0
    
    0 !== 1
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 1
  actual: 0
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/home/griff843/code/Unit-Talk-v2/.out/worktrees/claude__utv2-1699-lane-maximizer-discovery-repair/scripts/ops/lane-maximizer.test.ts:1471:10)
    async Test.run (node:internal/test_runner/test:1054:7)
    async startSubtestAfterBootstrap (node:internal/test_runner/harness:296:3)
  ...
# Subtest: UTV2-1699 AC3: a Linear auth failure fails closed as candidate discovery
not ok 2 - UTV2-1699 AC3: a Linear auth failure fails closed as candidate discovery
  ---
  duration_ms: 12.996357
  type: 'test'
  location: '/home/griff843/code/Unit-Talk-v2/.out/worktrees/claude__utv2-1699-lane-maximizer-discovery-repair/scripts/ops/lane-maximizer.test.ts:4:6593'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    
    0 !== 1
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 1
  actual: 0
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/home/griff843/code/Unit-Talk-v2/.out/worktrees/claude__utv2-1699-lane-maximizer-discovery-repair/scripts/ops/lane-maximizer.test.ts:1494:10)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
# Subtest: UTV2-1699 AC4: active-lane discovery failure exits non-zero with a DISTINCT code
not ok 3 - UTV2-1699 AC4: active-lane discovery failure exits non-zero with a DISTINCT code
  ---
  duration_ms: 28.352512
  type: 'test'
  location: '/home/griff843/code/Unit-Talk-v2/.out/worktrees/claude__utv2-1699-lane-maximizer-discovery-repair/scripts/ops/lane-maximizer.test.ts:4:6992'
  failureType: 'testCodeFailure'
  error: |-
    an unknown active board must never exit 0
    
    0 !== 1
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 1
  actual: 0
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/home/griff843/code/Unit-Talk-v2/.out/worktrees/claude__utv2-1699-lane-maximizer-discovery-repair/scripts/ops/lane-maximizer.test.ts:1515:10)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
# Subtest: UTV2-1699 AC4: an unreadable lane manifest is a failure, not a smaller board
not ok 4 - UTV2-1699 AC4: an unreadable lane manifest is a failure, not a smaller board
  ---
  duration_ms: 13.230215
  type: 'test'
  location: '/home/griff843/code/Unit-Talk-v2/.out/worktrees/claude__utv2-1699-lane-maximizer-discovery-repair/scripts/ops/lane-maximizer.test.ts:4:8391'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    
    0 !== 1
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 1
  actual: 0
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/home/griff843/code/Unit-Talk-v2/.out/worktrees/claude__utv2-1699-lane-maximizer-discovery-repair/scripts/ops/lane-maximizer.test.ts:1547:10)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
1..4
# tests 4
# suites 0
# pass 0
# fail 4
# cancelled 0
# skipped 0
# todo 0
# duration_ms 615.010795
```

Mutation reverted; the same command PASSES:

```text
ok 1 - UTV2-1699 AC3: candidate-source failure exits non-zero with a candidate-discovery code
ok 2 - UTV2-1699 AC3: a Linear auth failure fails closed as candidate discovery
ok 3 - UTV2-1699 AC4: active-lane discovery failure exits non-zero with a DISTINCT code
ok 4 - UTV2-1699 AC4: an unreadable lane manifest is a failure, not a smaller board
# tests 4
# pass 4
# fail 0
```

### M2 — restore the `else -> parseCandidatesArg(argv)` fallthrough

Mutation applied (`git diff scripts/ops/lane-maximizer.ts`):

```diff
diff --git a/scripts/ops/lane-maximizer.ts b/scripts/ops/lane-maximizer.ts
index 10b49de2..ad0f1e69 100644
--- a/scripts/ops/lane-maximizer.ts
+++ b/scripts/ops/lane-maximizer.ts
@@ -1296,9 +1296,10 @@ export interface MaximizerCliOutcome {
  * wants to supply the population itself, but they must now say so explicitly.
  */
 export function resolveCandidateSource(argv: string[]): CandidateSource {
+  // MUTATION M2: restored the pre-UTV2-1699 `else -> parseCandidatesArg(argv)` fallthrough.
+  if (hasFlag(argv, '--from-linear')) return 'linear';
   if (hasFlag(argv, '--from-queue')) return 'queue';
-  if (hasFlag(argv, '--candidates') || hasFlag(argv, '--from-stdin')) return 'explicit';
-  return 'linear';
+  return 'explicit';
 }
 
 async function defaultFetchCandidates(
```

Command:

```bash
pnpm exec tsx --test --test-name-pattern 'UTV2-1699 AC1' scripts/ops/lane-maximizer.test.ts
```

Literal output UNDER THE MUTATION — the regression FAILS:

```text
TAP version 13
# Subtest: UTV2-1699 AC1: a bare invocation queries the canonical Linear candidate source
not ok 1 - UTV2-1699 AC1: a bare invocation queries the canonical Linear candidate source
  ---
  duration_ms: 11.27024
  type: 'test'
  location: '/home/griff843/code/Unit-Talk-v2/.out/worktrees/claude__utv2-1699-lane-maximizer-discovery-repair/scripts/ops/lane-maximizer.test.ts:4:3230'
  failureType: 'testCodeFailure'
  error: |-
    a bare argv must select the canonical Linear candidate source, never an argv/stdin parse
    + actual - expected
    
    + 'explicit'
    - 'linear'
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'linear'
  actual: 'explicit'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/home/griff843/code/Unit-Talk-v2/.out/worktrees/claude__utv2-1699-lane-maximizer-discovery-repair/scripts/ops/lane-maximizer.test.ts:1395:10)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.start (node:internal/test_runner/test:944:17)
    startSubtestAfterBootstrap (node:internal/test_runner/harness:296:17)
  ...
1..1
# tests 1
# suites 0
# pass 0
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1088.911902
```

Mutation reverted; the same command PASSES:

```text
ok 1 - UTV2-1699 AC1: a bare invocation queries the canonical Linear candidate source
# tests 1
# pass 1
# fail 0
```

### M3 — restore the hard limit of 10 and drop pagination

Mutation applied (`git diff scripts/ops/lane-maximizer.ts`):

```diff
diff --git a/scripts/ops/lane-maximizer.ts b/scripts/ops/lane-maximizer.ts
index 10b49de2..c7b6156e 100644
--- a/scripts/ops/lane-maximizer.ts
+++ b/scripts/ops/lane-maximizer.ts
@@ -792,9 +792,9 @@ export async function fetchLinearCandidates(
   // dispatch invocation) means "the whole eligible population", retrieved by
   // cursor pagination -- not "the 10 most recently updated issues", and not
   // clamped to 50.
-  const limitFlag = getFlagValue(argv, '--linear-limit');
-  const limitRaw = limitFlag === null ? Number.NaN : Number.parseInt(limitFlag, 10);
-  const maxCandidateIssues = Number.isFinite(limitRaw) ? Math.max(1, limitRaw) : null;
+  // MUTATION M3: restored the pre-UTV2-1699 hard limit of 10 (clamped to 50).
+  const limitRaw = Number.parseInt(getFlagValue(argv, '--linear-limit') ?? '10', 10);
+  const maxCandidateIssues = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 50)) : 10;
   const linearOpts = { token, userAgent: 'unit-talk-ops-lane-maximizer' };
   const teamResult = await query<{
     teams: { nodes: Array<{ id: string; key: string }> };
@@ -872,13 +872,8 @@ export async function fetchLinearCandidates(
     const connection = result.data.team.issues;
     nodes.push(...connection.nodes);
 
-    if (maxCandidateIssues !== null && nodes.length >= maxCandidateIssues) {
-      nodes.length = maxCandidateIssues;
-      break;
-    }
-    if (!connection.pageInfo?.hasNextPage) {
-      break;
-    }
+    // MUTATION M3: no pagination -- a single `first: $limit` page, as before.
+    break;
     if (!connection.pageInfo.endCursor) {
       throw new Error(
         'Linear reported another candidate page but returned no cursor; ' +
```

Command:

```bash
pnpm exec tsx --test --test-name-pattern 'UTV2-1699 AC2' scripts/ops/lane-maximizer.test.ts
```

Literal output UNDER THE MUTATION — the regression FAILS:

```text
TAP version 13
# Subtest: UTV2-1699 AC2: candidate discovery paginates past the first page
not ok 1 - UTV2-1699 AC2: candidate discovery paginates past the first page
  ---
  duration_ms: 35.78935
  type: 'test'
  location: '/home/griff843/code/Unit-Talk-v2/.out/worktrees/claude__utv2-1699-lane-maximizer-discovery-repair/scripts/ops/lane-maximizer.test.ts:4:4729'
  failureType: 'testCodeFailure'
  error: |-
    candidates on pages 2 and 3 must be discovered; the population is not capped at the first page
    + actual - expected
    
      [
        'UTV2-9101',
    -   'UTV2-9102',
    -   'UTV2-9103'
      ]
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected:
    0: 'UTV2-9101'
    1: 'UTV2-9102'
    2: 'UTV2-9103'
  actual:
    0: 'UTV2-9101'
  operator: 'deepStrictEqual'
  stack: |-
    TestContext.<anonymous> (/home/griff843/code/Unit-Talk-v2/.out/worktrees/claude__utv2-1699-lane-maximizer-discovery-repair/scripts/ops/lane-maximizer.test.ts:1441:10)
    async Test.run (node:internal/test_runner/test:1054:7)
    async startSubtestAfterBootstrap (node:internal/test_runner/harness:296:3)
  ...
# Subtest: UTV2-1699 AC2: a truncated page walk fails closed instead of returning a partial population
not ok 2 - UTV2-1699 AC2: a truncated page walk fails closed instead of returning a partial population
  ---
  duration_ms: 18.554497
  type: 'test'
  location: '/home/griff843/code/Unit-Talk-v2/.out/worktrees/claude__utv2-1699-lane-maximizer-discovery-repair/scripts/ops/lane-maximizer.test.ts:4:5396'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    
    0 !== 1
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 1
  actual: 0
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/home/griff843/code/Unit-Talk-v2/.out/worktrees/claude__utv2-1699-lane-maximizer-discovery-repair/scripts/ops/lane-maximizer.test.ts:1474:10)
    async Test.run (node:internal/test_runner/test:1054:7)
    async Test.processPendingSubtests (node:internal/test_runner/test:744:7)
  ...
1..2
# tests 2
# suites 0
# pass 0
# fail 2
# cancelled 0
# skipped 0
# todo 0
# duration_ms 991.233742
```

Mutation reverted; the same command PASSES:

```text
ok 1 - UTV2-1699 AC2: candidate discovery paginates past the first page
ok 2 - UTV2-1699 AC2: a truncated page walk fails closed instead of returning a partial population
# tests 2
# pass 2
# fail 0
```

### M4 — revert to the local-manifest-only active-lane read

Mutation applied (`git diff scripts/ops/lane-maximizer.ts`):

```diff
diff --git a/scripts/ops/lane-maximizer.ts b/scripts/ops/lane-maximizer.ts
index 10b49de2..c1b3bce2 100644
--- a/scripts/ops/lane-maximizer.ts
+++ b/scripts/ops/lane-maximizer.ts
@@ -598,9 +598,14 @@ function readLaneManifests(dir: string = LANE_DIR): LaneManifest[] {
  * failing it.
  */
 function resolveActiveLanesCanonically(
-  discoveryDeps?: ActiveLaneDiscoveryDeps,
+  _discoveryDeps?: ActiveLaneDiscoveryDeps,
 ): LaneManifest[] {
-  return resolveActiveLaneManifests(discoveryDeps).manifests;
+  // MUTATION M4: reverted to the pre-UTV2-1699 local-manifest-only read.
+  void resolveActiveLaneManifests;
+  void ActiveLaneDiscoveryError;
+  return readLaneManifests(LANE_DIR).filter((manifest) =>
+    ['started', 'in_progress', 'in_review', 'blocked', 'parked', 'reopened'].includes(manifest.status),
+  );
 }
 
 function readDoneIssueIds(dir: string = LANE_DIR): Set<string> {
```

Command:

```bash
pnpm exec tsx --test --test-name-pattern 'UTV2-1699 AC6' scripts/ops/lane-maximizer.test.ts
```

Literal output UNDER THE MUTATION — the regression FAILS:

```text
TAP version 13
# Subtest: UTV2-1699 AC6: a PR-head-only lane manifest is counted as active
not ok 1 - UTV2-1699 AC6: a PR-head-only lane manifest is counted as active
  ---
  duration_ms: 47.493349
  type: 'test'
  location: '/home/griff843/code/Unit-Talk-v2/.out/worktrees/claude__utv2-1699-lane-maximizer-discovery-repair/scripts/ops/lane-maximizer.test.ts:4:10331'
  failureType: 'testCodeFailure'
  error: |-
    a lane whose manifest exists only on its open PR head must count against capacity
    
    0 !== 1
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 1
  actual: 0
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (/home/griff843/code/Unit-Talk-v2/.out/worktrees/claude__utv2-1699-lane-maximizer-discovery-repair/scripts/ops/lane-maximizer.test.ts:1613:10)
    async Test.run (node:internal/test_runner/test:1054:7)
    async startSubtestAfterBootstrap (node:internal/test_runner/harness:296:3)
  ...
1..1
# tests 1
# suites 0
# pass 0
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 916.3318
```

Mutation reverted; the same command PASSES:

```text
ok 1 - UTV2-1699 AC6: a PR-head-only lane manifest is counted as active
# tests 1
# pass 1
# fail 0
```

## AC8 — ranking output unchanged

`scoreCandidate` / `rankCandidates` / `evaluateCandidates` were not modified. Proven
by running the same fixed three-candidate set through `evaluateCandidates` on the
pre-change implementation (restored from base `e48106fc9a5eb5904b322833d0968da5ae0b0665`)
and on this lane's implementation, and diffing the results.

```text
$ diff ranking-before.json ranking-after.json && echo "IDENTICAL"
IDENTICAL
```

The shared output of both runs:

```json
[
  {
    "issue_id": "UTV2-RANK-A",
    "decision": "recommended",
    "reason_codes": [],
    "rank": 1,
    "ranking_score": 80,
    "ranking_reasons": [
      "tier:T2 dispatchable default",
      "file scope declared",
      "acceptance criteria present",
      "safe work class"
    ]
  },
  {
    "issue_id": "UTV2-RANK-B",
    "decision": "blocked",
    "reason_codes": [
      "MISSING_ACCEPTANCE_CRITERIA"
    ],
    "rank": 3,
    "ranking_score": -25,
    "ranking_reasons": [
      "tier:T3 lower urgency",
      "file scope missing",
      "acceptance criteria missing",
      "safe work class"
    ]
  },
  {
    "issue_id": "UTV2-RANK-C",
    "decision": "deferred",
    "reason_codes": [
      "T1_REQUIRES_PM"
    ],
    "rank": 2,
    "ranking_score": 45,
    "ranking_reasons": [
      "tier:T1 requires PM authorization",
      "file scope declared",
      "safe work class"
    ]
  }
]
```

The same golden is asserted inside the test suite as
`UTV2-1699 AC8: ranking output is unchanged for a fixed candidate set`.

## `pnpm verify`

```text
2:> @unit-talk/v2@0.1.0 verify 
6:> @unit-talk/v2@0.1.0 verify:static 
36:> @unit-talk/v2@0.1.0 env:check 
41:> @unit-talk/v2@0.1.0 lint 
45:> @unit-talk/v2@0.1.0 type-check 
49:> @unit-talk/v2@0.1.0 build 
53:> @unit-talk/v2@0.1.0 test 
35829:> @unit-talk/v2@0.1.0 verify:commands 
35841:> @unit-talk/v2@0.1.0 test:live-db 
35845:> @unit-talk/v2@0.1.0 test:db 
35849:> @unit-talk/v2@0.1.0 ci:assert-staging 

aggregate node:test totals across every suite run by `pnpm test`:
# tests 5524
# pass 5524
# fail 0
# cancelled 0
# skipped 0

count of `not ok` lines in the whole verify log: 0



> @unit-talk/v2@0.1.0 ci:assert-staging /home/griff843/code/Unit-Talk-v2/.out/worktrees/claude__utv2-1699-lane-maximizer-discovery-repair
> tsx scripts/ci/assert-staging-target.ts

[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1). Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci GitHub environment with CI_SUPABASE_* credentials.
 ELIFECYCLE  Command failed with exit code 1.
 ELIFECYCLE  Command failed with exit code 1.
 ELIFECYCLE  Command failed with exit code 1.
 ELIFECYCLE  Command failed with exit code 1.
VERIFY_EXIT=1
```

`pnpm verify` exits 1, and it does so at exactly one stage: `test:live-db`.
`env:check`, `lint`, `type-check`, `build`, the whole `pnpm test` tree
(5524 tests, 0 failures, 0 `not ok` lines), `verify:static` and `verify:commands`
are all exit 0.

`test:live-db` is REFUSED, not failed, and the refusal is a containment control
rather than a defect in this change:

```text
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci
GitHub environment with CI_SUPABASE_* credentials.
```

This is the same `REFUSED_AT_LIVE_DB` condition recorded in UTV2-1798's evidence
bundle: the writable receipt is produced inside required CI `verify` against the
run-scoped staging project, never claimed from a workstation. This lane touches no
schema, no migration, no DB client and no query — the changed files are
`scripts/ops/lane-maximizer.ts` and `scripts/ops/lane-maximizer.test.ts` only.

## Scope

```text
 .ops/sync/UTV2-1699.yml                 | 400 +++++++++++++++++++++++++++++++
 docs/06_status/lanes/UTV2-1699.json     |  41 ++++
 docs/06_status/proof/UTV2-1699/.gitkeep |   0
 scripts/ops/lane-maximizer.test.ts      | 405 +++++++++++++++++++++++++++++++-
 scripts/ops/lane-maximizer.ts           | 370 ++++++++++++++++++++++++-----
 5 files changed, 1150 insertions(+), 66 deletions(-)
```
