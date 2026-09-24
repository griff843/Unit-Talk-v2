# PROOF: WORK-2026092314

MERGE_SHA: f7b9eadb8e0101c19867bd5fd268071f7127864e

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries the
> verified implementation identity. `post-merge-lane-close.yml` rebinds merge authority only
> after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-23T22:40:22.000Z
Issue: WORK-2026092314
Tier: T3
Lane type: governance
Branch: claude/work-2026092314-warehouse-vacuous-tests
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1642
Head SHA: f7b9eadb8e0101c19867bd5fd268071f7127864e
Execution SHA: f7b9eadb8e0101c19867bd5fd268071f7127864e
Diff base: 7159bcdeb2141b4b620f3335122df63fa0d39721
result: pass

## ASSERTIONS:

- [x] `scripts/warehouse/conveyor.test.ts`: the interrupt test resolves each uploaded data key to
      its manifest through `parseDataObjectKey`, `computeManifestId` and `manifestObjectKey`, the
      same resolution `conveyor.ts` uses. It asserts the manifest is absent and not prune-eligible.
- [x] `scripts/warehouse/query.test.ts`: the literal-`false` field assertion and the
      empty-env tautology are replaced. After the query, `duckdb_databases()` on the reader lists
      only `memory`.
- [x] Test files only. No file under `scripts/warehouse/` other than the two tests is changed.

## EVIDENCE:

```
== M1 the lookup loop runs after the retry has written verified manifests
not ok 7 - an interruption after upload leaves no manifest, and the retry completes it
    canonical/markets/nba/2026/2026-08-06/part-0000.parquet has a manifest although it was never verified
== M2 the reader attaches a second database before the query
not ok 3 - the representative query answers a market question from the archive alone
== restored (cmp identical)
# tests 14
# pass 14
# fail 0

$ pnpm exec tsx --test scripts/warehouse/*.test.ts
# tests 108
# pass 108
# fail 0
```

## Verification

- `pnpm type-check` exit 0 on f7b9eadb8e0101c19867bd5fd268071f7127864e
- `pnpm exec eslint` on the 2 changed files: exit 0
- `ops:preflight WORK-2026092314` VERDICT PASS (38 checks)
- CI `verify` on the PR head

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1642
Approved PR head: pending merge
Execution SHA: f7b9eadb8e0101c19867bd5fd268071f7127864e

### Re-anchor to `f7b9eadb8e0101c19867bd5fd268071f7127864e`

Branch refreshed from origin/main `893cc0667` after main advanced. The merge brings in only main's own
changes: `.ops/sync/WORK-2026092308.yml`, `.ops/sync/WORK-2026092312.yml`, `.ops/sync/WORK-2026092405.yml`, `apps/api/src/model-performance-service.test.ts`, `apps/api/src/model-performance-service.ts`, `apps/api/src/t1-proof-utv2-1137-settlement-corrections.test.ts`, `docs/02_architecture/HISTORICAL_MARKET_DATA_WAREHOUSE.md`, `docs/05_operations/SGO_REACTIVATION_GATE.md`, `docs/05_operations/WAREHOUSE_HISTORICAL_BACKFILL_PLAN.md`, `docs/05_operations/WAREHOUSE_OBJECT_STORAGE_PROVISIONING.md`, `docs/06_status/lanes/WORK-2026092308.json`, `docs/06_status/lanes/WORK-2026092312.json`, `docs/06_status/lanes/WORK-2026092405.json`, `docs/06_status/proof/WORK-2026092308/evidence.json`, `docs/06_status/proof/WORK-2026092308/verification.md`, `docs/06_status/proof/WORK-2026092312/.gitkeep`, `docs/06_status/proof/WORK-2026092312/diff-summary.md`, `docs/06_status/proof/WORK-2026092312/verification.md`, `docs/06_status/proof/WORK-2026092405/diff-summary.md`, `docs/06_status/proof/WORK-2026092405/verification.md`, `docs/06_status/proof/WORK-2026092405/work-order.md`, `docs/06_status/readiness/readiness-score.json`, `docs/mission/plan.md`. Lane-scope files changed by the merge: 0. Superseded anchor, not
withdrawn: `13c0ad82023802cde7fca9dae7860b3981bf04d7`. `verify` re-runs on the new head.
