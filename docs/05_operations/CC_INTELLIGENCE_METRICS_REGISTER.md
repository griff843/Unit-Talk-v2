# Intelligence Metrics Register

**Issue:** UTV2-423
**Date:** 2026-04-07
**Status:** Ratified — source-of-truth ownership for all Intelligence workspace metrics
**Authority:** This document assigns canonical ownership to every intelligence metric. No intelligence metric may be displayed in the Command Center without a register entry. If a metric has no entry here, it is not authorized for display.

---

## Purpose

This register prevents fake analytics and metric drift. Every metric produced by the Intelligence workspace must have:
- An exact canonical source (table.column)
- A defined recompute strategy
- A validation rule that determines trustworthiness
- A declared app owner (who writes the underlying data)
- A current status (does the data actually exist?)

If a metric requires a column that does not exist as a named column in `packages/db/src/database.types.ts`, it is flagged as **schema gap** rather than treated as available.

---

## Schema Gap Definitions Used in This Register

The following expected columns were verified against `database.types.ts` and their status is noted:

| Expected column | Table | Actual status |
|---|---|---|
| `clv_at_close` | `settlement_records` | **Schema gap** — stored in `settlement_records.payload` (JSON), not a top-level column. Requires extraction via `payload->>'clv_at_close'` or a column promotion migration. |
| `clv_at_bet` | `settlement_records` | **Schema gap** — same: stored in `settlement_records.payload`, not a top-level column. |
| `member_tier_id` | `cappers` | **Schema gap** — `cappers` table has no `member_tier_id` FK. Capper-to-tier join requires a separate mapping or derivation from `member_tiers.discord_id`. |
| `edge_score`, `trust_score`, etc. | `pick_promotion_history` | **Schema gap** — individual score components are NOT top-level columns. They exist in `pick_promotion_history.payload` (JSON). Only `score` (total), `status`, and `target` are top-level columns. |
| `stake` | `settlement_records` | **Schema gap** — not a top-level column. Stakes live in `picks.stake_units` (not denominated in currency). |

---

## Register Format

Each entry:
- **Metric name** — plain English label as it appears in the UI
- **Canonical source** — exact `table.column` (or payload path for JSON columns)
- **Recompute strategy** — when/how the value is computed
- **Validation rule** — what makes the value trustworthy
- **Owner** — which app writes this data
- **Current status** — `live data exists` / `partial` / `not yet populated` / `schema gap`

---

## Section 1 — ROI Metrics

### 1.1 — Flat-Bet ROI % by Tier

**Metric name:** ROI by member tier (flat-bet)

**Canonical source:**
- `settlement_records.result` — outcome value (`win` / `loss` / `push` / `void`)
- `settlement_records.pick_id` — join key to picks
- `settlement_records.settled_at` — settlement timestamp (filter by period)
- `picks.id` — join key
- `member_tiers.tier` — tier label (`diamond`, `gold`, `silver`, `bronze`)
- `member_tiers.discord_id` — member identifier

**Join path:** `settlement_records.pick_id → picks.id`. Tier derivation: `picks.capper_id` must be mapped to `discord_id` via a capper-to-member mapping that does not currently exist as a schema FK. **See open question #1 below.**

**Formula:** `(count(result = 'win') - count(result = 'loss')) / count(result IN ('win', 'loss'))`. Void and push picks excluded from denominator.

**Recompute strategy:** On-demand — query at page load. Cache TTL: 5 minutes. If query duration > 2s: escalate to scheduled materialized view (requires PM approval).

**Validation rule:** Requires >= 50 settled (non-void) picks per tier. Display volume warning when N < 50. Display "No data" when N = 0.

**Owner:** `apps/api` writes `settlement_records`. `apps/ingestor` does not write settlement data.

**Current status:** Partial — `settlement_records` is live but insufficient volume per tier for statistically meaningful ROI. Capper-to-tier join is a schema gap (no FK exists).

---

### 1.2 — Flat-Bet ROI % by Capper

**Metric name:** ROI by capper (flat-bet)

**Canonical source:**
- `settlement_records.result` — outcome
- `settlement_records.pick_id` — join key
- `settlement_records.settled_at` — timestamp
- `picks.capper_id` — join key to cappers
- `cappers.id` — capper identifier
- `cappers.display_name` — capper label

**Join path:** `settlement_records.pick_id → picks.id → picks.capper_id → cappers.id`

**Formula:** Same flat-bet formula as 1.1, grouped by `picks.capper_id`.

**Recompute strategy:** On-demand — query at page load. Sort by N count descending to surface most-confident data first.

**Validation rule:** Requires >= 50 settled (non-void) picks per capper. Volume warning when N < 50. "No data" when N = 0.

**Owner:** `apps/api` writes `settlement_records` and `picks`.

**Current status:** Partial — data exists but volume per capper is low. No schema gap for the join path (picks.capper_id → cappers.id FK exists).

---

### 1.3 — Flat-Bet ROI % by Market Type

**Metric name:** ROI by market type (flat-bet)

**Canonical source:**
- `settlement_records.result` — outcome
- `settlement_records.pick_id` — join key
- `settlement_records.settled_at` — timestamp
- `picks.market_type_id` — join key to market_types
- `market_types.id` — market type identifier
- `market_types.display_name` — market type label (e.g., `Player Points`, `Player Rebounds`)
- `market_types.short_label` — compact label for tables

**Join path:** `settlement_records.pick_id → picks.id → picks.market_type_id → market_types.id`

**Formula:** Same flat-bet formula, grouped by `picks.market_type_id`.

**Recompute strategy:** On-demand — query at page load. Sort by N count descending.

**Validation rule:** Requires >= 50 settled (non-void) picks per market type. Volume warning when N < 50.

**Owner:** `apps/api` writes `settlement_records` and `picks`. `apps/ingestor` populates `market_types` reference data.

**Current status:** Partial — data exists. Market type FK (`picks.market_type_id → market_types.id`) is live. Volume is the limiting factor.

---

### 1.4 — Win Rate % (overall and per-segment)

**Metric name:** Win rate

**Canonical source:**
- `settlement_records.result` — `win` / `loss` / `push` / `void`
- `settlement_records.pick_id`
- `settlement_records.settled_at`

**Formula:** `count(result = 'win') / count(result IN ('win', 'loss'))`. Pushes and voids excluded.

**Recompute strategy:** On-demand.

**Validation rule:** Requires >= 20 settled picks. Display "Insufficient data" when N < 20.

**Owner:** `apps/api`

**Current status:** Live data exists — `settlement_records.result` is populated for settled picks.

---

### 1.5 — Record (W-L-P) Count

**Metric name:** Record

**Canonical source:**
- `settlement_records.result` — `win` / `loss` / `push` / `void`
- `settlement_records.pick_id`
- `settlement_records.settled_at`

**Formula:** Count of each result value. Voids displayed separately as "V" or excluded per display context.

**Recompute strategy:** On-demand.

**Validation rule:** None — raw counts are always valid regardless of N.

**Owner:** `apps/api`

**Current status:** Live data exists.

---

## Section 2 — Scoring Calibration Metrics

### 2.1 — Promotion Score Components (per pick)

**Metric name:** Score breakdown — edge / trust / readiness / uniqueness / boardFit

**Canonical source:**
- `pick_promotion_history.payload` (JSON) — individual component scores are stored in payload, not as top-level columns. Extract as: `payload->>'edge'`, `payload->>'trust'`, `payload->>'readiness'`, `payload->>'uniqueness'`, `payload->>'boardFit'`
- `pick_promotion_history.score` — total weighted score (top-level column)
- `pick_promotion_history.status` — promotion outcome (`qualified` / `suppressed`) — top-level column
- `pick_promotion_history.target` — promotion target (`best-bets` / `trader-insights` etc.) — top-level column
- `pick_promotion_history.pick_id` — join key
- `pick_promotion_history.decided_at` — evaluation timestamp
- `pick_promotion_history.version` — policy version used for evaluation

**Schema gap note:** Individual score components (`edge_score`, `trust_score`, etc.) are NOT top-level columns in `pick_promotion_history`. They live inside the `payload` JSON field. Any query that references `pick_promotion_history.edge_score` directly will fail. Use `payload->>'edge'` (or the JSON key used in the payload shape — verify against promotion-service.ts output).

**Recompute strategy:** Not recomputed — this is a historical audit record. Each row is immutable (per governance: original row is never mutated). New evaluation creates a new row.

**Validation rule:** Row exists for every pick that has passed through promotion evaluation. If `pick_promotion_history` has no row for a pick, that pick was not evaluated (pre-evaluation picks or picks created before promotion was activated).

**Owner:** `apps/api` (promotion-service.ts) writes `pick_promotion_history`.

**Current status:** Live data exists — every promoted pick has a row.

---

### 2.2 — Score-to-Outcome Correlation (per component)

**Metric name:** Component effectiveness — correlation of each score component with win/loss outcomes

**Canonical source:**
- `pick_promotion_history.payload` — score component values (see 2.1)
- `settlement_records.result` — win / loss outcome
- `settlement_records.pick_id` — join key

**Join path:** `pick_promotion_history.pick_id → settlement_records.pick_id`

**Computation:** Domain function `analyzeWeightEffectiveness()` in `packages/domain/src/clv-weight-tuner.ts`. This function requires `ScoredPickOutcome[]` with `scoreInputs` (5 components) and `clvPercent`. For the win/loss-only shell (before CLV is available), substitute `won: boolean` as the outcome proxy and skip CLV correlation.

**Recompute strategy:** On-demand — run `analyzeWeightEffectiveness()` server-side in operator-web endpoint at page load. The function is pure and stateless.

**Validation rule:** `WeightEffectivenessReport.confidence` from the domain function: `insufficient` (N < 20), `low` (20–49), `medium` (50–99), `high` (100+). Do not display suggested weight adjustments unless confidence is `medium` or higher.

**Owner:** `apps/api` writes `pick_promotion_history` and `settlement_records`. Domain computation is stateless in `packages/domain`.

**Current status:** Partial — data exists for join. CLV correlation blocked (see 2.3). Win/loss correlation computable now.

---

### 2.3 — Score-to-CLV Correlation

**Metric name:** Component effectiveness — correlation of each score component with closing line value

**Canonical source:**
- `pick_promotion_history.payload` — score component values
- `settlement_records.payload` — `clv_at_close` (JSON path: `payload->>'clv_at_close'`) — **schema gap: not a top-level column**

**Schema gap note:** `clv_at_close` is stored inside `settlement_records.payload` (JSON), not as a standalone column. A query must use JSON extraction (`payload->>'clv_at_close'`). This also means the value cannot be indexed efficiently for aggregation queries. A column promotion migration (`ALTER TABLE settlement_records ADD COLUMN clv_at_close numeric`) would resolve this — requires PM approval (T1 migration).

**Recompute strategy:** On-demand — same domain function as 2.2 but with CLV values from payload.

**Validation rule:** Requires UTV2-335 to be Done AND `settlement_records.payload->>'clv_at_close'` to have valid non-zero values for a sufficient sample. Do not display this metric until UTV2-335 is confirmed closed.

**Owner:** `apps/api` (settlement-service.ts) writes `settlement_records.payload` including `clv_at_close`.

**Current status:** Schema gap + not yet populated. `clv_at_close` exists in the payload shape but valid values require UTV2-335 to close. **Do not display.**

---

### 2.4 — Calibration Confidence Level

**Metric name:** Calibration confidence

**Canonical source:** Derived from count of settled picks with promotion history rows. Computed as `N = count(distinct pick_id WHERE pick_id IN (pick_promotion_history) AND pick_id IN (settlement_records))`.

**Formula:** Map N to confidence tier: `insufficient` (N < 20), `low` (20–49), `medium` (50–99), `high` (100+). Sourced from `WeightEffectivenessReport.confidence` returned by domain function.

**Recompute strategy:** On-demand.

**Validation rule:** N = 0 → do not run calibration at all, display "No calibration data yet."

**Owner:** Derived metric — no app writes this directly. Computed at display time.

**Current status:** Partial — enough rows exist in both tables to compute a confidence level, but sample is low.

---

## Section 3 — CLV Metrics (Blocked)

All CLV metrics in this section are **blocked on UTV2-335**. Do not display any CLV metric until UTV2-335 is confirmed Done and `clv_at_close` values are proven valid in `settlement_records.payload`.

### 3.1 — Average CLV at Close

**Metric name:** Average closing line value

**Canonical source:** `settlement_records.payload->>'clv_at_close'` (JSON extraction — schema gap, not a top-level column)

**Formula:** `avg(clv_at_close)` across settled picks. Positive = beat the closing line on average.

**Recompute strategy:** On-demand.

**Validation rule:** Requires >= 20 settled picks with valid (non-null, non-zero) `clv_at_close` values. Requires UTV2-335 Done.

**Owner:** `apps/api` (settlement-service.ts)

**Current status:** Schema gap + not yet populated. **Blocked: UTV2-335.**

---

### 3.2 — CLV by Capper

**Metric name:** Average CLV at close by capper

**Canonical source:**
- `settlement_records.payload->>'clv_at_close'` (schema gap)
- `settlement_records.pick_id → picks.capper_id → cappers.display_name`

**Recompute strategy:** On-demand.

**Validation rule:** Requires UTV2-335 Done. Requires >= 20 settled picks per capper with valid CLV values.

**Owner:** `apps/api`

**Current status:** Schema gap + not yet populated. **Blocked: UTV2-335.**

---

### 3.3 — CLV by Market Type

**Metric name:** Average CLV at close by market type

**Canonical source:**
- `settlement_records.payload->>'clv_at_close'` (schema gap)
- `settlement_records.pick_id → picks.market_type_id → market_types.display_name`

**Recompute strategy:** On-demand.

**Validation rule:** Requires UTV2-335 Done. Requires >= 20 settled picks per market type with valid CLV values.

**Owner:** `apps/api`

**Current status:** Schema gap + not yet populated. **Blocked: UTV2-335.**

---

### 3.4 — CLV Distribution (histogram)

**Metric name:** CLV distribution

**Canonical source:** `settlement_records.payload->>'clv_at_close'` (schema gap) — binned into ranges: `< -5%`, `-5–0%`, `0–2%`, `2–5%`, `> 5%`.

**Recompute strategy:** On-demand.

**Validation rule:** Requires UTV2-335 Done. Requires >= 50 settled picks with valid CLV values for a meaningful histogram.

**Owner:** `apps/api`

**Current status:** Schema gap + not yet populated. **Blocked: UTV2-335.**

---

## Section 4 — Delivery and Channel Health Metrics

These metrics are owned by the Operations workspace but sourced here for completeness. They are NOT Intelligence workspace metrics.

### 4.1 — Delivery success rate

**Canonical source:** `distribution_receipts.outcome` — values: `sent` / `retryable-failure` / `terminal-failure`

**Owner:** `apps/worker` writes `distribution_receipts`.

**Current status:** Live data exists.

*(Not displayed in Intelligence workspace — owned by Operations.)*

---

## Section 5 — Open Schema Gaps (Summary)

The following gaps require PM decision before resolution:

| Gap | Affected metrics | Resolution options |
|---|---|---|
| `clv_at_close` stored in `settlement_records.payload` JSON, not a top-level column | 2.3, 3.1, 3.2, 3.3, 3.4 | Option A: Add `clv_at_close numeric` column (T1 migration, PM approval). Option B: Extract from payload at query time (slow, unindexed). Recommendation: T1 migration. |
| `clv_at_bet` stored in `settlement_records.payload` | Not currently displayed | Same as above |
| Score components stored in `pick_promotion_history.payload`, not top-level columns | 2.1, 2.2, 2.3 | Extract via JSON path. No migration required — acceptable performance for low-volume analytics queries. |
| No FK between `cappers` and `member_tiers` | 1.1 (ROI by tier) | Requires either: (a) adding `member_tier_id` to `cappers` (T1 migration), or (b) deriving tier from `member_tiers.discord_id` joined to a capper-discord mapping that does not currently exist in schema. **Schema gap for 1.1.** |

---

## Section 6 — Metric Authorization Rules

1. A metric may only be displayed if it has an entry in this register.
2. A metric flagged as **schema gap** must not be displayed until the gap is resolved and this register is updated.
3. A metric flagged as **blocked** must not be displayed (not even as a shell) until the named blocker is resolved.
4. Validation rules are enforced at the UI level — the endpoint must return N count, and the UI must enforce the volume gate before rendering a value.
5. No metric may be fabricated, estimated, or interpolated from incomplete data.
6. Recompute strategy changes (e.g., switching from on-demand to scheduled) require a register update.

---

## Open Questions

| # | Question | Blocking what |
|---|---|---|
| 1 | How does `picks.capper_id` map to a member tier? There is no `cappers.member_tier_id` column. | ROI by tier (metric 1.1) — cannot join capper picks to tiers without this mapping |
| 2 | What JSON key names are used inside `pick_promotion_history.payload` for each score component? (`edge`? `edge_score`? `edgeScore`?) | Metrics 2.1, 2.2, 2.3 — query shape depends on exact key names; verify in `apps/api/src/promotion-service.ts` |
| 3 | Should `clv_at_close` be promoted to a top-level column via migration? | Metrics 3.1–3.4, 2.3 — resolves schema gap and enables indexing |
| 4 | Is `picks.stake_units` denominated consistently (always = 1 unit flat bet)? | ROI formula validity — if stake_units varies, flat-bet assumption breaks |
