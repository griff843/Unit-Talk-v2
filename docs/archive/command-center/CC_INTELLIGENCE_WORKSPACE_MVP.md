# Intelligence Workspace MVP Spec

**Issue:** UTV2-422
**Date:** 2026-04-07
**Status:** Ratified — gates UTV2-425 Intelligence workspace implementation
**Authority:** This document is the canonical module-by-module MVP spec for the Command Center Intelligence workspace. No Intelligence workspace implementation may begin without this spec in place.

---

## Overview

The Intelligence workspace answers one question: **is the system performing well, and can we calibrate it to perform better?**

It is analysis-only. No pick decisions are made here. No write surfaces. All data flows through existing `apps/operator-web` endpoints or new read-only endpoints added by UTV2-425/UTV2-427.

Grounded in: `CC_IA_RATIFICATION.md` (Section 2.4), `CC_MODULE_DEPENDENCY_MAP.md` (Intelligence section), and domain logic in `packages/domain/src/`.

---

## Module Inventory

### Module 1 — ROI by Tier

**Purpose:** Show flat-bet ROI broken out by member tier. Operators see whether Diamond picks outperform Gold, Gold outperform Silver, etc. This is the first calibration signal: if tier ordering is inverted, the trust score component is miscalibrated.

**Shippable status:** Shell only — volume-limited

**Reason for shell-only:**
The query is computable today. `settlement_records` and `picks` have the required columns. However, the pick volume per tier is currently insufficient (< 50 settled picks per tier) to produce statistically meaningful ROI numbers. Displaying a ROI% on 5–10 samples is misleading. The surface must ship with explicit N-count display and a volume warning when N < 50 per tier.

**Data source:**

| Table | Columns used |
|---|---|
| `settlement_records` | `pick_id`, `result` (`win`/`loss`/`push`/`void`), `payout_multiplier`, `stake`, `settled_at` |
| `picks` | `id`, `capper_id`, `status`, `metadata->>'tier'` or FK to member tiers |
| `member_tiers` | `id`, `label` (e.g., `diamond`, `gold`, `silver`, `bronze`) |

**Join path:** `settlement_records.pick_id → picks.id → picks.metadata` (tier field) or `picks.capper_id → cappers.member_tier_id → member_tiers.label`

**ROI formula:** `sum(payout_multiplier * stake - stake) / sum(stake)` across settled (non-void) picks per tier. Flat-bet variant: `(wins - losses) / total` where push = 0.

**Display format:** Metric card per tier showing:
- Tier label
- Record (W-L-P)
- Flat-bet ROI %
- N count (settled picks)
- Volume warning badge when N < 50: "Insufficient sample — results not reliable"

**What is NOT computable yet:**
- Risk-adjusted ROI (requires Kelly stake data per pick — not currently stored)
- CLV-adjusted ROI (requires `settlement_records.clv_at_close` valid values — blocked on UTV2-335)
- Tier-over-time trend charts (requires 90+ days of settled data per tier — volume constraint)

---

### Module 2 — ROI by Capper

**Purpose:** Show flat-bet ROI per capper. Operators see which cappers are profitable, which are losing, and by how much. This surfaces individual performance before it affects board composition.

**Shippable status:** Shell only — volume-limited

**Reason for shell-only:** Same as Module 1. Query computable today, but per-capper sample sizes are low. Must display N count and volume warning when N < 50 per capper. Cappers with zero settled picks must show as "No data — pending settlement."

**Data source:**

| Table | Columns used |
|---|---|
| `settlement_records` | `pick_id`, `result`, `payout_multiplier`, `stake`, `settled_at` |
| `picks` | `id`, `capper_id`, `status` |
| `cappers` | `id`, `display_name`, `slug` |

**Join path:** `settlement_records.pick_id → picks.id → picks.capper_id → cappers.id`

**ROI formula:** Same flat-bet formula as Module 1, grouped by `capper_id`.

**Display format:** Sortable table showing:
- Capper display name
- Record (W-L-P)
- Flat-bet ROI %
- N count (settled picks)
- Volume warning when N < 50

**Sort default:** By total settled picks descending (surfaces highest-confidence data first).

**What is NOT computable yet:**
- Capper-by-sport ROI breakdown (possible but misleading at current volume — defer)
- Capper consistency score (requires streak/variance analysis across 100+ picks — not enough data)
- Capper CLV distribution (blocked on UTV2-335)

---

### Module 3 — ROI by Market

**Purpose:** Show flat-bet ROI by prop market type (player points, player rebounds, player assists, game total, spread, etc.). Operators see which market types the system performs in and which it does not. This calibrates the `edge` and `readiness` score components.

**Shippable status:** Shell only — volume-limited

**Reason for shell-only:** Query computable today. Volume constraint applies per market type. Some market types may have very few settled picks. N count + volume warning required.

**Data source:**

| Table | Columns used |
|---|---|
| `settlement_records` | `pick_id`, `result`, `payout_multiplier`, `stake`, `settled_at` |
| `picks` | `id`, `market_type_id`, `status` |
| `market_types` | `id`, `label` (canonical market key, e.g., `player_points`, `player_rebounds`) |

**Join path:** `settlement_records.pick_id → picks.id → picks.market_type_id → market_types.id`

**ROI formula:** Same flat-bet formula, grouped by `market_type_id`.

**Display format:** Sortable table showing:
- Market type label
- Record (W-L-P)
- Flat-bet ROI %
- N count (settled picks)
- Volume warning when N < 50

**Sort default:** By N count descending.

**What is NOT computable yet:**
- Market ROI by book (requires per-book settlement data — not currently structured)
- Market efficiency curve (requires 200+ settled picks per market type for significance)
- CLV by market (blocked on UTV2-335)

---

### Module 4 — Scoring Calibration View

**Purpose:** Show how well the promotion score components predicted actual outcomes. The calibration view answers: "When the system assigned a high `edge` score, did the pick actually win? Did high `trust` scores predict beat-the-line CLV?"

This is the feedback loop between the scoring model and settled reality. Domain code for this analysis exists in `packages/domain/src/clv-weight-tuner.ts` (`analyzeWeightEffectiveness()`) and `packages/domain/src/probability/calibration.ts`. Neither is operationally scheduled.

**Shippable status:** Shell only — code not activated

**Reason for shell-only:** The data exists (both `pick_promotion_history` and `settlement_records` are populated). The domain computation is implemented (`analyzeWeightEffectiveness()` in `clv-weight-tuner.ts` takes `ScoredPickOutcome[]` and returns per-component Pearson correlations with CLV outcomes). However, no operator-web endpoint exposes this computation, and the CLV values required by `analyzeWeightEffectiveness()` depend on `settlement_records.clv_at_close` being valid — which is gated on UTV2-335.

A partial calibration view (win/loss correlation only, no CLV) can ship as a shell once an operator-web endpoint exposes the join of `pick_promotion_history` + `settlement_records`.

**Data source:**

| Table | Columns used |
|---|---|
| `pick_promotion_history` | `pick_id`, `edge_score`, `trust_score`, `readiness_score`, `uniqueness_score`, `board_fit_score`, `total_score`, `promotion_status`, `promotion_target`, `evaluated_at` |
| `settlement_records` | `pick_id`, `result`, `clv_at_close`, `settled_at` |

**Join path:** `pick_promotion_history.pick_id → settlement_records.pick_id`

**Computation path:** Domain function `analyzeWeightEffectiveness()` in `packages/domain/src/clv-weight-tuner.ts` accepts the join result as `ScoredPickOutcome[]` and returns `WeightEffectivenessReport` with per-component `correlation`, `predictive` flag, `topQuartileAvgClv`, `bottomQuartileAvgClv`, and `suggestedAdjustments`.

For the win/loss-only shell (before UTV2-335 closes): use `result` (win/loss) as the outcome proxy. Correlation with CLV is not available yet; substitute directional accuracy (did high score predict a win?).

**Display format:** Two-panel view:
- **Score component table** — one row per component (edge, trust, readiness, uniqueness, boardFit) showing: current weight, correlation with outcome (win/loss), correlation with CLV (grayed out / "pending UTV2-335"), predictive flag (yes/no), sample size
- **Calibration confidence badge** — `insufficient` (N < 20), `low` (20–49), `medium` (50–99), `high` (100+); sourced directly from `WeightEffectivenessReport.confidence`

**What is NOT computable yet:**
- CLV correlation (requires valid `clv_at_close` — blocked on UTV2-335)
- Suggested weight adjustments (blocked on CLV correlation — do not display until high confidence)
- Calibration trend over time (requires scheduled snapshots — not yet implemented)
- Band-level calibration (A+ vs A vs B — requires enough settled picks per band — volume constraint)

---

### Module 5 — CLV Trend / Starter Views

**Purpose:** Surface closing line value trends across the pick book. Show which cappers, markets, and tiers consistently beat the closing line. This is the highest-value analysis signal — CLV predicts long-run profitability independent of short-run win/loss variance.

**Shippable status:** BLOCKED

**Exact blocker:** `settlement_records.clv_at_close` column exists in the schema. However, valid CLV values are not yet proven populated end-to-end. UTV2-335 (CLV closing line wiring) must close before this module can be built, even as a shell. A shell with null/zero CLV values would display misleading zero-CLV "trends" — this is worse than no module.

**Do not ship even as a shell until UTV2-335 is Done.**

**Data source (when available):**

| Table | Columns used |
|---|---|
| `settlement_records` | `pick_id`, `clv_at_close`, `result`, `settled_at` |
| `picks` | `id`, `capper_id`, `market_type_id`, `sport_id` |
| `pick_promotion_history` | `pick_id`, `edge_score`, `trust_score`, `total_score` |

**Display format (when available):**
- CLV distribution histogram (binned: < -5%, -5–0%, 0–2%, 2–5%, > 5%)
- CLV by capper: ranked table (same as Module 2 but sorted by avg CLV)
- CLV by market type: ranked table
- CLV trend chart: 30-day rolling average

**What is NOT computable yet (and why):**
- Any CLV value: `clv_at_close` not proven valid end-to-end (UTV2-335 open)
- CLV by tier: same blocker
- CLV vs score correlation: same blocker (also needed for Module 4 full calibration)

---

## Merge/Form Window Tabs (from current /performance + /intelligence pages)

The Intelligence workspace merges the current `/performance` and `/intelligence` pages (both drawing from `shared-intelligence.ts`). The unified surface uses internal tab structure:

| Tab | Content | Status |
|---|---|---|
| Performance | ROI record stats, flat-bet ROI, W-L-P counts | Shell only — volume-limited |
| Form Windows | Trend windows from existing `shared-intelligence.ts` data | Shippable now (existing) |
| Calibration | Score component correlation table (Module 4) | Shell only — code not activated |
| CLV Cohorts | CLV distribution, capper/market CLV ranking (Module 5) | Blocked — do not surface tab |

The "CLV Cohorts" tab must not appear in the nav until UTV2-335 is Done and `clv_at_close` is proven valid.

---

## New Operator-Web Endpoints Required

None of the shippable/shell modules have a dedicated operator-web endpoint today. These must be created under UTV2-425 or UTV2-427:

| Endpoint | Module served | Query pattern |
|---|---|---|
| `GET /api/operator/roi-by-tier` | Module 1 | Join settlement_records + picks + member_tiers, group by tier |
| `GET /api/operator/roi-by-capper` | Module 2 | Join settlement_records + picks + cappers, group by capper_id |
| `GET /api/operator/roi-by-market` | Module 3 | Join settlement_records + picks + market_types, group by market_type_id |
| `GET /api/operator/scoring-calibration` | Module 4 | Join pick_promotion_history + settlement_records, call domain analyzeWeightEffectiveness() |

All four endpoints are read-only. No write surfaces. Classification: T2 (new read-only endpoints, no migration required).

Note on materialized views: if the ROI joins are too slow at page load, a `pg_cron`-scheduled materialized view is the fallback. That escalation requires PM approval (T1 if migration involved).

---

## Volume Gate Policy

Every ROI module must enforce this display policy:

| N count (settled picks in segment) | Display behavior |
|---|---|
| 0 | "No settled picks yet" — no ROI shown |
| 1–49 | Volume warning: "Insufficient sample (N={count}) — results not statistically reliable" — ROI shown in gray/italic |
| 50–99 | Soft warning: "Low sample (N={count})" — ROI shown normally |
| 100+ | No warning — full display |

The calibration module uses a different gate (from `WeightEffectivenessReport.confidence`): `insufficient` < 20, `low` 20–49, `medium` 50–99, `high` 100+.

---

## What This Spec Does NOT Authorize

- No write surfaces in the Intelligence workspace
- No CLV surface before UTV2-335 is Done
- No materialized views or DB schema changes without explicit PM approval
- No merging of approval state into ROI analysis (approval and promotion are separate concepts)
- No external ML model integration (model_registry/model_health_snapshots are not operationally populated)
- No Discord channel activation

---

## Open Questions (require PM or implementation truth before resolving)

| # | Question | Blocking what |
|---|---|---|
| 1 | Does `/api/operator/performance` already return W-L-P per tier/capper/market, or only aggregate? | Whether Module 1-3 need new endpoints or can extend existing |
| 2 | Is `picks.metadata->>'tier'` the correct path to tier, or is it via capper FK to member_tiers? | Query path for Modules 1 and 2 |
| 3 | Should ROI endpoints cache results, or query live? | Performance vs freshness tradeoff; decide at UTV2-425 |
| 4 | When UTV2-335 closes, does CLV Cohorts tab go directly in Intelligence or is a separate "CLV" workspace warranted? | Module 5 placement; current ratification: stays in Intelligence |
