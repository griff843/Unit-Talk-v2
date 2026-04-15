# Champion Inventory Standard

**Status:** RATIFIED 2026-04-15
**Authority:** UTV2-622 — defines the authoritative inventory of active champion, challenger, staged, and unsupported sport × market-family model slices.
**Depends on:** `docs/05_operations/MODEL_REGISTRY_CONTRACT.md`, `supabase/migrations/202604030001_model_registry.sql`

---

## Purpose

An elite modeling program must declare, precisely, what it models. This document is the live runtime truth for which sport × market-family slices have real model ownership, which are eligible for live routing vs shadow-only, and which are explicitly unsupported.

Failure mode this prevents: routing picks through a scoring stack that has no actual champion model, producing scores that look authoritative but are not.

---

## 1. Champion Status Definitions

| Status | Meaning | Routing Eligibility |
|--------|---------|---------------------|
| `champion` | One ratified model per slot. Exclusive per (sport, market_family). | Live routing allowed |
| `challenger` | Active challenger in evaluation against current champion. | Shadow-only until promoted |
| `staged` | Model trained and staged; not yet in challenger evaluation. | Shadow-only |
| `unsupported` | No model ownership. Explicit gap declaration. | Blocked from top-tier routing |

A slot with no row in `model_registry` is treated as `unsupported`. Absence is not neutrality — it is a declared gap.

---

## 2. Active Sport × Market-Family Inventory

### Primary Sports (live routing eligible)

| Sport | Market Family | Champion Status | Notes |
|-------|--------------|-----------------|-------|
| NBA | player-prop | `unsupported` | No champion bootstrapped. Gap declared. |
| NBA | moneyline | `unsupported` | No champion bootstrapped. Gap declared. |
| NBA | spread | `unsupported` | No champion bootstrapped. Gap declared. |
| NBA | total | `unsupported` | No champion bootstrapped. Gap declared. |
| NBA | team-total | `unsupported` | No champion bootstrapped. Gap declared. |
| NFL | player-prop | `unsupported` | No champion bootstrapped. Gap declared. |
| NFL | moneyline | `unsupported` | No champion bootstrapped. Gap declared. |
| NFL | spread | `unsupported` | No champion bootstrapped. Gap declared. |
| NFL | total | `unsupported` | No champion bootstrapped. Gap declared. |
| NFL | team-total | `unsupported` | No champion bootstrapped. Gap declared. |
| MLB | player-prop | `unsupported` | No champion bootstrapped. Gap declared. |
| MLB | moneyline | `unsupported` | No champion bootstrapped. Gap declared. |
| MLB | spread | `unsupported` | No champion bootstrapped. Gap declared. |
| MLB | total | `unsupported` | No champion bootstrapped. Gap declared. |
| MLB | team-total | `unsupported` | No champion bootstrapped. Gap declared. |
| NHL | player-prop | `unsupported` | No champion bootstrapped. Gap declared. |
| NHL | moneyline | `unsupported` | No champion bootstrapped. Gap declared. |
| NHL | spread | `unsupported` | No champion bootstrapped. Gap declared. |
| NHL | total | `unsupported` | No champion bootstrapped. Gap declared. |
| NHL | team-total | `unsupported` | No champion bootstrapped. Gap declared. |

### Secondary Sports (not eligible for live routing — model gaps not tracked individually)

| Sport | Status |
|-------|--------|
| NCAAB | Unsupported — no model ownership |
| NCAAF | Unsupported — no model ownership |
| Soccer | Unsupported — no model ownership |
| MMA | Unsupported — no model ownership |
| Tennis | Unsupported — no model ownership |

---

## 3. Current Gap Map

**All primary sport × market-family slices are currently unsupported.**

The `model_registry` table exists and is schema-ready (migration `202604030001_model_registry.sql`) but contains no champion rows. This is the honest baseline as of 2026-04-15.

Implication: the system currently scores picks using the promotion pipeline (5-score evaluation) without a sport-specific champion model backing those scores. Scores are not model-backed; they reflect the weight configuration in `packages/contracts/src/promotion.ts`.

This does NOT mean picks are wrong — operator-submitted picks with explicit edge data can produce valid scores. But no claim of "elite modeling" applies until at least one champion model is bootstrapped per active sport.

---

## 4. Routing Gate

### Rule

Any pick routing to `trader-insights` or `exclusive-insights` on a slot with status `unsupported` MUST be suppressed unless:

1. The pick has an explicit edge source (`real-edge` or `consensus-edge`) from a live market-backed computation.
2. The pick is operator-submitted with explicit `promotionScores.edge` override.

### Enforcement

This rule is currently advisory — it is not yet mechanically enforced. The enforcement issue is tracked separately. Until enforcement lands, this document governs the intent.

---

## 5. Promotion Criteria (when a champion is bootstrapped)

To bootstrap a champion for a slot:

1. A model version must be inserted into `model_registry` with `status = 'staged'`.
2. The model must pass a shadow evaluation period (minimum 30 days, minimum 100 predictions).
3. A calibration check must pass: Brier score ≤ 0.25, ROI improvement over baseline ≥ 2%.
4. Status is advanced: `staged → challenger → champion` via `ModelRegistryRepository.updateStatus()`.
5. Promotion must be recorded in the `experiment_ledger` table with `run_type = 'eval'`.
6. Only one `champion` row is allowed per (sport, market_family) — the prior champion is archived automatically.

---

## 6. Inventory Maintenance

This document is updated:

- When a new champion is bootstrapped (add row to table above, change status)
- When a champion is demoted (update row to `unsupported`)
- At each monthly model review cadence (verify table matches `model_registry` runtime state)

**Runtime truth source:** `model_registry` table in Supabase (project ref: `feownrheeefbcsehtsiw`).

This document must match runtime truth. If they diverge, runtime wins and this doc must be corrected.

---

## 7. Why This Blocks Elite Status

A system cannot claim "unmatched" or "elite" model coverage for a sport if it cannot declare, precisely, what it is modeling. This document is the minimum bar to make that claim honestly — even when the answer is "unsupported across the board, for now."

The gap declaration is not a failure. It is an honest foundation from which to build.
