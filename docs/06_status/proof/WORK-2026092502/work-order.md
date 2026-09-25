# WORK-2026092502 — the warehouse can backfill history, and the default policy can name a key

Tier: T1 (mechanical floor: `.github/workflows/`) · Lane type: governance · Executor: claude

Repo-owned work order (tracker independence, ratified 2026-09-05). No Linear issue exists for this
identity by design. Implements `docs/05_operations/WAREHOUSE_HISTORICAL_BACKFILL_PLAN.md` §7.

## Problem

1. `DEFAULT_RETENTION_POLICY` sets `season: 'all'`, which `object-layout.ts` refuses, so
   `dataObjectKey` throws for the only production policy entry. The throw happens before the
   per-item `try` in `runConveyor`, so no failed-item result and no heartbeat are written.
2. Existing history (`provider_offer_history` 2026-05-11 → 2026-06-30,
   `provider_offers_legacy_quarantine` 2026-04-23 → 2026-04-29) is older than the daily
   conveyor's single window and can never reach the warehouse without a bounded backfill.
3. The research read path can resolve the writer key; it must run with the reader key only.

## Outcome

1. Season resolves to the window's year; key construction runs inside the per-item `try`.
2. A `raw/{provider}` target override and a `pruneHold` on policy entries; a pure
   `decideRetentionEligibility` that deletes nothing.
3. `scripts/warehouse/backfill.ts`: `planBackfill` (inclusive, oldest first, ≤ 62 windows, refuses
   backwards/non-ISO/hot windows) and `runBackfill` (one window per `runConveyor`, stop on first
   failure, progress ledger under `manifests/_backfill/`).
4. `warehouse backfill` subcommand; `query` and `doctor --research` run on the reader key only.
5. `warehouse-archive-conveyor.yml`: a main-only `workflow_dispatch` backfill mode in the
   `warehouse-archive` environment, dry-run first; inputs reach the shell only via env.
6. `WAREHOUSE_ARCHIVE_CONTRACT.md` records the reader-only read path and the backfill mode.

## Not in scope

- No live warehouse run, no provisioning, no credentials, no DDL, no prune path of any kind.
- No `package.json` change: backfill tests live in `conveyor.test.ts`, already in `test:ops`.
- Starting a production backfill stays PM-reserved (plan §5).
