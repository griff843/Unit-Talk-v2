## Summary

UTV2-1201: postingWindowClosed writer for promotion enrichment — T2 lane (runtime path).

The `withinPostingWindow` gate in `promotion-service.ts` was previously operationally inert because no writer set `postingWindowClosed=true` in metadata. This change activates the gate by extending all 6 `withinPostingWindow` computations to also check whether the event has already started via a new `isEventStarted()` helper.

`isEventStarted()` reads `pick.eventStartTime` (top-level `CanonicalPick` field) with fallback to `metadata.eventStartTime`. Fail-open behavior: when no event time is present, returns `false` (assume window is open).

## Evidence

**Implementation:** `apps/api/src/promotion-service.ts`
- Added `isEventStarted(pick: CanonicalPick): boolean` helper at line ~1585
- Updated 6 `withinPostingWindow` computations (lines 262, 341, 557, 631, 877, 932)

**Tests added:** `apps/api/src/promotion-service-stale-data.test.ts`
1. `UTV2-1201: pick with event time in the PAST is suppressed` — verifies gate blocks promotion
2. `UTV2-1201: pick with event time in the FUTURE is eligible` — verifies gate does not block valid picks
3. `UTV2-1201: pick with no event time is not suppressed` — verifies fail-open behavior
4. `UTV2-1201: pick with past eventStartTime in metadata is suppressed` — verifies metadata fallback path

**Test output (stale-data test file):**
```
# tests 10
# suites 0
# pass 10
# fail 0
# cancelled 0
# skipped 0
```

**Full verify output:**
```
# tests 113
# suites 13
# pass 113
# fail 0
# cancelled 0
# skipped 0
```

**R-level check:**
```
Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```

## Verification

| Check | Result |
|---|---|
| pnpm lint | PASS |
| pnpm type-check | PASS |
| pnpm build | PASS |
| pnpm test | PASS (113 tests, 0 failures) |
| R-level check | PASS (no artifacts required) |

pnpm test:db — Not applicable: T2 lane

```
# pass 0
# fail 0
# skipped 0
```

Executor: codex-cli
Lane type: runtime
Tier: T2
