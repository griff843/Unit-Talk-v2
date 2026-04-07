# Decision Workspace MVP Spec

**Issue:** UTV2-417
**Generated:** 2026-04-07
**Authority:** This document specifies the MVP for the Decision workspace in the Command Center. Classifications are derived from `CC_MODULE_DEPENDENCY_MAP.md`. Scoring logic is derived from reading `apps/api/src/promotion-service.ts` and `packages/contracts/src/promotion.ts` directly — not inferred.

---

## Overview

The Decision workspace gives operators visibility into how the promotion engine evaluated a pick: what scores it received, whether it qualified for a target, where it would route, and what the board looks like before committing to post it.

The Decision workspace has **4 shippable modules**, **1 shell-only module**, and **1 blocked module**.

### Critical UX Language Rule — Applies to All Modules

**Qualified is not approved. Approved is not qualified. These are separate system concepts and must never be conflated in UX copy.**

- **Approval** is an operator decision (approve / deny / hold / return). It is stored in `picks.approval_status`. It is a precondition for promotion — not a synonym for it. Approval happens in the Operations workspace review queue.
- **Qualification** is the promotion engine's decision. It is stored in `pick_promotion_history.promotion_status`. A pick must be approved before the engine will qualify it. A pick that is approved may still be suppressed or not_eligible by the engine.

All Decision workspace UI must:
- Use "qualified" or "not qualified" for engine promotion outcomes
- Use "approved" only when referring to the operator review decision
- Never label a qualified pick as "approved" or vice versa
- Never surface the word "approved" to mean "will be posted" — delivery requires qualification, not just approval

---

## Module 1: Score Breakdown

**Status:** Shippable now

**Data source:** `pick_promotion_history` (columns: `edge`, `trust`, `readiness`, `uniqueness`, `boardFit`, `promotion_score`, `promotion_status`, `payload`)

### What It Shows

A per-component breakdown of the five promotion scores for a given pick. The engine computes a weighted sum of five components, each normalized to 0–100 before weighting. The breakdown reflects the actual decision stored — not a live recompute.

**Five components:**

| Component | Weight (best-bets default) | Input source |
|---|---|---|
| `edge` | 35% | Explicit `promotionScores.edge` → domain real-edge → confidence delta |
| `trust` | 25% | Explicit `promotionScores.trust` → domain trust signal → confidence; then CLV-adjusted |
| `readiness` | 20% | Explicit `promotionScores.readiness` → Kelly gradient → neutral fallback of 60 |
| `uniqueness` | 10% | Explicit `promotionScores.uniqueness` → neutral default of 50 (no signal wired yet) |
| `boardFit` | 10% | Explicit `promotionScores.boardFit` → default 75; reduced by correlation penalty |

**Total score:** `edge * 0.35 + trust * 0.25 + readiness * 0.20 + uniqueness * 0.10 + boardFit * 0.10`

**Policy thresholds (best-bets):** minimumScore = 70, minimumEdge = 0, minimumTrust = 0, confidenceFloor = 0.60

**Suppression outcomes:** `suppressed` (score below threshold), `not_eligible` (gate check failed), `expired` (stale pick or expired approval)

**Qualification outcome:** `qualified` (all gates passed and score ≥ minimumScore, or operator force-promoted)

### What It Does NOT Show

- Live recalculation of a future pick (see Promotion Preview, Module 2)
- Member-tier context or CLV values (Intelligence workspace)
- Reasons for the operator's approval decision (Operations workspace review queue)

### Hidden System Metadata (Not User-Visible)

The `payload` column in `pick_promotion_history` contains the full `PromotionDecisionSnapshot`: scoring profile name, policy version, all weight values, all gate input booleans, and board state at decision time. This is audit data. It must not be surfaced raw to the operator — only structured fields from the breakdown.

### UX Language Rules

- Label the weighted contribution column "Weighted score" not "Result"
- Label the total as "Promotion score" not "Approval score" or "Quality score"
- Label the outcome badge as "Qualified" / "Not qualified" / "Suppressed" / "Not eligible" — never "Approved" / "Rejected"
- Show suppression reasons (from `payload.explanation.suppressionReasons`) as a collapsed list below the breakdown
- Show which scoring profile was used (from `payload.scoringProfile`) as a small metadata note

---

## Module 2: Promotion Preview

**Status:** Shippable now

**Data source:** `pick_promotion_history` + `apps/api/src/promotion-service.ts` (live re-evaluation)

### What It Shows

For picks still in `validated` state (not yet promoted), operators can preview what target the pick would qualify for if promoted now. This is a read-only simulation — it runs the full promotion engine against the current pick state without writing to `pick_promotion_history`.

The preview evaluates all three active policies in priority order:
1. `exclusive-insights` (minimumScore: 90, edge: 90, trust: 88)
2. `trader-insights` (minimumScore: 80, edge: 85, trust: 85)
3. `best-bets` (minimumScore: 70, edge: 0, trust: 0)

The highest-priority policy for which the pick qualifies is the resolved target. If none qualify, the preview shows "No target — pick would not route."

**For already-promoted picks:** show the stored decision from `pick_promotion_history` with the resolved target. Do not trigger a live re-evaluation.

### What It Does NOT Show

- Forward-looking score predictions for picks not yet submitted
- Impact of changing individual metadata fields (counterfactual simulation is out of scope for MVP)
- CLV forecasts

### UX Language Rules

- Label the resolved target field "Routing target if promoted" — not "Approved for channel" or "Destination"
- Label each policy row as "Qualified" / "Not qualified" — not "Passes" / "Fails"
- If no policy qualifies, use "Would not route — no qualifying target" — not "Rejected" or "Denied"
- Smart-form picks always force-qualify to `best-bets` — show this clearly: "Smart-form: routes directly to best-bets"

---

## Module 3: Routing Preview

**Status:** Shippable now

**Data source:** `distribution_outbox` state + `picks.status` + `picks.promotion_target`

### What It Shows

For a given pick, shows the current routing state: where it will go (or has gone) in the delivery pipeline. This is deterministic from the pick's lifecycle state and promotion outcome — no estimation.

**Routing state matrix:**

| `picks.status` | `picks.promotion_target` | Routing state |
|---|---|---|
| `validated` | null | Not yet evaluated — awaiting promotion |
| `validated` | set | Qualified — awaiting enqueue |
| `queued` | set | Enqueued in outbox — delivery pending |
| `posted` | set | Delivered — pick is live |
| `settled` | set | Delivered and settled |
| Any | null (after promotion ran) | Did not qualify — will not route |
| Any | Any | `voided` → voided, will not route |

**Outbox row:** if a row exists in `distribution_outbox` for this pick, show claim state (`pending`, `claimed`, `done`, `failed`, `dead_letter`), target channel, and claimed_at timestamp.

### What It Does NOT Show

- Discord embed preview or message formatting
- Historical delivery failure logs for prior picks
- Channel health or circuit breaker state (Operations workspace)

### UX Language Rules

- Label target channel as "Delivery target" — not "Approved channel" or "Approved for"
- Use "Qualified — awaiting delivery" not "Approved — ready to post"
- Use "Did not qualify — will not route" not "Rejected" or "Denied"
- If outbox row is `dead_letter`, label it "Delivery failed — manual intervention required" and link to Operations > Exceptions

---

## Module 4: Board Saturation

**Status:** Shippable now

**Data source:** `distribution_outbox` + `picks` (queried by sport / market type / game event)

### What It Shows

A real-time count of how many picks are currently live (status: `queued` or `posted`) for a given:
- Sport (e.g., NBA, NHL, NFL)
- Game/event (`eventName` from pick metadata)
- Market type (e.g., `player_prop_points`, `spread`, `total`)

**Board cap context:** the system enforces hard caps per promotion target. For `best-bets`:
- Per slate: 15 picks maximum
- Per sport: 10 picks maximum
- Per game/thesis cluster: 2 picks maximum

The board saturation module shows current counts against these caps so operators can anticipate suppression before submitting a pick.

**Board exposure data** is already present in `GET /api/operator/snapshot` (via `boardExposure` field) — this module surfaces it as a first-class Decision tool, not buried in the ops snapshot.

### What It Does NOT Show

- Individual pick scores for board members (that is the Score Breakdown module)
- Projected future exposure (no forecasting)
- Saturation across deferred channels (`exclusive-insights`, `game-threads`, `strategy-room`)

### UX Language Rules

- Label counts as "Active on board" not "Approved picks" or "Posted picks"
- When a sport or game is at cap, label the badge "Board cap reached — new picks for this game will be suppressed"
- Do not use "rejected" or "denied" for cap suppression — use "suppressed by board cap"

---

## Module 5: Hedge Overlays

**Status:** Shell only

**Data source:** `hedge_opportunities` table (exists; populated only when hedge conditions are detected against live pick volume)

### What It Shows

When hedge conditions are detected, displays flagged pick pairs with:
- Pick A and Pick B identities (market, selection, odds)
- Hedge type: `arbitrage`, `middle`, or `hedge`
- Detected profit window or risk-free range
- Detection timestamp

### Current Limitation

The `hedge_opportunities` table is live in schema but is only populated when the hedge detection logic fires against active open picks. With current pick volume, this table may be empty or have sparse rows. The UI shell can ship and will show "No hedge opportunities detected" when the table is empty.

### What It Does NOT Show

- Middling opportunities (see Module 6 — blocked)
- Manual hedge calculation tools
- Historical resolved hedge opportunities

### If Empty

Display: "No hedge opportunities detected for current board. Hedge detection runs automatically against open picks." Do not show a loading spinner or error state when the table is empty — empty is a valid state.

### UX Language Rules

- Label "Arbitrage" / "Middle" / "Hedge" by the exact classification from the detection engine — do not simplify to a single label
- Do not imply guaranteed profit — label profit windows as "Detected window" not "Guaranteed return"

---

## Module 6: Middling Overlays

**Status:** Blocked — multi-book

**Data source:** Requires simultaneous multi-book line feeds via `provider_offers.bookmaker_key` across 2+ books at the same time with stable ingestion

**Exact blocker:** byBookmaker ingestion must be proven stable across Pinnacle, DraftKings, FanDuel, and BetMGM simultaneously. As of 2026-04-07, `provider_offers` has 329k rows with per-bookmaker rows via `bookmaker_key`, but the stability of simultaneous multi-book ingestion at the moment of middling window detection has not been proven end-to-end.

### What It Will Show (When Unblocked)

Pick pairs where opening lines from two different books create a middle opportunity — a spread where both sides can win simultaneously. Requires real-time comparison of opening vs current lines across books to detect the window before it closes.

### What It Does NOT Show Until Unblocked

Nothing. Do not ship a shell UI for middling that suggests the feature is available. The dependency is blocking — no partial display is correct.

### Unblock Path

1. Prove `byBookmaker` ingestion is stable across 2+ books simultaneously (track freshness gaps, confirm no missed rows)
2. Wire middling detection logic from `packages/domain/src/hedge-detection.ts` against live multi-book `provider_offers` rows
3. Validate detected middle windows against known historical middles

---

## Implementation Priority Order

Shippable in v1 (no blockers):
1. Score Breakdown — data fully live in `pick_promotion_history`
2. Routing Preview — data fully live in `distribution_outbox` + `picks`
3. Board Saturation — data live in `picks` + `distribution_outbox`; partial data already surfaced in operator snapshot
4. Promotion Preview — promotion engine re-evaluation is deterministic and stateless

Shell in v1 (ship empty state, no fake data):
5. Hedge Overlays — table exists, show when data appears

Blocked (do not ship until dependency resolved):
6. Middling Overlays — do not ship shell; dependency is active, not just volume

---

## Approval vs Promotion: System Separation Reference

This section exists to prevent UX drift. Read it before writing any label, tooltip, or status badge for the Decision workspace.

**Approval** (`picks.approval_status`):
- Set by: operator in the review queue (Operations workspace)
- Values: `approved`, `denied`, `hold`, `pending`
- Meaning: operator has reviewed the pick and agreed to allow it to proceed
- Gate: promotion engine checks `approvalStatus === 'approved'` as a hard gate — non-approved picks are suppressed before scoring

**Promotion qualification** (`pick_promotion_history.promotion_status`):
- Set by: `evaluatePromotionEligibility()` in `packages/domain/src/promotion.ts`
- Values: `qualified`, `suppressed`, `not_eligible`, `expired`
- Meaning: the pick passed (or failed) the engine's scoring gates and weighted threshold
- Gate: distribution service checks `promotion_status === 'qualified'` before enqueuing to the outbox

**Chain:** a pick must be `approved` by an operator AND `qualified` by the engine before it can be `queued` in the outbox and delivered to a Discord channel.

**What this means for UX:**
- "Approved" in the Decision workspace context refers to operator review — it is the input to promotion, not the outcome
- "Qualified" is the promotion engine's verdict — it is the output of scoring, not operator judgment
- Never use "approved" to mean "will be posted" — a pick is only posted if it is qualified, enqueued, and successfully delivered
- Never use "qualified" to mean "the operator approved it" — qualification is system-determined

---

## Data Sources Reference

| Module | Tables / Services |
|---|---|
| Score Breakdown | `pick_promotion_history` |
| Promotion Preview | `pick_promotion_history` + live `evaluatePromotionEligibility()` call |
| Routing Preview | `picks`, `distribution_outbox` |
| Board Saturation | `picks`, `distribution_outbox` |
| Hedge Overlays | `hedge_opportunities` |
| Middling Overlays | **BLOCKED** — `provider_offers` multi-book (not yet proven stable) |

---

## Non-Goals for MVP

- No write actions in Decision workspace — read-only (writes go through Operations actions)
- No pick creation or editing from Decision workspace
- No batch promotion simulation
- No counterfactual score adjustment ("what if edge were 80?")
- No Discord embed preview or channel message formatting
- No activation of deferred Discord channels (`exclusive-insights`, `game-threads`, `strategy-room`)
