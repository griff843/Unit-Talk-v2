# Unit Talk V2 — Launch Blockers & Open Work

> Generated: 2026-03-24. Grounded in `docs/06_status/PROGRAM_STATUS.md` and `docs/discord/pick_promotion_interim_policy.md`.

---

## What "Launch" Means in V2

The pick lifecycle is fully operational end-to-end:
- Submit → DB → promote → distribute → Discord → settle → downstream truth

These are **not** launch blockers for the core pick lifecycle. What follows are blockers for specific features or surfaces that are either incomplete or require design work before implementation.

---

## Current Open Risks

| Risk | Severity | Status |
|------|----------|--------|
| Historical pre-fix outbox rows may add noise to operator incident triage | Low | Open — known, non-blocking |
| API process requires manual restart to load new code | Low | Open — dev workflow only |
| Recap/performance/accounting surfaces do not consume downstream truth | Low | **PARTIALLY RESOLVED** — `GET /api/operator/recap` calls `computeSettlementSummary`. Full rollups/evaluation/system-health wiring deferred. |

---

## Blocked Discord Channels

These channels exist in the target map but are **not routable** until architectural gaps are resolved:

### `discord:exclusive-insights`
- **Status:** Blocked — not implemented
- **Required:** Contract + implementation + graduation criteria

### `discord:game-threads`
- **Status:** Blocked — architectural gap
- **Gap:** Legacy used `sendEmbedToThread(threadId)`. V2 worker posts to channel IDs only. There is no thread routing mechanism in V2.
- **Required:** Thread routing design + implementation + activation contract

### `discord:strategy-room`
- **Status:** Blocked — architectural gap
- **Gap:** Legacy sent personal DM + public ack. V2 has no DM delivery mechanism.
- **Required:** DM routing design + implementation + activation contract

**Rule:** Do not activate any blocked target without a written and ratified contract. This is a T1 sprint trigger.

---

## Smart Form V1 — Scoring & Promotion

**Problem:** Smart Form V1 does not submit a `confidence` field. Without confidence:
- Domain analysis cannot compute edge or Kelly fraction
- All domain-derived score signals return null
- Promotion score falls back to 61.5 (static defaults)
- 61.5 < 70 threshold → picks are suppressed at the score gate
- Smart Form picks correctly land in the manual/capper lane but cannot auto-promote to Discord

**Current behavior (CORRECT for interim):**
- Picks bypass the confidence floor gate (gate 12 only applies when `pick.confidence !== undefined`)
- Picks score 61.5 and are suppressed at gate 15 (score gate)
- `promotionStatus = 'suppressed'` — evaluated, did not meet threshold (not dead on arrival)
- An operator can force-promote via `applyPromotionOverride()` with `force_promote`

**What's needed for Smart Form picks to auto-promote:**
1. Smart Form V2 must include `confidence` in its submission payload, OR
2. The scoring model must be rebuilt to score manual picks without `confidence` as sole input

**This requires a T1 sprint** — new user-facing surface, scoring rebuild. See `PROGRAM_STATUS.md § Next Milestone`.

---

## Next Milestone (from PROGRAM_STATUS.md)

**Smart Form V1 — Operator Submission Surface**

Designing and building the Smart Form V1 operator submission surface. Requires a T1 contract before implementation begins.

---

## Candidate Work Queue

| Item | Expected Tier | Rationale |
|------|---------------|-----------|
| Smart Form V1 design + contract | T1 | New user-facing surface |
| Offer Fetch service wrapper | T2 | New service, cross-package |
| DeviggingService integration | T2 | Multi-book consensus at submission |
| Risk Engine integration | T2 | Bankroll-aware sizing |
| Observation Hub permanent form | T2 | Architectural promotion |
| Promotion uniqueness/boardFit enrichment | T3 | Pure computation wiring |

---

## Do Not Start Without Planning (from CLAUDE.md)

These are **hard gates** — implementation cannot begin without a written, ratified contract:

- `discord:game-threads` live routing
- `discord:strategy-room` live routing
- Broad multi-channel expansion beyond Best Bets
- Any new product surface

---

## Promotion Policy Supersession Triggers

`docs/discord/pick_promotion_interim_policy.md` is the active promotion authority. It must be formally superseded when **all** of the following are true:

1. V2 score audit is complete and accepted
2. V2 promotion/tier audit is complete and accepted
3. Smart Form V2 includes `confidence` in its submission payload
4. Scoring rebuild is materially complete (model can score Smart Form/manual picks without confidence-as-sole-input)
5. Best Bets criteria are formally ratified in a new policy contract

Until all five conditions are met, the interim policy governs.

---

## Things Explicitly Not in V2

These legacy concepts do not exist in V2 and must not be imported:

| Legacy concept | V2 status |
|----------------|-----------|
| Tier concepts S/A/B/C/D | **Do not exist** — no tier classification in V2 |
| `discord:free-picks` | **Not in approved target map** — dropped until ratified |
| `liveUpdates` channel | **Dropped** — not in V2 target map |
| `coaching` channel | **Dropped** — not in V2 target map |
| Automated settlement from `feed` source | **Blocked** — throws 409 at service layer |
| Old lifecycle stages (PICK_SUBMITTED, etc.) | **Do not exist** — V2 stages: validated/queued/posted/settled/voided |
| `pick_lifecycle_events` table | **Does not exist** — correct table is `pick_lifecycle` |
