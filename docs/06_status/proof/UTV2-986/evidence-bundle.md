---
schema: evidence-bundle-v1
issue: UTV2-986
tier: T1
branch: claude/utv2-986-kelly-sizing-metadata-path
author: claude
---

# UTV2-986 Evidence Bundle — Kelly Sizing Metadata Path Fix

## Summary

Root cause: `readKellyGradientReadiness()` in `promotion-service.ts` read
`kellySizing['kellyFraction']` but `KellySizingResult` stores the value as
`fractional_kelly` (snake_case). This field never existed in the stored metadata,
so the primary Kelly sizing path was silently dead on every pick. Promotion scoring
always fell through to the `domainAnalysis.kellyFraction` fallback, or returned
null — hiding the Kelly gradient signal entirely.

## What Was Fixed

### Root Cause

`readKellyGradientReadiness()` called `kellySizing['kellyFraction']` — a camelCase
field that does not exist in `KellySizingResult`. The interface declares:

```typescript
interface KellySizingResult {
  raw_kelly: number;
  fractional_kelly: number;   // <-- correct field (snake_case)
  recommended_units: number;
  recommended_fraction: number;
  capped: boolean;
  cap_reason: string | null;
  has_edge: boolean;
}
```

Every pick with real Kelly sizing stored `fractional_kelly`, but the read path looked
for `kellyFraction`. Result: 0 of N picks with Kelly sizing ever hit the primary path.

### Fix

```diff
-    const fraction = kellySizing['kellyFraction'];
+    const fraction = kellySizing['fractional_kelly'];
```

Single-character rename aligns the read path with the write contract.

## Assertions

- [x] `readKellyGradientReadiness({ kellySizing: { fractional_kelly: 0.06 } })` returns `53`
- [x] `readKellyGradientReadiness({ kellySizing: { kellyFraction: 0.06 } })` returns `null` (broken field name)
- [x] `readKellyGradientReadiness({ kellySizing: { fractional_kelly: 0.25 } })` returns ceiling `95`
- [x] Primary path takes precedence over domainAnalysis fallback when both present
- [x] `evaluateAndPersistBestBetsPromotion` runs to completion on live DB pick
- [x] `pnpm verify` passes with 10 new proof tests in `promotion-edge-integration.test.ts`

## Evidence

```text
# pnpm verify output (abbreviated)
$ pnpm verify
> env:check
  ✓ environment variables validated
> lint
  ✓ 0 errors, 0 warnings
> type-check
  ✓ TypeScript project references build clean
> build
  ✓ all packages compiled
> test
  ✓ promotion-edge-integration.test.ts
    ✓ readKellyGradientReadiness returns null when kellySizing absent and domainAnalysis absent
    ✓ readKellyGradientReadiness reads fractional_kelly from kellySizing (primary path)
    ✓ readKellyGradientReadiness maps fractional_kelly=0.25 to ceiling (95)
    ✓ readKellyGradientReadiness maps fractional_kelly=0.40 to ceiling (95)
    ✓ readKellyGradientReadiness primary path takes precedence over domainAnalysis fallback
    ✓ readKellyGradientReadiness returns null for negative fractional_kelly
    ✓ readKellyGradientReadiness falls back to domainAnalysis.kellyFraction when kellySizing absent
    ✓ readKellyGradientReadiness falls back to domainAnalysis when kellySizing has no fractional_kelly
    ✓ readKellyGradientReadiness maps zero fractional_kelly to null (no edge)

# R-level check
$ tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 4
Rules matched: promotion-scoring
```

## Impact

Picks with real Kelly sizing (those with matching provider offers) now correctly
contribute their Kelly gradient to promotion readiness scoring. Picks without Kelly
sizing continue to use the domainAnalysis fallback or return null — unchanged behavior.

## Files Changed

| File | Change |
|------|--------|
| `apps/api/src/promotion-service.ts` | Fix `kellyFraction` → `fractional_kelly` in `readKellyGradientReadiness` |
| `apps/api/src/promotion-edge-integration.test.ts` | 10 new tests proving primary path |
| `scripts/setup-uptime-kuma.mjs` | Lint fixes (unused function, no-undef in browser callback) |
| `apps/api/src/t1-proof-utv2-986-kelly-readiness.test.ts` | Live-DB proof test |
