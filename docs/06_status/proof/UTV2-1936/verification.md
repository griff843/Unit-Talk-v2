# PROOF: UTV2-1936 Verification

MERGE_SHA: pending merge

Issue: UTV2-1936
Tier: T2
Lane type: delivery-ui
Branch: claude/utv2-1936-command-center-fixture-guard
PR: https://github.com/griff843/Unit-Talk-v2/pull/1610
Head SHA: a27ac381f65d6a31afbe38ad2cec30452c450ab1
Execution SHA: a27ac381f65d6a31afbe38ad2cec30452c450ab1
result: pass

## Verification

All commands run in the lane worktree at `a27ac381f65d6a31afbe38ad2cec30452c450ab1`, the last
non-proof commit on the branch and therefore the execution anchor.

| Command | Exit | Result |
|---|---|---|
| `pnpm lint` | 0 | pass |
| `pnpm type-check` | 0 | pass |
| `pnpm test` | 0 | pass — `ok=5939 not_ok=0 suites=104 failing_blocks=0` |
| `pnpm lane:check --lane delivery-ui --base 27bddb3ce --head HEAD` | 0 | pass, `files=5` |
| `pnpm ops:r-level-check --issue UTV2-1936 --head HEAD` | 0 | pass |
| `pnpm ops:branch-discipline --issue UTV2-1936 --pr 1610` | 0 | `"errors": []` |

`pnpm verify` is **not** quoted as green here, and that is deliberate rather than an omission. Its
`ci:assert-staging-isolation` step refuses in a local worktree that has no staging credentials — a
correct refusal of an environment precondition, not a failing test. Its constituent stages are each
recorded above with their own exit codes. The authoritative `verify` result for this lane is the
required check on PR #1610 at the current head, which runs with the CI environment that step
demands.

## Mutation drill — does the corrected test actually constrain the guard?

The point of this lane is that the previous test could not fail. A repaired guard is worth nothing
unless its test now fails when the guard regresses. Drilled at the execution anchor:

| Step | State of `client.ts:98` | Command | Result |
|---|---|---|---|
| 1. Baseline | `metadata['testRun'] != null` | `pnpm exec tsx --test apps/command-center/src/lib/data/client.test.ts` | `# pass 5  # fail 0` |
| 2. Revert the fix | `metadata['testRun'] === true` | same | **`# pass 4  # fail 1`** |
| 3. Restore | `metadata['testRun'] != null` | same | `# pass 5  # fail 0` |

Step 2 is the load-bearing line. Under the *old* test — which asserted `{ metadata: { testRun:
true } }` — that same revert passed 5/5, because the test constructed the one input shape the bug
happened to accept. The guard and its test agreed with each other about a value no writer emits.
The corrected fixture asserts the run-identifier string production actually writes, so the revert
is now detected.

Step 3 restored the file with `git checkout`, not by re-editing, so the tree at the anchor is
byte-identical to the committed state.

## Runtime verification — read-only, production

Production `zfzdnfwdarxucxtaojxm`, 2026-09-18. Every query below is a `SELECT`. **Zero rows were
written, and no containment setting, kill switch, delivery target or runtime flag was read or
changed.**

### 1. The stored shape of `testRun`

```sql
select jsonb_typeof(metadata->'testRun') as t, count(*)
from picks where metadata ? 'testRun' group by 1;
```

| `t` | rows |
|---|---|
| `string` | 60,206 |
| `boolean` | **0** |

The `=== true` clause could not have matched a row. This is the whole defect, measured rather than
argued.

### 2. What the guard recovers, repo-wide

Over all 107,865 `picks` rows, applying the five markers plus the `/proof/i` selection test:

| | before | after |
|---|---|---|
| detected as fixture | 19,365 | **79,571** |
| recovered solely by this clause | — | 60,206 |

### 3. What it recovers in the operator approval scope

`picks_current_state` where `status = 'awaiting_approval' OR approval_status = 'pending'` — the
exact population the review queue and `/held` read. 21,871 rows.

| | before | after |
|---|---|---|
| excluded as fixture | 8,716 | **19,587** |
| surviving to the operator | 10,871 | **2,284** |

### 4. The 2,284 survivors are not fixtures

```sql
select source, min(created_at), max(created_at), count(*)
from picks_current_state
where (status = 'awaiting_approval' or approval_status = 'pending')
  and not (<fixture predicate>)
group by 1;
```

All 2,284 are `source = 'system-pick-scanner'`, created 2026-05-12 .. 2026-07-23 — real
pre-containment pipeline rows carrying none of the five fixture markers. Whether stale scanner
output belongs in an operator queue is a separate disposition question this lane does not decide.

**The issue's acceptance criterion 4 predicted 0 survivors. That prediction was wrong.** The
measurement is 2,284. The criterion was corrected on the issue with this figure and its reason,
rather than the lane being closed against a target it cannot meet.

### 5. No governed pick is newly hidden

```sql
select count(*) from picks_current_state
where (status = 'awaiting_approval' or approval_status = 'pending')
  and metadata ? 'distributionMode';
-- 0
```

The governed cohort in approval scope is **0 rows**. Separately, none of the 7 governed picks
repo-wide carries `testRun`, `proof_issue`, `proof_fixture_id`, `proof_script` or `test_key`. The
corrected guard therefore removes nothing genuine from any operator surface.

## Provider independence

Nothing here depends on SGO or any provider-fed schedule, offer, result or closing line. Fixture
classification reads metadata already present on the row. This lane makes no claim about CLV,
closing lines or automated grading, which remain explicitly deferred under the standing sequencing
directive.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1610
Approved PR head: pending merge
Execution SHA: a27ac381f65d6a31afbe38ad2cec30452c450ab1
