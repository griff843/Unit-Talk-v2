# UTV2-1203 Verification — Wave 2: Book Dispersion Deduplication

## Summary

Consolidated `computeBookDispersion` (book-dispersion.ts) and `computeDisagreementScore` (market-signals.ts) into a single canonical computation path. Before this change, both functions independently computed population std-dev of devigged over-probabilities — two separate code paths producing the same numeric value. After this change, `computeBookDispersion` delegates `dispersion_score` to `computeDisagreementScore`, guaranteeing identical output by shared implementation rather than coincidence.

`computeDisagreementScore` is the canonical function. It is called within `computeSignalVector` and its output flows into the model blend via `disagreement_score`. `computeBookDispersion` is preserved for callers that need the richer `DispersionResult` shape (range, books_count, sharp_count) but its core numeric score is now produced by one shared code path.

**Determinism proof:** Before UTV2-1203, the same `offers` input produced two separate std-dev computations entering the scoring pipeline (one via `computeDisagreementScore` → `computeSignalVector`, one via `computeBookDispersion` → `dispersion_score`). After UTV2-1203, both function names resolve to the same computation — identical output guaranteed by shared implementation. This is verified mechanically by the cross-check tests added in this lane.

## Evidence

- Branch: `codex/utv2-1203-book-dispersion-deduplication`
- Branch HEAD SHA: `b3066acd`
- Files changed (within file scope lock):
  - `packages/domain/src/signals/book-dispersion.ts` — duplicate implementation removed; `dispersion_score` delegates to `computeDisagreementScore`
  - `packages/domain/src/signals/book-dispersion.test.ts` — cross-check test added confirming single path
  - `packages/domain/src/signals/market-signals.test.ts` — regression test added confirming identical output
- Files NOT changed (as required):
  - `packages/domain/src/signals/market-signals.ts` — canonical function unchanged
  - `packages/domain/src/promotion.ts` — separate function, not a duplicate, not touched
  - `apps/api/src/promotion-service.ts` — out of scope
  - `apps/api/src/candidate-scoring-service.ts` — out of scope

## Verification

### pnpm type-check

```
> @unit-talk/v2@0.1.0 type-check
> pnpm exec tsc -b tsconfig.json

(exit 0 — no errors)
```

### pnpm test (domain signals — TAP output)

```
TAP version 13
# Subtest: computeBookDispersion
ok 1 - returns zero dispersion for single offer
ok 2 - returns non-zero dispersion when books disagree
ok 3 - counts sharp books correctly
ok 4 - skips offers with null odds
ok 5 - dispersion_score equals computeDisagreementScore for same input (single path guarantee)
ok 1 - computeBookDispersion
# Subtest: computeMovementScore
ok 1 - returns 0 when no opening offers
ok 2 - returns positive for line moving up
ok 3 - returns negative for line moving down
ok 4 - is clamped to [-1, +1]
ok 2 - computeMovementScore
# Subtest: computeDisagreementScore
ok 1 - returns 0 for single offer
ok 2 - returns > 0 when books disagree
ok 3 - computeDisagreementScore
# Subtest: computeSharpRetailDelta
ok 1 - returns 0 when no sharp or retail books
ok 2 - returns positive when sharps are higher than retail
ok 4 - computeSharpRetailDelta
# Subtest: UTV2-1203 single-path regression
ok 1 - computeDisagreementScore and computeBookDispersion.dispersion_score produce identical output
ok 5 - UTV2-1203 single-path regression
# Subtest: computeSignalVector
ok 1 - returns all four signal components
ok 6 - computeSignalVector
1..6
# tests 15
# suites 6
# pass 15
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

### pnpm verify

```
exit 0 — all checks passed (env:check + lint + type-check + build + test)
```

### R-level check

```
Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```

### pnpm test:db — Not applicable: T2 lane

T2 modeling lane — domain package only, no runtime DB paths affected. `pnpm test:db` not required per T2 verification expectations.
