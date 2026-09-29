# WORK-2026092811 Diff Summary

Issue: WORK-2026092811
Tier: T2
Lane type: governance
Branch: claude/work-2026092811-receipt-freshness
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1684
Diff base: d6ece6b4532c01bcff00b05c4804e93300025c5a
Diff target: d9b27e5b10f645166c751d8d0303ab59f661c720

| File | Change |
|---|---|
| `scripts/ops/pipeline-health-classification.ts` | Adds `newestDeliveredReceiptAt` and `newestGovernedReceiptByTarget` |
| `scripts/pipeline-health.ts` | Reads receipts before the queue evaluation; freshness from receipts; per-target line |
| `scripts/ops/pipeline-health-classification.test.ts` | 5 new cases |

## SHA Binding

Merge SHA: 3b071d9d6514cc9943a4e875371940337f38b600
PR: https://github.com/griff843/Unit-Talk-v2/pull/1684
