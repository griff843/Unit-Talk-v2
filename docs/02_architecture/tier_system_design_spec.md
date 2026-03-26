# Tier System Design Spec — Unit Talk

## Status

**DESIGN CONTRACT — NOT YET CALIBRATED. NOT IMPLEMENTED IN V2 RUNTIME.**
This document defines the tier system as a core evaluation layer. Mathematical weights, exact thresholds, and production calibration are explicitly deferred until the scoring rebuild is complete. The tier system described here does not currently exist in V2 code. For current-state scoring and promotion truth, see `docs/audits/v2_score_promotion_truth_audit.md` and `docs/discord/pick_promotion_interim_policy.md`.

---

## Purpose

Define the Unit Talk tier system as a **core evaluation layer** used for:

- internal scoring and audit
- promotion decision support
- recap segmentation and analytics
- capper performance evaluation
- future marketing and product surfaces

This system must work **before and after full model rebuild**, without relying on assumptions or incomplete signals.

---

## Scope

This document defines:

- what tiers represent
- how tiers are created conceptually
- what inputs are allowed to influence tiers
- how incomplete data affects tier eligibility
- how tiers interact with promotion and Discord output

This document does **not** define:

- final mathematical weights or thresholds
- final EV/edge formulas
- final production calibration

---

## Core Principles

### 1. Tiers are a system evaluation, not a capper opinion
Tiers represent the model/system assessment of pick quality. Capper input remains independent. The system does not publicly contradict capper selections.

### 2. All picks are silently evaluated
Every pick — manual or model — is scored internally. Tier is assigned internally. Results are stored for audit, recap, capper review, and model improvement.

### 3. Public display is controlled
Tiers are not always shown publicly. The system must never undermine capper credibility in-channel. Public tier display is a separate policy layer from tier assignment.

### 4. Missing data must reduce certainty
Incomplete picks cannot achieve top-tier status automatically. Missing intelligence must be reflected in the evaluation. Fallback/default values must not artificially produce elite tiers.

### 5. Best Bets must remain strict
Tiers support promotion decisions. They do not automatically guarantee promotion. Top-tier eligibility must remain selective.

---

## Tier Definitions (Conceptual)

These are meaning definitions, not final thresholds.

| Tier | Meaning | Promotion Eligibility |
|------|---------|----------------------|
| **S** | Exceptional opportunity. Strong edge and high-quality supporting signals. | Fully qualified for top-tier promotion |
| **A** | Strong opportunity. Solid supporting signals. | Eligible for premium surfaces and potential top-tier promotion |
| **B** | Acceptable premium play. Moderate signals or partial data. | Suitable for VIP-level distribution |
| **C** | Lower confidence or incomplete information. | Informational or selective use only |
| **D** | Insufficient quality or signal. | Should not be promoted |

---

## Input Categories (Allowed Signals)

Tiers may be influenced by the following signal categories. Final weights are deferred.

### Core scoring signals
- composite score (current or future model)
- edge / EV (when real and available)
- trust / reliability indicators

### Market intelligence
- CLV (closing line value)
- line movement
- sharp money signals
- projection deltas

### Structural signals
- readiness
- uniqueness
- board fit

### Data quality
- feature completeness
- input coverage
- fallback/default usage

### Source type
- model-generated pick
- manual/capper pick
- enriched vs non-enriched submission path

### Risk (future)
- variance
- volatility
- uncertainty

---

## Missing Data Rules

### Rule 1 — Evaluate but do not inflate
Incomplete picks must be evaluated. They must not receive inflated scores from neutral fallback values.

### Rule 2 — Top-tier requires sufficient data completeness
S and A tier eligibility requires sufficient data completeness. A pick scoring high due to static defaults does not qualify.

### Rule 3 — Fallbacks must not produce elite tiers
Fallback/default values (e.g., the 80/80/75 static defaults in the current V2 model) must not be a path to S or A tier.

### Rule 4 — Manual/capper picks are evaluated but gated
Manual and capper picks may be silently evaluated. They cannot automatically reach top tiers without sufficient signals. Enrichment or system validation may unlock higher tiers post-submission.

---

## Lane Behavior

### 1. Manual / Capper Lane
Smart Form and manual submissions. Always silently scored.

Eligible for:
- capper pick posts
- VIP surfaces

Not automatically eligible for Best Bets.

### 2. Model-Qualified Lane
Picks that pass full scoring logic with real signal inputs.

Eligible for:
- tier-based promotion
- Best Bets consideration

### 3. Operator Override Lane
Explicit manual promotion path.

Requirements:
- rare
- auditable
- intentional — not a workaround for incomplete scoring

---

## Promotion Relationship

Tiers **inform** promotion but do not fully control it.

### Interim policy (V2 — current)
- Best Bets = model-qualified picks only
- Manual/capper picks do not auto-promote to Best Bets
- Tiers may be used internally to evaluate manual picks

### Future policy (post-rebuild)
To be determined after scoring rebuild, feature completeness, and model validation. A new contract must be written and ratified before replacing this design spec.

---

## Internal vs Public Tier Use

### Internal — always
- evaluation and ranking
- audit trail
- capper performance analysis
- model iteration and calibration

### Public — controlled
- Best Bets labeling
- premium surface segmentation
- recap tier breakdowns

### Not allowed
- publicly contradicting capper picks in-channel
- exposing system disagreement without operator review
- surfacing D or C tier assessments to end users

---

## Capper Interaction Model

### Silent evaluation
The system scores every capper pick internally. No public disagreement is surfaced.

### Promotion upgrade
A capper pick may be elevated to Best Bets — but only when:
- system evaluation produces a qualifying tier
- all promotion rules are satisfied

### Audit use
System evaluation vs capper submissions is tracked over time for:
- long-term capper performance analysis
- model calibration
- improving signal quality

---

## Current Limitations (V2)

| Limitation | Status |
|-----------|--------|
| Scoring model is incomplete | Active — five-input weighted sum is functional but not fully rebuilt |
| Smart Form lacks full feature coverage | Active — confidence absent; 88% of inputs fall to static defaults |
| Tiers not yet calibrated | Active — this document is a design contract, not a calibrated system |
| Promotion relies on interim logic | Active — see `docs/discord/pick_promotion_interim_policy.md` |

---

## Recalibration Trigger

This system must be revisited and formally recalibrated when:

1. Scoring model rebuild is complete
2. Feature coverage materially improves (especially for Smart Form / manual paths)
3. EV/edge logic is validated end-to-end
4. Promotion policy is finalized
5. Tier thresholds have been tested against real performance data

---

## Authority References

| Document | Role |
|----------|------|
| `docs/audits/v2_score_promotion_truth_audit.md` | Current V2 scoring and promotion code truth |
| `docs/discord/pick_promotion_interim_policy.md` | Active interim lane and promotion rules |
| `packages/contracts/src/promotion.ts` | Current policy constants (minimumScore, weights, boardCaps) |
| `packages/domain/src/promotion.ts` | Current evaluation gate logic |

---

## Summary

- Tiers are a **core system abstraction**, not a capper-facing feature
- They exist now as a **design contract** — meaning is locked, calibration is deferred
- They enable structured promotion, internal audit, and future product clarity
- They are **not yet fully calibrated** and must not be treated as final
