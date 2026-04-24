# UTV2-590 Production Readiness Gate Results

**Verdict: PASS_WITH_KNOWN_GAPS**
**Date:** 2026-04-24
**SHA:** 9796f36

## Gate Checklist

| Check | Result |
|---|---|
| All blocking audit issues complete | PASS |
| Governed pipeline proof (UTV2-587) | PASS |
| Submission convergence proof (UTV2-588) | PASS |
| Settlement/analytics proof (UTV2-589, UTV2-737) | PASS |
| Runtime burn-in (throughput evidence) | PASS |
| Static baseline (pnpm verify) | PASS |
| Fail-closed if proof absent | PASS |

## Surface Results

| Surface | Verdict | Key Evidence |
|---|---|---|
| Ingestion | PASS | 98k offers fresh/6h, 0 events in_progress, latest offer 15:12Z |
| Pipeline | PASS | 4,280 candidates/24h, 2,723 board rows/24h, 5 active pick sources |
| Delivery | PASS_WITH_GAPS | 0 live failures; 2 dead-letters from April-22 canary (expected) |
| Settlement | PASS_WITH_GAPS | 200 settled/24h, 258 total; 129 posted (128 fail-closed, 41 await repoll) |
| CLV Analytics | PASS | MLB 82.4%, NBA 80.7%, NHL 75.5%; all 258 settlements carry CLV |
| Operator | PASS | 248 audit entries/24h, 0 awaiting_approval |
| Runtime | PASS | Inferred live from throughput; pnpm verify green |
| Security | PASS | 0 picks failed, 0 live dead-letters, 0 awaiting_approval |

## Known Gaps (non-blocking)

1. 128 picks skip on unsupported_market_family — fail-closed correctly; market expansion is roadmap
2. 41 picks skip on game_result_not_found — UTV2-745 repoll cycle will clear these
3. 2 canary dead-letters — April-22 artifact; purge on PM decision

## Prerequisite Issues — All Done

UTV2-587, 588, 589, 602, 621, 628, 659, 715, 716, 719, 721, 726, 731, 732, 733, 734, 737, 738, 740, 742, 743, 745, 749
