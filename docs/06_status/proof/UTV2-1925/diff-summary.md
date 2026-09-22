# DIFF SUMMARY: UTV2-1925 — Smart Form receipt reports server truth

**Issue:** UTV2-1925 — the submission receipt must describe what the server did, not what the browser asked for
**Tier:** T2 · **Lane type:** delivery-ui · **Executor:** claude

## Merge SHA Binding

MERGE_SHA: 97af7f25841893f87b3ec36e4713cb31901b463f
Merge SHA: 97af7f25841893f87b3ec36e4713cb31901b463f
PR: https://github.com/griff843/Unit-Talk-v2/pull/1594
Anchor commit (implementation): ca8e98878482a9bff510af84ed4d09049c0fcd4d

## The defect

`SuccessReceipt.tsx` rendered, after a successful submission:

```
Saved to your internal record. Track Only — no member delivery.
```

The condition on that sentence was `v.trackOnly` — a field of `submittedValues`, the operator's own
form state. The receipt therefore reported **the request the browser made**, never the disposition
the server reached. Those two agree only as long as every submission is pinned to Track Only.

They stop agreeing the moment a capper is server-authorized into the approval-for-delivery path: the
client field is unchanged, so the receipt would still promise permanent non-delivery for a pick that
is in fact queued for operator approval and, after it, for member delivery. The sentence would be
false at precisely the moment its falsity matters.

A second, quieter problem: *"no member delivery"* is a claim about a **permanent property** of the
pick, while what a submission response can actually support is the **observation** that no delivery
record was created for this submission. The receipt asserted the stronger of the two from evidence
that supports only the weaker.

## Files changed

| File | Δ | What |
|---|---|---|
| `apps/smart-form/lib/delivery-disposition.ts` | new | pure resolver from the server response to one of four dispositions |
| `apps/smart-form/lib/api-client.ts` | +17 | declare the four server fields that were already arriving |
| `apps/smart-form/app/submit/components/SuccessReceipt.tsx` | +8/−2 | render the disposition; stop reading form state |
| `apps/smart-form/app/submit/components/BetSlipPanel.tsx` | +3/−3 | pre-submission pills describe the request, not the outcome |
| `apps/smart-form/app/submit/components/BetForm.tsx` | +1/−1 | same, for the third pill |
| `apps/smart-form/test/api-client.test.ts` | +154 | 8 new tests: dispositions, and structural controls on the two rules |

## The resolver

```ts
export type DeliveryDisposition =
  | { kind: 'queued';            target: string | null; headline: string; detail: string }
  | { kind: 'awaiting-approval';                        headline: string; detail: string }
  | { kind: 'not-enqueued';                             headline: string; detail: string }
  | { kind: 'undetermined';                             headline: string; detail: string };
```

Four states rather than two, and the fourth is the load-bearing one. `undetermined` is what an
**absent** `outboxEnqueued` resolves to — "the server did not report a delivery outcome" — which is
not the same as "the server reported that it created none". Folding the two together is exactly how
the original defect would reappear, in the reassuring direction, against an older API build.

The resolver has **no inputs other than the server response**. It does not import `form-schema`, does
not know `BetFormValues` exists, and cannot see `trackOnly`. That is what makes "the UI may display
server truth but may not control delivery authorization" a structural property of this module rather
than a convention someone has to remember.

## Nothing here was blocked on unmerged work

The four fields the resolver reads — `outboxEnqueued`, `lifecycleState`, `promotionStatus`,
`promotionTarget` — are already returned by `submitPickController` on `main`. `SubmitPickResult`
simply stopped declaring them, so the receipt had no typed access to server truth and fell back to
the only value it could see. Widening the interface changes no wire format and adds no round trip.

This corrects a claim in the sibling lane's proof (`docs/06_status/proof/UTV2-1924/verification.md`,
"Known gap"), which recorded this work as depending on an unmerged `deliveryPosture`. Measured
against `main`, it does not.

## Pre-submission wording

Three pills previously promised an outcome before any server had been consulted
("Track Only — no member delivery"). They now describe the **request**: "Requesting Track Only — the
server decides delivery, and the receipt will report what it did." The form may state what it is
asking for; it may not state what will happen.

## Out of scope, measured and recorded

`apps/smart-form/lib/form-utils.ts:350` lets the client *propose*
`distributionMode: 'delivery-eligible'` from `values.trackOnly`. Whether the server on `main` honours
a client-proposed value is an `apps/api` question and outside this lane's `apps/smart-form/**` file
scope. It is recorded in the verification document rather than changed here.

## Containment

Untouched. This lane renders text. It writes nothing, deploys nothing, enqueues nothing, grants no
delivery authorization and changes no containment setting. The server-side Track Only pin
(`handlers/submit-pick.ts:93-123`) is not modified, and its mutation-tested guard set is intact.
