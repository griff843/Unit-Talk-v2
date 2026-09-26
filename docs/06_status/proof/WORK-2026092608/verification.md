# PROOF: WORK-2026092608

MERGE_SHA: 9ddfdce383ba9b760056a29246ad78f2201ce451

> Pre-merge, merge authority does not exist yet. `post-merge-lane-close.yml` binds the merge
> SHA after GitHub supplies the merged-PR attestation.

Issue: WORK-2026092608
Tier: T2
Lane type: governance
Branch: claude/work-2026092608-closeable-lane-start
Head SHA: 479b7b134f396b6d85177de8539d57d3af3ebb86
result: pass

## ASSERTIONS:

- [x] `defaultProofPaths` declares diff-summary.md, evidence.json and verification.md for T1 and T2, and nothing for T3; an existing declared list is not rewritten (shared.test; M1 red).
- [x] The declared set passes closeout P11 at T1 and T2 by filename alone (truth-check-lib.test; M1 red).
- [x] lane-start scaffolds diff-summary.md and verification.md with a `Merge SHA: pending merge` anchor that `rebindMergeShaAnchorsInMarkdown` binds, and never writes a SHA or a `.gitkeep` (lane-start.test; M2, M3 red).
- [x] An unfilled scaffold still fails P12-P14 and carries no checked assertion or fenced evidence (lane-start.test).
- [x] A tracker-linked lane's unstarted issue is moved to In Claude / In Codex after preflight and the manifest write, on all three lane-start paths (M4, M5 red).
- [x] A lane with no tracker issue never touches the tracker; started/completed/canceled issues are never moved; every failure is a warning, never a throw (M6, M7, M8 red).
- [x] Leases whose lane manifest is done/superseded/cancelled/failed are released with actor and reason; merged, non-terminal, missing and unreadable lanes keep theirs; lane-start sweeps before its first lease check (M9-M13 red).

## EVIDENCE:

```
$ pnpm exec tsx --test scripts/ops/shared.test.ts           # tests 133  # pass 133  # fail 0
$ pnpm exec tsx --test scripts/ops/lane-start.test.ts       # tests 74   # pass 74   # fail 0
$ pnpm exec tsx --test scripts/ops/lease-registry.test.ts   # tests 42   # pass 42   # fail 0
$ pnpm exec tsx --test scripts/ops/truth-check-lib.test.ts  # tests 158  # pass 158  # fail 0
$ pnpm exec tsx --test scripts/ops/lane-manifest.test.ts    # tests 35   # pass 35   # fail 0
$ pnpm test:ops                                             # tests 3453 # pass 3453 # fail 0
```

## Verification

Measured on `479b7b134f396b6d85177de8539d57d3af3ebb86` in the lane worktree.

```
$ pnpm test:ops                  -> tests 3452, pass 3452, fail 0
$ pnpm type-check                -> exit 0
$ pnpm exec eslint <7 touched files> -> exit 0
$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD -> PASS, no rules matched
```

`pnpm test` was exercised through `pnpm test:ops`, which contains every touched test file.
`pnpm verify` was not run locally: `ci:assert-staging` refuses the workstation target, so
`verify` comes from CI on the PR head.

Mutation battery. Each mutation applied alone, the named test file run, the file restored
from a pre-mutation copy (file checksums identical before and after; restore rerun green).

| ID | Mutation | Observed |
|---|---|---|
| M1 | `defaultProofPaths` back to tier-shaped | shared.test "declares the full closeable bundle" red; truth-check-lib.test "satisfy P11 at every tier" red |
| M2 | Drop `Merge SHA: pending merge` from the diff-summary scaffold | lane-start.test "scaffolds ... with bindable anchors" red |
| M3 | Scaffold writes `.gitkeep` instead of the template | 11 red, incl. the scaffold test and readmission tests G20/G21/G27/G28/G36/G41/G48-G50 |
| M4 | New-lane path skips `runTrackerStartTransition` | "every lane-start path attempts the tracker transition" red |
| M5 | Return `advanced` without calling `issueUpdate` | "moves an unstarted tracker issue" and "tracker failures are warnings" red |
| M6 | Allow moving an issue out of any state type | "never moves an issue that is already started, done or canceled" red |
| M7 | Rethrow tracker errors | "tracker failures are warnings and never throw" red |
| M8 | Treat `issue_id` as tracker ref (ignore `resolveTrackerRef`) | "a lane with no tracker issue never touches the tracker" red |
| M9 | lane-start skips `runLeaseSweep` | "sweeps terminal leases before its first lease check" red |
| M10 | Sweep ignores lane status | "never releases a lease for a lane that has not closed" red |
| M11 | Sweep never releases | "leaked lease on a done lane" and "every closed-without-completing state" red |
| M12 | `merged` added to the sweepable set | "never releases a lease for a lane that has not closed" red |
| M13 | Registry read error propagates | "unreadable registry is a warning, never a throw" red |

## Merge SHA Binding

Merge SHA: 9ddfdce383ba9b760056a29246ad78f2201ce451
PR: https://github.com/griff843/Unit-Talk-v2/pull/1660
Execution SHA: 479b7b134f396b6d85177de8539d57d3af3ebb86

### Orchestrator review fixes

Two defects found in review and repaired in `28907a15e`:

1. **T3 kept bundle-free.** The first version gave every tier the three-file bundle. T3's proof is
   green CI on the merge SHA (truth-check M7, the tier table), so a bundle would be a tier-policy
   change, not a repair. `defaultProofPaths` returns `[]` for T3 again. Mutation MB (drop the T3
   branch): shared.test red.
2. **A reopened lane keeps its lease.** The sweep read `origin/main` first, so a lane reopened
   locally (main `done`, local `started`) would have lost its live lease. A live local manifest now
   wins. A local `merged` beside a terminal main is a stale copy and does not block the release.
   New test "a lane reopened locally keeps its lease although main reads done". Mutation MA (main
   always wins): that test red.

Re-measured after the fixes: lane-start 74/74, shared 133/133, truth-check-lib 158/158,
`pnpm test:ops` 3453/3453, eslint on the touched files rc=0.

### Re-anchor to `479b7b134f396b6d85177de8539d57d3af3ebb86`

Branch refreshed from origin/main `cb2f347f0` after main advanced. The merge brings in only main's own
changes: `.github/workflows/warehouse-archive-conveyor.yml`, `.ops/sync/WORK-2026092605.yml`, `.ops/sync/WORK-2026092607.yml`, `apps/command-center/e2e/recovery/delivery-truth.spec.ts`, `apps/command-center/src/app/operations/outbox/page.tsx`, `apps/command-center/src/lib/data/delivery-population.test.ts`, `apps/command-center/src/lib/data/outbox.ts`, `docs/05_operations/WAREHOUSE_ARCHIVE_CONTRACT.md`, `docs/05_operations/WAREHOUSE_HISTORICAL_BACKFILL_PLAN.md`, `docs/05_operations/WAREHOUSE_OBJECT_STORAGE_PROVISIONING.md`, `docs/06_status/lanes/WORK-2026092605.json`, `docs/06_status/lanes/WORK-2026092607.json`, `docs/06_status/proof/WORK-2026092605/.gitkeep`, `docs/06_status/proof/WORK-2026092605/diff-summary.md`, `docs/06_status/proof/WORK-2026092605/evidence.json`, `docs/06_status/proof/WORK-2026092605/model-routing.json`, `docs/06_status/proof/WORK-2026092605/verification.md`, `docs/06_status/proof/WORK-2026092607/diff-summary.md`, `docs/06_status/proof/WORK-2026092607/evidence.json`, `docs/06_status/proof/WORK-2026092607/verification.md`, `docs/06_status/proof/WORK-2026092607/work-order.md`, `scripts/warehouse/README.md`, `scripts/warehouse/backfill.ts`, `scripts/warehouse/conveyor-workflow.test.ts`, `scripts/warehouse/conveyor.test.ts`, `scripts/warehouse/conveyor.ts`. Lane-scope files changed by the merge: 0. Superseded anchor, not
withdrawn: `28907a15e92785636e7565e5e69cab1dadb95781`. `verify` re-runs on the new head.
