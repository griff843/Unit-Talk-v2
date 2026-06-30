# UTV2-1380 Diff Summary

## Summary

- Wired market-backed Kelly sizing into `processSubmission` when direct provider-offer devigging is unavailable but real-edge enrichment supplies a market-backed probability.
- Extended promotion-time enrichment to materialize `metadata.kellySizing` from market-backed `realEdge` + `marketProbability` before promotion scoring.
- Persisted promotion-time `domainAnalysis` and `kellySizing` metadata patches alongside the promotion band so replay/audit surfaces keep the scoring inputs used for the decision.

## Files Changed

- `apps/api/src/submission-service.ts`
  - Falls back to market-backed real-edge probability for Kelly sizing when provider-offer devigging misses.
  - Keeps confidence-delta out of Kelly sizing by requiring `realEdgeResult.marketSource !== 'confidence-delta'`.
- `apps/api/src/promotion-service.ts`
  - Enriches picks with Kelly sizing at promotion time when market-backed real-edge inputs exist.
  - Uses the enriched pick for readiness/risk/band computation.
  - Persists enrichment metadata through `metadataPatch` for qualified, suppressed, override, stale-data, and exposure-gate promotion paths.

## Scope Notes

- No contracts, domain package logic, DB repositories, migrations, worker delivery, or docs outside required proof files were changed.
- R-level rules triggered by changed paths: `lifecycle-fsm` and `promotion-scoring`.
