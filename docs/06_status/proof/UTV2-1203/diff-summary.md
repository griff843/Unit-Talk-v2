# UTV2-1203 Diff Summary — Wave 2: Book Dispersion Deduplication

## What Changed

### packages/domain/src/signals/book-dispersion.ts

**Before:** Contained a full duplicate implementation of population std-dev over devigged over-probabilities — identical logic to `computeDisagreementScore` in market-signals.ts.

**After:** Duplicate implementation removed. `dispersion_score` in the returned `DispersionResult` now delegates to `computeDisagreementScore(offers)` — the canonical single computation. The function still computes `range`, `books_count`, and `sharp_count` (not provided by `computeDisagreementScore`) so the `DispersionResult` type contract is preserved for all existing callers.

Import added: `import { computeDisagreementScore } from './market-signals.js'`

### packages/domain/src/signals/book-dispersion.test.ts

Added cross-check test: `dispersion_score equals computeDisagreementScore for same input (single path guarantee)`. Confirms that for the same input, `computeBookDispersion(offers).dispersion_score === computeDisagreementScore(offers)`.

### packages/domain/src/signals/market-signals.test.ts

Added regression test suite `UTV2-1203 single-path regression` with one test: confirms `computeDisagreementScore` and `computeBookDispersion.dispersion_score` produce identical output for identical input, proving the single-path guarantee from the market-signals side.

## What Did NOT Change

- `packages/domain/src/signals/market-signals.ts` — `computeDisagreementScore` is unchanged; it is the canonical implementation
- `packages/domain/src/promotion.ts` — `computeDispersionScore` there reads from `metadata.bookSpread` via tiered scoring; it is a different function and was not touched
- All app-layer files — out of scope for this domain lane
