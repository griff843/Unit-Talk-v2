# UTV2-1355 Verification Log

## Verification

### Lines Changed

**`apps/api/src/model-performance-service.ts` (line 175)**

Before:
```ts
const recentSettlements = await repositories.settlements.listRecent(5000);
```

After:
```ts
// Enforce a 30-day lower bound to avoid full-table ORDER BY scan (UTV2-1355)
const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
const recentSettlements = await repositories.settlements.listRecent(5000, since30d);
```

**`apps/api/src/recap-service.ts` (line 154)**

Before:
```ts
const settlements = await repositories.settlements.listRecent(RECENT_SETTLEMENT_LIMIT);
```

After:
```ts
// Pass window.startsAt as the since lower bound to avoid full-table ORDER BY scan (UTV2-1355)
const settlements = await repositories.settlements.listRecent(RECENT_SETTLEMENT_LIMIT, window.startsAt);
```

### pnpm type-check

```
> pnpm exec tsc -b tsconfig.json
(exit 0 — no output means clean)
```

Result: **PASS**

### pnpm test TAP summary

```
1..19
# tests 19
# suites 0
# pass 19
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 874.298525
```

Result: **PASS**

### R-level check

```
$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 8
Rules matched: (none) — no R-level artifacts required for this diff
```

Result: **PASS**

## pnpm test:db

Command: `pnpm test:db`
Status: **FAIL** — pre-existing statement timeout, unrelated to this lane's call-site fixes

`pnpm test:db` was run against the live Supabase project (`zfzdnfwdarxucxtaojxm`). All 7
subtests timed out via `settlement_records.listRecent` in the CLV computation path
(`clv-feedback.ts → processSubmission → DatabaseSettlementRepository.listRecent`).

Root cause: `settlement_records` has no index on `created_at`. The table requires a full
sequential scan even with a `since` lower-bound. This lane adds `since` bounds at two
call sites (`model-performance-service.ts`, `recap-service.ts`); the `clv-feedback.ts`
call at line 45 already passes a 30-day `cutoffIso` but still times out because no index
exists to make the bounded scan fast. An index on `settlement_records(created_at)` is the
remaining infrastructure requirement.

Basic DB connectivity confirmed: `scripts/ci/required-db-smoke.ts` passes in under 2s.

## Tier

**T2** — call-site only, no DDL, no migrations.

<!-- merge_sha: to be bound by post-merge-lane-close.yml after PR merges -->
