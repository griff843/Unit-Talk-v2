# Command Center Analytics Dashboard Rebuild — Sequencing

**Issue:** UTV2-425
**Date:** 2026-04-07
**Status:** Ratified — gates Phase 2 analytics rebuild execution
**Authority:** This document is the canonical sequencing contract for the Command Center analytics rebuild. It defines the execution order (ingestion data readiness → analytics rebuild → Intelligence workspace modules), the audience ownership split, and the readiness gate definitions for checklist items 5.8 and 5.9. No analytics implementation may proceed without this sequencing in place.

---

## 1 — Sequencing Overview

The rebuild has three phases. Each phase gates the next. No phase may begin before its predecessor's readiness gate is met.

| Phase | What ships | Readiness gate | Audience |
|---|---|---|---|
| **Phase A — Ingestion data readiness** | Live `provider_offers` proven stable; `settlement_records` accumulating; CLV wiring (UTV2-335); capper-to-tier mapping resolved | A.1: Ingestor is live and multi-book; A.2: UTV2-335 Done; A.3: capper-tier join path confirmed | Operator-internal (no UI) |
| **Phase B — Analytics rebuild (5.8)** | Intelligence workspace modules 1–4 wired to real data; new operator-web endpoints (`roi-by-tier`, `roi-by-capper`, `roi-by-market`, `scoring-calibration`); `/performance` and `/intelligence` pages merged into unified Intelligence workspace with tab structure | B.1: Phase A gate A.1 met; B.2: new endpoints green; B.3: volume warnings enforced; B.4: no CLV surface until A.2 confirmed | Operator-facing |
| **Phase C — Intelligence workspace modules (5.9)** | CLV Cohorts tab (Module 5); full score-to-CLV calibration; player enrichment context in Research workspace; matchup context in Research workspace | C.1: UTV2-335 confirmed Done and `clv_at_close` values proven non-null in `settlement_records.payload`; C.2: historical stat ingest pipeline exists (player_game_stats table) | Operator-facing + member-facing (Research) |

**Deferred (not in current milestone):** historical box score ingest, player_game_stats table, Middling Overlays, CLV column promotion migration.

---

## 2 — Audience Split

Every analytics module has a declared primary audience. Audience determines which workspace owns it, which endpoints serve it, and what volume gates apply.

### 2.1 — Operator-Facing Analytics

Operator-facing analytics live in the **Intelligence workspace** and the **Decision workspace**. They are read-only surfaces for system calibration and performance review. No member sees these.

| Module | Workspace | Phase | Status |
|---|---|---|---|
| ROI by Tier | Intelligence | B | Shell only — volume-limited (N < 50 per tier = warning) |
| ROI by Capper | Intelligence | B | Shell only — volume-limited (N < 50 per capper = warning) |
| ROI by Market Type | Intelligence | B | Shell only — volume-limited (N < 50 per market = warning) |
| Scoring Calibration (win/loss proxy) | Intelligence | B | Shell only — code not activated; endpoint needed |
| Score-to-CLV Calibration (full) | Intelligence | C | Blocked — UTV2-335 required |
| CLV Cohorts | Intelligence | C | Blocked — UTV2-335 required |
| Score Breakdown (per pick) | Decision | B | Shippable now — `pick_promotion_history` live |
| Promotion Preview | Decision | B | Shippable now — stateless re-eval available |
| Routing Preview | Decision | B | Shippable now — `distribution_outbox` live |
| Board Saturation | Decision | B | Shippable now — `picks` + outbox live |

**Operator-facing volume gate policy (enforced at endpoint and UI level):**

| N count (settled picks in segment) | Display behavior |
|---|---|
| 0 | "No settled picks yet" — no ROI value rendered |
| 1–49 | Volume warning badge: "Insufficient sample (N={count}) — results not statistically reliable" — value shown in gray/italic |
| 50–99 | Soft warning: "Low sample (N={count})" — value shown normally |
| 100+ | No warning — full display |

---

### 2.2 — Member-Facing Analytics

Member-facing analytics surface in the **Research workspace** and are scoped to market data and per-pick hit rates. Members never see internal score components, promotion qualification state, or ROI analysis.

| Module | Workspace | Phase | Status |
|---|---|---|---|
| Prop Explorer | Research | B | Shippable now — `provider_offers` live (329k rows) |
| Line-Shopper | Research | B | Shippable now — multi-book `provider_offers` live |
| Player Card (identity) | Research | B | Shippable now — `players`, `player_team_assignments`, `teams` live |
| Matchup Card (event identity) | Research | B | Shippable now — `events`, `event_participants`, `teams` live |
| Hit Rate / Avg / Median | Research | B | Shell only — N count required; volume warning when N < 100 |
| Player Card (historical stats) | Research | C | Blocked — no `player_game_stats` table in DB |
| Matchup Card (comparative stats) | Research | C | Blocked — same historical stats gap |
| Trend / Split Filters | Research | C | Blocked — same gap; must not ship partial |

**Member-facing volume gate (hit rate module only):**

| N count (settled picks for the prop) | Display behavior |
|---|---|
| 0 | "No settled picks for this prop" |
| 1–99 | Volume warning: "Low sample (N={count})" — rate shown in gray/italic |
| 100+ | Full display |

**Language rule for Research workspace:** Hit rate and line data are market data only. Never surface pick approval state, promotion qualification, or score components to the Research workspace. These concepts belong exclusively to Decision and Intelligence.

---

### 2.3 — Shared Analytics Infrastructure

The following data infrastructure serves both operator-facing and member-facing modules.

| Infrastructure item | Serves | Phase | Status |
|---|---|---|---|
| `provider_offers` ingest (SGO, multi-book) | Research (member) + Research operator endpoints | A | Live — Pinnacle, DK, FD, BetMGM proven |
| `settlement_records` accumulation | Intelligence (operator) + Research hit rate (member) | A | Live — volume is the constraint |
| `settlement_records.clv_at_close` valid values | Intelligence CLV modules + Scoring calibration full mode | A (UTV2-335) | Not yet proven — UTV2-335 open |
| Capper-to-tier join path | Intelligence ROI by Tier | A | Schema gap — `cappers` has no `member_tier_id` FK |
| New operator-web endpoints (roi-by-tier, roi-by-capper, roi-by-market, scoring-calibration) | Intelligence modules 1–4 | B | Missing — must be created in Phase B |
| New operator-web endpoints (prop-offers, line-shopper, hit-rates, events/:id) | Research workspace | B | Missing — must be created in Phase B |
| Historical stat ingest pipeline (`player_game_stats` table) | Research (historical stats, comparative stats, trend filters) | C | Not in current milestone |

---

## 3 — Dependency Chain

```
Phase A — Ingestion data readiness
  ├─ A.1: provider_offers live and multi-book (DONE — ingestor live)
  ├─ A.2: UTV2-335 closed, clv_at_close proven valid (OPEN)
  └─ A.3: capper-to-tier join path confirmed or migrated (OPEN — schema gap)
       │
       ▼
Phase B — Analytics rebuild (readiness checklist item 5.8)
  ├─ B.1: Phase A.1 confirmed (unblocks Research and all ROI endpoints)
  ├─ B.2: New operator-web endpoints created and green:
  │     roi-by-tier, roi-by-capper, roi-by-market, scoring-calibration
  │     prop-offers, line-shopper, hit-rates, events/:id
  ├─ B.3: /performance + /intelligence pages merged into Intelligence workspace
  │     (unified tab structure: Performance | Form Windows | Calibration)
  ├─ B.4: Volume gates enforced — no fake data, no empty loading spinners
  └─ B.5: CLV Cohorts tab ABSENT until Phase C gate met
       │
       ▼
Phase C — Intelligence workspace modules + player enrichment (readiness checklist item 5.9)
  ├─ C.1: UTV2-335 Done + clv_at_close non-null values proven in settlement_records.payload
  │     → unlocks: CLV Cohorts tab, full scoring calibration, score-to-CLV correlation
  └─ C.2: Historical stat ingest pipeline created (player_game_stats table, new migration)
         → unlocks: Player historical stats, Matchup comparative stats, Trend/split filters
         → REQUIRES: PM approval (T1 — new migration + new ingest pipeline)
```

**Critical constraint:** Phase B may begin only on gate A.1. Phase B does NOT require A.2 or A.3 to be met in full — it ships with CLV and tier-ROI as shells/blocked states. Phase C requires both C.1 and C.2 independently; they are not coupled to each other.

---

## 4 — Readiness Gate Definitions

### 4.1 — Gate 5.8: Analytics Dashboard Rebuild

Readiness item 5.8 is met when ALL of the following are true:

| Gate criterion | Verified by | Current state |
|---|---|---|
| 5.8.1 Intelligence workspace modules 1–3 (ROI by tier/capper/market) are wired to live `settlement_records` data with volume gates enforced | `GET /api/operator/roi-by-tier`, `roi-by-capper`, `roi-by-market` return real data with N counts | Not started — endpoints missing |
| 5.8.2 Scoring Calibration (Module 4, win/loss proxy mode) is wired — `pick_promotion_history` joined to `settlement_records`, `analyzeWeightEffectiveness()` called server-side | `GET /api/operator/scoring-calibration` returns `WeightEffectivenessReport` | Not started — endpoint missing |
| 5.8.3 `/performance` and `/intelligence` CC pages are merged into a unified Intelligence workspace with tab structure: Performance / Form Windows / Calibration | CC route renders unified Intelligence workspace with three visible tabs | Not started |
| 5.8.4 CLV Cohorts tab is absent from the nav | UI inspection — tab not rendered | N/A until Phase B builds the tab structure |
| 5.8.5 Volume warning policy is enforced: no ROI value renders with N = 0; warning badge appears when N < 50 | UI + endpoint test — confirm badge renders at N < 50, clears at N >= 100 | Not started |
| 5.8.6 Score Breakdown, Promotion Preview, Routing Preview, Board Saturation modules are wired in Decision workspace | Existing `pick_promotion_history` + `distribution_outbox` queries; no new endpoints required | Shippable now — Decision workspace implementation pending |

**5.8 is NOT met by:** docs alone, page navigation changes alone, or endpoint creation without CC page integration.

---

### 4.2 — Gate 5.9: Player Enrichment and Matchup Context

Readiness item 5.9 has two independent sub-gates. Each may ship separately.

**Sub-gate 5.9-CLV** (CLV enrichment — Intelligence):

| Gate criterion | Verified by | Current state |
|---|---|---|
| 5.9-CLV.1: UTV2-335 is Done | Linear issue status = Done | Open |
| 5.9-CLV.2: `settlement_records.payload->>'clv_at_close'` has valid non-null values for >= 20 settled picks | Direct DB query against live `settlement_records` | Not proven |
| 5.9-CLV.3: CLV Cohorts tab is added to Intelligence workspace and renders Module 5 with distribution histogram + capper/market CLV ranking | CC route renders CLV Cohorts tab; data is not all-zero | Not started |
| 5.9-CLV.4: Scoring Calibration upgrades from win/loss proxy to full CLV correlation mode | `scoring-calibration` endpoint returns non-null CLV correlation values; `WeightEffectivenessReport` CLV fields are populated | Not started |

**Sub-gate 5.9-Stats** (historical stats and matchup context — Research):

| Gate criterion | Verified by | Current state |
|---|---|---|
| 5.9-Stats.1: `player_game_stats` table exists in DB (T1 migration approved and applied) | `pnpm supabase:types` shows `player_game_stats` in generated types | Not started — table does not exist |
| 5.9-Stats.2: Historical stat ingest pipeline is live and populating `player_game_stats` | DB query: `select count(*) from player_game_stats` returns > 0 | Not started |
| 5.9-Stats.3: Player Card (historical stats) module is wired in Research workspace | CC Research workspace Player Card shows historical stat rows | Not started |
| 5.9-Stats.4: Matchup Card (comparative stats) module is wired | CC Research workspace Matchup Card shows comparative data | Not started |
| 5.9-Stats.5: Trend / Split Filters module is wired and usable | CC Research workspace filters apply to prop explorer results | Not started |

**5.9-Stats REQUIRES explicit PM approval before implementation begins** — it is a T1 item (new migration, new ingest pipeline).

---

## 5 — What Is Explicitly Deferred and Why

The following items are out of scope for the current milestone and must not be implemented without explicit PM approval.

| Deferred item | Reason | Resolution path |
|---|---|---|
| CLV Cohorts tab (Module 5) | `clv_at_close` not proven valid; UTV2-335 open. A shell with null values would display misleading zero-CLV trends. | Reopen when UTV2-335 is Done and gate 5.9-CLV.1–2 are met |
| Score-to-CLV calibration (full mode) | Same CLV blocker as above. Win/loss proxy mode (Phase B) is the correct interim state. | Reopen after UTV2-335 |
| CLV column promotion migration (`ALTER TABLE settlement_records ADD COLUMN clv_at_close numeric`) | T1 migration — requires PM approval. Improves query performance but is not required to ship Phase B or the win/loss calibration shell. | PM decision — open question from `CC_INTELLIGENCE_METRICS_REGISTER.md` Section 5 |
| Capper-to-tier FK migration (`ADD COLUMN member_tier_id TO cappers`) | T1 migration — requires PM approval. Without this, ROI by Tier ships as a shell with a schema gap warning. | PM decision — open question from `CC_INTELLIGENCE_METRICS_REGISTER.md` Section 5 |
| Historical stat ingest pipeline + `player_game_stats` table | T1 — new migration + new ingest pipeline. Not in current milestone scope. Blocks Research workspace stats/trend/matchup modules. | PM-approved new milestone item |
| Middling Overlays (Decision workspace) | byBookmaker ingestion not proven stable across 2+ books simultaneously. Must not ship even as a shell. | Prove multi-book ingest stability, then wire `hedge-detection.ts` |
| Materialized views for ROI aggregations | T1 escalation if query duration > 2s at page load. Not triggered until live perf testing. | PM approval required if escalated |
| Risk-adjusted ROI | Kelly stake data not stored per pick — `picks.stake_units` is not denominated in currency. | New pick schema field required (T1) |
| CLV by tier | No `member_tier_id` FK on `cappers` (schema gap) AND blocked on UTV2-335. Double-blocked. | Both schema gap and CLV blocker must be resolved |
| Discord channel activation (exclusive-insights, game-threads, strategy-room) | Explicitly deferred per project scope. Not an analytics item. | Out of scope — do not activate |

---

## 6 — Open Issues That Must Resolve Before Phase B Implementation

These open questions are inherited from upstream ratification docs. They must be answered before implementation begins, not during.

| # | Question | Source | Blocking what |
|---|---|---|---|
| 1 | How does `picks.capper_id` map to a member tier? No `cappers.member_tier_id` column exists. | `CC_INTELLIGENCE_METRICS_REGISTER.md` OQ#1 | ROI by Tier (Module 1) endpoint query shape |
| 2 | What JSON key names are used inside `pick_promotion_history.payload` for score components? (`edge`? `edge_score`? `edgeScore`?) | `CC_INTELLIGENCE_METRICS_REGISTER.md` OQ#2 | Scoring Calibration (Module 4) + Score Breakdown (Decision workspace) |
| 3 | Does `/api/operator/performance` already return W-L-P per tier/capper/market, or only aggregate? | `CC_INTELLIGENCE_WORKSPACE_MVP.md` OQ#1 | Whether Modules 1–3 need new endpoints or can extend existing |
| 4 | Does `GET /api/operator/events/:id` already exist in operator-web under a different path? | `CC_IA_RATIFICATION.md` Section 7 OQ#4 | Research workspace Matchup Card — avoid duplicate endpoint creation |
| 5 | Does merging `/performance` and `/intelligence` pages require a new route structure, or can existing routes adopt tabs? | `CC_IA_RATIFICATION.md` Section 7 OQ#2 | Phase B route architecture decision |

**Resolution method:** Check implementation truth in `apps/operator-web` and `apps/command-center` before writing Phase B implementation packets. Do not assume.

---

## Appendix A — New Operator-Web Endpoints Required by Phase

### Phase B endpoints (required before 5.8 gate is met)

| Endpoint | Module served | Classification | Notes |
|---|---|---|---|
| `GET /api/operator/roi-by-tier` | Intelligence Module 1 | T2 — new read-only endpoint | Schema gap (capper-tier join) must be resolved first |
| `GET /api/operator/roi-by-capper` | Intelligence Module 2 | T2 — new read-only endpoint | No schema gap — `picks.capper_id → cappers.id` FK exists |
| `GET /api/operator/roi-by-market` | Intelligence Module 3 | T2 — new read-only endpoint | No schema gap — `picks.market_type_id → market_types.id` FK exists |
| `GET /api/operator/scoring-calibration` | Intelligence Module 4 | T2 — new read-only endpoint | Calls `analyzeWeightEffectiveness()` in `packages/domain` server-side |
| `GET /api/operator/prop-offers` | Research — Prop Explorer, Line-Shopper | T2 — new read-only endpoint | Queries `provider_offers` |
| `GET /api/operator/line-shopper` | Research — Line-Shopper | T2 — new read-only endpoint | Multi-bookmaker `provider_offers` grouped by prop |
| `GET /api/operator/hit-rates` | Research — Hit Rate module | T2 — new read-only endpoint | Joins `settlement_records` + `picks`; N count required |
| `GET /api/operator/events/:id` | Research — Matchup Card | T2 — verify before creating; may already exist | Verify in `apps/operator-web` first |

### Phase C endpoints (required before 5.9 gates are met)

| Endpoint | Module served | Classification | Notes |
|---|---|---|---|
| `GET /api/operator/clv-cohorts` | Intelligence Module 5 | T2 — new read-only endpoint | Blocked until UTV2-335 Done |
| `GET /api/operator/player-stats/:id` | Research — Player historical stats | T2 — new read-only endpoint | Blocked until `player_game_stats` table exists |
| `GET /api/operator/matchup-stats/:id` | Research — Matchup comparative stats | T2 — new read-only endpoint | Same blocker |

All endpoints are read-only. No write surfaces are introduced in any phase. If any ROI query exceeds 2s at page load, escalate to materialized view — that is a T1 decision requiring PM approval.

---

## Appendix B — Mapping to Four-Workspace Nav Structure

This table shows how Phase B and Phase C modules land in the ratified four-workspace nav (`CC_IA_RATIFICATION.md` Section 4).

| Nav workspace | Module | Phase | Tab / sub-nav label |
|---|---|---|---|
| Intelligence | ROI by Tier / Capper / Market | B | Performance tab |
| Intelligence | Form Windows (existing `shared-intelligence.ts`) | B | Form Windows tab |
| Intelligence | Scoring Calibration (win/loss mode) | B | Calibration tab |
| Intelligence | CLV Cohorts | C | CLV Cohorts tab — hidden until C.1 gate met |
| Decision | Score Breakdown | B | Score Breakdown |
| Decision | Promotion Preview | B | Promotion Preview |
| Decision | Routing Preview | B | Routing Preview |
| Decision | Board Saturation | B | Board Saturation |
| Research | Prop Explorer | B | Prop Explorer |
| Research | Line-Shopper | B | Line-Shopper |
| Research | Player Card (identity) | B | Player Card |
| Research | Matchup Card (event identity) | B | Matchup Card |
| Research | Hit Rate | B | Hit Rate (shell — volume warning active) |
| Research | Player Card (historical stats) | C | Player Card — historical tab (disabled until C.2 gate met) |
| Research | Matchup Card (comparative stats) | C | Matchup Card — stats tab (disabled until C.2 gate met) |
| Research | Trend / Split Filters | C | Trend Filters — hidden until C.2 gate met |
| Operations | All existing surfaces | B | No change — preserve all current capabilities |
