# Board Promotion Contract

## Metadata

| Field | Value |
|---|---|
| Owner | Architecture / Product |
| Status | Ratified |
| Ratified | 2026-03-20 |
| Last Updated | 2026-03-29 — depth pass UTV2-160; aligned to V2 runtime truth |

---

## Purpose

Board promotion is the second gate after submission validation. It determines whether a validated pick earns promotion to a high-signal delivery channel.

**Gate 1** (submission): Is the pick valid, canonical, and publishable?
**Gate 2** (promotion): Does the pick earn a place on a specific board?

**Approval does not imply promotion. Never collapse these two concepts.**

---

## Live Promotion Targets (V2 current)

| Target | Policy | Min Score | Status |
|---|---|---|---|
| `discord:best-bets` | `bestBetsPromotionPolicy` | 70.00 | Live |
| `discord:trader-insights` | `traderInsightsPromotionPolicy` | 80.00 (edge ≥ 85, trust ≥ 85) | Live |
| `discord:exclusive-insights` | — | — | Blocked — activation contract required |

All active policies are evaluated at submission time via `evaluateAllPoliciesEagerAndPersist()` in `apps/api/src/promotion-service.ts`. Both policies run regardless of each other's outcome. If a pick qualifies for both, it routes to `trader-insights` (higher-priority target).

---

## Promotion Decision Lifecycle

```
pick validated
   → eligibility check (hard rules — any failure → not_qualified)
   → scoring (weighted components)
   → policy threshold check (score >= minimumScore → qualified)
   → persistence to pick_promotion_history
   → if qualified: distribution_outbox row created for that target
```

The decision is made once at submission time and is immutable. Promotion is never re-evaluated at delivery time or settlement time.

---

## Hard Eligibility Rules

A pick cannot be promoted unless **all** of the following are true:

- `picks.status = 'validated'` — must be a canonicalized pick
- All required metadata fields present: `capper`, `league`, `pick`, `odds`
- Pick is not voided, expired, or in error state
- Pick is within the posting window (not stale)
- Odds are actionable (not an expired line)
- Pick is not blocked by an active operator suppression override
- Pick is not a duplicate or near-duplicate of a recently promoted pick

If any hard rule fails, `promotionStatus = 'not_qualified'` is written immediately. No scoring occurs.

---

## Promotion Score Components

After hard eligibility passes, a weighted score is computed from `pick.metadata.promotionScores`:

| Component | Field | Weight (best-bets) |
|---|---|---|
| Edge / EV | `edge` | 35% |
| Confidence / trust | `trust` | 25% |
| Market readiness / timing | `readiness` | 20% |
| Uniqueness / redundancy control | `uniqueness` | 10% |
| Board fit / presentation quality | `boardFit` | 10% |

`trader-insights` uses the same components with different weight ratios and higher minimum thresholds (`edge ≥ 85`, `trust ≥ 85`).

The evaluator is **deterministic for the same inputs and scoring profile version**. Given the same `metadata.promotionScores` and policy, the same decision will always result.

---

## Scoring Profile System

A named scoring profile controls which weight set is used. The active profile is set via `UNIT_TALK_SCORING_PROFILE` env var:

| Profile | Description |
|---|---|
| `default` | Current production weights (as above) |
| `conservative` | Edge-weighted; higher threshold on edge component |

The profile name is written to `pick_promotion_history.metadata.scoringProfile` at decision time. Replayable scoring (`replayPromotion()` in `@unit-talk/domain`) uses the stored snapshot to reproduce any past decision.

---

## Promotion Statuses

| Status | Meaning |
|---|---|
| `qualified` | Passed hard rules and score threshold; routed to target |
| `not_qualified` | Failed hard rules or score below threshold |

**V1 legacy statuses (`not_eligible`, `eligible`, `promoted`, `suppressed`, `expired`) are not used in V2.** The V2 model uses `qualified` and `not_qualified` only.

---

## Persistence

Each policy evaluation writes one row to `pick_promotion_history`:

| Field | Value |
|---|---|
| `pick_id` | FK to `picks.id` |
| `promotion_target` | Target channel name |
| `promotion_status` | `qualified` or `not_qualified` |
| `promotion_score` | Final weighted score |
| `promotion_reason` | Explanation payload |
| `promotion_version` | Policy version string |
| `promotion_decided_at` | Timestamp |
| `metadata.scoringProfile` | Active profile name |
| `metadata.scoreInputs` | Snapshot of input scores |

`pick_promotion_history` rows are immutable after write. Promotion decisions are never updated post-decision. Corrections to promotion outcomes require a new row or an operator-documented override — not a mutation of the original record.

---

## Enforcement Surfaces

| Rule | Enforcement location |
|---|---|
| Both policies evaluated at submission | `evaluateAllPoliciesEagerAndPersist()` in `apps/api/src/promotion-service.ts` |
| Distribution blocked for non-qualified picks | `distribution-service.ts`: picks not `qualified` or wrong `promotion_target` cannot enqueue |
| Minimum score threshold | `bestBetsPromotionPolicy` (70.00) and `traderInsightsPromotionPolicy` (80.00) in `@unit-talk/domain` |
| Scoring weights per policy | `PromotionPolicy.weights` — each policy carries its own weight set |
| Target registry kill switch | `defaultTargetRegistry` in `@unit-talk/contracts`; worker skips disabled targets |
| Idempotency (no re-evaluation) | `needsPromotionEvaluationForTarget()` checks `pick.promotionDecidedAt`; skips if already decided |

---

## Board Rules (best-bets)

Active board protection rules for `discord:best-bets`:

- Board cap per slate: configurable maximum (checked at distribution enqueue time)
- Cap per sport: prevents single-sport domination
- Redundancy suppression: highly correlated plays filtered to prevent duplicate-thesis flooding
- Confidence floor: separate minimum above baseline approval

These caps are enforced at the distribution service layer, not at the promotion service layer. Promotion decides eligibility; distribution enforces board density.

---

## Operator Overrides

Operators may:

- `force_promote` — bypass score threshold; pick routes to board regardless of score
- `suppress_from_best_bets` / `suppress_from_trader_insights` — block promotion despite qualification

Both overrides are:
- Stored as fields on the pick or in a dedicated override table
- Written to `audit_log` with actor, reason, and timestamp
- Visible in the operator snapshot

---

## Failure Behavior

| Failure | Behavior |
|---|---|
| `metadata.promotionScores` absent | Hard rule failure → `not_qualified`; pick proceeds in lifecycle without promotion |
| Score computation error | Fail-closed: `not_qualified` written; submission still accepted |
| DB unavailable at promotion write | Promotion write deferred until retry; pick held in `validated` state |
| Both policies fail threshold | Two `not_qualified` rows written; pick does not reach outbox |
| One policy qualifies | One `qualified` row written; outbox row created for that target only |
| Both policies qualify | Two rows written; `trader-insights` wins routing (priority order) |

---

## Implementation Boundaries

In scope:
- Policy evaluation and persistence
- Score computation with profile support
- Operator overrides
- Board cap enforcement at distribution enqueue

Not in scope:
- Real-time rescoring after submission (not implemented — decisions are final at submission)
- Retroactive promotion changes (corrections require operator authority; see writer authority contract)
- Future boards (`strategy-lab`, curated digests) — require separate ratified contracts and policy definitions before implementation
