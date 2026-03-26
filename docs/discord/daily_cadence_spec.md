# Daily Posting Cadence Spec — Unit Talk V2

> **Date:** 2026-03-24
> **Status:** Current-state truth. V2 cadence is outbox-driven, not schedule-driven.
> **Authority:** `docs/discord/pick_promotion_interim_policy.md`, runtime worker behavior

---

## Current V2 Cadence Model

**V2 does not use a scheduled posting cadence.**

Picks are delivered as they qualify. The distribution worker polls `distribution_outbox` continuously and delivers any claimable row. There is no time-of-day gating, no scheduled batch window, and no daily posting limit enforced in the current runtime.

---

## How Delivery Works

1. Pick submitted → promotion evaluated at submission time → if qualified, `distribution_outbox` row written with target channel
2. Worker polls `distribution_outbox` for unclaimed rows
3. Worker claims a row, calls the Discord delivery adapter, records a `distribution_receipt`
4. Pick lifecycle transitions: `validated → queued → posted`

**Rate:** Continuous. No batching. No scheduled windows.

---

## Posting Window Gate

The promotion evaluation includes a `withinPostingWindow` gate (gate 5 in `evaluatePromotionEligibility`). This gate reads `pick.metadata.withinPostingWindow`.

**Current behavior:** This field defaults to `true` when absent. The gate does not block any picks in the current runtime — it is a placeholder for future time-of-day restrictions.

**Future use:** When a scheduled posting cadence is ratified, this gate can enforce it without changing the promotion gate structure. The field would be set by a pre-evaluation enrichment step.

---

## What This Means Operationally

- Picks reach Discord as fast as the worker can claim and deliver them
- No guaranteed time-of-day for Best Bets posts
- No daily cap on number of posts (board caps apply per slate/sport/game, not per day)
- No minimum spacing between posts

---

## Target Cadence (Design Intent — Not Yet Implemented)

The following represents design intent for a future ratified cadence. It is **not** current runtime behavior.

| Surface | Desired cadence | Status |
|---------|----------------|--------|
| Best Bets | Morning window (before slate locks) | Not implemented |
| Trader Insights | As-available, within game-day window | Not implemented |
| Canary | Continuous (test lane) | Current behavior |

These will require:
1. A ratified daily cadence contract
2. Implementation of posting window enrichment at submission time
3. Operator control surface for window configuration

---

## Open Risks

- No posting window enforcement means a late-arriving pick (e.g., post-injury scratch after market move) could be posted at any time
- No daily cap means board caps are the only volume constraint — and board caps are currently counting historical picks (open risk per `PROGRAM_STATUS.md`)
- Worker restart during delivery may cause duplicate delivery attempts — mitigated by `idempotency_key` on `distribution_receipts`

---

## Authority References

| Document | Role |
|----------|------|
| `docs/discord/pick_promotion_interim_policy.md` | Interim promotion rules |
| `packages/domain/src/promotion.ts` | Gate 5: `withinPostingWindow` check |
| `apps/worker/src/distribution-worker.ts` | Worker poll/claim/deliver loop |
| `docs/audits/v2_score_promotion_truth_audit.md` | Board cap open risk |
