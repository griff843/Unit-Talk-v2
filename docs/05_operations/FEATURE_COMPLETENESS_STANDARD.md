# Feature Completeness Standard

**Status:** RATIFIED 2026-04-15
**Authority:** UTV2-625 — defines minimum required features per model slice before a pick can qualify as top tier.
**Depends on:** `CHAMPION_INVENTORY_STANDARD.md`, `packages/domain/src/probability/probability-layer.ts`

---

## Purpose

The architecture docs explicitly state: incomplete data must not produce elite tiers. This document converts that rule from prose into hard per-slice thresholds.

Failure mode this prevents: a pick with 40% feature completeness being routed to `trader-insights` or `exclusive-insights` with a score that looks authoritative.

---

## 1. Feature Completeness Concept

Feature completeness is expressed as a float [0.0, 1.0] representing the fraction of required input signals that were actually present at scoring time. It is computed in `probability-layer.ts` and passed through the promotion evaluation pipeline.

Current implementation (soft gate):
- Completeness < 1.0 reduces final confidence via `uncertainty += (1 - featureCompleteness) * 0.1`
- Completeness is clamped to a minimum of 0.3 in the probability computation
- This means even a pick with 0% completeness gets `completenessFactor = 0.3` — it is NOT hard-blocked

**This standard defines hard thresholds that override the soft gate behavior.**

---

## 2. Feature Categories

| Category | Definition | Impact if missing |
|----------|-----------|-------------------|
| **Mandatory** | Required for any score to be valid. Missing = pick blocked from scoring entirely. | Hard block at submission |
| **Core** | Required for top-tier (`trader-insights`, `exclusive-insights`) routing. Missing = capped at `best-bets`. | Tier cap |
| **Standard** | Required for `best-bets` routing. Missing = score penalized but pick still eligible. | Score reduction |
| **Enrichment** | Optional. Improves accuracy when present. | No gate — soft improvement only |

---

## 3. Per-Slice Feature Requirements

### NBA — Player Props

| Feature | Category | Notes |
|---------|----------|-------|
| `sport` | Mandatory | Must be `NBA` |
| `selection` | Mandatory | Must parse to player name + stat type + line |
| `odds` | Mandatory | American odds for Kelly and CLV computation |
| `eventName` | Standard | Game context. Without it: no CLV possible. |
| `player` or `participantId` | Standard | Participant linkage. Without it: no grading. |
| `line` | Standard | Numeric line. Without it: no over/under resolution. |
| Edge source (real-edge or consensus-edge) | Core | Required for trader-insights/exclusive-insights. |
| `promotionScores.edge` OR devigging data | Core | Explicit edge. Required for top-tier. |
| Recent player form data | Enrichment | Improves accuracy but not required. |
| Injury/lineup context | Enrichment | Optional. |

**NBA player-prop completeness thresholds:**

| Tier | Minimum completeness | Mandatory features | Core features |
|------|---------------------|-------------------|---------------|
| `exclusive-insights` | 0.85 | All present | All present |
| `trader-insights` | 0.75 | All present | All present |
| `best-bets` | 0.50 | All present | Not required |
| `qualified` (no routing) | 0.30 | All present | Not required |
| Block | < 0.30 | Any missing | N/A |

### NBA — Game Lines (moneyline, spread, total, team-total)

| Feature | Category |
|---------|----------|
| `sport` | Mandatory |
| `selection` | Mandatory |
| `odds` | Mandatory |
| `eventName` | Standard |
| `line` | Standard |
| Edge source (real-edge or consensus-edge) | Core |
| Devigging data | Core |
| Multi-book consensus | Enrichment |

**NBA game-line completeness thresholds:** Same tier/threshold table as NBA player-props.

### NFL — Player Props and Game Lines

Same structure as NBA. Same thresholds.

### MLB — Player Props (batting, pitching)

Same structure as NBA player-props with additional:

| Feature | Category |
|---------|----------|
| `statType` (hits, HR, RBI, etc.) | Mandatory |
| Pitcher handedness context | Enrichment |
| Park factor context | Enrichment |

### MLB — Game Lines

Same as NBA game lines.

### NHL — Player Props and Game Lines

Same structure as NBA. Same thresholds.

---

## 4. Completeness Score Computation

The completeness score for a pick is computed at promotion-evaluation time as:

```
completeness = (mandatory_present + core_present * 0.6 + standard_present * 0.3) /
               (mandatory_count + core_count * 0.6 + standard_count * 0.3)
```

Where `*_present` is the count of present features in that category, and `*_count` is the total count in that category for the pick's sport × market-family slice.

Enrichment features do not affect completeness score — they only affect prediction quality.

---

## 5. Hard Gate Enforcement

### Current state

Feature completeness is currently a soft gate only. This standard defines the intended hard gates. Mechanical enforcement is a follow-on issue.

### Target enforcement points

**At promotion evaluation** (`packages/domain/src/promotion.ts`):

1. Compute per-slice completeness score for the pick.
2. If mandatory features missing → `hasRequiredFields = false` → suppression reason `required canonical fields are missing`.
3. If `exclusive-insights` target AND completeness < 0.85 → suppress from exclusive-insights (can still qualify for lower targets).
4. If `trader-insights` target AND completeness < 0.75 → suppress from trader-insights.
5. If `best-bets` target AND completeness < 0.50 → suppress from best-bets (still `qualified`).
6. If completeness < 0.30 AND mandatory features missing → hard block: `promotionStatus = 'suppressed'`.

### Completeness surfaced as explanation

The completeness score and missing features MUST appear in:
- `PromotionDecisionSnapshot.scoreInputs` — for replay and audit
- Operator pick detail page — for human review
- `pick_promotion_history.metadata` — for analytics

---

## 6. Completeness Visibility in Operator Surfaces

The operator must be able to see, per pick:
1. The completeness score (0.0–1.0).
2. Which category each missing feature falls into (mandatory/core/standard).
3. Which tier the pick was capped at because of completeness.

This is a prerequisite for operators to diagnose why high-confidence picks get suppressed.

---

## 7. Why This Blocks Elite Status

If incomplete picks can still look elite, the program is inflating itself. A 40% complete pick that routes to `trader-insights` makes the `trader-insights` channel untrustworthy. The whole point of tiered routing is to give operators a reliable signal — and that signal is worthless if incomplete data can achieve top-tier routing.

Hard completeness gates are not optional polish. They are the minimum bar for the tier structure to mean anything.
