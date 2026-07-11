# PROOF: UTV2-1516
MERGE_SHA: 21eff733cb7098ef838be59def6a74eee5e92ca1

ASSERTIONS:
- [x] Local full-verification semaphore serializes preflight's PB1/PB2 heavy type-check/test baseline checks
- [x] `releaseStaleThrottleSlot` no longer treats an epoch-zero `acquired_at` timestamp as falsy-missing (was an infinite-loop bug; fixed with an explicit `Number.isFinite` check)
- [x] `configuredFullVerifyConcurrency`/`acquireFullVerifyThrottle`/`releaseFullVerifyThrottle` exported and covered by 6 new isolated-tmp-dir unit tests
- [x] `lane-maximizer.ts` reports `full_verify_throttle` state via the shared import from `preflight.ts`
- [x] `pnpm test:db` passes against live Supabase
- [x] Follow-up: `proof-generate.ts`'s `DEFAULT_VERIFICATION_COMMANDS` now includes `pnpm verify` and an `r-level-check.ts` mention, so a freshly-regenerated `verification.md` satisfies truth-check-lib's P13/P14 checks

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
```text
$ npx tsx --test scripts/ops/proof-generate.test.ts
# tests 21
# pass 21
# fail 0
```
