# PROOF: UTV2-1886

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-11T12:22:15.372Z
Issue: UTV2-1886
Tier: T1
Lane type: runtime
Branch: claude/utv2-1886-grading-settlement-prefetch
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1565
Head SHA: 3d9886e586f15686a0ae1baa310fd615e2d59dbb
result: pass

## ASSERTIONS:

- [x] `runGradingPass` performs exactly one settlement read for the whole pick population, not one per pick.
- [x] The batched read is complete: every chunk is paginated to exhaustion, so no pick is silently omitted.
- [x] An omitted pick is the fail-open direction (it reads as "no settlement exists"), so a failed prefetch rejects the pass rather than degrading to an empty map.
- [x] `findLatestForPicks` and `findLatestForPick` agree on which settlement is current, including on a `created_at` tie, because both reduce through `compareSettlementRecordsDescending`.
- [x] Each of the four claims above is mutation-tested, and each mutation is caught by a distinct named assertion.

## EVIDENCE:

```
$ pnpm type-check
> pnpm exec tsc -b tsconfig.json
(exit 0, no diagnostics)

$ pnpm lint
> eslint . --cache --cache-location .cache/eslint/
(exit 0, no findings)

$ pnpm test
# pass 6153
# fail 0
(exit 0, aggregated across every TAP stream in the run)

$ pnpm exec tsx --test packages/db/src/settlement-invariants.test.ts
# tests 18
# pass 18
# fail 0

$ pnpm exec tsx --test apps/api/src/grading-service.test.ts
# tests 71
# pass 71
# fail 0

$ pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1886 --base origin/main --head 3d9886e58
Verdict: PASS
Changed files: 15
Rules matched: (none) — no R-level artifacts required for this diff
```

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm lint`: exit 0
- [x] `pnpm test`: exit 0, 6153 pass / 0 fail
- [ ] `pnpm verify`: NOT RUN on the workstation. `verify` ends at `test:live-db`, where `ci:assert-staging` refuses a workstation target by design (it requires staging `xskgrzbteyqdufktjrjx`). The CI `verify` job is the authoritative run; see the Runtime Verification section.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS

## Mutation battery

Baseline: `pnpm exec tsx --test packages/db/src/settlement-invariants.test.ts` 18/18, and
`pnpm exec tsx --test apps/api/src/grading-service.test.ts` 71/71.

| # | Mutation | Result |
|---|---|---|
| a | Drop the `.range` pagination loop — read only the first page of each chunk | `not ok 13 - collectLatestSettlementsByPick reads every page of a chunk, not just the first` (1 fail) |
| b | Reduce with `record.created_at > current.created_at` instead of `compareSettlementRecordsDescending` | `not ok 17 - collectLatestSettlementsByPick breaks a created_at tie on id, in either page order` (1 fail) |
| c | `.catch(() => new Map())` on the prefetch instead of rejecting | `not ok 38 - UTV2-1886: a failed settlement prefetch rejects the pass instead of reading as an empty map` (1 fail) |
| d | Revert the loop body to `await repositories.settlements.findLatestForPick(pick.id)` | `not ok 39 - UTV2-1886: the settlement lookup is one batched read, not one read per pick` (1 fail) |

**Mutation (b) survived the first attempt and that is recorded rather than smoothed over.**
The correction-chain test used distinct `created_at` values, so it never exercised the
comparator's tiebreak and `>` passed. The gap was in the test, not the implementation: a
tie-ordering test was added — asserting *both* page orders, because a one-order test passes
by luck half the time — and the mutation is caught. A mutation that survives is evidence the
assertion is weak, never evidence the condition is unprovable.

## Production measurement

Read-only, governed, against production `zfzdnfwdarxucxtaojxm` on 2026-09-11. This is why the
change exists and why pagination is mandatory rather than precautionary.

| Measurement | Value |
|---|---|
| `grading.run` rows, 7 days to 2026-09-11 | 108 |
| Median gap between consecutive runs | 91.1 min (min 88.1, max 152.5) |
| `pollIntervalMs` default | 5 min |
| Grading population (`posted` + `awaiting_approval` + Track Only `validated`) | 7,306 + 14,984 + 1 = 22,291 |
| `settlement_records` rows / distinct picks | 37,496 / 25,430 |

A 500-pick chunk can therefore hold far more than PostgREST's default 1000-row page, and a
truncated page does not raise — it silently omits picks.

## Runtime Verification
- Pending: the `verify` and `Writable DB proof (staging only)` jobs on PR #1565. Their results are recorded in `evidence.json` under `runtime_proof` once the run concludes, bound to the run and job ids.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1565
Approved PR head: pending merge
Execution SHA: 3d9886e586f15686a0ae1baa310fd615e2d59dbb
