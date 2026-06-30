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
