# UTV2-1377 Verification

## Verification

- `npx tsx --test packages/db/src/inmemory-constraints.test.ts` passed.
- `pnpm type-check` passed.
- `npx tsx --test packages/db/src/inmemory-constraints.test.ts packages/db/src/settlement-invariants.test.ts scripts/ops/fix-settlement-utv2-665.test.ts` passed.
- `pnpm test` passed.
- `pnpm verify` passed.
- `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD` passed.

## R-level Check

```text
Verdict: PASS
Changed files: 6
Rules matched: (none) — no R-level artifacts required for this diff
```

## pnpm test:db

```text
> pnpm test:db
TAP version 13
# Subtest: database repository bundle persists a submission and settlement when Supabase is configured
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
  ---
  duration_ms: 18969.728079
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
  ---
  duration_ms: 19892.877598
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
  ---
  duration_ms: 18079.608571
  type: 'test'
  ...
# Subtest: UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
  ---
  duration_ms: 17202.66291
  type: 'test'
  ...
# Subtest: UTV2-883: no duplicate participants for the same external_id and sport
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
  ---
  duration_ms: 801.101102
  type: 'test'
  ...
# Subtest: UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
  ---
  duration_ms: 19276.038095
  type: 'test'
  ...
# Subtest: UTV2-996: correction chain is additive — original settlement row is not mutated
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
  ---
  duration_ms: 19129.194266
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
# duration_ms 114174.141855
```

## pnpm verify Tail

```text
ok 5 - UTV2-1327 live-DB: picks table is accessible via listByLifecycleStates
  ---
  duration_ms: 296.8028
  type: 'test'
  ...
# Subtest: UTV2-1327 live-DB: enrichPickAtPromotionTime is stable against real pick schema from DB
ok 6 - UTV2-1327 live-DB: enrichPickAtPromotionTime is stable against real pick schema from DB
  ---
  duration_ms: 148.501749
  type: 'test'
  ...
1..6
# tests 6
# suites 0
# pass 6
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1490.076842
```

## Merge SHA

Merged to main: `10dd8eba933539b21e7a677b080f5db6c218dca8`
