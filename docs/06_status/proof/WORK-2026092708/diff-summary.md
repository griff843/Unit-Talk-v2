# Diff summary: WORK-2026092708

| File | Change |
|---|---|
| `scripts/pipeline-health.ts` | § Authorized delivery targets: the unordered `.limit(100)` sample and the hardcoded `LIVE_TARGETS` / `LIVE_CHANNEL_IDS` lists are replaced. Every receipt in a 30-day window is read in id-ordered pages, checked against an exact count, and partitioned by `partitionReceiptAuthority`. An incomplete read or an unrecognized destination is CRITICAL. The census goes into the JSON report. |
| `scripts/ops/pipeline-health-classification.ts` | Pure `receiptLogicalTarget`, `classifyReceiptDestination` (governed from `governedDeliveryTargets`, plus control, simulated and unrecognized), `partitionReceiptAuthority`, and `RECEIPT_AUTHORITY_WINDOW_DAYS`. |
| `scripts/ops/pipeline-health-classification.test.ts` | 7 new tests on production receipt shapes: the UTV2-1929 resolved-id receipt, `discord:#canary`, registry-derived membership, simulated, unrecognized ids and nulls, anti-laundering, and the partition. |
| `.ops/work/WORK-2026092708.md` | Repo-owned work order. |

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1674
