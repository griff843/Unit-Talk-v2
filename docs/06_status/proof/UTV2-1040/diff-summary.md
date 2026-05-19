# UTV2-1040 Diff Summary

- Changed `apps/api/src/submission-service.ts` so `computeRealEdge` failures remain fail-open but no longer silent.
- On real-edge computation failure, submission metadata now keeps confidence-delta fallback fields and writes `realEdgeFailure` with `stage`, `reason`, and `errorName`.
- Added a structured warning log for real-edge computation failures with market, selection, and error context.

R-level lookup:
- `apps/api/src/submission-service.ts` matches `lifecycle-fsm` in `docs/05_operations/r1-r5-rules.json`.
- Required levels from rule map: `R1`, `R2`, `R3`, `R4`; advisory: `R5`.
- Artifact requirements from rule map: `r2-determinism`, `r3-shadow-report`, `r4-fault-report`.

Scope:
- Runtime implementation file touched: `apps/api/src/submission-service.ts`.
- Proof files added under `docs/06_status/proof/UTV2-1040/` per execution packet.
