# UTV2-1296 — Verification

**Lane:** UTV2-1296 — scope provider_offer_history dedup pre-load by snapshot_at (partition pruning)
**Tier:** T2 · **Lane type:** runtime · **Executor:** Claude
**PR:** #PENDING · **Merge SHA:** PENDING (bound post-merge by `post-merge-lane-close.yml`)

## Summary

The MLB odds-ingest cycle aborted every cycle on `Failed to load existing provider offer history: canceling statement due to statement timeout`. Root cause: `DatabaseProviderOfferRepository.upsertBatch` dedup pre-load queried `provider_offer_history` by `idempotency_key` only, with no `snapshot_at` predicate. The table is `RANGE(snapshot_at)` partitioned (60 partitions, ~1.39M rows) and its only `idempotency_key` index is the composite unique `(snapshot_at, idempotency_key)`. Without `snapshot_at`, Postgres could neither prune partitions nor seek the composite index, so each of ~150 chunked lookups per MLB cycle scanned every partition → 120s `statement_timeout`. This lane scopes the pre-load to the batch's distinct `snapshot_at` value(s), enabling partition pruning + composite-index seek. The upsert was already idempotent via `onConflict: 'snapshot_at,idempotency_key'`; only the existence probe changed (now keyed on the composite pair, which also corrects the inserted/updated count).

## Static verification (branch)
- `pnpm type-check`: **PASS** (exit 0).
- `pnpm test` (`packages/db` targeted, `provider-offer-repository.test.ts`): **PASS** — 7 pass / 0 fail / 0 skipped. Updated the existing `upsertBatch` test to the chained snapshot_at+idempotency_key dedup probe; added `upsertBatch scopes dedup pre-load to all distinct batch snapshot_ats`.
- `pnpm test` (full suite): **PASS** — see TAP block below.
- `pnpm verify`: PENDING (CI on PR head + merge SHA).

## Full-suite TAP (branch)
```
# tests 3052
# pass 3052
# fail 0
# skipped 0
# suites 95
```
(full `pnpm test` across all workspaces, exit 0)

## Pre-deploy production baseline (read-only, host + DB; 2026-06-23)
- Ingestor SHA `54ef1273` resident/healthy; `league=MLB failed ... provider offer history: canceling statement due to statement timeout` every cycle (19:56, 20:05, 20:14, 20:44, 20:54, 21:01Z).
- `provider_offer_history`: partitioned `RANGE(snapshot_at)`, 60 partitions, 1,386,923 rows; only `idempotency_key` index = composite `(snapshot_at, idempotency_key)`.
- `game_results` NOT frozen (settlement path intact): 491 rows/6h, 1648/48h.

## Post-deploy 8-point production proof (host + read-only DB) — PENDING DEPLOY
| # | Required signal | Result | Evidence |
|---|---|---|---|
| 1 | ingestor resident | PENDING | |
| 2 | RestartCount flat | PENDING | |
| 3 | MLB odds path no longer logs provider_offer_history statement_timeout | PENDING | |
| 4 | dedup query prunes by snapshot_at (fresh MLB odds cycle completes) | PENDING | |
| 5 | no statement_timeout / schema-cache / 521 storm | PENDING | |
| 6 | finalized-repoll still runs normally | PENDING | |
| 7 | game_results keeps moving when candidates exist | PENDING | |
| 8 | fresh same-day MLB provider_offer_history rows written post-deploy | PENDING | |

## R-level compliance
Diff touches `packages/db/**` (runtime repository) + its test + proof. R-level check on PR head: PENDING (CI).

## Guardrails honored
No DDL, no new index, no migration, no DB mutation, no retention/purge. No public Discord. No P3 cert. UTV2-1042 untouched. No CLV/ROI/edge claims. No backfill. No >48h backlog mutation. No secrets printed. No fabricated proof. No loosened scoring/freshness/settlement thresholds.
