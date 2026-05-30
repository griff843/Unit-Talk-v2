# UTV2-1138 Diff Summary

## Summary

INIT-4.3.1 — Verified Closing-Source Hierarchy. Adds `ClosingSourceVerification` interface and a ranked, version-controlled hierarchy of closing sources. Every CLV computation outcome now carries the verified source provenance.

## Changes

### New types (apps/api/src/clv-service.ts)
- `ClosingSourceType` — discriminated union of 5 source types (ranks 1–5)
- `ClosingSourceVerification` — readonly struct: `sourceType`, `rank`, `isVerified`, `hierarchyVersion`, `providerKey`
- `CLOSING_SOURCE_HIERARCHY_VERSION = '1'` — version-controlled constant
- `CLOSING_SOURCE_RANKS` — internal rank/isVerified config map

### Updated interfaces
- `CLVResult.closingSourceVerification: ClosingSourceVerification` — required field on every computed result
- `CLVComputationOutcome.closingSourceVerification?: ClosingSourceVerification` — optional, set whenever a source is resolved

### Source tracking in computeCLVOutcome
- `market_universe_provenance` (rank 1, verified) — direct from pick's market universe record
- `pinnacle_closing` (rank 2, verified) — Pinnacle closing line from provider_offers
- `consensus_closing` (rank 3, verified) — any closing line from provider_offers
- `opening_line_proxy` (rank 5, not verified) — opening line fallback; isVerified=false
- `market_universe_fallback` (rank 4, verified) — market universe via provider key lookup

### New tests (apps/api/src/clv-service.test.ts)
- 4 new INIT-4.3.1 tests covering all source types and the isVerified invariant

## Scope

All changes within `apps/api/src/clv-service.ts` and `apps/api/src/clv-service.test.ts`.
No Tier C path modifications. No DB schema changes. No domain mutations.

## SHA Binding
merge_sha: 0f56d512d5cced372b4e4ef25b35922490e32364
pr: https://github.com/griff843/Unit-Talk-v2/pull/934
