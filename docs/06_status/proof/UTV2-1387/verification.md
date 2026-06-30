# UTV2-1387 Verification

## Summary

Implements Discord delivery routing adapters in `apps/worker/src/delivery-adapters.ts`:
- `resolveDiscordDeliveryRoute()` — dispatcher for Discord delivery targets
- `resolveDiscordGameThreadRoute()` — routes to mapped game thread (falls back to parent channel with structured warning)
- `resolveDiscordStrategyRoomRoute()` — creates DM channel via `POST /users/@me/channels`, then delivers

No production Discord delivery targets were activated by this lane. Distribution activation requires separate governance work per acceptance criteria.

## Evidence

### Issue-specific tests

4 new adapter tests in `apps/worker/src/delivery-adapters.test.ts`:
- Game-thread to mapped thread — PASS
- Game-thread fallback to parent channel — PASS
- Strategy-room DM creation + delivery — PASS
- Strategy-room retryable failure on DM channel 503 — PASS

No live Discord calls were made; Discord HTTP behavior was tested with injected `fetchImpl`.

### Full test suite

```
npx tsx --test apps/worker/src/delivery-adapters.test.ts  → 4 tests PASS
npx tsx --test apps/worker/src/worker-runtime.test.ts apps/worker/src/delivery-adapters.test.ts  → 66 tests PASS
```

### pnpm test:db

```
TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
  ---
  duration_ms: 17615.145693
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
  ---
  duration_ms: 15238.483534
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
  ---
  duration_ms: 20960.277165
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
  ---
  duration_ms: 22636.037733
  type: 'test'
  ...
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
  ---
  duration_ms: 5182.671592
  type: 'test'
  ...
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
  ---
  duration_ms: 20922.123241
  type: 'test'
  ...
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
  ---
  duration_ms: 17975.234342
  type: 'test'
  ...
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 107840.436554
```

## Verification

- `pnpm type-check` — PASS
- `pnpm test` — PASS
- `pnpm test:db` — PASS (7/7 live DB smoke tests above)
- `pnpm verify` — PASS (includes verify:static, test:db, test:t1-proof:live)
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` — PASS

### R-level compliance — scripts/ci/r-level-check.ts

```
Verdict: PASS
Changed files: adapter code + tests + proof
Rules matched: (none) — no R-level artifacts required for this diff
```

## Notes

- Live DB proof emitted existing enrichment timeout warnings and stranded-pick warnings during unrelated proof files; the relevant tests still passed.
- No blocked Discord delivery target was activated by this lane. Production activation requires separate governance work per the acceptance criteria.

## Merge SHA

Merged to main: `c4817007e25e3c08e05bd5d5c54369835e9e21c7`
