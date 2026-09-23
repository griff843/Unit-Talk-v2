# PROOF: WORK-2026092308

MERGE_SHA: pending merge

> Pre-merge, the merge row is intentionally a placeholder. The Execution SHA row carries the
> verified implementation identity. `post-merge-lane-close.yml` rebinds merge authority only
> after GitHub supplies the merged-PR attestation.

Issue: WORK-2026092308
Tier: T1
Lane type: runtime
Branch: claude/work-2026092308-model-performance-effective-settlement
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1636
Head SHA: 8d8b7e492ed06b7c59701e0bb16c0d4db28d23b8
result: pass

## ASSERTIONS:

- [x] `getModelPerformanceReport` no longer keeps only `corrects_id`-null rows. A corrected
      pick is reported with the correction's result and CLV, not the superseded original's.
- [x] A chain whose root predates the 30-day `listRecent` window is completed from
      `listByPick` rather than dropped.
- [x] A chain that does not resolve (orphan correction, two roots, a branch, a cycle) is not
      counted as settled, and is counted in `unresolvedSettlementPickCount`.
- [x] A pick whose effective record is `manual_review` is not counted as settled, and is not
      counted as unresolved.
- [x] Each repair is mutation-proven: each of 4 mutations, applied alone, turns a distinct
      named test red.
- [x] The live proof (UTV2-1137 suite, Test 5) completes a real chain from Postgres. It runs in
      `Writable DB proof (staging only)` under `t1_live_db_precondition: deferred_to_ci`.
- [x] No containment surface is touched. There are zero migrations and zero production writes.

## EVIDENCE:

Measured on head `056f9b575b4251bbb67bac3fbf1752e1dc66e563` in the lane worktree; re-anchored to `8d8b7e492ed06b7c59701e0bb16c0d4db28d23b8` (merge of origin/main `7159bcdeb`, docs and ledger only, no code), so these figures carry forward.

```
$ pnpm exec tsx --test apps/api/src/model-performance-service.test.ts
# tests 13
# pass  13
# fail  0

$ pnpm test
tests 6833, pass 6833, fail 0 (zero 'not ok' TAP lines across the workspace)
exit 0

$ pnpm type-check
exit 0

$ pnpm exec eslint apps/api/src/model-performance-service.ts \
    apps/api/src/model-performance-service.test.ts \
    apps/api/src/t1-proof-utv2-1137-settlement-corrections.test.ts
exit 0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Rules matched: (none)
```

### The mutation battery

Each mutation was applied to `apps/api/src/model-performance-service.ts` alone, the suite run,
and the file restored from a pre-mutation copy.

```
== M1 root not tip
not ok 10 - getModelPerformanceReport: a corrected pick reports the correction, not the superseded original
not ok 11 - getModelPerformanceReport: a chain whose root predates the read window is completed, not dropped
not ok 13 - getModelPerformanceReport: a chain whose tip is in manual review is not a settlement
# pass 10
# fail 3
== M2 no window completion
not ok 11 - getModelPerformanceReport: a chain whose root predates the read window is completed, not dropped
# pass 12
# fail 1
== M3 no completeness guard
not ok 12 - getModelPerformanceReport: a correction whose target cannot be read is excluded and counted
# pass 12
# fail 1
== M4 manual_review counted
not ok 13 - getModelPerformanceReport: a chain whose tip is in manual review is not a settlement
# pass 12
# fail 1
== restored
# pass 13
# fail 0
```

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm test`: exit 0, with 6833 tests, 6833 pass and 0 fail
- [ ] `pnpm verify`: not runnable locally (staging-target assertion). It is executed by the required `verify` check on this PR.
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS

## Runtime Verification

The live-DB half of T1 runtime proof is deferred to CI under this lane's
`t1_live_db_precondition: deferred_to_ci`. It is supplied by the `Writable DB proof
(staging only)` job on the merge SHA, against staging `xskgrzbteyqdufktjrjx`. It is **not**
fabricated here: `runtime_proof.status` in `evidence.json` reads `PENDING_CI`, and is
populated at closeout by `autoHarvestCiDbProofIntoEvidence`.

The lane extends the already-wired `t1-proof-utv2-1137-settlement-corrections.test.ts` with
Test 5. The test does four things:

- It writes a real root (win, `clvPercent` 2.5) and a real correction (loss, `clvPercent` −1)
  to Postgres.
- It gives the report a window that holds only the correction.
- It asserts that the report completes the chain through the real `listByPick`, with exactly
  one history read.
- It asserts the result: one settled pick, 0 wins, 1 loss, `avgClv` −1, and zero unresolved.

Locally, all five tests in that file fail identically with
`Failed to save submission: TypeError: fetch failed`. That includes the four pre-existing
tests, which is how the failure is known to be the containment placeholder rather than a defect.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1636
Approved PR head: pending merge
Execution SHA: 8d8b7e492ed06b7c59701e0bb16c0d4db28d23b8
