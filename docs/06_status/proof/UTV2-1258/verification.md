# UTV2-1258 Verification — Fix 1000-row Grading Fetch Cap

merge_sha: f42f3077bcf4312ed9e8eb4eba38dc4d921330ed

## Summary

Adds pagination to `runGradingPass` so picks beyond the Supabase 1000-row PostgREST default cap are reached. Root cause: `listByLifecycleState('posted')` and `listByLifecycleState('awaiting_approval')` were called with no limit/offset, silently truncating at 1000 rows. CLV-join picks submitted after the 1000th always-`posted` row never reached grading.

## Changes

### `packages/db/src/repositories.ts`

Added `offset?: number` to `PickRepository.listByLifecycleState` and `listByLifecycleStates` interface signatures.

### `packages/db/src/runtime-repositories.ts`

- **InMemory**: Sorts by `created_at`, slices by `offset ?? 0`, then takes `limit` items
- **Database**: Uses `.range(offset, offset + limit - 1)` when both `offset` and `limit` are present; falls back to `.limit(limit)` when only limit is set

### `apps/api/src/grading-service.ts`

Added `fetchAllByLifecycleState(picks, state, pageSize=500)` — loops through 500-row pages until the last page is shorter than `PAGE_SIZE`. Replaced two bare `listByLifecycleState` calls in `runGradingPass`.

### `apps/api/src/grading-cron.test.ts`

Added `fetchAllByLifecycleState paginates through more than 1000 picks` test: creates 1050 mock PickRecord entries, verifies 3 paginated calls are made and all 1050 rows are returned.

## Verification

### `pnpm verify:quick`
```
lint: PASS
type-check: PASS
env:check: PASS
```

### `pnpm verify` (full)
```
env:check: PASS
lint: PASS
type-check: PASS
build: PASS
test: PASS (exit 0)
verify:commands: PASS
```

### `pnpm test:db`
```
TAP version 13
ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 182524
```

pnpm type-check: PASS
pnpm test: PASS

### R-level check

```
scripts/ci/r-level-check.ts — R2 (runtime service change) + R3 (repository interface change) triggered
required artifacts: diff-summary.md, verification.md, runtime-health.json — all present
R-level: PASS
```

## Production Impact

- On next deploy: grading passes will fetch all `posted` and `awaiting_approval` picks in 500-row pages, bypassing the 1000-row cap
- Picks submitted after the 1000th row in either lifecycle state now reach grading
- CLV-join picks from UTV2-1253 that accumulated past row 1000 will be graded on the next grading pass

## UTV2-1250 Readiness Impact

Combined with UTV2-1257 (grading-cron now has a managed production home), this unblocks the evidence accumulation pipeline:
- All `awaiting_approval` picks (no matter how many) will have grading pass run against them
- Evidence settlements begin accumulating toward the UTV2-1250 threshold
