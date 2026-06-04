# UTV2-1200 Verification

## Summary

Wave 1 — P3 Decision Integrity safety gate. Extended the `riskBlocked` computation in `promotion-service.ts` at all 6 call sites to also block picks where `playerAvailabilityStatus` is `OUT`, `OUT_INDEFINITELY`, or `INJURED_OUT`. Added 4 unit tests covering all three blocked statuses and one ACTIVE control. `pnpm verify` PASS, promotion-service-stale-data 6/6, promotion-edge-integration 66/66.

## Evidence

| Item | Result |
|------|--------|
| `pnpm verify` | PASS — exit code 0, all test suites green |
| `pnpm type-check` | PASS — exit 0 |
| New tests | 4 (ok 2–5 in promotion-service-stale-data.test.ts) |
| R-level check | PASS — no artifacts required |
| Files changed | `promotion-service.ts` (6 call sites, +24/-6 lines), `.test.ts` (+135 lines) |
| Scope bleed | None — candidate-scoring-service.ts not touched |

## Verification

**Date:** 2026-06-04
**Branch:** codex/utv2-1200-injury-player-status-guard
**Tier:** T2
**Executor:** Claude (codex-cli lane)

## pnpm verify

```
exit code: 0
# fail 0 (across all test suites)
env:check + lint + type-check + build + test: all green
```

## Targeted test runs

### promotion-service-stale-data.test.ts (6 tests)
```
# tests 6
# pass 6
# fail 0
```

Tests added by UTV2-1200:
- ok 2 - UTV2-1200: pick with playerAvailabilityStatus=OUT is suppressed (riskBlocked)
- ok 3 - UTV2-1200: pick with playerAvailabilityStatus=OUT_INDEFINITELY is not promoted
- ok 4 - UTV2-1200: pick with playerAvailabilityStatus=INJURED_OUT is not promoted
- ok 5 - UTV2-1200: pick with playerAvailabilityStatus=ACTIVE is NOT suppressed by injury guard

### promotion-edge-integration.test.ts (66 tests)
```
# tests 66
# pass 66
# fail 0
```

All 66 existing promotion edge integration tests continue to pass.

## R-level check

```
tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```

## Behavior verified

- `playerAvailabilityStatus = 'OUT'` → `riskBlocked = true` → `qualified = false`, `resolvedTarget = null`
- `playerAvailabilityStatus = 'OUT_INDEFINITELY'` → `riskBlocked = true` → `qualified = false`, `resolvedTarget = null`
- `playerAvailabilityStatus = 'INJURED_OUT'` → `riskBlocked = true` → `qualified = false`, `resolvedTarget = null`
- `playerAvailabilityStatus = 'ACTIVE'` → injury guard does not trigger → pick evaluated normally
- `playerAvailabilityStatus` absent → injury guard does not trigger (empty string is not in the blocked list)

## Type check

```
pnpm type-check: exit 0 (no errors)
```
