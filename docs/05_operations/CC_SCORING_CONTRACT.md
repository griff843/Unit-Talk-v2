# CC Scoring Contract

**Issue:** UTV2-418
**Date:** 2026-04-07
**Authority:** This document governs how the five promotion score components are labeled, explained, and displayed in the Command Center. It is derived from reading `packages/contracts/src/promotion.ts` and `packages/domain/src/promotion.ts` directly — not inferred.
**Merge tier:** T2 — doc, no runtime change.

---

## Purpose

This contract prevents misrepresentation of the scoring engine in any Command Center surface. Every CC page, component, tooltip, and label that surfaces promotion score data must conform to this document.

---

## Section 1 — Five Component Definitions

Each component is a 0–100 input to the promotion engine. All five are normalized to [0, 100] before weighting. The descriptions below are plain-language operator-facing definitions — they do not expose implementation internals.

### 1.1 Edge

**What it measures:** How much better this pick's expected outcome is compared to the market price. A higher edge score means the system detected a larger gap between the model's probability estimate and the implied probability from the market odds. This is the primary indicator of potential value.

**What it does NOT mean:** It is not a win probability. It is not a guarantee that the pick will win. It is not a measure of confidence in isolation.

**Input resolution order (implementation truth — for engineering only, not displayed to operators):**
1. Explicit `pick.metadata.promotionScores.edge` if provided
2. Real-edge model probability vs Pinnacle devigged line (`real-edge` source)
3. Multi-book consensus devigged line (`consensus-edge` source)
4. SGO devigged line (`sgo-edge` source)
5. Confidence minus implied probability from submitted odds (`confidence-delta` source)

### 1.2 Trust

**What it measures:** How reliable the submitter's track record and signal quality are for this type of pick. A higher trust score means the system has higher confidence in the submitter's historical accuracy on similar plays. Trust is adjusted post-hoc by closing line value (CLV) feedback over time.

**What it does NOT mean:** It is not an approval of the submitter. It is not a measure of the pick's edge or correctness. It does not reflect operator opinion.

**Input resolution order (engineering only):**
1. Explicit `pick.metadata.promotionScores.trust` if provided
2. Domain trust signal derived from submitter track record
3. Confidence as a proxy fallback
4. CLV trust adjustment applied on top via `computeClvTrustAdjustment()`

### 1.3 Readiness

**What it measures:** Whether the pick is in a ready-to-act market condition: line is fresh, timing is appropriate, and sizing is supported by Kelly criterion analysis. A higher readiness score means the pick arrives at an optimal point in the market lifecycle.

**What it does NOT mean:** It is not a measure of how good the pick is. It is not an operator review signal. It does not guarantee delivery timing.

**Input resolution order (engineering only):**
1. Explicit `pick.metadata.promotionScores.readiness` if provided
2. Kelly gradient computation
3. Neutral fallback of 60 when no signal is available

### 1.4 Uniqueness

**What it measures:** How differentiated this pick is from other picks already on the board. A higher uniqueness score means less overlap with existing live picks in terms of market type, game, and player. Low uniqueness indicates correlation risk with the current board.

**What it does NOT mean:** It is not a creativity score. It is not a measure of information advantage. It does not mean the pick is rare or novel in the market.

**Current signal status:** Uniqueness has no live signal wired as of this contract date. The engine defaults to a neutral value of 50 for all picks. This will be updated when a uniqueness signal is wired.

**Input resolution order (engineering only):**
1. Explicit `pick.metadata.promotionScores.uniqueness` if provided
2. Default 50 (neutral — no signal wired)

### 1.5 Board Fit

**What it measures:** How well this pick fits alongside the current set of live picks on the board. Accounts for correlation between picks (same game, same player, same market cluster). A higher board fit score means lower systemic correlation risk when this pick is added to the current board.

**What it does NOT mean:** It is not a quality score for the pick in isolation. It is a board-context measure that can change as other picks are posted or settled.

**Input resolution order (engineering only):**
1. Explicit `pick.metadata.promotionScores.boardFit` if provided
2. Default of 75; reduced by correlation penalty when correlated picks are detected on the board

---

## Section 2 — Visible Labels (Approved Names)

The following names are the only approved labels for these components in any CC surface. No synonyms or alternative framings are permitted.

| Component key | Approved display label |
|---|---|
| `edge` | **Edge** |
| `trust` | **Trust** |
| `readiness` | **Readiness** |
| `uniqueness` | **Uniqueness** |
| `boardFit` | **Board Fit** |
| `total` / `promotion_score` | **Promotion Score** |

**Prohibited label substitutions** (must never appear in CC):
- "AI score" — prohibited
- "Quality score" — prohibited
- "Approval score" — prohibited
- "Confidence score" — prohibited (confidence is a separate pick field, not the promotion score)
- "Rating" as a synonym for any of the five components — prohibited
- Any label that implies certainty, prediction, or AI authorship — prohibited

---

## Section 3 — Display Format

**One format per component.** No mixing of formats across components on the same surface.

### 3.1 Individual Component Format

Each of the five components displays as:
- **A numeric value rounded to the nearest whole number, on a 0–100 scale**
- Example: `72`, `45`, `88`
- No decimal places for operator-facing display
- No letter grades (no A/B/C)
- No color-only encoding without a numeric value alongside it

A progress bar or gauge may accompany the numeric value as a visual aid, but the numeric value must always be present. The bar is supplementary — it is never the sole representation.

### 3.2 Weighted Contribution Format

When showing each component's contribution to the total promotion score, display:
- **Component score × policy weight = weighted contribution**
- Label the column "Weighted score" (not "Result", not "Points", not "Score")
- Example row: `Edge | 80 | 35% | 28.0`

### 3.3 Composite Score Format

The overall promotion score displays as:
- **A numeric value rounded to one decimal place, on a 0–100 scale**
- Label it "Promotion Score" (not "Total", not "Overall score", not "Grade")
- Example: `Promotion Score: 74.5`
- Show the threshold the score is evaluated against: "Threshold: 70 (best-bets)"

### 3.4 Policy Weights Reference (by target)

These are the canonical weights from `packages/contracts/src/promotion.ts`. Display only the weights for the policy that produced the stored decision.

| Component | best-bets | trader-insights | exclusive-insights |
|---|---|---|---|
| Edge | 35% | 40% | 45% |
| Trust | 25% | 30% | 30% |
| Readiness | 20% | 15% | 10% |
| Uniqueness | 10% | 10% | 10% |
| Board Fit | 10% | 5% | 5% |

---

## Section 4 — Composite Score Display

The promotion score block must contain all of the following elements:

1. **Promotion Score** — numeric (one decimal), label "Promotion Score"
2. **Threshold** — the `minimumScore` for the evaluated policy, labeled "Threshold"
3. **Outcome badge** — one of: `Qualified` / `Not Qualified` / `Suppressed` / `Not Eligible` / `Expired`
4. **Policy name** — the scoring profile and policy version used (from `payload.scoringProfile` and `payload.policyVersion` in `pick_promotion_history`)
5. **Component breakdown** — all five components with their raw score (0–100), weight %, and weighted contribution

**Outcome badge rules:**
- `Qualified` — `pick_promotion_history.promotion_status = 'qualified'` (or force-promoted by operator)
- `Suppressed` — `promotion_status = 'suppressed'` (score below threshold, all gate checks passed)
- `Not Eligible` — `promotion_status = 'not_eligible'` (one or more hard gate checks failed)
- `Expired` — `promotion_status = 'expired'` (pick was stale or approval expired)
- Never use `Approved`, `Rejected`, `Denied`, or `Failed` as outcome badges

Suppression reasons (from `payload.explanation.suppressionReasons`) must be shown as a collapsed list below the composite score block when suppression reasons are present.

---

## Section 5 — What Operators May NOT Claim

The following statements are prohibited in all CC surfaces, tooltips, documentation, and operator-facing copy:

| Prohibited claim | Why prohibited |
|---|---|
| "This pick was generated by AI" | The scoring engine evaluates picks — it does not generate them. Picks are submitted by human cappers or smart-form. |
| "This pick is guaranteed to win" | The engine measures edge and trust — not outcomes. No score implies a win guarantee. |
| "A high promotion score means this pick will win" | Promotion score determines routing eligibility — not win probability. |
| "Approved score" or "Quality score" as labels | These conflate approval (operator decision) with scoring (engine decision). They are separate system concepts. |
| "The AI recommends this pick" | The engine does not recommend picks. It evaluates whether a pick qualifies for a distribution target. |
| "Score above X means the pick is good" | Score thresholds determine routing eligibility only. They do not certify pick quality. |
| Claiming uniqueness or trust scores reflect market intelligence | Uniqueness currently defaults to 50; trust reflects submitter track record, not market positioning. |

---

## Section 6 — Fallback Behavior

**Rule: fail closed.** When a score component is null, missing, or non-finite, show `—` (an em dash). Never show `0` as a fallback — zero is a valid score and would misrepresent the actual state.

| Condition | Display |
|---|---|
| Score component value is null or undefined | `—` |
| Score component value is `NaN` or `Infinity` | `—` |
| Entire `pick_promotion_history` row is missing for a pick | Show "No promotion evaluation on record" — do not show any score values |
| Policy weights are missing from payload | Show component raw scores only (no weighted contribution column) — do not fabricate weights |
| `promotion_status` is missing | Show "—" for outcome badge — do not default to any status |

**The composite score block must never display a partial set of five components.** If any component is missing, show the component row with `—` for all numeric fields. Do not skip the row.

---

## Section 7 — Write Authority

**Scores are read-only in Command Center.** No CC surface may write, override, or modify any score component or the promotion status.

**What CC may not do:**
- Write to `pick_promotion_history`
- Modify `picks.promotion_target`
- Modify `picks.promotion_score`
- Re-run the promotion engine in a way that persists to the database (preview re-evaluation is read-only and must not write)
- Allow operators to adjust component weights or scores via any UI control

**What CC may do:**
- Read and display stored `pick_promotion_history` rows
- Trigger a read-only promotion preview re-evaluation (does not write to `pick_promotion_history`)
- Trigger operator override actions (force-promote, suppress) via the Operations workspace server actions — these write through `apps/api` via Bearer-authenticated endpoints, not directly to the DB

**Authority chain:**
- Score values are written by `evaluateAndPersistBestBetsPromotion()` / `evaluateAllPoliciesEagerAndPersist()` in `apps/api/src/promotion-service.ts`
- The domain implementation of scoring lives in `packages/domain/src/promotion.ts`
- The canonical weights and thresholds live in `packages/contracts/src/promotion.ts`
- CC reads results — it has no authority over scoring logic

---

## Governance

This contract is owned by the Command Center workstream. Changes to component definitions, labels, display formats, or fallback behavior require a contract update with PM approval. Changes to score weights or thresholds in `packages/contracts/src/promotion.ts` must be reflected in Section 3.4 of this document in the same PR.
