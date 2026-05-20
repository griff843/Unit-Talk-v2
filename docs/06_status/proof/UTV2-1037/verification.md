# Verification — UTV2-1037: Audit and Fix CLV Methodology

## Summary

This T1 lane audited the CLV methodology across `@unit-talk/domain` and fixed a gap where
`analyzeWeightEffectiveness()` in `clv-weight-tuner.ts` accepted opening-line fallback rows
alongside true closing-line rows, corrupting Pearson correlation weight-tuning with non-syndicate
evidence. The settlement CLV path in `apps/api/src/clv-service.ts` was confirmed to correctly
use `closingSnapshotAt` + `providerKey` as the closing-line source, and to flag fallback rows
with `isOpeningLineFallback: true`.

**Branch:** `claude/utv2-1037-audit-fix-clv-methodology`
**Branch HEAD SHA:** `c57ade96a364c190562fbca0f3e3126f0b288b41`
**Merge SHA:** `9b10fd58f310ab2d824518f40d019bab9d2e0427`

## Evidence

### Files changed

| File | Change |
|------|--------|
| `packages/domain/src/clv-weight-tuner.ts` | Added `isOpeningLineFallback?` to `ScoredPickOutcome`; filter in `analyzeWeightEffectiveness()`; `openingLineFallbacksExcluded` in report |
| `packages/domain/src/edge-validation/clv-analyzer.ts` | Added `WithClosingSource` interface + `assertClosingSourcePresent()` guard |
| `packages/domain/src/clv-weight-tuner.test.ts` | 3 new tests for opening-line exclusion |
| `packages/domain/src/edge-validation/edge-validation.test.ts` | 5 new tests for `assertClosingSourcePresent()` |

### Audit findings

1. **HIGH** — `clv-weight-tuner.ts` did not filter `isOpeningLineFallback` rows. **Fixed.**
2. **MEDIUM** — `clv-analyzer.ts` had no fail-closed guard for closing-line provenance. **Fixed.**
3. **INFO** — Settlement CLV path confirmed correct; `clv-service.ts` sets `isOpeningLineFallback: true` on fallbacks. No change required.

## Verification

```
pnpm verify — EXIT 0
  env:check     PASS
  lint          PASS
  type-check    PASS
  build         PASS
  test          PASS (all unit tests)

R-level check: PASS — no R-level artifacts required (Changed files: 2, Rules matched: none)

pnpm test:db — EXIT 0
  tests 7 / pass 7 / fail 0
  duration_ms 256547 (real Supabase, project ref: zfzdnfwdarxucxtaojxm)
```

All verification gates passed. No R-level artifacts required.
