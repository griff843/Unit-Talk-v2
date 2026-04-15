# Uniqueness Scoring Standard

**Status:** RATIFIED 2026-04-15
**Authority:** UTV2-605 — audit prerequisite: replace dead-weight uniqueness scoring with a real portfolio signal.
**Depends on:** `packages/contracts/src/promotion.ts` (PromotionScoreInputs, PromotionScoreWeights), `packages/domain/src/promotion.ts` (evaluatePromotionEligibility, calculateScore)

---

## Purpose

The promotion scoring system computes a weighted 5-input score (edge, trust, readiness, **uniqueness**, boardFit) to route picks to operator channels. The uniqueness component carries a weight of 10% across all three promotion targets. This standard defines what uniqueness is supposed to measure, documents the audit finding that made this a blocker, and specifies the computation, thresholds, and enforcement required before the component contributes meaningfully to routing decisions.

---

## 1. What Uniqueness Means

**Uniqueness** measures how differentiated the proposed pick is from positions already on the active board. High uniqueness means the pick adds genuine portfolio diversity — a new market type, a fresh correlation group, a position that is not replicated by existing board occupancy. Low uniqueness means the pick is a near-clone of something already being surfaced.

The concept is defined by three sub-signals:

| Sub-signal | Meaning |
|---|---|
| **Correlation group overlap** | How many active picks share the same game event and thesis cluster (e.g., same team to cover, same player prop direction). |
| **Market novelty** | Whether this market type and selection direction already has coverage on the board for this slate. A pick on a market with zero board presence is more unique. |
| **Operator concentration** | How many picks from the same submitter are already active. A high concentration from a single operator reduces uniqueness at the portfolio level. |

A uniqueness score of 100 means the pick is fully differentiated across all three sub-signals. A score of 0 means the pick duplicates board state on all three dimensions.

---

## 2. Why the Current Implementation Fails

**Audit finding (UTV2-605):** The uniqueness score input is hardcoded to `50` in the API service for every pick, regardless of board state.

Location: `apps/api` submission/promotion path (confirmed in `packages/domain/CLAUDE.md`: *"Uniqueness score input is hardcoded to 50 in the API service, not here — domain has no signal wired for it yet"*).

Consequences:

1. **Dead weight.** Uniqueness is a non-varying constant. It contributes exactly `50 × weight` (= 5.0 for best-bets, 5.0 for trader-insights, 5.0 for exclusive-insights) to every pick's total score, unconditionally.

2. **10% of the promotion score is structurally uninformative.** Under `best-bets-v2` weights (`uniqueness: 0.10`), the uniqueness component always contributes exactly 5.00 to the total score. This means the effective score range is [0, 95] plus a constant 5 — every pick receives a free 5-point bump regardless of how duplicated or novel it is.

3. **Board saturation is not penalized.** A 5th pick on the same game-winner thesis scores identically (on uniqueness) to a novel same-game parlay market with no board presence.

4. **Deterministic replay is misleading.** Snapshot-replayed decisions claim to reproduce the original uniqueness signal, but the signal was never computed — it was always 50. Audit confidence in replayed decisions is degraded.

5. **Hard eligibility vs soft signal inversion.** The duplicate count check (`boardState.duplicateCount > 0`) is a hard suppression gate, but it fires only on exact duplicates. Near-duplicate concentration (2–3 similar picks, not exact dupes) is not penalized anywhere. Uniqueness scoring was the intended mechanism for this; with it hardcoded, the gap is structural.

---

## 3. What a Real Uniqueness Signal Looks Like

A real uniqueness signal is computed from portfolio state at the moment of promotion evaluation. It requires the following inputs:

### 3.1 Required Inputs

| Input | Type | Source |
|---|---|---|
| `correlationGroupCount` | `number` | Count of active board picks in the same correlation group as the candidate pick. Correlation group = same event ID + same market family (moneyline / spread / total / prop). |
| `sameSelectionDirectionCount` | `number` | Count of active board picks with the same selection direction on the same market type for this slate (e.g., number of active "over" picks on player receiving yards across all games). |
| `submitterActivePickCount` | `number` | Count of picks from this submitter currently active on the board (validated, queued, or posted). |
| `boardTotalActiveCount` | `number` | Total active picks across the full current board. Used for concentration normalization. |

These inputs are available at promotion evaluation time because `BoardPromotionEvaluationInput` already carries `boardState`. The current `PromotionBoardState` shape must be extended to include the correlation group and selection direction counts. See Section 6 for the contract extension point.

### 3.2 What the Signal Does Not Require

- External API calls. All inputs derive from the current board state query already performed before promotion evaluation.
- Model inference or LLM calls.
- Historical data. This is a point-in-time portfolio signal, not a retrospective metric.

---

## 4. Computation Specification

### 4.1 Component Scores

Each sub-signal produces a component score in [0, 100].

**Correlation group penalty (C):**

```
C_raw = max(0, correlationGroupCount - 1)   // zero for first pick in group
C = max(0, 100 - C_raw × 25)               // -25 per additional correlated pick
```

Cap: `C = max(0, C)`. A group of 5+ correlated picks scores 0 on this component.

**Market novelty score (M):**

```
M = sameSelectionDirectionCount === 0 ? 100 :
    sameSelectionDirectionCount === 1 ? 75  :
    sameSelectionDirectionCount === 2 ? 50  :
    sameSelectionDirectionCount === 3 ? 25  :
    0
```

**Concentration score (K):**

```
concentration = submitterActivePickCount / max(1, boardTotalActiveCount)
K = max(0, 100 - Math.round(concentration × 400))
```

The multiplier of 400 means a submitter representing 25%+ of the board scores 0 on this component.

### 4.2 Composite Uniqueness Score

```
uniqueness = Math.round(
  0.50 × C +   // correlation group overlap is the primary signal
  0.30 × M +   // market novelty is secondary
  0.20 × K     // operator concentration is tertiary
)
```

Result is clamped to [0, 100].

### 4.3 Rationale for Weights

- Correlation group overlap (50%) is the strongest signal for duplicate-like board saturation. It directly measures whether the proposed pick argues the same thesis as existing board picks.
- Market novelty (30%) measures whether the market type is already well-represented, a meaningful but softer signal.
- Operator concentration (20%) penalizes portfolio over-reliance on a single source. It is tertiary because board caps already limit per-game and per-sport counts; concentration matters most when those caps are not yet binding.

---

## 5. Hard Thresholds

Uniqueness is not merely a scoring input — it is an eligibility gate at the top tiers.

| Tier | Minimum Uniqueness Score | Behavior Below Threshold |
|---|---|---|
| `best-bets` | 20 | No hard gate. Uniqueness score contributes to total; low uniqueness reduces total score below `minimumScore`. |
| `trader-insights` | 40 | Hard suppression. A uniqueness score below 40 must add a `suppressionReason` and set `qualified: false`. |
| `exclusive-insights` | 60 | Hard suppression. A uniqueness score below 60 must add a `suppressionReason` and set `qualified: false`. |

**Rationale:** `trader-insights` and `exclusive-insights` serve operators who are explicitly paying for differentiated signal. Routing near-duplicate picks to those channels degrades product trust. The 10% weight already penalizes low uniqueness in the score, but for top-tier channels the penalty is not sufficient — a strong edge score can overwhelm a low uniqueness score in the weighted sum. The hard gate prevents that override.

**Suppression message format:**

```
uniqueness score <N> is below the <target> minimum of <threshold>
```

Example: `"uniqueness score 32 is below the trader-insights minimum of 40"`

---

## 6. Enforcement Points

### 6.1 Contract Extension — `PromotionBoardState`

File: `packages/contracts/src/promotion.ts`

The current `PromotionBoardState` interface must be extended with two new optional fields:

```typescript
export interface PromotionBoardState {
  currentBoardCount: number;
  sameSportCount: number;
  sameGameCount: number;
  duplicateCount: number;
  // UTV2-605: uniqueness signal inputs — required for real uniqueness computation
  correlationGroupCount?: number;      // picks in same event + market family
  sameSelectionDirectionCount?: number; // picks with same direction on same market type
  submitterActivePickCount?: number;   // active picks from this submitter
}
```

These fields are optional to preserve backward compatibility with callers that pre-date UTV2-605. When absent, the uniqueness computation falls back to Section 6.3 behavior.

### 6.2 Score Computation — `packages/domain/src/promotion.ts`

The `calculateScore` function currently reads `input.scoreInputs.uniqueness` directly. After UTV2-605:

1. A new exported function `computeUniquenessScore(boardState: PromotionBoardState): number` must be added to `packages/domain/src/promotion.ts` implementing Section 4.
2. `calculateScore` must call `computeUniquenessScore` when the extended board state fields are present, and use the result to populate `input.scoreInputs.uniqueness` before weighting.
3. Alternatively, the API service computes the uniqueness score via `computeUniquenessScore` before constructing `BoardPromotionEvaluationInput`, and populates `scoreInputs.uniqueness` directly. This is the preferred approach because `domain` remains pure — it does not reach into `boardState` to override a score input; instead the caller provides the correct value.

**Preferred call site:** `apps/api` promotion path, at the point where `scoreInputs` is assembled.

### 6.3 Fallback Behavior (Partial Data)

When `correlationGroupCount`, `sameSelectionDirectionCount`, or `submitterActivePickCount` are absent from `boardState`:

- The uniqueness score must **not** default to 50.
- The uniqueness score must default to **35** (below all top-tier hard gates, above best-bets soft floor).
- The score explanation must include: `"uniqueness: computed from partial board state — correlation group data unavailable"`.

This ensures partial data degrades gracefully without the silent free-pass that the hardcoded 50 produced.

### 6.4 Hard Gate Enforcement in `evaluatePromotionEligibility`

File: `packages/domain/src/promotion.ts`

After the edge and trust threshold checks (lines 68–78 of the current implementation), add:

```typescript
const uniquenessScore = normalizeScore(input.scoreInputs.uniqueness);
const uniquenessFloor = UNIQUENESS_FLOORS[input.target] ?? 0;
if (uniquenessScore < uniquenessFloor) {
  suppressionReasons.push(
    `uniqueness score ${uniquenessScore.toFixed(0)} is below the ${input.target} minimum of ${uniquenessFloor}`,
  );
}
```

Where `UNIQUENESS_FLOORS` is a const:

```typescript
const UNIQUENESS_FLOORS: Partial<Record<PromotionTarget, number>> = {
  'trader-insights': 40,
  'exclusive-insights': 60,
};
```

`best-bets` has no floor in this map — it relies solely on the weighted total.

---

## 7. Operator Visibility

### 7.1 Score Breakdown Display

The `PromotionScoreBreakdown` already includes `uniqueness: number`. Operator-facing pick detail pages must display the uniqueness component in the score breakdown with a human-readable label and signal descriptor.

| Uniqueness Score Range | Label | Visual Tone |
|---|---|---|
| 80–100 | "High portfolio novelty" | Green |
| 60–79 | "Moderate novelty" | Amber-green |
| 40–59 | "Low novelty — similar picks active" | Amber |
| 20–39 | "Very low novelty — concentrated thesis" | Orange |
| 0–19 | "Near-duplicate board exposure" | Red |

### 7.2 Score Explanation Payload

The `PromotionExplanationPayload.reasons` array (populated in `buildDecision`) must include a uniqueness descriptor when the score is computed from real board state:

```
"uniqueness: <score>/100 — <N> correlated picks, <M> same-direction picks, submitter at <K>% board share"
```

Example: `"uniqueness: 62/100 — 1 correlated pick, 0 same-direction picks, submitter at 4% board share"`

When the fallback applies: `"uniqueness: 35/100 — computed from partial board state"`

### 7.3 Snapshot Auditability

The `PromotionDecisionSnapshot.scoreInputs.uniqueness` value stored in `pick_promotion_history.metadata` must reflect the computed value (not 50). This ensures replayed decisions via `replayPromotion()` use the original computed score and produce auditable results.

---

## 8. Migration Notes

### 8.1 Historical Rows

All picks with `pick_promotion_history.metadata.scoreInputs.uniqueness = 50` prior to this standard's implementation are to be treated as having used the dead-weight constant. They must not be retroactively corrected. Audit queries filtering on uniqueness must apply a date filter to exclude pre-UTV2-605 rows.

### 8.2 Scoring Profile Versions

When this standard is implemented, all affected `PromotionPolicy.version` strings must be incremented:
- `best-bets-v2` → `best-bets-v3`
- `trader-insights-v2` → `trader-insights-v3`
- `exclusive-insights-v2` → `exclusive-insights-v3`

The `defaultScoringProfile.version` must be incremented from `2.1.0` to `3.0.0` to mark the boundary between dead-weight uniqueness and the real signal.

### 8.3 Existing Board Cap Logic

The hard suppression on `boardState.duplicateCount > 0` (exact duplicate check) remains in place and is independent of this standard. Uniqueness scoring handles the _near-duplicate_ case; the duplicate count gate handles the exact-duplicate case. Both apply.

---

## 9. Verification Criteria

A PR implementing this standard is not closeable until:

1. `pnpm type-check` passes with the extended `PromotionBoardState` interface.
2. `pnpm test` passes including new unit tests for `computeUniquenessScore` covering:
   - Zero board picks: score = 100
   - 3 correlated picks: correlation component = max(0, 100 - 2×25) = 50
   - `sameSelectionDirectionCount = 4`: market novelty component = 0
   - Submitter at 30% board share: concentration component = 0
   - Fallback (missing fields): score = 35
3. The hardcoded `50` in `apps/api` promotion path is removed and replaced with a call to `computeUniquenessScore`.
4. The hard gate suppressions for `trader-insights` and `exclusive-insights` are present in `evaluatePromotionEligibility`.
5. The operator pick detail page displays the uniqueness label from the table in Section 7.1.
6. `pick_promotion_history` rows written after the deploy have `scoreInputs.uniqueness` values other than exactly 50 (runtime proof).

---

## References

- `packages/contracts/src/promotion.ts` — `PromotionScoreWeights`, `PromotionScoreInputs`, `PromotionBoardState`, `PromotionPolicy`
- `packages/domain/src/promotion.ts` — `evaluatePromotionEligibility`, `calculateScore`, `buildDecision`
- `packages/domain/CLAUDE.md` — audit note: *"Uniqueness score input is hardcoded to 50 in the API service"*
- `docs/05_operations/SCORE_PROVENANCE_STANDARD.md` — parallel standard for edge source provenance (UTV2-580)
- `docs/05_operations/BOARD_CAP_POLICY.md` — hard board cap rules that operate alongside uniqueness scoring
- UTV2-605 — Linear issue tracking this work
