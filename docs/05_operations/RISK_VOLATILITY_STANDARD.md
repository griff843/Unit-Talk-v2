# Risk / Volatility Standard

**Status:** RATIFIED 2026-04-15
**Authority:** UTV2-607 — audit prerequisite: add an explicit risk/volatility component to the routing score.
**Depends on:** `packages/contracts/src/promotion.ts` (PromotionScoreInputs, PromotionScoreBreakdown), `packages/domain/src/promotion.ts` (calculateScore, evaluatePromotionEligibility), `packages/domain/src/risk/kelly-sizer.ts`, `packages/domain/src/bands/thresholds.ts`

---

## 1. Problem Statement

The current routing score is a 5-component weighted sum:

```
score = edge × w_e + trust × w_t + readiness × w_r + uniqueness × w_u + boardFit × w_b
```

Edge carries the highest single weight (0.35–0.45 depending on target). This creates a structural blind spot: a high-edge, high-variance pick routes exactly the same as a high-edge, low-variance pick. The score can overstate the value of opportunities where outcome variance — not edge magnitude — is the dominant factor determining whether the pick belongs in a top-tier promotion channel.

Concrete failure modes:

- **Longshot inflation:** A +1200 moneyline play with a 30% model probability and 7% edge scores identically to a -115 spread with the same model edge. The longshot has materially higher outcome variance and poses more systemic risk if published to a subscriber board at volume.
- **Stale-line masking:** A pick with high model edge but rapid adverse line movement (a signal that sharp money disagrees) routes to `trader-insights` or `exclusive-insights` without penalty.
- **Odds dispersion blindness:** A market where book A offers -110 and book B offers -140 indicates uncertainty about the true price. The current score does not penalize this disagreement.
- **Kelly fraction mismatch:** `kelly-sizer.ts` already computes a fractional Kelly that intrinsically accounts for variance (via the b = decimal_odds − 1 term). A pick whose fractional Kelly is 0 or capped by `max_bet_fraction` carries a risk signal that the promotion score ignores.

---

## 2. What Risk/Volatility Means in This Context

Risk/volatility is not a single number. It is a composite of four observable signals, each measuring a different dimension of outcome uncertainty:

| Signal | What it measures | Data source |
|--------|-----------------|-------------|
| **Variance tier** | Implied outcome variance from the market price (longshot vs favorite) | Submitted odds or provider line |
| **Kelly fraction** | Kelly-optimal fraction given model probability vs offered odds; near-zero means the edge is thin relative to price uncertainty | `computeKellyFraction()` in `packages/domain/src/risk/kelly-sizer.ts` |
| **Line movement speed** | Rate of adverse price change since model evaluated the opportunity; fast movement signals that the market is correcting against the pick | Ingestor line snapshot delta (`pick.metadata.lineMovement`) |
| **Odds dispersion** | Spread of prices across books for the same market; high dispersion signals price uncertainty | Multi-book consensus result (`computeMultiBookConsensus()`) |

All four signals are already computable from data available at promotion time. None require new data sources.

---

## 3. Why the Current Score Is Incomplete

The edge component (weight 0.35–0.45) is computed as `model_probability − implied_probability`. It measures size of the perceived advantage but not quality or stability of that advantage. Two picks with identical edge scores can differ by:

- A factor of 10× in implied outcome variance (American odds +800 vs −115)
- A factor of 5× in Kelly fraction (thin edge at long odds vs solid edge at even odds)
- Line movement direction (price improving vs deteriorating since model ran)
- Book consensus (all books agree vs wide dispersion)

The band system in `packages/domain/src/bands/` partially addresses this via `UNCERTAINTY_CAPS` and `LIQUIDITY_BAND_CAPS`, but band assignment is a separate pipeline that runs before promotion scoring and does not feed back into the promotion score. A pick that passes band assignment still enters the promotion scorer with no risk signal.

The existing `riskBlocked` gate in `BoardPromotionEvaluationInput` is a binary suppression flag set by the operator, not a computed score component. It cannot express gradations of risk that should lower routing tier without fully suppressing the pick.

---

## 4. Risk/Volatility Signal Specification

### 4.1 Variance Tier (from odds)

Derive implied variance tier from the submitted decimal odds. High-odds picks have high outcome variance regardless of edge.

```
decimalOdds = americanToDecimal(pick.odds)

varianceTier =
  if decimalOdds >= 6.0 (approx +500 or longer):  EXTREME   → risk penalty: 40
  if decimalOdds >= 3.5 (approx +250 or longer):  HIGH      → risk penalty: 25
  if decimalOdds >= 2.0 (approx +100 or even):    MODERATE  → risk penalty: 10
  if decimalOdds <  2.0 (favorites):              LOW       → risk penalty: 0
```

The penalty is a 0–100 score where 100 = no risk, 0 = maximum risk. Convert:

```
varianceScore = 100 − risk_penalty
```

### 4.2 Kelly Fraction Score

Use the already-computed Kelly fraction from `pick.metadata.kellySizing.fractional_kelly` (written by the submission service per `KELLY_POLICY.md`).

```
kellyFraction = pick.metadata.kellySizing.fractional_kelly  // 0.0 – max_bet_fraction (default 0.05)
kellyScore    = clamp(kellyFraction / DEFAULT_MAX_BET_FRACTION, 0, 1) × 100
              = clamp(kellyFraction / 0.05, 0, 1) × 100
```

A pick with zero Kelly (no edge at the offered price) scores 0. A pick at the max cap scores 100.

If `kellySizing` is absent, `kellyScore = 0` (fail-closed, not a default pass).

### 4.3 Line Movement Score

Derived from `pick.metadata.lineMovement` if present. A line moving against the pick (price lengthening for a favorite, shortening for a dog) is adverse.

```
lineMovementBps = pick.metadata.lineMovement.basisPointsDelta  // negative = adverse

lineMovementScore =
  if lineMovementBps is absent:           50  (neutral — no data, not penalized but not rewarded)
  if lineMovementBps >= +10:             100  (price improving — model is being validated)
  if lineMovementBps >= 0:                75  (stable)
  if lineMovementBps >= -20:              50  (minor adverse movement)
  if lineMovementBps >= -50:              25  (significant adverse movement)
  if lineMovementBps <  -50:              0   (sharp adverse movement — model likely wrong)
```

### 4.4 Odds Dispersion Score

Derived from `pick.metadata.consensus.bookSpread` if present — the inter-quartile range of devigged probabilities across books, as computed by `computeMultiBookConsensus()`.

```
dispersionPct = pick.metadata.consensus.bookSpread  // 0.0 – 1.0 (probability points)

dispersionScore =
  if dispersionPct is absent:             50  (neutral — single book, no consensus data)
  if dispersionPct <= 0.02:              100  (all books agree)
  if dispersionPct <= 0.05:               75  (minor disagreement)
  if dispersionPct <= 0.10:               50  (moderate disagreement)
  if dispersionPct <= 0.20:               25  (high disagreement)
  if dispersionPct >  0.20:               0   (extreme disagreement — market uncertain)
```

### 4.5 Composite Risk Score

Combine the four sub-scores with fixed internal weights. These weights are internal to the risk component and do not interact with the outer promotion score weights.

```
riskScore = (
  varianceScore    × 0.35 +
  kellyScore       × 0.35 +
  lineMovementScore × 0.20 +
  dispersionScore  × 0.10
)
```

**Range:** 0–100. Higher = lower risk / higher volatility safety.

These internal weights reflect the audit finding: outcome variance (via price) and Kelly fraction together account for the dominant portion of routing risk. Line movement is a strong but less-available signal. Dispersion is a useful supplement when multi-book data exists.

The weights must be version-stamped. Initial version: `risk-v1`.

---

## 5. Integration with the Existing 5-Component Score

The risk score integrates as a **modifier on the final score**, not as a 6th additive component. The modifier approach is chosen because:

1. Adding a 6th additive component would require renormalising all existing weight sets across all scoring profiles and all three targets — a broad, risky change.
2. Risk is a downward pressure, not an upward one. A high-risk pick should never score higher than a low-risk pick with identical edge/trust/readiness/uniqueness/boardFit.
3. A modifier preserves existing score semantics while adding a disciplined risk floor.

### Modifier formula

```
rawScore     = calculateScore(input, policy.weights)  // existing 5-component total (0–100)
riskModifier = riskScore / 100                        // 0.0 – 1.0

modifiedScore = rawScore × (1 − RISK_MODIFIER_WEIGHT + RISK_MODIFIER_WEIGHT × riskModifier)
```

Where `RISK_MODIFIER_WEIGHT = 0.15` (15% of the final score is influenced by risk).

This means:
- A pick with `riskScore = 100` (zero risk) has `modifiedScore = rawScore × 1.0` — no penalty.
- A pick with `riskScore = 0` (maximum risk) has `modifiedScore = rawScore × 0.85` — 15% reduction.
- A pick with `riskScore = 50` (moderate risk) has `modifiedScore = rawScore × 0.925` — 7.5% reduction.

The modifier constant `RISK_MODIFIER_WEIGHT = 0.15` is version-stamped and must be updated in the score version string when changed.

### Score version bump

When the risk modifier is activated, bump the policy version strings:

- `best-bets-v2` → `best-bets-v3`
- `trader-insights-v2` → `trader-insights-v3`
- `exclusive-insights-v2` → `exclusive-insights-v3`

All existing `PromotionDecisionSnapshot` rows written under v2 remain valid for replay against v2 policies. Replay against v3 requires the `riskScore` field to be present in the snapshot.

---

## 6. Hard Thresholds

The modifier is insufficient for extreme risk cases. The following hard thresholds suppress a pick from specific targets regardless of the composite score:

| Condition | Target blocked | Reason |
|-----------|---------------|--------|
| `varianceTier = EXTREME` (decimalOdds ≥ 6.0) | `exclusive-insights`, `trader-insights` | Longshots are not appropriate for top-tier operator channels regardless of edge |
| `kellyFraction = 0` (no edge at offered price) | `exclusive-insights` | Zero-Kelly means the model finds no positive EV at this price; exclusive routing requires demonstrated Kelly edge |
| `lineMovementBps < −50` (sharp adverse movement) | `exclusive-insights`, `trader-insights` | Pick is likely stale; sharp money has moved against it |
| `riskScore < 20` | `exclusive-insights` | Composite risk is too high for the highest-trust channel |
| `riskScore < 10` | `trader-insights` | Composite risk is too high even for the second-tier channel |

These thresholds are enforced as hard suppression gates — they fire before the composite score is computed, in the same gate-check sequence as `riskBlocked`, `isStale`, and board caps in `evaluatePromotionEligibility()`.

A suppression reason string is emitted for each triggered threshold and included in `BoardPromotionDecision.explanation.suppressionReasons`.

---

## 7. Operator Visibility

The risk score and its components must appear in the score explanation surfaces wherever the existing breakdown is shown.

### Score breakdown extension

`PromotionScoreBreakdown` (in `packages/contracts/src/promotion.ts`) is extended:

```typescript
export interface PromotionScoreBreakdown {
  edge: number;
  trust: number;
  readiness: number;
  uniqueness: number;
  boardFit: number;
  // Added by UTV2-607:
  riskScore: number;           // 0–100 composite risk score (higher = lower risk)
  riskModifier: number;        // effective multiplier applied (0.85 – 1.0)
  total: number;               // final modified score
}
```

`PromotionDecisionSnapshot.scoreInputs` is extended:

```typescript
scoreInputs: {
  edge: number;
  trust: number;
  readiness: number;
  uniqueness: number;
  boardFit: number;
  edgeSource?: EdgeSource;
  // Added by UTV2-607:
  riskScore?: number;
  riskComponents?: {
    varianceScore: number;
    kellyScore: number;
    lineMovementScore: number;
    dispersionScore: number;
  };
}
```

`riskScore` and `riskComponents` are optional for backward compatibility with pre-v3 snapshots.

### Command center pick detail

The operator pick detail page must show:

- **Risk score:** numeric (0–100) with label "Risk quality"
- **Risk modifier:** percentage reduction applied, e.g. "−6.8% (risk modifier)"
- **Risk components:** expandable sub-table showing varianceScore, kellyScore, lineMovementScore, dispersionScore with their individual values
- **Visual tone:** green (riskScore ≥ 75), amber (riskScore 40–74), red (riskScore < 40)
- **Hard threshold indicators:** if any hard threshold fired, show which threshold and why

This display must be consistent with the existing edge-source trust indicators in `apps/command-center/src/lib/score-insight.ts`.

---

## 8. Enforcement Point

The risk score is computed and enforced in `packages/domain/src/promotion.ts` inside `evaluatePromotionEligibility()`.

### Placement in the gate sequence

Hard risk thresholds fire in the existing suppression gate block, after the operator-level `riskBlocked` flag and before the composite score check:

```typescript
// Existing gates: override.suppress, approvalStatus, hasRequiredFields,
// isStale, withinPostingWindow, marketStillValid, riskBlocked, boardState, ...

// NEW — UTV2-607 risk gates:
const riskResult = computeRiskScore(input.pick, input.scoreInputs);
if (riskResult.hardBlock) {
  suppressionReasons.push(...riskResult.hardBlockReasons);
}

// Existing score gates continue below
const breakdown = calculateScoreWithRisk(input, policy.weights, riskResult.score);
```

### New exports from `packages/domain/src/promotion.ts`

```typescript
export interface RiskScoreResult {
  score: number;                         // 0–100 composite
  modifier: number;                      // 0.85 – 1.0
  hardBlock: boolean;                    // true if any hard threshold fired
  hardBlockReasons: string[];
  components: {
    varianceScore: number;
    kellyScore: number;
    lineMovementScore: number;
    dispersionScore: number;
  };
}

export function computeRiskScore(
  pick: CanonicalPick,
  scoreInputs: PromotionScoreInputs,
): RiskScoreResult;
```

`computeRiskScore` is a pure function. It reads only from `pick.odds`, `pick.metadata.kellySizing`, `pick.metadata.lineMovement`, and `pick.metadata.consensus`. It does not call any external service. Absent fields default to neutral sub-scores (not zero, except `kellyScore` which fails closed).

### calculateScore update

`calculateScore()` (currently private in `packages/domain/src/promotion.ts`) is updated to accept an optional `riskScore` parameter and apply the modifier:

```typescript
function calculateScore(
  input: BoardPromotionEvaluationInput,
  weights: PromotionScoreWeights,
  riskScore?: number,         // 0–100; undefined = no modifier (pre-v3 compat)
): PromotionScoreBreakdown
```

When `riskScore` is undefined, the modifier is 1.0 (no change). This preserves deterministic replay for pre-v3 snapshots.

### Version constant

```typescript
export const RISK_MODIFIER_WEIGHT = 0.15;          // modifiable without policy version bump IF kept in this constant
export const RISK_SCORE_VERSION   = 'risk-v1';     // bump when formula changes
```

---

## 9. Audit Trail

Every promotion decision made under a v3+ policy must include in `pick_promotion_history.metadata.scoreInputs`:

- `riskScore`: the composite 0–100 value
- `riskComponents`: the four sub-scores
- `riskModifier`: the effective multiplier (1 d.p.)

Snapshots written before v3 are replay-compatible with v2 policies only. Replaying them against v3 policies with no `riskScore` in the snapshot uses the no-modifier path (`riskScore = undefined` → modifier 1.0).

---

## 10. Change History

| Date | Change | Authority |
|------|--------|-----------|
| 2026-04-15 | Initial ratification: 4-signal composite risk modifier, hard thresholds, snapshot extension, enforcement point | UTV2-607 |
