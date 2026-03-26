# Pick Promotion Interim Policy — Unit Talk V2

## Status

**INTERIM — ACTIVE.**
This policy governs pick promotion during the V2 rebuild period. It is superseded when the scoring/tiering rebuild is formally complete and a permanent policy is ratified.

---

## Purpose

Define how picks move from submission to delivery channels while the V2 scoring and tiering model is not yet fully rebuilt.

This policy prevents guessing, prevents mixing lane types without explicit rules, and prevents Smart Form/manual picks from being promoted as if they were full model outputs.

---

## Scope

Applies to all picks entering the V2 runtime from any source (Smart Form, API, operator submission) during the interim period.

Does not cover: settlement, lifecycle transitions, operator-web monitoring, recap/analytics surfaces.

---

## Current Reality

- The V2 scoring model is a five-input weighted sum. It is functional but not a complete rebuilt model.
- Smart Form V1 does not submit a `confidence` field. Without confidence, domain analysis cannot compute edge or Kelly. All domain-derived score signals return null, and every Smart Form pick scores exactly **61.5** via static fallbacks.
- 61.5 is not a quality verdict. It is a fallback artifact.
- Picks without a `confidence` field (all current Smart Form V1 submissions) bypass the confidence floor gate and proceed to score evaluation. They score exactly **61.5** via static fallbacks and are suppressed at the score gate (61.5 < 70). This is the correct interim behavior: the pick is evaluated and correctly determined to not meet the model-qualified threshold.
- There is no tier concept (S/A/B/C/D) in V2. Quality classification is `promotionStatus` only.
- Best Bets must remain stricter than ordinary premium picks. A model-qualified pick is not the same as a manually curated pick.

---

## Pick Lanes

### 1. Manual / Capper Lane

**Qualifies when:** pick does not have `confidence` in the submission payload, OR confidence is present but odds are absent (domain analysis cannot run).

This includes all current Smart Form V1 submissions.

**Delivery surfaces:**
- VIP picks channel
- Capper thread (when capper routing is available)
- Any premium surface not requiring model qualification

**Best Bets eligibility:** Not eligible automatically. Manual/capper picks do not reach Best Bets via the promotion pipeline. An operator override is required (see Lane 3).

**Why:** These are high-quality capper picks. They are not claimed to be model outputs. They belong in premium capper delivery, not in the highest-signal promotion channel.

---

### 2. Model-Qualified Lane

**Qualifies when:**
- `pick.confidence` is present and in (0, 1) range (fractional win probability estimate)
- `pick.odds` is present and valid
- Domain analysis ran and computed `edge` and `kellyFraction`
- Promotion score ≥ 70 (Best Bets) or ≥ 80 + edge ≥ 85 + trust ≥ 85 (Trader Insights)
- `pick.confidence ≥ 0.6` (confidence floor)
- Board caps not exceeded

This is the only lane eligible for automatic Best Bets or Trader Insights promotion.

**Delivery surfaces:**
- VIP picks channel
- Best Bets (if score ≥ 70 and all gates pass)
- Trader Insights (if score ≥ 80, edge ≥ 85, trust ≥ 85, and all gates pass)

**Why:** This lane has real signal backing. The promotion engine is making a meaningful decision, not evaluating fallback numbers.

---

### 3. Operator Override / Curated Lane

**Qualifies when:** an operator explicitly calls `applyPromotionOverride()` with `action: 'force_promote'` and a required `reason` string.

**Use when:**
- A high-conviction manual pick should reach Best Bets and the operator is making a deliberate curatorial judgment
- An exceptional circumstance justifies bypassing the model gate

**Rules:**
- Must have a non-empty `reason` string
- Is recorded in `pick_promotion_history` with `override_action = 'force_promote'`
- Is visible in the audit log
- Should be rare — not a workaround for broken scoring

**Delivery surfaces:** Any surface, including Best Bets. The override is explicit and auditable.

---

## Ratified Decisions (2026-03-24)

| Decision | Rule |
|----------|------|
| **Confidence language** | `confidence` is a technical scoring input only. It is not a user-facing signal, not a product authority, and must not appear in marketing language or public-facing copy. |
| **Smart Form lane** | Smart Form = manual/capper lane. Picks without `confidence` bypass the confidence floor gate and are evaluated on their score. They are suppressed at the score gate (61.5 < 70). This is implemented and correct. |
| **EV/edge display** | EV/edge may only be displayed when real inputs exist (`pick.confidence` in (0,1) AND valid `pick.odds` both present and used by domain analysis). If either is absent, edge was not computed — hide EV/edge. Smart Form picks currently never qualify. |

---

## Interim Promotion Rules

| Rule | Detail |
|------|--------|
| Best Bets = model-qualified lane only | Score ≥ 70, confidence ≥ 0.6, all gates pass — or explicit operator override |
| VIP picks may include manual/capper picks | Manual lane is a valid premium delivery lane, not a lesser lane |
| `confidence` is a technical input only | It feeds the fallback chain for score inputs and controls the confidence floor gate. It is not a user-facing signal. Do not surface it as a business authority or use it in marketing language. |
| Smart Form lane = manual/capper lane (interim) | Picks without `confidence` bypass the confidence floor gate (source-agnostic). They score 61.5 and are correctly suppressed at the score gate. `suppressed` = evaluated, did not meet threshold — not dead on arrival. |
| 61.5 is not a quality score | Smart Form picks scoring 61.5 must be treated as fallback-scored, not model-scored |
| Tier concepts (S/A/B/C/D) do not exist in V2 | Do not import production repo tier concepts into V2 policy or docs |
| Board caps reflect active inventory only | RESOLVED (Run 003). Board state query filters to `status IN ('validated', 'queued', 'posted')`. Settled/voided picks no longer count toward caps. Historical test picks no longer pollute capacity. |
| Permanent promotion policy is deferred | Final thresholds, weights, and model inputs will be ratified after the scoring rebuild |

---

## What This Policy Prevents

- Promoting a Smart Form pick to Best Bets because the capper is confident — confidence without model inputs is not promotion authority
- Treating the fallback score of 61.5 as a real quality signal
- Using a legacy tier concept (S/A/B/C/D) that does not exist in this codebase
- Mixing manual and model lanes without explicit routing rules
- Relying on board caps that may be saturated by historical test picks

---

## Revisit Trigger

This policy must be revisited and formally superseded when **all** of the following are true:

1. V2 score audit is complete and accepted
2. V2 promotion/tier audit is complete and accepted
3. Smart Form V2 includes `confidence` in its submission payload
4. Scoring rebuild is materially complete (model can score Smart Form/manual picks without confidence-as-sole-input)
5. Best Bets criteria are formally ratified in a new policy contract

Until all five conditions are met, this interim policy is the operating authority.

---

## Authority References

| Document | Role |
|----------|------|
| `docs/audits/v2_score_promotion_truth_audit.md` | Code-grounded basis for this policy |
| `packages/contracts/src/promotion.ts` | Policy constants and weight definitions |
| `packages/domain/src/promotion.ts` | Gate evaluation logic |
| `apps/api/src/promotion-service.ts` | Score input resolution and persistence |
| `docs/06_status/PROGRAM_STATUS.md` | Open risks (board cap saturation) |
