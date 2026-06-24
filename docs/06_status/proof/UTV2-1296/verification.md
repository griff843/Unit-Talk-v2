# UTV2-1296 — Verification

**Lane:** UTV2-1296 — scope provider_offer_history dedup pre-load by snapshot_at (partition pruning)
**Tier:** T2 · **Lane type:** runtime · **Executor:** Claude
**PR:** #1049 (squash-merged) · **Merge SHA:** `c4a338aa621188b4071df974ff998af1dc5a5a76`
**Deploy:** Deploy run 28060656860 — completed/success. Prod image `ghcr.io/griff843/unit-talk-v2/ingestor:c4a338aa…` live on Hetzner (resident since 22:19:38Z, RestartCount=0).

## Summary

The MLB odds-ingest cycle aborted every cycle on `Failed to load existing provider offer history: canceling statement due to statement timeout`. Root cause: `DatabaseProviderOfferRepository.upsertBatch` dedup pre-load queried `provider_offer_history` by `idempotency_key` only, with no `snapshot_at` predicate. The table is `RANGE(snapshot_at)` partitioned (60 partitions, ~1.39M rows) and its only `idempotency_key` index is the composite unique `(snapshot_at, idempotency_key)`. Without `snapshot_at`, Postgres could neither prune partitions nor seek the composite index, so each of ~150 chunked lookups per MLB cycle scanned every partition → 120s `statement_timeout`. This lane scopes the pre-load to the batch's distinct `snapshot_at` value(s), enabling partition pruning + composite-index seek. The upsert was already idempotent via `onConflict: 'snapshot_at,idempotency_key'`; only the existence probe changed (now keyed on the composite pair, which also corrects the inserted/updated count).

## Verification

### Static (branch)
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

### Live-DB smoke (`pnpm test:db`, real Supabase, branch)
```
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
# tests 7
# pass 7
# fail 0
# skipped 0
```
(`pnpm test:db` = `tsx --test apps/api/src/database-smoke.test.ts`, exit 0)

### Live-DB read-only partition-pruning proof (real Supabase, branch)
`apps/api/src/scripts/utv2-1296-dedup-pruning-proof.ts` runs the EXACT new vs old dedup pre-load query shapes against the live ~1.39M-row partitioned `provider_offer_history` (GET-only, no writes):
```
# sampled snapshot_at=2026-06-23T21:47:14.033+00:00
# sampled idempotency_keys=50
# NEW shape (snapshot_at + idempotency_key): 161ms, rows=50
# OLD shape (idempotency_key only): canceling statement due to statement timeout (Postgres 57014)
ok 1 - snapshot_at-scoped dedup pre-load returns in 161ms (<= 10000ms ceiling) against the live ~1.39M-row partitioned table
# pass 1
# fail 0
```
This reproduces the production failure (old idempotency_key-only shape → `statement_timeout`) and proves the fix (snapshot_at-scoped shape → **161ms**, partition-pruned) directly against live data, read-only.

## Pre-deploy production baseline (read-only, host + DB; 2026-06-23)
- Ingestor SHA `54ef1273` resident/healthy; `league=MLB failed ... provider offer history: canceling statement due to statement timeout` every cycle (19:56, 20:05, 20:14, 20:44, 20:54, 21:01Z).
- `provider_offer_history`: partitioned `RANGE(snapshot_at)`, 60 partitions, 1,386,923 rows; only `idempotency_key` index = composite `(snapshot_at, idempotency_key)`.
- `game_results` NOT frozen (settlement path intact): 491 rows/6h, 1648/48h.

## Post-deploy 8-point production proof (host + read-only DB; 2026-06-23, prod SHA c4a338aa)
| # | Required signal | Result | Evidence |
|---|---|---|---|
| 1 | ingestor resident | **YES** | resident since 22:19:38Z (deploy), healthy |
| 2 | RestartCount flat | **YES** | RestartCount=0 |
| 3 | MLB odds path no longer logs provider_offer_history statement_timeout | **YES** | `Failed to load existing provider offer history` occurrences since deploy = **0**; no `league=MLB failed` on the dedup load (was every cycle pre-deploy) |
| 4 | dedup query prunes by snapshot_at | **YES** | MLB cycle now progresses **past** the dedup load (reaches archive at 22:20:07Z + `markClosingLines`), which it never did pre-deploy. Live read-only proof: snapshot_at-scoped shape **161ms** vs idempotency_key-only shape **statement_timeout (57014)** against the live 1.39M-row table |
| 5 | no statement_timeout / schema-cache / 521 storm | **YES** | dedup `statement_timeout` = 0; no schema-cache/521 storm |
| 6 | finalized-repoll still runs normally | **YES** | `finalized-repoll league=MLB candidates=1` ran 22:24:08Z |
| 7 | game_results keeps moving when candidates exist | **N/A this window** | candidates=1 and not SGO-finalized → nothing to settle (diurnal); settlement path intact (1648 rows/48h) |
| 8 | fresh same-day MLB provider_offer_history rows written post-deploy | **NO — blocked by the separate 240s wall-clock deadline, NOT the dedup** | `poh_since_deploy=0`. The MLB odds cycle ran 22:20:07→22:23:57Z and hit `cycle=1 league=MLB TIMEOUT after 240000ms — failing closed (UTV2-1280/1282)` before offer-persist completed. This is the heavy-slate throughput bottleneck (18.7MB payload + entity-resolve + ~15k offer persist), out of this lane's scope. |

### Outcome
This lane's target — the `provider_offer_history` dedup `statement_timeout` — is **eliminated and proven** (live 161ms vs statement_timeout; 0 prod occurrences; cycle now progresses past the dedup). The MLB odds path's **next** and now-dominant bottleneck is the **240s per-league wall-clock deadline** on the heavy MLB slate (logged as UTV2-1280/1282), which currently prevents fresh-odds persistence. That is a distinct throughput issue tracked separately and is the next runtime first-NO.

## R-level compliance
Diff touches `packages/db/**` (runtime repository) + its test + `apps/api/src/scripts/` proof script + proof docs. `scripts/ci/r-level-check.ts` (CI "R-Level Compliance Check" on PR #1049): **PASS** (green on merge SHA `c4a338aa`).

## Runtime proof row_counts (read-only live Supabase, post-deploy)
runtime_proof row_counts: `provider_offer_history` rows since deploy (22:19:38Z) = 0 (240s wall-clock blocks persist, not the dedup); dedup `statement_timeout` occurrences since deploy = 0; live dedup query latency = 161ms (new shape) vs statement_timeout (old shape); `game_results` = 1648 rows/48h (settlement path intact); ingestor RestartCount = 0.

## Guardrails honored
No DDL, no new index, no migration, no DB mutation, no retention/purge. No public Discord. No P3 cert. UTV2-1042 untouched. No CLV/ROI/edge claims. No backfill. No >48h backlog mutation. No secrets printed. No fabricated proof. No loosened scoring/freshness/settlement thresholds.
