# Diff Summary — UTV2-1315 markClosingLines snapshot_at partition-pruning fix

**Lane:** UTV2-1315
**Tier:** T2 runtime
**Branch:** claude/utv2-1315-markclosinglines-snapshot-at-lower-bound
**Generated at:** 2026-06-25T15:00:00Z

---

## Changes

### Files modified

- `packages/db/src/runtime-repositories.ts` — one line added to `DatabaseProviderOfferRepository.markClosingLines`

### Diff

```diff
-        .eq('provider_event_id', providerEventId)
-        .lt('snapshot_at', commenceTime)
-        .eq('is_closing', false)
+        .eq('provider_event_id', providerEventId)
+        .gte('snapshot_at', windowStart)
+        .lt('snapshot_at', commenceTime)
+        .eq('is_closing', false)
```

**Location:** `DatabaseProviderOfferRepository.markClosingLines`, line ~5103

---

## Root cause addressed

`provider_offer_history` is daily-partitioned (60+ partitions). The SELECT in `markClosingLines` had only an upper-bound on `snapshot_at` (`.lt('snapshot_at', commenceTime)`), causing Postgres to scan all 60+ partitions for each started event on every ingestor cycle. With a full MLB slate this causes a statement_timeout unconditionally.

`windowStart = snapshotAt - 48h` was already computed at line 5080 for the JavaScript-side event filter but was not passed to the DB query.

This is the same partition-pruning pattern applied in UTV2-1296 to `findExistingCombinations`. `markClosingLines` was not included in that fix.

---

## Scope

- No schema changes
- No migrations
- No new columns or tables
- Single line added to SELECT builder in one method

R-level check: PASS — 2 changed files, no R-level artifacts required.

---

## Readiness Score Impact

After this lane merges and deploys:

- `ingestor_health`: FAIL → **PASS** (markClosingLines partition scan eliminated; cycles expected to complete cleanly)
- `blockers`: `["ingestor_health"]` → `[]`
- `verdict`: **YELLOW → GREEN** (0 blocking failures)

---

## Merge SHA Binding

**Merge SHA:** `321638ab98b3a25f2ed18b86c0e9aea0fc8784af`
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/1076
**Merged at:** 2026-06-25T16:48:18Z
