# WORK-2026092807 Diff Summary

Issue: WORK-2026092807
Tier: T2
Lane type: delivery-ui
Branch: claude/work-2026092807-smart-form-delivery-posture
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1681
Diff base: a5399adc187bf8f59b19b25ee39e5651bb49ea0d
Diff target: cf050e518d4296f4b8a2b9b51da06ed3a6f32468

| File | Change |
|---|---|
| `apps/smart-form/lib/delivery-disposition.ts` | Adds `track-only` and `delivery-refused` dispositions, read from the server's `deliveryPosture` |
| `apps/smart-form/lib/api-client.ts` | `SubmitPickResult` declares `deliveryPosture`, `deliveryRefusedReason` and `deliveryTarget` |
| `apps/smart-form/app/submit/components/BetSlipPanel.tsx` | Bet-slip copy for Track Only and delivery requests |
| `apps/smart-form/test/api-client.test.ts` | 4 new cases |

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1681
