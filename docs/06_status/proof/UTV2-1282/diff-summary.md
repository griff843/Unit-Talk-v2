# UTV2-1282 — Diff Summary

Fix MLB offer persistence: bound the opening-line dedup lookup (partition pruning)
and stop overlapping ingestor cycles from piling onto the DB.

## Problem (live evidence, prod @ 3336491a, 2026-06-18)

UTV2-1281 fixed the prop-**fetch** hang; the MLB cycle now gets past the fetch but
dies in the **DB** phase:
- `Failed to load existing provider offer history: canceling statement due to statement timeout`
- `provider_offer_history` partitioned into **60 daily partitions**; the dedup lookup
  filtered only `snapshot_at < beforeSnapshotAt` (≈ now) — **no lower bound**, so it
  scanned every partition.
- **EXPLAIN** of the lookup: `Append` over **~48 partitions** (`Subplans Removed: 12`
  = future partitions only), even though the matching rows live in the current-day
  partition. The `(provider_event_id, snapshot_at)` index already exists per partition.
- Multiple MLB cycles ran **concurrently** (3 `running` at once); the 240s timeout's
  orphaned work kept running and the next cycle started another overlapping MLB cycle
  → DB overload → cascading statement-timeout + schema-cache errors → 0 offers persisted.

## Fix

### 1. Bound the dedup lookup → partition pruning (no migration)
- `packages/db/src/repositories.ts` + `runtime-repositories.ts` — `findExistingCombinations`
  gains an `afterSnapshotAt` option; the DB impl adds `.gte('snapshot_at', afterSnapshotAt)`,
  the in-memory impl mirrors it.
- `apps/ingestor/src/ingest-league.ts` — passes `afterSnapshotAt = snapshot − 72h`
  (`OPENING_DEDUP_LOOKBACK_HOURS`). Postgres prunes from ~48 partitions to ~3 recent ones.
  Opening-line detection only needs recent history (events snapshot every cycle), and
  SGO's own per-offer opening signal still applies — freshness gate unchanged.

### 2. Per-league singleton (no overlap)
- `apps/ingestor/src/ingestor-runner.ts` — `runIngestorCycles` tracks `leagueInFlight`.
  A league whose prior cycle's work is still in flight is **skipped** (clear telemetry
  warning) instead of started as an overlapping cycle.

### 3. Terminal timeout / lease release
- `ingestLeagueWithTimeout` gains an `onWorkSettled` hook that fires when the **underlying
  work** truly settles (not when the timeout race settles). On timeout the runner holds
  the singleton (does not clear it) until the orphaned work settles, then releases — so a
  timed-out league's still-running work can never overlap a new cycle. The cycle is
  terminalized as a failed run by the work's own catch (now fast, since the dedup query
  no longer hangs).

## Files

- `packages/db/src/repositories.ts` — `findExistingCombinations` interface + `afterSnapshotAt`.
- `packages/db/src/runtime-repositories.ts` — DB `.gte()` lower bound + in-memory mirror.
- `apps/ingestor/src/ingest-league.ts` — pass `afterSnapshotAt`; `OPENING_DEDUP_LOOKBACK_HOURS`.
- `apps/ingestor/src/ingestor-runner.ts` — singleton + `onWorkSettled` terminal-release.
- `apps/ingestor/src/ingestor-cycle-singleton.test.ts` (new) — 4 focused tests.
- `apps/ingestor/package.json` — wire the new test into the package test script.
- `.ops/sync/UTV2-1282.yml` — lane sync metadata.

## Out of scope

No migration (index exists). Freshness gate unchanged. Event-centered ingestion model
unchanged. No backfill, no fabricated picks, no production evidence mutation beyond
normal ingestor behavior. `missing_event_context` (SUPPRESS noise) untouched.
