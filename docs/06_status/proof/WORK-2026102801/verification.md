# PROOF: WORK-2026102801

MERGE_SHA: f4354929bd700d105f8103eb61038c174c0958f1

Issue: WORK-2026102801
Tier: T2
Branch: codex/work-2026102801-track-only-settlement-queue
Executor: codex-cli (codex-luna-medium; routing evidence in `model-routing.json`)
Head SHA (last non-proof commit): 4fdc61527e01ba1626b4c8b8881cb439c80aa8ae
result: pass

## ASSERTIONS:

- [x] `getResultsOpsSnapshot` returns `trackOnlyAwaitingSettlement` (at most 50 rows, oldest first) and an authoritative count. Both read `picks_current_state` through `applyOperatorPickPopulation` with `settlement_recorded_at IS NULL`, `metadata->>distributionMode = 'track-only'` and `status <> 'voided'` (`results-ops.test.ts` asserts each query parameter).
- [x] Settled, voided and delivered picks are excluded; ordering is oldest-first (same test).
- [x] The Settlement page shows a "Track Only — Awaiting Settlement" stat card and a table whose rows link to `/picks/<id>`, with an explicit empty state.
- [x] Every selected column exists on `picks_current_state` in `packages/db/src/database.types.ts`.
- [x] Read-only: no settlement, write, API, schema, delivery, authentication or attribution change.

## EVIDENCE:

```text
$ pnpm exec tsx --test apps/command-center/src/lib/data/results-ops.test.ts
# tests 1  # pass 1  # fail 0
$ pnpm test:command-center
# tests 695  # pass 695  # fail 0
$ pnpm --filter @unit-talk/command-center type-check
exit 0
```

The orchestrator (Claude) re-ran all three in the lane worktree on 2026-10-28 with the same result.

Production read-only check, 2026-10-28: the same predicate against canonical `picks_current_state` matches zero rows. The only Track Only pick in production (fa5e1dd2, Kingro623) has `settlement_recorded_at` set, so its absence from the queue is correct.

Writable live DB: not applicable to a read-only Command Center query. The local run was refused by the staging identity guard as designed (target identity unresolved); the protected staging-ci proof runs in the required CI `verify` context.

## Verification

- `pnpm verify`: executed by the required CI `verify` check on the PR head (verification of record). Locally, Codex ran `pnpm verify:static`: PASS.
- `pnpm type-check`: PASS (Codex, repository-wide; orchestrator re-ran the Command Center type-check: exit 0).
- `pnpm test` (focused): `results-ops.test.ts` 1/1 PASS; `pnpm test:command-center` 695/695 PASS. Codex's repository-wide `pnpm test` run reported 13 failures outside the touched surface; CI `verify` on the PR head is the authority.
- `pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS, no R-level rules matched.

## Merge SHA Binding

Merge SHA: f4354929bd700d105f8103eb61038c174c0958f1
PR: https://github.com/griff843/Unit-Talk-v2/pull/1796
Execution SHA: 4fdc61527e01ba1626b4c8b8881cb439c80aa8ae
