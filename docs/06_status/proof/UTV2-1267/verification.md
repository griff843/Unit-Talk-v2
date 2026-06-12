# UTV2-1267 Verification

## Summary

Classify all 172 UTV2-1262 backfilled `closing_for_clv` rows by SGO provider-truth quality.

## Classification Methodology

**Phase 1 (DB-observable signals):**
- null both sides → FAIL (1H_NO_CLOSE or NULL_BOTH_SIDES)
- 1H market key with null odds → FAIL (1H_NO_CLOSE)
- overround outside 0.95–1.50 → FAIL (OVERROUND_INVALID)
- one side null → WARN (NO_CLOSE_ONE_SIDE)
- elevated overround 1.15–1.50 → WARN (ODDS_TIMING_DRIFT)
- all signals healthy → PASS (pending SGO MCP Phase 2)

**Phase 2 (SGO MCP direct confirmation — 31-pick sample):**
Applied known verdicts from the extended 31-pick MCP validation:
- 6 confirmed FAILs (3 LINE_MOVE_STALE, 1 ALT_LINE, 2 1H_NO_CLOSE)
- 7 confirmed WARNs (timing drift, source mismatch, intermediate snapshot)
- 18 confirmed PASS

**Full 172-row audit requires UTV2-1267 Phase 2 script execution against live DB.**

## Audit Script

```
tsx apps/api/src/scripts/sgo-provider-truth-audit.ts
```

Output: `docs/06_status/proof/UTV2-1267/audit-results.json`

## Classification Criteria (per PM directive)

| Root cause | Verdict |
|-----------|---------|
| line moved AND DB has stale old-line odds | FAIL: LINE_MOVE_STALE |
| DB line != SGO main line (alt-line captured) | FAIL: ALT_LINE |
| 1H market, null both sides | FAIL: 1H_NO_CLOSE |
| null both sides, non-1H | FAIL: NULL_BOTH_SIDES |
| overround outside valid range | FAIL: OVERROUND_INVALID |
| line moved but DB captured correct close, odds Δ<50 | PASS with note |
| line moved but DB captured correct close, odds Δ50+ | WARN: LINE_MOVED_CORRECT_CLOSE_DRIFT |
| no Pinnacle close on one side | WARN: NO_CLOSE_ONE_SIDE |
| settlement source differs from SGO | WARN: SETTLEMENT_SOURCE_MISMATCH |
| intermediate snapshot during line movement | WARN: INTERMEDIATE_SNAPSHOT |
| timing odds drift Δ20–50 | WARN: ODDS_TIMING_DRIFT |

## 31-Pick Sample Results (Part A evidence)

| Bucket | Count | % |
|--------|-------|---|
| PASS | 18 | 58.1% |
| WARN | 7 | 22.6% |
| FAIL | 6 | 19.4% |

FAIL root causes: LINE_MOVE_STALE×3, ALT_LINE×1, 1H_NO_CLOSE×2

## Reporting Buckets (per PM directive Part F)

1. **PASS-only** — picks with clean SGO match; valid for evidence metrics
2. **PASS+WARN** — includes timing-uncertain rows; forward-leaning evidence
3. **FAIL-excluded** — removed from all certification-facing metrics; reported with reason codes
4. **Forward-flow** — picks submitted after UTV2-1262 go-live (not in this backfill set)
5. **Combined reference** — all 172 rows annotated

## UTV2-1042 Posture

`DATA_SUFFICIENT_READY_FOR_FILTERED_PM_REVIEW`

- Do not certify P3
- Do not mark UTV2-1042 Done
- Do not make CLV/ROI/edge claims
- FAIL rows must be excluded from evidence metrics

## Guardrails

- No production data mutated
- Backfill provenance visible in all output
- Public Discord remains gated
- FAIL rows listed separately, never counted in evidence
