## Summary

UTV2-1201 adds an event-time check alongside the existing `postingWindowClosed` metadata read in `promotion-service.ts`. Previously, the `withinPostingWindow` gate was operationally inert because no writer ever set `postingWindowClosed=true` in metadata. This lane activates the gate by extending each of the 6 `withinPostingWindow` computations to also evaluate whether the event has already started.

A new `isEventStarted(pick: CanonicalPick)` helper reads `pick.eventStartTime` (top-level field on `CanonicalPick`) with a fallback to `metadata.eventStartTime` for existing data that carries it only in the metadata bag. Fail-open: when no event time is available, `isEventStarted` returns `false` (assume window is open), preserving existing behavior for picks without timing data.

Changed files:
- `apps/api/src/promotion-service.ts` — added `isEventStarted()` helper, updated 6 `withinPostingWindow` computations
- `apps/api/src/promotion-service-stale-data.test.ts` — added 4 new unit tests for the posting window gate

## Evidence

Event time field used: `pick.eventStartTime` (top-level field on `CanonicalPick`, defined in `packages/contracts/src/picks.ts` line 75) with fallback to `readMetadataString(pick.metadata, 'eventStartTime')`.

Test results (10 pass, 0 fail):

```
# tests 10
# suites 0
# pass 10
# fail 0
# cancelled 0
# skipped 0
```

Full verify results:

```
# tests 113
# suites 13
# pass 113
# fail 0
# cancelled 0
# skipped 0
```

R-level check: `Verdict: PASS — no R-level artifacts required for this diff`

## Verification

pnpm verify — PASS (113 tests, 0 failures)
pnpm type-check — PASS
pnpm lint — PASS
pnpm build — PASS

pnpm test:db — Not applicable: T2 lane

```
# pass 0
# fail 0
# skipped 0
```
