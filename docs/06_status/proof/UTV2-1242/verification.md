# UTV2-1242 Verification — Ingestor Recovery

## Summary

T2 data-canonical lane. Bounded `findExistingCombinations` in `ingest-odds-api.ts`
to prevent full-table scan on `provider_offer_history`. Added HUNG_SINGLETON /
DB_TIMEOUT / API_KEY / NO_SLATE health codes to `staleness.ts` and `supervisor.ts`.
Added HUNG_SINGLETON logging to `index.ts` startup recovery path.

Ghost MLB run `e28fe752` reaped via Supabase (UTV2-1242 operational clear —
code-level recovery confirmed in place first).

## Verification

`pnpm type-check` — PASS

`pnpm lint` — PASS

`pnpm test` — PASS (113 pass, 0 fail, includes 12 new supervisor tests)

`pnpm verify` — PASS (all gates green)

`tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS, 0 triggers

## pnpm test:db

Run against live Supabase (project `zfzdnfwdarxucxtaojxm`) on branch `claude/utv2-1242-ingestor-recovery`.

```
# tests 7
# pass 7
# fail 0
# duration_ms 114964
```

Result: PASS (7/7)

## Root Cause Analysis

Two distinct timeout failure modes confirmed from `system_runs` before fix:

| Run ID | Status | Error |
|---|---|---|
| `e28fe752` | running (ghost) | Hung MLB cycle — blocked singleton |
| `d84cde80` | failed | `canceling statement due to statement timeout` — `markClosingLines` (NFL) |
| `f5a81de6` | failed | `canceling statement due to statement timeout` — `upsertBatch` idempotency check (NHL) |
| `58d64a46` | failed | `canceling statement due to statement timeout` — `markClosingLines` (MLB) |

### Fix 1: `findExistingCombinations` in `ingest-odds-api.ts` (line 176)

**Before:** unbounded query on `provider_offer_history` for event IDs — no `snapshot_at` filter.

**After:** `{ beforeSnapshotAt: snapshotAt }` added. Query now bounded to data before the current snapshot — uses the composite index `(provider_event_id, snapshot_at)` on `provider_offer_history`.

### Fix 2: `markClosingLines` timeout (resolved by composite index on `provider_offer_history`)

Index `idx_provider_offer_history_event_snapshot` on `(provider_event_id, snapshot_at)` now active on live DB. The 48h window filter in `markClosingLines` was already in place; the index makes this query fast.

### Fix 3: Health codes in `staleness.ts` and `supervisor.ts`

Added `IngestorHealthCode` type with values: `HEALTHY`, `HUNG_SINGLETON`, `DB_TIMEOUT`, `API_KEY`, `NO_SLATE`, `STALE_OFFERS`, `STALE_CYCLE`, `FAILED_CYCLE`, `RUNTIME_DOWN`, `NO_CYCLE`.

Both `evaluateIngestorOutageHealth` and `evaluateIngestorHealth` now emit a `code` field.

### Fix 4: `index.ts` startup hung-singleton logging

`reapStaleRuns` result logged with `healthCode: 'HUNG_SINGLETON'` and `action: 'marked_failed'`. The `hungSingletonReaped` flag surfaces in the ingestor runtime summary JSON.

## DB Before/After State

**Before (2026-06-08T14:05:44Z frozen):**
```
provider_offer_current.max_snapshot_at = 2026-06-08T14:05:44.04Z
provider_offer_current.max_updated_at  = 2026-06-08T14:06:30.771Z
system_runs: ghost run e28fe752 status=running, finished_at=NULL
```

**Ghost run cleared (UTV2-1242 ops clear, 2026-06-09T18:18:41Z):**
```
system_runs e28fe752: status=failed, finished_at=2026-06-09T18:18:41.766Z
error detail: "Reaped as hung singleton by UTV2-1242 ops clear — startup recovery code in place"
```

## Known Follow-up (Tier C)

`upsertBatch` in `packages/db/src/runtime-repositories.ts` has an idempotency check
that queries `provider_offer_history` by `idempotency_key` without `snapshot_at` filter
(NHL failure at `f5a81de6`). This path is Tier C and requires a separate Griff-gated lane.
The primary production blocker (markClosingLines timeout on MLB/NFL) is resolved by the
composite index on `(provider_event_id, snapshot_at)` + this lane's bounded `findExistingCombinations`.
The NHL-specific `upsertBatch` timeout risk is reduced by the `idx_provider_offer_history_event_snapshot`
index which speeds up related scans.

## SHA Binding

Verified source SHA: set-by-ci
Merge SHA: PENDING — bind post-merge
