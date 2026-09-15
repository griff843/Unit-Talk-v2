# UTV2-1915 — Diff Summary

**Issue:** UTV2-1915 — Smart Form multi-leg bet slip (Lane A1-UI of the parlay journey)
**Tier:** T2
**Lane type:** delivery-ui
**Branch:** `claude/utv2-1915-smart-form-multi-leg-slip`
**Executor:** claude

## Merge SHA Binding

MERGE_SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1583

## What changed

| File | +/- | What |
|---|---|---|
| `apps/smart-form/lib/bet-slip.ts` | +209 / -0 | **New.** Pure slip model: `addLeg`, `removeLeg`, `moveLeg`, `summarizeLeg`/`summarizeSlip`, `describeIncompleteLeg`, `isMultiLegSlip`, `multiLegSubmissionRefusal`, `findCombinedPriceKeys`. No React, no I/O, no pricing. |
| `apps/smart-form/app/submit/components/BetSlipPanel.tsx` | +135 / -1 | Renders the leg list (`slip-legs` / `slip-leg`), per-leg move-up / move-down / remove controls, and two refusal regions (`slip-refusal`, `multi-leg-refusal`). Every new prop is optional and defaults to the empty slip, so the single-pick panel is byte-for-byte unchanged when no leg has been added. |
| `apps/smart-form/app/submit/components/BetForm.tsx` | +70 / -0 | Slip state, the three handlers, an "Add leg to slip" action, and a guard at the top of `onSubmit` that refuses a multi-leg slip before any other check. |
| `apps/smart-form/test/bet-slip.test.ts` | +207 / -0 | **New.** 18 unit tests over the slip model. |
| `apps/smart-form/e2e/multi-leg-slip.spec.ts` | +205 / -0 | **New.** 2 offline Playwright tests driving the real form. |
| `apps/smart-form/package.json` | +1 / -1 | Wires `test/bet-slip.test.ts` into the app's explicit `test` file list. |

Total: **6 files, +617 / -2**. No migrations, no workflow files, no `apps/api`, no contracts.

## Three deliberate omissions

This lane builds the slip **UI**, not parlay semantics. Each omission is a boundary, not a gap:

1. **No combined price.** `LegSummary` carries no `combinedOdds`, `parlayOdds`, `totalPayout` or
   `decimalPrice` field. Parlay pricing is `priceParlay` / `priceSettledParlay` in
   `@unit-talk/contracts`, and is UTV2-1906's. A UI that computed its own price would be a second,
   divergent source of truth for the number the operator acts on. A test asserts the field set stays
   free of every one of those names.
2. **No duplicate-market-identity refusal.** Whether two legs are the same bet is
   `deriveParlayTicketIdentity` and the ticket API, server-side. The UI surfaces a server refusal;
   it does not reimplement one.
3. **No ticket submission.** There is no ticket endpoint until UTV2-1912's API third lands, so a
   multi-leg slip is *built and reviewed* and explicitly refused at submit, with the reason rendered
   as text rather than expressed as a missing button.

## Containment

Track Only and member delivery are untouched. The slip never reaches `/api/submissions` with more
than one leg — the e2e test asserts the endpoint receives **zero** requests from a two-leg slip. No
production read, no production write, SGO untouched, no provider credential read.
