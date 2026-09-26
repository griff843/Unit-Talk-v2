# PROOF: WORK-2026092620

MERGE_SHA: pending merge

> Pre-merge, merge authority does not exist yet. `post-merge-lane-close.yml` binds the merge
> SHA after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-26T17:33:13.000Z
Issue: WORK-2026092620
Tier: T2
Lane type: governance
Branch: claude/work-2026092620-effective-settlement-scripts
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1662
Head SHA: 76f3bad230845df6cd61e94b4b6dce73932c401d
result: pass

## ASSERTIONS:

- [x] One shared reader (`scripts/effective-settlements.ts`) loads every record of every candidate pick's chain, paged with an ordered `range` past the 1000-row cap, and resolves each pick through `resolveEffectiveSettlement` from `@unit-talk/domain`.
- [x] A resolution is accepted only when every `corrects_id` target is present and `correction_depth + 1` equals the chain's row count; a lone correction with an absent target, a chain missing a middle link, a branched chain and an orphan loop are each unresolved (M1, M1b red).
- [x] The date window selects picks by their root's date and never cuts a chain: a correction after the window still resolves to its tip, and a pick whose root predates the window is not a candidate.
- [x] Paging reads 1500 candidate roots and 1200-row chain chunks through a fake that serves unordered reads unstably; dropping either ORDER BY loses rows (M2a, M2b red).
- [x] Pick id lists are chunked at 200 per `.in('pick_id', ...)` request.
- [x] roi-by-sport, clv-dashboard, band-accuracy, portfolio-review and scoring-provenance each consume the effective result, one test per script; reverting roi-by-sport to a root-only read turns its test red (M3).
- [x] Each script surfaces an unresolved count; output shape is otherwise unchanged.
- [x] No database was read or written by this lane; no containment, secret or environment change.

## EVIDENCE:

```
$ pnpm exec tsx --test scripts/roi-by-sport.test.ts   # tests 18   # pass 18   # fail 0
$ pnpm test:ops                                       # pass 3450 # fail 0 (summed across suites)
$ pnpm test                                           # pass 6996 # fail 0 (summed across suites), exit 0
```

## Verification

Measured on `76f3bad230845df6cd61e94b4b6dce73932c401d` in the lane worktree.

```
$ pnpm exec tsx --test scripts/roi-by-sport.test.ts -> tests 18, pass 18, fail 0
$ pnpm test:ops                  -> pass 3450, fail 0
$ pnpm test                      -> pass 6996, fail 0, exit 0
$ pnpm type-check                -> exit 0
$ pnpm exec eslint <7 touched files> -> exit 0
$ pnpm exec tsx scripts/ci/r-level-check.ts --issue WORK-2026092620 --base origin/main --head HEAD -> PASS, no rules matched
$ pnpm exec tsx scripts/ci/privileged-db-client-guard.ts -> OK
```

`pnpm type-check` does not cover `scripts/`. The seven touched files were also checked with
`tsc --noEmit` under a scratch tsconfig (base config plus `@unit-talk/*` path mappings): no error
in new code. It reports one pre-existing error on an untouched line (`roi-by-sport.ts`
`computeRoiPercent`, TS18047) and TS1470 `import.meta` notices that come from the scratch
config's module setting, not from the code.

`pnpm verify` was not run locally: `ci:assert-staging` refuses the workstation target, so
`verify` comes from CI on the PR head.

Mutation battery. Each mutation applied alone, `scripts/roi-by-sport.test.ts` run, the file
restored from a pre-mutation copy (`cmp` identical; restore rerun 18/18 green).

| ID | Mutation | Observed |
|---|---|---|
| M1 | `resolveChain` accepts without the missing-target and depth checks | 10 red: all four partial-chain resolver tests, the root-window test, and all five per-script tests |
| M1b | Depth check alone removed | 2 red: branched chain, orphan loop |
| M2a | ORDER BY dropped from root-candidate paging | paging test red: 1165 of 1500 candidates |
| M2b | ORDER BY dropped from chain paging | paging test red: 347 of 1500 picks resolved |
| M3 | roi-by-sport reverted to a root-only `.is('corrects_id', null)` read | "roi-by-sport counts each pick by its effective settlement" red |

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1662
Execution SHA: 76f3bad230845df6cd61e94b4b6dce73932c401d

### Re-anchor to `76f3bad230845df6cd61e94b4b6dce73932c401d`

Branch refreshed from origin/main `1cdb726c9` after main advanced. The merge brings in only main's own
changes: `.github/workflows/warehouse-archive-conveyor.yml`, `.ops/sync/WORK-2026092607.yml`, `.ops/sync/WORK-2026092608.yml`, `.ops/sync/WORK-2026092621.yml`, `.ops/work/WORK-2026092621.md`, `docs/05_operations/WAREHOUSE_ARCHIVE_CONTRACT.md`, `docs/05_operations/WAREHOUSE_HISTORICAL_BACKFILL_PLAN.md`, `docs/05_operations/WAREHOUSE_OBJECT_STORAGE_PROVISIONING.md`, `docs/06_status/lanes/WORK-2026092605.json`, `docs/06_status/lanes/WORK-2026092607.json`, `docs/06_status/lanes/WORK-2026092608.json`, `docs/06_status/lanes/WORK-2026092621.json`, `docs/06_status/proof/WORK-2026092605/diff-summary.md`, `docs/06_status/proof/WORK-2026092605/evidence.json`, `docs/06_status/proof/WORK-2026092605/model-routing.json`, `docs/06_status/proof/WORK-2026092605/verification.md`, `docs/06_status/proof/WORK-2026092607/diff-summary.md`, `docs/06_status/proof/WORK-2026092607/evidence.json`, `docs/06_status/proof/WORK-2026092607/verification.md`, `docs/06_status/proof/WORK-2026092607/work-order.md`, `docs/06_status/proof/WORK-2026092608/diff-summary.md`, `docs/06_status/proof/WORK-2026092608/evidence.json`, `docs/06_status/proof/WORK-2026092608/verification.md`, `docs/06_status/proof/WORK-2026092621/.gitkeep`, `scripts/ops/lane-start.test.ts`, `scripts/ops/lane-start.ts`, `scripts/ops/lease-registry.test.ts`, `scripts/ops/lease-registry.ts`, `scripts/ops/shared.test.ts`, `scripts/ops/shared.ts`, `scripts/ops/truth-check-lib.test.ts`, `scripts/warehouse/README.md`, `scripts/warehouse/backfill.ts`, `scripts/warehouse/conveyor-workflow.test.ts`, `scripts/warehouse/conveyor.test.ts`, `scripts/warehouse/conveyor.ts`. Lane-scope files changed by the merge: 0. Superseded anchor, not
withdrawn: `dd6ce2a08c9a1df7ef25e98a51b7307cb4547db7`. `verify` re-runs on the new head.
