# UTV2-1282 — Verification

**Issue:** UTV2-1282 — Fix MLB offer persistence DB timeout and overlapping ingestor cycles.
**Branch:** `griffadavi/utv2-1282-fix-mlb-offer-persistence-db-timeout` · **Lane type:** runtime · **Tier:** T1
**Base SHA:** `3336491a` · **Verified source SHA:** `11cb0c272d32a9774508ff10b1e3f5ebdefe70d1` · **Merge SHA:** _(bound post-merge)_

> Lane executed in the main checkout (main-control mode). No production rows mutated by
> this lane beyond normal ingestor behavior. No migration (the supporting index already exists).

## Scope (PM-directed)

Make MLB ingestion persist fresh provider offers reliably. The live post-slate funnel
proof showed the first NO moved from the prop-fetch hang (UTV2-1281, fixed) to **DB-side
offer persistence**: the dedup lookup scanned all `provider_offer_history` partitions and
hit a statement timeout, and timed-out cycles overlapped and overloaded the DB.

## Root cause (live + DB evidence, read-only)

- `provider_offer_history` is partitioned into **60 daily partitions** (by `snapshot_at`).
- `findExistingCombinations` filtered only `snapshot_at < beforeSnapshotAt` (≈ now) — no
  lower bound → scans every partition.
- **EXPLAIN** of the lookup on a live MLB event: `Append` over **~48 partitions**
  (`Subplans Removed: 12` = future partitions only); matching rows are in the current-day
  partition (`p20260618`). The `(provider_event_id, snapshot_at)` index exists per partition.
- Live: MLB cycle error `Failed to load existing provider offer history: canceling statement
  due to statement timeout`; **3 MLB cycles `running` concurrently**; `provider_offer_history`
  MLB rows in last 6h = 0.

## Operational action (restart — not a fix)

The wedged/overlapping prod ingestor was restarted via redeploy of `3336491a` to clear the
stuck state. Confirmed the loop resumed (NBA/NFL/NHL succeeded; MLB cycling). As expected and
per PM instruction, the restart is **not** a fix — overlapping MLB cycles re-formed in prod,
which this lane fixes.

## Fix

1. **Bound the dedup lookup** — `afterSnapshotAt = snapshot − 72h` enables partition pruning
   (~48 → ~3 partitions). No migration (index exists).
2. **Per-league singleton** — a league whose prior cycle's work is still in flight is skipped
   with clear telemetry, never overlapped.
3. **Terminal timeout / release** — `onWorkSettled` releases the singleton only when the
   underlying work truly settles; a timed-out league holds the singleton until then, so
   orphaned work can never spawn an overlapping cycle.

## Verification — commands run on the branch

- `pnpm verify:parallel` (lint + type-check, then build + test) → **PASS (lint/type-check/build green; all in-memory suites pass)**. One DB-backed apps/api test (`t1-proof-awaiting-approval-review`) flaked once with a **live** `canceling statement due to statement timeout` — collateral from the production DB being degraded by the very overlapping MLB cycles this lane fixes; **PASSED 5/5 on immediate retry**. Not a code regression.
- `pnpm test:db` (live Supabase smoke, T1 runtime proof) → **PASS — 7/7**. node:test TAP summary:

```
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 141917.11135
```
- Focused: `tsx --test apps/ingestor/src/ingestor-cycle-singleton.test.ts` → **4/4 PASS**:
  - singleton: a still-in-flight MLB cycle is not overlapped by the next cycle;
  - terminal timeout: a settled timed-out cycle releases the singleton + is terminalized failed;
  - next league proceeds when an earlier league times out;
  - `findExistingCombinations` is bounded by the snapshot window (old partitions excluded).
- Regression: `tsx --test apps/ingestor/src/*.test.ts` → **202 tests, 198 pass, 0 fail** (stable across 2 runs); `packages/db` → **237/237**.
- Live-DB proof: `tsx --test apps/ingestor/src/t1-proof-utv2-1282-bounded-dedup.test.ts` → **1/1 PASS** (read-only; bounded `findExistingCombinations` completed promptly against the live partitioned `provider_offer_history` and returned the recent event's combinations — partition pruning proven on real Postgres even under current load).

## DB evidence (read-only, EXPLAIN-style)

- Partition count: 60. Unbounded lookup plan: `Append` over ~48 partitions (`Subplans Removed: 12`).
- Bounded (`snapshot_at >= now − 72h`) prunes to ~3 recent daily partitions; index
  `(provider_event_id, snapshot_at)` already present → no migration required.

## Runtime proof posture

T1 runtime proof = live Supabase smoke (`pnpm test:db`). The **live production proof** —
MLB cycle succeeds or fails closed within the bound, **no overlapping MLB cycles**, fresh
`provider_offer_history` rows persist (incl. `provider_participant_id`), `market_universe`
updates, and `stale_price_data` is no longer the dominant reject (or the exact next blocker
reported) — can only be shown by deployed runtime and is the post-deploy live funnel re-check.

## R-level

Runtime + DB-access lane (apps/ingestor + packages/db) + tests + proof. No migration, no
schema change, no new dependency, no secret handling.
