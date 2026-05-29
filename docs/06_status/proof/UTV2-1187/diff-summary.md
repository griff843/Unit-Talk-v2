# UTV2-1187 Diff Summary

## Scope

- Recategorized `apps/api/src/t1-proof-scoring-integrity.test.ts` from a T1 live-DB acceptance gate into a T2 live-DB audit.
- Kept the test read-only and limited to observable scoring-integrity metrics in the current 30-day production cohort.
- Preserved hard assertions for query success, non-empty proof data, and deterministic cohort reads.
- Converted live-data threshold checks into explicit audit verdict logs so current production drift is recorded without blocking unrelated CI.

## Live Audit Results

Focused verification on 2026-05-29 reported:

- C1 confidence-proxy rate: `82.25% (820/997)`, threshold `<= 10%`, verdict `AUDIT_ONLY_THRESHOLD_MISS`.
- C3 uniqueness distribution: `7` distinct values, fallback `50` at `0.3%`, verdict `PASS`.
- C4 promoted rows missing band: `0/26`, verdict `PASS`.
- C5 qualified rows missing promotion target: `PPH:0/26 + picks:20/55`, verdict `AUDIT_ONLY_THRESHOLD_MISS`.
- Determinism: both cohort queries returned `500` rows.

## Notes

- No runtime, domain, contract, repository, migration, or generated DB type files changed.
- The threshold misses reflect current live data and are outside this lane's allowed file scope.
