# PROOF: UTV2-1516
MERGE_SHA: 6585dde7c5e0e83c07e62ab8b66920412ad30957

ASSERTIONS:
- [x] Local full-verification semaphore serializes preflight's PB1/PB2 heavy type-check/test baseline checks
- [x] `releaseStaleThrottleSlot` no longer treats an epoch-zero `acquired_at` timestamp as falsy-missing (was an infinite-loop bug; fixed with an explicit `Number.isFinite` check)
- [x] `configuredFullVerifyConcurrency`/`acquireFullVerifyThrottle`/`releaseFullVerifyThrottle` exported and covered by 6 new isolated-tmp-dir unit tests
- [x] `lane-maximizer.ts` reports `full_verify_throttle` state via the shared import from `preflight.ts`
- [x] `pnpm test:db` passes against live Supabase

EVIDENCE:
```text
$ pnpm test scripts/ops/preflight.test.ts
# tests 14
# pass 14
# fail 0
```
```text
$ pnpm test:db
TAP version 13
1..7
# tests 7
# pass 7
# fail 0
# cancelled 0
# skipped 0
```
