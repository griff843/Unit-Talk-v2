# Week 18 Contract — Domain Integration Layer

## Objective

Wire already-salvaged pure-computation domain modules into the real API submission path. At submission time, when a pick has American odds, compute implied probability (via devig), edge (vs submitter confidence), and Kelly fraction (via kelly-sizer). Store results in `pick.metadata.domainAnalysis` for downstream consumption.

## Sprint Name

`SPRINT-WEEK18-DOMAIN-INTEGRATION-LAYER`

## Scope

### In Scope

1. **Domain analysis service** (`apps/api/src/domain-analysis-service.ts`):
   - Pure function that takes a `CanonicalPick` and returns a `DomainAnalysis` object
   - Uses `americanToImplied` from `@unit-talk/domain` (probability/devig)
   - Uses `americanToDecimal`, `computeKellyFraction` from `@unit-talk/domain` (risk/kelly-sizer)
   - Computes: implied probability, decimal odds, edge (if confidence present), Kelly fraction (if confidence present)
   - Fail-open: returns `null` if odds are missing or invalid

2. **Submission path integration** (`apps/api/src/submission-service.ts`):
   - After `createCanonicalPickFromSubmission()`, call domain analysis
   - Merge `domainAnalysis` into `pick.metadata` before saving
   - No behavioral changes to existing promotion, distribution, or settlement paths

3. **Tests** (`apps/api/src/domain-analysis-service.test.ts`):
   - Unit tests for domain analysis computation
   - Integration test confirming enrichment flows through `processSubmission()`

### Out of Scope

- Changing promotion scoring inputs (promotion still reads `metadata.promotionScores`)
- Changing settlement or distribution paths
- Using domain analysis for routing decisions
- Multi-book consensus (requires `BookOffer[]` — not available in current submission payload)
- Calibration integration (requires `p_final` — not yet in flow)

## Acceptance Criteria

1. `computeSubmissionDomainAnalysis()` returns correct implied probability for known American odds
2. Edge is computed as `confidence - impliedProbability` when both are present
3. Kelly fraction is computed via `computeKellyFraction()` when confidence and odds are present
4. Missing odds → returns `null` (no enrichment)
5. All existing tests continue to pass
6. New tests verify computation correctness
7. All 6 gates pass: test, test:db, lint, type-check, build, verify

## Architecture Constraints

- Domain analysis is additive metadata — does not alter existing pick fields
- Uses only modules already exported from `@unit-talk/domain` top-level index
- No new dependencies
- No schema changes
- No I/O in domain analysis (pure computation)

## Codex Parallel Task

"Domain Module Re-Export Audit" — verify all domain module re-exports from `packages/domain/src/index.ts` are collision-free and document any intentional exclusions.

## Non-Goals

- Replacing hardcoded promotion fallback scores with domain analysis outputs
- Adding market-level data (multiple book offers) to submission payload
- Wiring domain analysis into settlement enrichment (already done via Week 16)
- Performance optimization or caching

## Ratification

This contract is ratified as part of the Week 18 sprint execution.
