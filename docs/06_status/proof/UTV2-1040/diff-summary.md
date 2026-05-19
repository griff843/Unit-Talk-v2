## Summary

UTV2-1040: Added structured failure visibility to the real-edge computation fail-open path in `apps/api/src/submission-service.ts`. Replaces silent `catch {}` with structured logging + `realEdgeFailure` metadata. No data semantics changed — pure observability addition.

## Evidence

**Changed file:** `apps/api/src/submission-service.ts`

On `computeRealEdge` failure, submission now:
- Populates `realEdgeFailure: { stage, reason, errorName }` in pick metadata alongside the confidence-delta fallback
- Emits `submissionServiceLogger.warn` with market, selection, errorName, and errorMessage
- Applied to both `processSubmission` and `processShadowSubmission` catch blocks

**Forced-failure test result:**
```
UTV2-1040 issue verification PASS {
  realEdgeSource: 'confidence-delta',
  edgeProvenance: { method: 'confidence-delta', providerCoverageState: 'none', fallbackReason: 'not-applicable' },
  realEdgeFailure: { stage: 'computeRealEdge', reason: '...', errorName: 'Error' }
}
```

R-level check: PASS — no R2/R3/R4 artifacts required (observability-only change, no model logic modified).
pnpm test: PASS (479/479).

## Verification

- [x] `pnpm type-check` — PASS
- [x] `pnpm test` (479/479) — PASS
- [x] Forced-failure unit test — PASS (realEdgeFailure populated, warn logged)
- [x] R-level compliance — PASS
- [x] Tier label `tier:T2` on PR #795
- [x] Observability-only change — no data path, no model logic, no DB schema
