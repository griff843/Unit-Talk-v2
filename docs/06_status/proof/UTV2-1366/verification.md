# UTV2-1366: markClosingLines compact-source + identity_key fix — Verification

## Summary

Fixed two bugs in `DatabaseProviderOffersRepository.markClosingLines` that caused statement_timeout on every ingestor cycle:

**Bug 1 — wrong source table (SELECT):** The function read from `provider_offer_history` whose `provider_event_id` index (`idx_provider_offer_history_event_snapshot`) is `ON ONLY` — not inherited by the ~60 child partitions. Every call caused a full sequential scan of 1M+ rows, reliably hitting the 30s statement_timeout. Fix: switched SELECT to `provider_offer_history_compact` which has a non-partitioned leading `provider_event_id` index that fires correctly.

**Bug 2 — wrong ID namespace (UPDATE):** The UPDATE on `provider_offer_current` used `.in('id', historyIds)` where `historyIds` are UUIDs from `provider_offer_history`. These are different UUID namespaces — zero rows were ever matched, `is_closing` was never set on current offers. Fix: use `.in('identity_key', identityKeys)` where `identityKey` is the shared text PK between compact and current.

**Added: compact idempotency UPDATE:** The compact table must also have `is_closing = true` set on processed rows, otherwise the same rows would be re-scanned every ingestor cycle (the SELECT filters `is_closing = false`). New step: UPDATE `provider_offer_history_compact.is_closing = true` via `snapshot_id` (the PK) for fast indexed writes.

## File changed

`packages/db/src/runtime-repositories.ts` — `markClosingLines` method (DatabaseProviderOffersRepository)

## Verification

### pnpm verify

```
> @unit-talk/v2@0.1.0 verify:quick
[sync-check] OK (per-issue): branch "claude/utv2-1366-markclosinglines-fix" <-> .ops/sync/UTV2-1366.yml
[system-alignment] verdict=PASS fail=0 warn=0
[automation-coverage] verdict=PASS fail=0 warn=0 classified=15
Environment files passed validation.
ESLint: clean
type-check: clean
build: clean
```

All `pnpm verify` passes (exit 0). Two parallel background runs also exited 0.

### pnpm test:db

```
TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
  ---
  duration_ms: 38696.921564
  ...
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
  ---
  duration_ms: 21880.68854
  ...
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
  ---
  duration_ms: 22629.429336
  ...
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
  ---
  duration_ms: 22517.395117
  ...
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
  ---
  duration_ms: 1712.339075
  ...
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
  ---
  duration_ms: 23174.999965
  ...
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
  ---
  duration_ms: 21078.634834
  ...
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 152477.924119
```

### T1 proof test (UTV2-1366 specific)

```
TAP version 13
# Subtest: UTV2-1366: markClosingLines reads from provider_offer_history_compact — completes in < 5s on a real event (Bug 1)
ok 1 - UTV2-1366: markClosingLines reads from provider_offer_history_compact — completes in < 5s on a real event (Bug 1)
  ---
  duration_ms: 2383.91239
  ...
# Subtest: UTV2-1366: markClosingLines with non-existent event returns 0 quickly — compact-source no-match path (Bug 1)
ok 2 - UTV2-1366: markClosingLines with non-existent event returns 0 quickly — compact-source no-match path (Bug 1)
  ---
  duration_ms: 141.741351
  ...
# Subtest: UTV2-1366: markClosingLines empty events array returns 0 without touching DB
ok 3 - UTV2-1366: markClosingLines empty events array returns 0 without touching DB
  ---
  duration_ms: 1.724966
  ...
1..3
# tests 3
# suites 0
# pass 3
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 3113.336804
```

No-match path: 141ms (vs former ~30s+ timeout). Real-event idempotent path: 2383ms.

### R-level check

```
Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```

## Post-Deploy Verification

Expected production outcome: ingestor cycles should complete all 5 steps (SGO fetch + NHL/MLB/NFL/NBA markClosingLines) without the per-league `"Failed to mark closing lines: canceling statement due to statement timeout"` errors. Observable in Hetzner logs: `succeeded` cycle counts should increase; `failed` counts should drop to zero for the markClosingLines step.

## R-level check

```
Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```
