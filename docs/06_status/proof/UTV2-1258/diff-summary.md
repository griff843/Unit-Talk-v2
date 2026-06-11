# UTV2-1258 Diff Summary

## Problem

`runGradingPass` called `picks.listByLifecycleState` with no limit or offset. Supabase's PostgREST default row cap is 1000 — picks submitted after the 1000th row in `posted` or `awaiting_approval` state were never reached by grading. Newer CLV-join picks (created by UTV2-1253) that sort later by `created_at` accumulated but never settled.

## Files Changed

| File | Change |
|------|--------|
| `packages/db/src/repositories.ts` | Added `offset?: number` to `listByLifecycleState` and `listByLifecycleStates` interface signatures |
| `packages/db/src/runtime-repositories.ts` | InMemory: slice by offset before limit. Database: use `.range(offset, offset+limit-1)` when both present |
| `apps/api/src/grading-service.ts` | Added `fetchAllByLifecycleState` (page=500 loop); replaced two bare `listByLifecycleState` calls in `runGradingPass` |
| `apps/api/src/grading-cron.test.ts` | Added pagination test: 1050 mock picks, verifies 3 paginated calls and all 1050 returned |

## Key Design Decisions

1. **Page size 500**: Half the Supabase default cap (1000). Leaves headroom for query overhead. Two pages handle up to 1000 picks with the same latency as the old single call.

2. **Loop termination on `page.length < PAGE_SIZE`**: Standard cursor-free pagination. No off-by-one risk with row count queries.

3. **Interface-level offset**: Added to both `repositories.ts` interface and both InMemory + Database implementations. The interface is the contract — callers other than grading that need pagination can use the same mechanism.

4. **No `listByLifecycleStates` change in `runGradingPass`**: That method is not used in grading. Interface updated for completeness; no callers changed.

5. **`fetchAllByLifecycleState` exported**: Exported for direct test coverage without requiring full repository setup.
