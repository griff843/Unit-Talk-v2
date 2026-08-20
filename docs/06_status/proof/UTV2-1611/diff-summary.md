# PROOF: UTV2-1611 — diff summary

MERGE_SHA: 5bf6ccb4c59fa24054b6b9f9412d3586cff2c26c

## What changed

18 files, 53 deletions. The insertion count is deliberately omitted: it counts this bundle's own growth and drifts on every proof edit. Every changed source path is runtime-compatible (`apps/api/src/**`); the remainder are the lane's own manifest, sync file and proof bundle.

```text
 .ops/sync/UTV2-1611.yml                              |  14 +
 apps/api/src/automated-write-boundary.ts             | 321 +++++
 apps/api/src/board-pick-writer.test.ts               |  91 ++-
 apps/api/src/board-pick-writer.ts                    |  72 ++-
 apps/api/src/candidate-pick-scanner.test.ts          |  31 +-
 apps/api/src/candidate-pick-scanner.ts               |  35 +-
 apps/api/src/controllers/submit-pick-controller.test.ts |  44 +-
 apps/api/src/controllers/submit-pick-controller.ts   |  38 +-
 apps/api/src/distribution-service.test.ts            |   9 +-
 apps/api/src/distribution-service.ts                 |  19 +-
 apps/api/src/submission-service.test.ts              | 449 +++++
 apps/api/src/submission-service.ts                   |  26 +-
 apps/api/src/t1-proof-awaiting-approval.test.ts      | 158 +++-
 docs/06_status/lanes/UTV2-1611.json                  |  66 +
 docs/06_status/proof/UTV2-1611/diff-summary.md       |  (self-referential — omitted)
 docs/06_status/proof/UTV2-1611/evidence.json         |  (self-referential — omitted)
 docs/06_status/proof/UTV2-1611/model-routing.json    |  14 +
 docs/06_status/proof/UTV2-1611/verification.md       |  (self-referential — omitted)
```

Two files were deleted: `apps/api/src/automated-write-boundary.test.ts` and `apps/api/src/t1-proof-utv2-1611-board-write-boundary.test.ts`. Their coverage was not dropped — it moved into already-wired roots (see below).

## The five acceptance corrections

1. **`board-construction` / no-marker bypass closed.** Admission is decided by `payload.source` through a three-valued policy (`boundary-required` / `boundary-when-marked` / `human-ingress`), not by `metadata.systemGenerated`. `board-construction` is `boundary-required`, so it is admitted by source with or without the marker — omitting `metadata.systemGenerated` does not create a human path, and an operator-originated board submission is governed identically. Once admitted, a missing producer identity or missing market evidence throws before persistence. A second layer adds `board-construction` to `GOVERNANCE_BRAKE_SOURCES`, and `assertEveryAutomatedSourceIsBraked()` runs at module load so the two mechanisms cannot drift apart again — that drift is what created the defect.
2. **Controller no longer re-applies `awaiting_approval`** after atomic materialization. The unconditional second transition was FSM-forbidden (`awaiting_approval -> awaiting_approval`) and would have rejected correctly-governed submissions the moment `board-construction` joined the brake set. The brake is now state-aware; the audit row distinguishes `materialized_at_birth` from `transition`.
3. **Fabricated midnight event start removed.** `readEventStartTime` no longer invents `T00:00:00Z` when a provider publishes no `starts_at`. That value fed the freshness gate and landed in pick metadata indistinguishable from real evidence, understating an evening start by up to a day and relaxing the gate exactly when it should tighten. Absent evidence now reads as absent.
4. **Live-proof cleanup goes through the lifecycle FSM**, not a direct status `PATCH` that wrote the lifecycle column with no `pick_lifecycle` row.
5. **Regressions for all four**, each failing before its fix.

## Test-surface consolidation

`scripts/ops/executable-wiring.ts` counts reachability from package scripts, workflows and non-test code imports only. A test importing another test is not reachable, which is why the boundary suite's wiring gap was invisible until it became a standalone module.

The coverage therefore moved onto roots that are already wired:

- unit coverage → `apps/api/src/submission-service.test.ts`, named directly by `test:apps-api-core` and the site where the boundary is invoked (73 → 89 tests);
- live staging assertions → `apps/api/src/t1-proof-awaiting-approval.test.ts`, already enumerated in `test:t1-proof:live` and already classified in `db-writer-classification.json`.

Consequently the lane's earlier edits to `package.json` and `docs/05_operations/db-writer-classification.json` were reverted; both are byte-identical to `origin/main`. This removes the `Lane Authority` failure at its cause rather than by widening `.lane/lanes/runtime.yml`, and removes the `Shadow Parity Check` refusal that guarded `package.json`.

## Scope and authorization

Six changed paths lie outside the `file_scope_lock` recorded in the manifest's first commit, which is the only version the file-scope guard trusts. A head-pinned `scope-override/v1` comment is required and **has not been posted**. The manifest records this truthfully and withdraws an earlier self-authored entry that claimed PM authorization which was never granted.

## Blast radius

Runtime write-path behaviour: automated board and scanner productions that previously could persist as `validated` now enter `awaiting_approval` or fail closed. The `validated` initial state is preserved only for sources classified `human-ingress` (`smart-form`, `feed`, `system`, `api`, `discord-bot`); downstream `validated` lifecycle behaviour is unchanged. No schema change, no migration, no dependency change, no production mutation.
