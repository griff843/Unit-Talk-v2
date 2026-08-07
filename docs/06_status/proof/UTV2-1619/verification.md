# PROOF: UTV2-1619 — capability 17: truth-gated lifecycle completion

MERGE_SHA: d75679eb4ad172b48eb430a28f79809dd9d21940

ASSERTIONS:
- [x] Lane completion and issue completion are separate facts; closing a lane no longer
      completes its issue by itself.
- [x] A failing closeout cannot complete an issue (prevention 1).
- [x] A merge with no lane manifest cannot complete an issue (prevention 2).
- [x] A truthfully completed lane cannot complete a multi-increment issue (prevention 3).
- [x] Completion requires all five conditions: evidence, authority, scope, state, intent.
- [x] Every failing condition is reported, not only the first.
- [x] Absence of completion intent leaves the issue open — the fail-closed direction.
- [x] A cleanup replay for an already-closed lane completes nothing.
- [x] No production, runtime, migration, or delivery path is touched.

EVIDENCE:

## Verification

Executed 2026-08-05 in `.out/worktrees/claude__utv2-1619-truth-gated-lifecycle-completion`,
branch `claude/utv2-1619-truth-gated-lifecycle-completion`, based on `ff7c7da1`.

### Coverage statement — read this before the numbers

`pnpm type-check` runs `tsc -b tsconfig.json`, whose root config declares 15 project
references and 0 files, all of them `packages/` or `apps/`. **`scripts/` is in no project
graph and is therefore not statically type-checked.** Verified empirically: a file in
`scripts/ops/` whose whole body is `return definitelyNotDefinedAnywhere.value;` passes both
`pnpm type-check` (exit 0) and `pnpm lint` (exit 0).

So for the two `scripts/ops` files in this change, the real evidence is **`pnpm test`
(runtime, via tsx) plus lint**. No static type coverage is claimed. This is recorded as
capability 20.

That is not theoretical here. Three missing-binding errors were introduced while writing
this change — a variable referenced across function boundaries, and two missing imports
(`SUCCESS_TERMINAL_STATUSES`, `isCanonicalRunner`). All three passed `type-check` and
`lint`. Two were found by direct inspection and the third by a runtime test failure:

```
error: 'isCanonicalRunner is not defined'
  evaluateIssueCompletionEligibility (scripts/ops/lane-close.ts:1543:27)
  completeSuccessfulLaneClose        (scripts/ops/lane-close.ts:1629:33)
```

### `pnpm test`

```
blocks reporting a nonzero '# fail': 0
aggregate pass=4535 fail=0
TEST_EXIT=0
```

4526 baseline plus the 9 tests added here. No new test file — the tests extend
`lane-close.test.ts`, already wired into `test:ops`, so no `package.json` change was
needed. That was required rather than convenient: `package.json` is inside another active
lane's declared `file_scope_lock`, and this lane does not override another lane's scope.

### `pnpm lint`

```
LINT=0
```

### `pnpm type-check`

```
TC=0
```

Reported for completeness. Per the coverage statement above it does **not** cover the two
`scripts/ops` files in this change; it covers the packages and apps that consume them.

### `pnpm verify`

`pnpm verify` was not run on the workstation; its static constituents were run
individually and are recorded above. CI executed it on the merged head, and that
run is the authoritative one:

```
check_run:  verify
head_sha:   f3c0de91a6d0e090caac1ffd0fb02ba25e990c7a
conclusion: success
url: https://github.com/griff843/Unit-Talk-v2/actions/runs/31077723051/job/92540730879
```

That head is the commit merged as d75679eb4ad172b48eb430a28f79809dd9d21940, and
`verify` is one of the four required contexts confirmed green on it before merge.

### R-level check (`scripts/ci/r-level-check.ts`)

```
Verdict: PASS
Rules matched: (none) — no R-level artifacts required for this diff
```

This change touches governance tooling and one workflow; it triggers no R1–R5
rule and requires no additional artifacts.

### Workflow validation

```
YAML OK, jobs: ['linear-auto-close']
```

### Scope

```
 M .github/workflows/linear-auto-close.yml
 M scripts/ops/lane-close.test.ts
 M scripts/ops/lane-close.ts
```

Exactly the three files this lane declared. `pnpm test:db` was not run: governance tooling
with no database access, production parked. No live-DB proof is claimed or required at T2.

## The three preventions

Acceptance is three preventions, and they fail in **different ways on purpose**. A design
that stops only the first two is incomplete.

| # | reproduction | receipt present? | test |
|---|---|---|---|
| 1 | closeout FAILED, issue marked Done | none | TGC-2 |
| 2 | no lane existed at all | impossible | TGC-3 |
| 3 | lane closed truthfully, multi-increment issue | **valid** | TGC-4 |

**Prevention 3 is the one that defeats a receipt-only gate.** In the observed case the
receipt was real: `verdict: pass`, `runner: ops:lane-close`, bound to the merge SHA. The
lane genuinely finished. The issue did not. TGC-4 encodes exactly that shape — all four
evidence conditions satisfied (`satisfied.length === 4`) with `completion_intent` as the
sole unsatisfied condition — so the test fails if anyone later "simplifies" the gate back
to checking evidence alone.

## Design notes

**Intent is declared, never inferred.** Inferring completion from a lane reaching a
terminal state *is* reproduction 3. Absence of intent means the issue stays open.

**All failures are reported together.** `TGC-9` asserts five simultaneous failures produce
five reasons. Discovering blocking conditions one CI cycle at a time is the failure mode
the truth-check M2 short-circuit already demonstrated on this program.

**The cleanup-replay path completes nothing.** `completeAlreadyClosedLaneCleanup` releases
coordination state for a lane that was already closed; it now returns
`issue_completed: false` with a stated reason rather than borrowing another function's
verdict.

**Both authorities are gated.** `lane-close.ts` covers the sanctioned closure path;
`linear-auto-close.yml` covers the merge-triggered path that produced reproductions 1 and
2. Gating only one would leave the other able to complete an issue unaided.
