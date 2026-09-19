# Diff Summary — UTV2-1939

MERGE_SHA: pending merge

> Plain anchor on purpose: CEP-E5 line-matches `MERGE_SHA:` at the start of a line, so a
> bolded or table-row form would not be rebindable after merge.

**Lane:** UTV2-1939 · T2 · `delivery-ui` · branch `claude/utv2-1939-command-center-human-capper-lifecycle`
**Scope:** `apps/command-center/**` (plus this lane's own control-plane files)

## What this changes, in one sentence

Command Center can now carry a human-submitted pick through the second half of its
lifecycle — it surfaces delivered picks that still need settling, predicts before the
operator acts whether the member recap will actually post, and reports the API's real
recap outcome afterwards instead of silently presenting a suppressed recap as success.

## Why

Measured against production on 2026-09-18: pick `ed0ed43c` was delivered to Discord
(`distribution_outbox` `sent`, receipt `71fccaa7…`, message `1550652082896375962`) and then
needed settling. Three things were missing from the operator surface.

1. **No worklist.** `/settlement` listed `manual_review` records and outbox rows stuck in
   `posted` for over 24h. A pick delivered ten minutes ago and awaiting its result appeared
   in neither, so the operator had no list to work from and had to arrive with a pick id.
2. **No forewarning.** `postSettlementRecapIfPossible` does **not** go through the outbox —
   `settle-pick-controller.ts` posts it by direct `fetch` and therefore checks the kill
   switch itself, short-circuiting to `{ posted: false, reason: 'kill-switch-engaged' }`.
   Because member-delivery activation is reserved and the switch is normally engaged, the
   *default* outcome of settling a delivered pick is a suppressed recap — and nothing told
   the operator that before they clicked.
3. **No honest reporting.** `settle.ts` read `settlementRecordId` and discarded
   `humanCapperRecap`; `SettlementForm.tsx` then rendered one unconditional green panel. An
   operator who settled a delivered pick saw "Settlement recorded." whether members had been
   told or not.

## Files

| File | Change |
|---|---|
| `src/lib/human-capper-recap.ts` | **NEW.** Pure verdict module. `describeRecapOutcome()` turns the API's `humanCapperRecap` into a three-way verdict (`not-applicable` / `posted` / `suppressed`) that names *why*; `predictRecapDelivery()` answers the same question before the operator acts. No I/O, no React. |
| `src/lib/human-capper-recap.test.ts` | **NEW.** 7 tests. Includes the two that matter: a kill-switch-suppressed recap is not success, and an unreadable kill switch predicts `unknown` rather than `will-post`. |
| `src/app/actions/settle.ts` | Reads `body.data.humanCapperRecap` and carries it on the ok branch as `recap`. Previously discarded. |
| `src/components/SettlementForm.tsx` | Success now renders two panels: the settlement record (emerald) and, separately, the recap verdict — emerald when posted, **amber** when suppressed, with the reason and what it means. Omitted entirely when the pick is not a human-capper delivery. |
| `src/lib/data/results-ops.ts` | Adds the `deliveredAwaitingSettlement` worklist off `picks_current_state`: `status = 'posted'`, `settlement_recorded_at IS NULL`, `metadata->deliveryAuthorization->>decision = 'authorized'`. |
| `src/app/settlement/page.tsx` | Renders that worklist above Manual Review, each row linking to `/settlement?pickId=<id>`, with a banner predicting the recap outcome from the live `official-picks` kill-switch state. |

## Fail-closed behaviour preserved

- The kill switch is **read**, never written. No delivery target is enabled, no containment
  setting is touched, and nothing in this diff can cause a Discord post.
- `predictRecapDelivery` fails closed: if the kill-switch read throws, `officialPicksKilled`
  is `null` and the prediction is `unknown`, not `will-post`. `settlement/page.tsx` wraps
  the read in try/catch precisely so an unreadable switch degrades to "unknown", never to
  optimism.
- `describeRecapOutcome` treats an absent `humanCapperRecap` as `not-applicable` rather than
  as success, so a Track Only settlement renders no recap claim at all.
- The worklist predicate keys on the **server-authored** `metadata.deliveryAuthorization`
  record, not on any client-supplied field.

## Deliberately out of scope

- `src/app/picks/[id]/page.tsx:345` passes a hardcoded `isAlreadySettled={false}` while
  `detail.settlements` is in scope. It looks inert (settled picks route to `CorrectionForm`
  one branch earlier), but it is a real latent defect. Recorded, not fixed — outside this
  lane's stated purpose.
- The `listUpcoming` ±90-day window defect, already declared under UTV2-1938.
