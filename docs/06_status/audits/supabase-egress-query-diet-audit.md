# Supabase Egress and Query Diet Audit

Issue: UTV2-1372
Date: 2026-07-07
Author: Claude (T2 read-only audit lane)
Scope: read-only only, per issue acceptance criteria — no code, query, or configuration changes made.

## Summary

This audit maps query-pattern cost drivers across the codebase (select-star usage, pagination coverage, CI/live-DB query volume) and cross-references them against the storage findings from the companion audit (UTV2-1369, `docs/06_status/audits/supabase-usage-cost-truth-audit.md`). All findings below are from static code search (`grep`) and the Supabase Performance Advisor (read-only lint) — no queries were executed against production data beyond the read-only row-count/size checks already captured in the UTV2-1369 audit.

**Headline finding:** 90 `select('*')` call sites exist across `packages/db/src` and the three app runtimes (`apps/api`, `apps/ingestor`, `apps/worker`), concentrated heavily in `packages/db/src/runtime-repositories.ts` (the canonical repository layer). Of 178 total `.select(` calls in that one file, only 41 pair with a `.limit(` call anywhere in the file and only 4 use true `.range()`-based pagination — meaning the large majority of query call sites have no enforced upper bound on rows returned, which directly drives egress cost on any table whose row count grows (several of which are the multi-GB tables identified in UTV2-1369).

## Query-Class Cost Drivers

### 1. `select('*')` prevalence

| Location | Count |
|---|---:|
| `packages/db/src/runtime-repositories.ts` | ~78 of the 90 total (majority) |
| `packages/db/src/market-family-trust-repository.ts`, `syndicate-board-repository.ts` | a few each |
| `apps/worker/src/certification-runtime.ts` | 2 |

`select('*')` over PostgREST always returns every column, including large JSON/JSONB metadata/payload columns where present — this is a direct row-width (and therefore egress-byte) cost multiplier compared to naming only the columns a caller actually uses. This audit did not verify, call-by-call, which of the 90 sites touch wide-column tables versus narrow ones — that per-call-site classification is exactly the kind of implementation-adjacent work reserved for a follow-up lane.

### 2. Pagination coverage

In `packages/db/src/runtime-repositories.ts`: 178 `.select(` calls, 41 `.limit(` calls, 4 `.range(` calls (file-level counts, not a verified 1:1 pairing per call site — a follow-up lane should confirm which specific `select` sites are genuinely unbounded versus already scoped by a `.eq()`/id-lookup that naturally returns ≤1 row). At face value, fewer than a quarter of select calls in this file have any visible row-count bound in the same file, which is a real signal worth a bounded per-call-site follow-up audit even though this pass didn't verify each one individually.

### 3. CI / live-DB query volume

46 test files across `apps/api`, `apps/ingestor`, and `apps/worker` execute live queries directly against Supabase (identified via `createServiceRoleDatabaseConnectionConfig`/`SUPABASE_SERVICE_ROLE_KEY` usage in test files, excluding in-memory-repository tests). Every `pnpm verify` run — which fires on every PR push and every merge-to-main CI run — executes all 46 of these files, each potentially issuing multiple live queries. This is a recurring, compounding egress/compute cost that scales with PR/push volume, not with production traffic, and is easy to overlook when reasoning about "usage cost" in terms of end-user activity alone.

### 4. Cross-reference to storage findings (UTV2-1369)

The two largest storage cost drivers identified in the companion audit — `provider_offers_legacy_quarantine` (6.5 GB) and `provider_offer_history` partitions (~7.6 GB combined) — are exactly the kind of tables where an unbounded `select('*')` becomes expensive per-call as row counts grow. This audit did not confirm whether any of the 90 `select('*')` call sites specifically target these two table families (that cross-reference is itself follow-up-lane-sized work), but flags it as the highest-value place to start the per-call-site pairing recommended above.

## Cache Opportunities (observed, not implemented)

- `getCatalog()` in `DatabaseReferenceDataRepository` (`packages/db/src/runtime-repositories.ts`) issues 7 parallel queries (`sports`, `sport_market_type_availability`, `stat_types`, `combo_stat_types`, `sportsbooks`, `cappers`, `participants` filtered to teams) to build what is, by its own nature, largely static reference data (sports, market types, sportsbooks). This is a strong caching candidate — reference data of this kind changes rarely and is queried on every reference-data API call.
- The Performance Advisor's 153 unused-index findings (shared with UTV2-1369) are index-storage/write-overhead cost, not directly a query/egress cost — listed for completeness but the primary relevant finding for *this* audit's query-diet scope is the 137 unindexed-foreign-key findings, since a missing FK index forces the query planner toward sequential scans on joins, increasing per-query compute and (for large tables) egress if the scan touches more rows than a proper index seek would.

## Immediate Cost Stop Conditions

Read-only observations only — no changes made in this lane:

1. **No column-scoped `select()` audit exists today.** The 90 `select('*')` sites are a mechanical, enumerable follow-up: replacing `select('*')` with an explicit column list on any hot-path query touching a large table is typically a pure win (less egress, same correctness) as long as all currently-used columns are included in the new list.
2. **No verified per-call-site pagination coverage exists.** The file-level 41-limit/178-select ratio is a signal, not a diagnosis — a follow-up lane should pair each `select` with its actual bound (a `.eq()` on a unique key, a `.limit()`, a `.range()`, or none) to find genuinely unbounded queries.
3. **CI live-DB query volume (46 test files) is a fixed recurring cost per push/PR**, independent of production traffic. If Supabase egress/compute cost is scaling faster than user-facing activity would suggest, CI query volume is a candidate explanation worth measuring directly (e.g., via Supabase's request logs, which this read-only audit did not have access to).
4. **`getCatalog()`'s 7-query fan-out for largely-static reference data** is a concrete, low-risk caching candidate for a follow-up lane.

## Follow-up Lanes (implementation, not this lane)

Per this lane's acceptance criteria, no query rewrite or optimization was implemented here. Recommended follow-up lanes, each requiring its own PM gate before implementation:

1. Per-call-site audit of the 90 `select('*')` sites: classify each as safe-to-narrow vs. genuinely needs all columns, prioritizing sites that touch `provider_offer_history`/`provider_offers_legacy_quarantine`/`system_runs` (the largest tables per UTV2-1369).
2. Per-call-site pagination audit in `runtime-repositories.ts`: confirm which of the 178 `select` sites are genuinely unbounded and add `.limit()`/`.range()` where appropriate.
3. Add a cache layer (in-memory TTL cache, or a materialized view) for `DatabaseReferenceDataRepository.getCatalog()`'s largely-static reference data.
4. Measure actual CI-driven Supabase request/egress volume (would require Supabase request-log or billing-dashboard access this audit did not have) to quantify the CI cost-driver hypothesis in dollar terms.
5. Add covering indexes for the highest-traffic of the 137 unindexed foreign keys (shared finding with UTV2-1369; join-performance benefit).

## What this audit could not do (tooling limitation, disclosed per instruction)

This audit relied on static code search (`grep`) rather than live query-plan analysis (`EXPLAIN ANALYZE`) or Supabase's request-log/egress-metering API, neither of which was available through the tools connected to this session. The `select('*')`/pagination findings above are therefore prevalence signals from source code, not measured runtime cost per query — a follow-up lane with query-plan or request-log access would produce a more precise dollar-cost ranking.
