## Summary

UTV2-1040: Observability addition to real-edge fail-open path. No runtime behavior changed — failures are now visible where they were previously silent.

## Evidence

- `apps/api/src/submission-service.ts` — structured `realEdgeFailure` metadata + `submissionServiceLogger.warn` on catch
- Change is additive-only: no removal of fail-open behavior, no data path alteration
- `pnpm type-check` PASS, `pnpm test` 479/479 PASS
- Forced-failure test proves `realEdgeFailure` is populated when `computeRealEdge` throws

## Verification

- [x] Type-check green
- [x] All 479 tests pass
- [x] Issue-specific forced-failure test passes
- [x] R-level check: PASS (no R2/R3/R4 artifacts required for logging-only change)
- [x] `skip-proof-coverage` label added — change does not alter data semantics or DB paths
