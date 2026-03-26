# Unit Talk V2 Score + Promotion Truth Audit

> **Date:** 2026-03-23
> **Working directory:** C:/dev/Unit-Talk-v2
> **Method:** Direct source inspection — V2 only. No cross-repo contamination.
> **Status:** Complete

---

## Executive Verdict

V2 scoring is not a general model. It is a **five-input weighted sum** (edge, trust, readiness, uniqueness, boardFit) where every input is either explicitly set in `pick.metadata.promotionScores`, derived from domain analysis (implied probability + confidence + Kelly), or filled by a hardcoded static default. Smart Form V1 provides none of the inputs the scoring system needs: `confidence` is absent from the submission payload, so domain analysis cannot compute edge or Kelly, all domain-derived signals return null, and the score resolves to exactly **61.5** via the static fallbacks. Smart Form picks are then blocked by a second independent gate — the `confidenceFloor = 0.6` check on `pick.confidence` — before the score threshold is even reached. There is **no tier concept in V2**: no S/A/B/C/D classification exists anywhere in the codebase. The only quality classification is `promotionStatus` on the pick record. The current model is trustworthy for picks that were explicitly scored (i.e., submitted with real `confidence` in (0,1) range and valid `odds`), but is producing a meaningless deterministic fallback number for all Smart Form / manual picks. Best Bets should be restricted to picks with a real confidence field and valid odds until the scoring rebuild gives Smart Form access to the full scoring surface.

---

## 1. Current V2 Scoring Model

### Source Files

| File | Role |
|------|------|
| `packages/contracts/src/promotion.ts:125–131` | `bestBetsScoreWeights` — the only weights in V2 |
| `apps/api/src/promotion-service.ts:393–413` | `readPromotionScoreInputs()` — builds the five inputs with fallback chains |
| `apps/api/src/promotion-service.ts:415–438` | `readDomainAnalysisEdgeScore()` — converts raw edge to 0-100 |
| `apps/api/src/promotion-service.ts:451–468` | `readDomainAnalysisTrustSignal()` — derives trust from domain edge |
| `apps/api/src/promotion-service.ts:481–494` | `readDomainAnalysisReadinessSignal()` — derives readiness from Kelly |
| `apps/api/src/promotion-service.ts:510–520` | `normalizeConfidenceForScoring()` — converts confidence to 0-100 |
| `packages/domain/src/promotion.ts:151–165` | `calculateScore()` — executes the weighted sum |
| `packages/domain/src/promotion.ts:167–173` | `normalizeScore()` — clamps each component to [0, 100] |
| `apps/api/src/domain-analysis-service.ts:47–96` | `computeSubmissionDomainAnalysis()` — implied probability, edge, Kelly at submission time |

### Formula

```
total = normalizeScore(edge)   × 0.35
      + normalizeScore(trust)  × 0.25
      + normalizeScore(readiness) × 0.20
      + normalizeScore(uniqueness) × 0.10
      + normalizeScore(boardFit)   × 0.10

where normalizeScore(x) = clamp(x, 0, 100)
```

Weights source: `packages/contracts/src/promotion.ts:125–131`

```typescript
export const bestBetsScoreWeights: PromotionScoreWeights = {
  edge: 0.35, trust: 0.25, readiness: 0.2, uniqueness: 0.1, boardFit: 0.1,
};
```

Note: `bestBetsScoreWeights` is used by `calculateScore()` for **both** Best Bets and Trader Insights decisions. There is one weight set in the codebase.

### Input Fallback Chains (`readPromotionScoreInputs`)

| Input | Tier 1 (explicit) | Tier 2 (domain-derived) | Tier 3 (static default) |
|-------|-------------------|------------------------|------------------------|
| edge | `metadata.promotionScores.edge` | `readDomainAnalysisEdgeScore()` | `confidenceScore` |
| trust | `metadata.promotionScores.trust` | `readDomainAnalysisTrustSignal()` | `confidenceScore` |
| readiness | `metadata.promotionScores.readiness` | `readDomainAnalysisReadinessSignal()` | **80** |
| uniqueness | `metadata.promotionScores.uniqueness` | — | **80** |
| boardFit | `metadata.promotionScores.boardFit` | — | **75** |

`confidenceScore = normalizeConfidenceForScoring(pick.confidence)`:
- `undefined` or `NaN` → **50**
- `≤ 1` → `value × 100` (0-1 range stored as fraction)
- `> 1` → `value` as-is (0-100 range stored directly)

### Domain-Derived Signal Formulas

**`readDomainAnalysisEdgeScore()`** (`promotion-service.ts:415–438`):
```
edgeScore = clamp(50 + rawEdge × 400, 0, 100)
rawEdge = pick.confidence - impliedProbability  (set at submission time)

Examples: rawEdge +0.10 → 90, +0.05 → 70, 0.00 → 50, -0.05 → 30
Returns null if metadata.domainAnalysis.edge is absent or not finite.
```

**`readDomainAnalysisTrustSignal()`** (`promotion-service.ts:451–468`):
```
Returns 80 if domainAnalysis.hasPositiveEdge === true AND edge ≥ 0.05
Returns 65 if domainAnalysis.hasPositiveEdge === true AND edge < 0.05
Returns null if hasPositiveEdge is not true (falls through to confidenceScore)
```

**`readDomainAnalysisReadinessSignal()`** (`promotion-service.ts:481–494`):
```
Returns 85 if domainAnalysis.kellyFraction > 0
Returns null otherwise (falls through to static default 80)
```

Domain analysis is computed at submission time (`domain-analysis-service.ts:47–96`). It requires:
- `pick.odds` present and not null
- `pick.confidence` in range (0, 1) exclusive — **stored as a fraction, not a percentage**

If either condition is absent, `edge` and `kellyFraction` are not written to `domainAnalysis`.

### Exact 61.5 Derivation

Smart Form V1 `buildSubmissionPayload()` (`apps/smart-form/lib/form-utils.ts:65–93`) does not include `confidence` in its output. `SubmitPickPayload` has no `confidence` field (`apps/smart-form/lib/api-client.ts:5–15`).

Therefore: `pick.confidence = undefined`

Fallback chain:
1. `normalizeConfidenceForScoring(undefined)` → **50** (`confidenceScore = 50`)
2. `readDomainAnalysisEdgeScore()`: domain analysis was computed (odds may be present), but `edge` field was never written because `pick.confidence` was absent at submission → returns **null**
3. edge input → falls to `confidenceScore` = **50**
4. `readDomainAnalysisTrustSignal()`: `hasPositiveEdge` was never set → returns **null**
5. trust input → falls to `confidenceScore` = **50**
6. `readDomainAnalysisReadinessSignal()`: `kellyFraction` was never set → returns **null**
7. readiness input → falls to static default = **80**
8. uniqueness → static default = **80**
9. boardFit → static default = **75**

```
total = 50×0.35 + 50×0.25 + 80×0.20 + 80×0.10 + 75×0.10
      = 17.50 + 12.50 + 16.00 + 8.00 + 7.50
      = 61.50
```

**Exactly 61.5. Deterministic. Every Smart Form V1 pick that lacks confidence scores 61.5.**

---

## 2. Current V2 Tier Model

**There is no tier model in V2.**

`CanonicalPick` (`packages/contracts/src/picks.ts`) has no `tier` field. There is no `TierScale`, no S/A/B/C/D classification, no tier-based routing anywhere in the V2 codebase. The only quality classification on a pick record is `promotionStatus` (values: `not_eligible`, `eligible`, `qualified`, `promoted`, `suppressed`, `expired`).

The promotion outcome (`qualified` vs `suppressed`) is the effective quality signal. A pick either passes all gates and is `qualified`, or it does not.

**Smart Form tier behavior:** Not applicable — there is no tier. Smart Form picks get `promotionStatus = 'suppressed'` with the reason `pick confidence is below the best-bets floor`.

**Is promotion status trustworthy enough to drive interim routing?** Yes, for picks that were scored on real inputs. No, for Smart Form picks — their `suppressed` status is correct but their score of 61.5 is a fallback artifact, not a meaningful quality signal.

---

## 3. Current V2 Promotion Model

### Source Files

| File | Role |
|------|------|
| `packages/domain/src/promotion.ts:15–143` | `evaluatePromotionEligibility()` — all gates |
| `apps/api/src/promotion-service.ts:84–248` | `evaluateAllPoliciesEagerAndPersist()` — dual-policy evaluation |
| `packages/contracts/src/promotion.ts:133–159` | Policy definitions and board caps |

### Best Bets Policy (`bestBetsPromotionPolicy`)

```typescript
minimumScore:    70      // total weighted score
minimumEdge:     0       // edge component (no floor beyond 0)
minimumTrust:    0       // trust component (no floor beyond 0)
confidenceFloor: 0.6     // pick.confidence in 0-1 range; undefined → 0
boardCaps: { perSlate: 5, perSport: 3, perGame: 1 }
version: 'best-bets-v1'
```

### Trader Insights Policy (`traderInsightsPromotionPolicy`)

```typescript
minimumScore:    80
minimumEdge:     85      // hard component floor — very restrictive
minimumTrust:    85      // hard component floor — very restrictive
confidenceFloor: 0.6
boardCaps: { perSlate: 5, perSport: 3, perGame: 1 }
version: 'trader-insights-v1'
```

### Gate Evaluation Order (`evaluatePromotionEligibility`)

Gates are evaluated in this sequence. Any gate failure (before the force-promote check) adds to `suppressionReasons` and the pick is returned as `not_eligible` or `suppressed`:

| # | Gate | Best Bets value | Notes |
|---|------|-----------------|-------|
| 1 | `override.suppress` | — | Operator-set |
| 2 | `approvalStatus !== 'approved'` | required | Smart Form picks default to `approved` |
| 3 | `!hasRequiredFields` | market + selection + source | Smart Form satisfies this |
| 4 | `isStale` | metadata flag | False by default |
| 5 | `!withinPostingWindow` | metadata flag | True by default |
| 6 | `!marketStillValid` | metadata flag | True by default |
| 7 | `riskBlocked` | metadata flag | False by default |
| 8 | `boardState.duplicateCount > 0` | computed | Dedup check |
| 9 | `boardState.currentBoardCount >= perSlate` | 5 | **Open risk: counts all historical qualified picks** |
| 10 | `boardState.sameSportCount >= perSport` | 3 | Same issue |
| 11 | `boardState.sameGameCount >= perGame` | 1 | Same issue |
| 12 | `(pick.confidence ?? 0) < confidenceFloor` | 0.6 | **Smart Form fails here — `undefined ?? 0 = 0 < 0.6`** |
| 13 | `edgeScore < minimumEdge` | 0 | Would pass even at 0 for Best Bets |
| 14 | `trustScore < minimumTrust` | 0 | Would pass even at 0 for Best Bets |
| 15 | `breakdown.total < minimumScore` | 70 | **Smart Form fails here too — 61.5 < 70** |

Smart Form picks fail at **two independent gates**: gate 12 (confidence floor) and gate 15 (score). Gate 12 fires first.

### Board Cap Behavior

**RESOLVED (Run 003, 2026-03-24).** `getPromotionBoardState` now filters to picks with `status IN ('validated', 'queued', 'posted')` in addition to `promotion_status IN ('qualified', 'promoted')`. Settled and voided picks no longer count toward board capacity. Historical picks from prior test runs no longer saturate caps.

Note: the correct active-state filter is `('validated', 'queued', 'posted')` — not just `('queued', 'posted')`. Picks remain `validated` throughout their pre-delivery lifecycle in V2 (the worker transitions them to `queued` → `posted` after delivery). Excluding `validated` would allow multiple picks to qualify in the same game slot before any are delivered.

Implementation: `packages/db/src/runtime-repositories.ts` (both `InMemoryPickRepository` and `DatabasePickRepository`).

### Priority Routing

`evaluateAllPoliciesEagerAndPersist()` evaluates Trader Insights first, then Best Bets. A pick qualifying for both routes exclusively to Trader Insights. Both policy results are written to `pick_promotion_history` regardless.

---

## 4. Smart Form / Manual Pick Path

### What Smart Form Provides

Source: `apps/smart-form/lib/form-utils.ts:65–93` (`buildSubmissionPayload`) and `apps/smart-form/lib/api-client.ts:5–15` (`SubmitPickPayload`)

| Field | Sent? | Notes |
|-------|-------|-------|
| `source` | YES — hardcoded `'smart-form'` | Governance enforcement |
| `market` | YES | Derived from sport + market type label |
| `selection` | YES | Built from player, stat, line, direction |
| `odds` | YES | Raw American odds |
| `line` | YES | Raw numeric line |
| `stakeUnits` | YES | Units field |
| `eventName` | YES | Optional free text |
| `metadata.*` | YES | sport, marketType, date, capper, sportsbook, player, statType, direction, team |
| `confidence` | **NO** | Field does not exist in `buildSubmissionPayload` or `SubmitPickPayload` |
| `submittedBy` | YES | Capper name string |

### What the Scoring Pipeline Consumes

`readPromotionScoreInputs()` reads from `pick.confidence` and `pick.metadata.domainAnalysis`. Smart Form provides `odds`, so domain analysis **runs** at submission time (`computeSubmissionDomainAnalysis`). However, domain analysis requires `pick.confidence > 0 && pick.confidence < 1` to compute `edge` and `kellyFraction`. Since `confidence` is absent, domain analysis writes `impliedProbability` and `decimalOdds` only — no edge, no Kelly.

Result: all three domain-derived signal functions return null, all three fall to static defaults or `confidenceScore=50`.

### Can Smart Form Picks Currently Qualify for Best Bets?

**No.** Blocked by two independent gates:

1. **Confidence floor gate** (`gate 12`): `(undefined ?? 0) = 0 < 0.6` → `pick confidence is below the best-bets floor`
2. **Score gate** (`gate 15`): `61.5 < 70` → `promotion score 61.50 is below threshold 70.00`

Gate 12 fires first and terminates evaluation with `suppressionReasons`.

### Should Smart Form Picks Be Treated as Manual/Capper Lane?

**Yes.** Smart Form picks are structurally manual picks: no confidence, no edge, no Kelly. They should be routed to VIP/capper surfaces directly. They are not model-qualified picks and should not be presented as such.

---

## 5. Confidence / EV / Edge Analysis

### Confidence

**Exists as a real business field in V2.** `CanonicalPick.confidence` is defined in the contract (`picks.ts:26`). It is expected as a fraction in (0, 1) range (e.g., 0.65 = 65% win probability estimate).

`normalizeConfidenceForScoring()` handles both 0-1 and 0-100 inputs defensively:
- `≤ 1` → treated as fraction, multiplied by 100
- `> 1` → treated as percentage, used directly
- `undefined` → 50 (neutral)

Confidence is **not** an independent promotion gate in V2. It feeds into the fallback chain for edge and trust only when domain analysis is absent. It also controls the `confidenceFloor` gate (0.6 for both policies) as a raw 0-1 value on `pick.confidence`.

### EV (Expected Value)

**Does not exist as a distinct concept in V2.** There is no EV field, no EV computation, and no EV gate in the V2 promotion pipeline. The mathematical equivalent is `edge = confidence - impliedProbability` (computed by `domain-analysis-service.ts`), stored as a raw fraction in `metadata.domainAnalysis.edge`.

### Edge

**Exists in two forms in V2:**

1. **Raw edge** (`metadata.domainAnalysis.edge`): `confidence - impliedProbability`. Range typically −0.5 to +0.5. Computed only when both `confidence` and `odds` are present.

2. **Promotion edge score** (`readDomainAnalysisEdgeScore`): `clamp(50 + rawEdge × 400, 0, 100)`. This is the 0-100 value that feeds the weighted sum. A raw edge of +0.05 produces a promotion edge score of 70.

The promotion policy's `minimumEdge = 0` for Best Bets means any non-negative edge score passes the edge gate. The real quality bar is `minimumScore = 70`.

For Trader Insights, `minimumEdge = 85` is a hard component floor — requiring a raw edge of approximately +0.0875 (from `(85-50)/400 = 0.0875`) before any other evaluation.

### What Should Matter Right Now

| Signal | Currently Active | Should Drive Interim Promotion |
|--------|-----------------|-------------------------------|
| confidence | Yes — falls back to 50 when absent; gates confidenceFloor | Required for model lane; absent from Smart Form |
| raw edge (domain analysis) | Yes — computed when confidence + odds present | Best available quality signal for enriched picks |
| promotion score (weighted sum) | Yes — 61.5 for Smart Form, variable for enriched picks | Should gate Best Bets; current 70 threshold is reasonable |
| EV | Not implemented | Not applicable |
| tier (S/A/B/C/D) | **Does not exist in V2** | Not applicable |

---

## 6. Interim Operating Recommendation

Grounded in current V2 code truth only.

### Manual / Capper Lane

**Definition:** Any pick submitted without `confidence` in the payload, or with `confidence` present but without valid `odds` (i.e., domain analysis cannot compute edge/Kelly).

This includes all current Smart Form V1 submissions.

**What it means:**
- These picks are valid, visible, high-quality picks from cappers
- They are suitable for VIP picks surfaces, capper threads, and direct premium delivery
- They are **not automatically eligible for Best Bets**
- Their promotion score of 61.5 is a fallback artifact — not a quality verdict

### Model-Qualified Lane

**Definition:** Any pick with `confidence` present in (0, 1) range AND valid `odds`, such that domain analysis computed `edge` and (when positive) `kellyFraction`.

For these picks, `readPromotionScoreInputs()` produces real signal-backed values for edge, trust, and readiness. The score is meaningful.

**Best Bets rule (interim):**
- Score ≥ 70 (current threshold)
- Confidence floor met: `pick.confidence ≥ 0.6`
- Not board-capped (requires board state query fix for historical pollution)
- No operator suppression flags

Both conditions are already enforced by the existing V2 promotion gates. No code change required to implement this rule — it is already the runtime behavior.

### Operator Override / Curated Lane

**Definition:** Picks that an operator explicitly force-promotes via `applyPromotionOverride()` with `action: 'force_promote'`.

**Rules:**
- Must have an explicit `reason` string
- Is recorded in `pick_promotion_history` with `override_action = 'force_promote'`
- Should be rare — reserved for operator judgment on high-conviction manual picks
- Is fully auditable via the audit log

### What This Means Practically

| Surface | Manual/Capper lane | Model-qualified lane | Operator override |
|---------|-------------------|----------------------|-------------------|
| VIP picks | YES | YES | YES |
| Capper surfaces | YES | YES | — |
| Best Bets | **NO** | YES (score ≥ 70 + conf ≥ 0.6) | YES (explicit) |
| Trader Insights | **NO** | YES (score ≥ 80 + edge ≥ 85 + trust ≥ 85) | YES (explicit) |

The only required operational fix before this is reliable: **the board state query must filter to only count picks with `lifecycleState IN ('queued', 'posted')`**. Currently it counts all-time qualified picks, which saturates caps after test runs.

---

## 7. Required Follow-Up Changes

### Docs Only
- Correct prior audit memos in `docs/audits/` — both production repo audits are not authoritative for V2
- Add note to `PROGRAM_STATUS.md` open risks: Smart Form missing confidence → model lane ineligibility

### Config / Policy
- No policy changes required for interim operation — existing gates already implement the correct interim behavior
- Consider adding an explicit `version: 'interim-v1'` label to `bestBetsPromotionPolicy` to signal the policy is not final

### Code Changes
1. **Board state query fix:** RESOLVED (Run 003, 2026-03-24). Filter is `status IN ('validated', 'queued', 'posted')` — not `('queued', 'posted')` as originally documented. See Board Cap Behavior section above.
2. **Smart Form confidence field (when V2 scoring rebuild begins):** Add `confidence` to `buildSubmissionPayload()` and `SubmitPickPayload`. Until then, Smart Form picks correctly land in manual/capper lane.

### Later Rebuild Tasks (Not Contracted)
- V2 scoring model rebuild: replace 5-input weighted sum with a model that can score from market data without requiring manual confidence input
- Board state concept clarification: distinguish "picks currently live on the board" from "picks historically qualified"
- Operator dashboard: add a `dataSufficiency` indicator distinguishing scored-on-real-data picks from fallback-scored picks
- Smart Form enrichment: define which metadata fields could be enriched post-submission (e.g., closing line, implied probability) to feed back into promotion scoring

---

## 8. Ratified Decisions Applied (2026-03-24)

The following decisions were made by Griff after reviewing this audit. They are ratified policy, not recommendations.

| Decision | Rule | Doc Updated |
|----------|------|-------------|
| **Confidence language** | `confidence` is a technical scoring input only — not a user-facing signal, not a product authority, not used in marketing language | `pick_promotion_interim_policy.md` |
| **Smart Form lane** | Smart Form = manual/capper lane. Picks should be allowed into system, scored silently, NOT hard-blocked at confidence floor gate. Code change required (pending authorization). | `pick_promotion_interim_policy.md` |
| **EV/edge display** | EV/edge shown only when `pick.confidence` in (0,1) AND valid `pick.odds` both present. If either absent, hide EV/edge. Smart Form picks currently never qualify. | `discord_embed_system_spec.md` |

**Code change implemented (Run 002, 2026-03-24):**
The confidence floor gate (gate 12) now only fires when `pick.confidence` is explicitly present. Picks without confidence bypass the gate and are evaluated on their score. This is source-agnostic — the fix applies to all manual/capper picks regardless of source, not just `'smart-form'`. Picks without confidence score 61.5 via static fallbacks and are suppressed at the score gate (61.5 < 70). `packages/domain/src/promotion.ts:58-65`.

---

## 9. Evidence Index

| File | Lines | Finding |
|------|-------|---------|
| `packages/contracts/src/promotion.ts:125–131` | — | `bestBetsScoreWeights` — edge=0.35, trust=0.25, readiness=0.20, uniqueness=0.10, boardFit=0.10 |
| `packages/contracts/src/promotion.ts:133–159` | — | `bestBetsPromotionPolicy` and `traderInsightsPromotionPolicy` — all thresholds |
| `packages/contracts/src/picks.ts:18–39` | — | `CanonicalPick` definition — no tier field exists |
| `packages/contracts/src/submission.ts:1–12` | — | `SubmissionPayload` — no confidence field required |
| `packages/domain/src/promotion.ts:15–173` | — | `evaluatePromotionEligibility()` — full gate sequence; `calculateScore()` — weighted sum implementation |
| `apps/api/src/promotion-service.ts:393–520` | — | `readPromotionScoreInputs()`, `readDomainAnalysisEdgeScore()`, `readDomainAnalysisTrustSignal()`, `readDomainAnalysisReadinessSignal()`, `normalizeConfidenceForScoring()` |
| `apps/api/src/promotion-service.ts:84–248` | — | `evaluateAllPoliciesEagerAndPersist()` — dual-policy evaluation, priority routing |
| `apps/api/src/domain-analysis-service.ts:47–96` | — | `computeSubmissionDomainAnalysis()` — requires confidence in (0,1) for edge/Kelly |
| `apps/smart-form/lib/form-utils.ts:65–93` | — | `buildSubmissionPayload()` — no `confidence` field |
| `apps/smart-form/lib/api-client.ts:5–15` | — | `SubmitPickPayload` — no `confidence` field |
