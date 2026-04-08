# Command Center Information Architecture Ratification

**Issue:** UTV2-411
**Date:** 2026-04-07
**Status:** Ratified — Phase 1 complete
**Authority:** This document is the canonical IA ratification for the Command Center four-workspace model. It gates all Phase 2 implementation work (UTV2-420, UTV2-421, UTV2-427 and downstream). No workspace implementation may proceed without this ratification in place.

---

## Section 1 — Ratification Basis

This document synthesizes four completed upstream Phase 1 documents. All four were read before writing this ratification. Findings are sourced from those documents; nothing here is invented.

| Input document | Issue | Status | Role |
|---|---|---|---|
| `COMMAND_CENTER_AUDIT.md` | UTV2-412 | Done | 45-item surface audit: all current routes, components, endpoints classified by workspace |
| `CC_MODULE_DEPENDENCY_MAP.md` | UTV2-424 | Done | Data reality baseline: per-module shippable/shell/blocked classification against live DB |
| `RESEARCH_WORKSPACE_MVP.md` | UTV2-414 | Done | Research workspace MVP scope contract; 6 modules with explicit v1 deliverables |
| `DECISION_WORKSPACE_MVP.md` | UTV2-417 | Done | Decision workspace MVP scope contract; 6 modules with explicit v1 deliverables |
| `CC_UNIFICATION_TIER_CLASSIFICATION.md` | UTV2-429 | Done | T1/T2/T3 classification for all 20 CC Unification issues |

Confirmation: all four primary input documents were present and complete at ratification time. No gaps were detected that would prevent ratification.

---

## Section 2 — Four-Workspace Structure

### 2.1 Research Workspace

**Purpose:** Market data exploration and player/event context. Operators use this workspace to browse available props, compare lines across books, view player identity, and check per-pick hit rates. This workspace is purely informational — it does not surface pick approval state or promotion outcomes.

**Coverage today:** 0% — no Research workspace page exists in `apps/command-center`. The `GET /api/operator/participants` endpoint exists in operator-web but is not consumed by any CC page.

| Module | Status | Live Data Source |
|---|---|---|
| Prop explorer | **Shippable now** | `provider_offers` (329k rows, Pinnacle/DK/FD/BetMGM, live) |
| Player card — identity | **Shippable now** | `players`, `player_team_assignments`, `teams` (populated via ingestor) |
| Matchup card — event identity | **Shippable now** | `events`, `event_participants`, `teams` (SGO-sourced, live) |
| Line-shopper | **Shippable now** | `provider_offers.bookmaker_key` (multi-book rows live) |
| Hit rate / avg / median | **Shell only** — volume-limited | `settlement_records` + `picks`; N count must always display; volume warning required when N < 100 |
| Player card — historical stats | **BLOCKED: historical backfill** | No `player_game_stats` or equivalent table exists in DB |
| Matchup card — comparative stats | **BLOCKED: historical backfill** | Same gap as player historical stats |
| Trend/split filters | **BLOCKED: historical backfill** | No external stat split table. Must NOT ship even as degraded partial version. |

**New operator-web endpoints required before implementation:**

| Endpoint | Status |
|---|---|
| `GET /api/operator/participants` | Exists — mark as `expand` target, not yet consumed by CC |
| `GET /api/operator/prop-offers` | Missing — new endpoint required |
| `GET /api/operator/line-shopper` | Missing — new endpoint required |
| `GET /api/operator/hit-rates` | Missing — new endpoint required |
| `GET /api/operator/events/:id` | Missing or extend existing — verify before creating |

**UX constraint:** Research workspace must never expose pick approval status or promotion qualification state. Line-shopper is market data only. Approval and promotion are separate system concepts owned by the Operations and Decision workspaces respectively.

---

### 2.2 Decision Workspace

**Purpose:** Promotion engine transparency. Operators use this workspace to understand how the system evaluated a pick: what scores it received, whether it qualified for a target, where it will route, and what the current board looks like. All modules are read-only — write actions remain in Operations.

**Coverage today:** ~25% — the `/decisions` page covers review history only. No score breakdown, promotion preview, routing preview, or board saturation tool exists as a designed workspace.

| Module | Status | Live Data Source |
|---|---|---|
| Score breakdown | **Shippable now** | `pick_promotion_history` (edge/trust/readiness/uniqueness/boardFit, every promoted pick) |
| Promotion preview | **Shippable now** | `pick_promotion_history` + live `evaluatePromotionEligibility()` (stateless re-eval for validated picks) |
| Routing preview | **Shippable now** | `picks.status` + `picks.promotion_target` + `distribution_outbox` |
| Board saturation | **Shippable now** | `picks` + `distribution_outbox` (by sport/market/event); cap context already in `boardExposure` via snapshot |
| Hedge overlays | **Shell only** — volume-dependent | `hedge_opportunities` table live; populated only when hedge conditions detected; empty is valid state |
| Middling overlays | **BLOCKED: multi-book** | byBookmaker ingestion must be proven stable across 2+ books simultaneously. Do not ship shell. |

**Critical language rule — enforced across all Decision workspace UX:**
- "Qualified" / "Not qualified" = promotion engine outcome (`pick_promotion_history.promotion_status`)
- "Approved" = operator review decision (`picks.approval_status`)
- These are never synonyms. Never label a qualified pick as approved or vice versa.
- "Will not route" and "suppressed by board cap" replace "rejected" or "denied" everywhere in this workspace.

**Review history resolution:** The current `/decisions` page (review history — `GET /api/operator/review-history`) maps into the Decision workspace under the label "Review History." It is the only existing Decision workspace surface. It must be renamed from "Decision Audit" to "Review History" and integrated under the Decision workspace nav group.

---

### 2.3 Operations Workspace

**Purpose:** Operational management of the pick lifecycle. All current operator-web capabilities are preserved here in full — nothing is removed. This workspace covers snapshot health, picks pipeline, lifecycle detail, manual review, held picks, exceptions, recap status, channel health, and intervention audit. Write surfaces (server actions) remain in this workspace.

**Coverage today:** ~85% — the most complete workspace. Gaps are recap status as a first-class view and per-channel health promoted out of the burn-in scorecard into a primary Operations view.

| Module | Status | Live Data Source |
|---|---|---|
| Snapshot / system health | **Shippable now** | `GET /api/operator/snapshot` (already live) |
| Picks pipeline | **Shippable now** | `picks_current_state` view (already live) |
| Lifecycle detail | **Shippable now** | `pick_lifecycle` + `audit_log` per pick (already live) |
| Manual review queue | **Shippable now** | `pick_reviews` + `GET /api/operator/review-queue` (already live) |
| Held picks queue | **Shippable now** | `GET /api/operator/held-queue` (already live) |
| Exceptions management | **Shippable now** | `GET /api/operator/exception-queues` (already live) |
| Recap status | **Shippable now** | `distribution_receipts` + recap tracking (already live — needs promotion to first-class surface) |
| Channel health | **Shippable now** | `distribution_receipts` by target + circuit-breaker state (already live — needs promotion out of burn-in) |
| Readiness / health scorecard | **Shippable now** | Existing burn-in page content (rename: "Burn-In" → "Readiness / Health Scorecard") |
| Intervention log | **Shippable now** | `audit_log` filtered to operator actions (rename nav label: "Audit" → "Intervention Log") |

**Full Operations workspace surface inventory — all current `keep` items from audit:**

See Section 3 for the complete operator-web surface mapping.

---

### 2.4 Intelligence Workspace

**Purpose:** Performance analysis and model feedback. Operators use this workspace to assess ROI by capper, tier, and market, calibrate scoring models, and track CLV patterns. This workspace is analysis-only — no pick decisions are made here.

**Coverage today:** ~60% — Performance and Intelligence pages cover the right concepts but overlap in form-window coverage, and CLV cohort analysis, market-level ROI, and calibration time-series are absent.

| Module | Status | Live Data Source |
|---|---|---|
| ROI by capper | **Shell only** — volume-limited | `settlement_records` + `picks` + cappers; needs 50+ settled picks per capper |
| ROI by tier | **Shell only** — volume-limited | `settlement_records` + `picks` + `member_tiers`; same volume gate |
| ROI by market | **Shell only** — volume-limited | `settlement_records` + `picks` + `market_types`; same volume gate |
| Scoring calibration | **Shell only** — code not activated | `pick_promotion_history` + `settlement_records`; calibration logic exists in `packages/domain` but not scheduled |
| CLV trend cohorts | **BLOCKED: CLV/line-movement** | `settlement_records.clv_at_close` exists in schema; valid values not proven end-to-end until UTV2-335 closes |

**Overlap resolution — `/performance` vs `/intelligence`:** Both current pages cover form windows from the same `shared-intelligence.ts` source. These must be merged into the Intelligence workspace with internal tab structure: Performance (ROI/record stats), Form (trend windows), Calibration (score bands, score-outcome correlation).

---

## Section 3 — Operations Workspace Inventory

All items classified `keep`, `rename`, `move`, or `expand` in `COMMAND_CENTER_AUDIT.md` that map to Operations are listed here. Nothing is removed from the operator capability set.

### Pages (from apps/command-center)

| Current route | Current label | Ratified label | Status |
|---|---|---|---|
| `/` | Dashboard | Dashboard | Keep — health signals, delivery state, worker runtime, provider health, lifecycle table |
| `/burn-in` | Burn-In Scorecard | Readiness / Health Scorecard | Rename — label "Burn-In" is a controlled-validation artefact name, not a workspace concept |
| `/picks-list` | Picks | Picks | Keep — filterable pick search, pagination |
| `/picks/[id]` | Pick Detail | Pick Detail | Keep — submission, lifecycle, promotion state, delivery status, score metadata, settlement, audit trail |
| `/review` | Review Queue | Review Queue | Keep — pending approval picks, bulk review UI |
| `/held` | Held Picks | Held Picks | Keep — picks with hold decision, release/approve/deny actions |
| `/exceptions` | Exception Operations | Exceptions | Keep — failed delivery, dead-letter, pending manual review, stale validated, rerun candidates |
| `/interventions` | Audit | Intervention Log | Rename nav label from "Audit" to "Intervention Log" — content is unchanged |

### Pages mapping to Decision workspace (from current command-center)

| Current route | Current label | Ratified label | Target workspace |
|---|---|---|---|
| `/decisions` | Decision Audit | Review History | Decision — rename and integrate into Decision workspace nav group |

### Pages mapping to Intelligence workspace (from current command-center)

| Current route | Current label | Ratified label | Target workspace |
|---|---|---|---|
| `/performance` | Performance | Performance (merge into Intelligence) | Intelligence — expand: add market/tier/CLV cohort slices |
| `/intelligence` | Intelligence | Intelligence (merge with Performance) | Intelligence — expand: add CLV cohorts, calibration, tier ROI |

### Server Actions (from apps/command-center/src/app/actions/)

| File | Actions | Classification |
|---|---|---|
| `intervention.ts` | `retryDelivery`, `rerunPromotion`, `overridePromotion`, `requeueDelivery` | Keep — Operations write actions via Bearer token to apps/api |
| `review.ts` | Review decision (approve/deny/hold/return) | Keep — Operations write actions |
| `settle.ts` | Manual settlement, correction submission | Keep — Operations write actions |

### Components (from apps/command-center/src/)

| Component | Keep/rename | Notes |
|---|---|---|
| `BulkReviewBar` | Keep | Multi-select approve/deny/hold across review queue |
| `CorrectionForm` | Keep | Submit correction to settled pick |
| `ExceptionPanel` | Keep | Exception summary cards with drill-down |
| `HealthSignalsPanel` | Keep | Lifecycle signals with drill-down links |
| `InterventionAction` | Keep | Single-action retry/rerun/force-promote buttons |
| `NavLinks` | Rename | Labels do not match workspace model — see Section 4 for nav structure |
| `PickFilters` | Keep | Source/status/approval filter for picks list |
| `PickLifecycleTable` | Keep | Compact picks table on dashboard |
| `QueueFilters` | Keep | Source/sort filter for review and held queues |
| `ReviewActions` | Keep | Approve/deny/hold/return action buttons |
| `ReviewQueueClient` | Keep | Client component for review queue cards |
| `SettlementForm` | Keep | Manual settlement form for posted picks |
| All `ui/*` primitives | Keep | Utility components shared across all workspaces |

### Hooks and Lib (from apps/command-center/src/)

| File | Keep/change |
|---|---|
| `hooks/useAutoRefresh.ts` | Keep — used by all pages with auto-refresh |
| `lib/api.ts` | Keep — client-side fetch wrappers |
| `lib/server-api.ts` | Keep — server-side env resolution |
| `lib/pick-actions.ts` | Keep — lifecycle state to action set mapping |
| `lib/types.ts` | Keep — frontend types mirroring operator-web contract |

### Operator-Web API Endpoints (from apps/operator-web)

| Endpoint | Classification | Consumer |
|---|---|---|
| `GET /api/operator/snapshot` | Keep | Dashboard, burn-in, interventions pages |
| `GET /api/operator/picks/:id` | Keep | Pick detail page |
| `GET /api/operator/review-queue` | Keep | Review page |
| `GET /api/operator/held-queue` | Keep | Held picks page |
| `GET /api/operator/pick-search` | Keep | Picks list page |
| `GET /api/operator/review-history` | Keep | Review history (Decision workspace) |
| `GET /api/operator/performance` | Keep | Performance/Intelligence page |
| `GET /api/operator/intelligence` | Keep | Intelligence page |
| `GET /api/operator/intelligence-coverage` | Keep | Burn-in / Intelligence workspace |
| `GET /api/operator/provider-health` | Keep | Burn-in / Operations workspace |
| `GET /api/operator/exception-queues` | Keep | Dashboard, exceptions, burn-in pages |
| `GET /api/operator/leaderboard` | Keep | Performance page leaderboard |
| `GET /api/operator/dashboard` | Keep | Main dashboard data |
| `GET /health` | Keep | Internal health check |
| `GET /api/operator/participants` | Expand | Not yet consumed by CC — required for Research workspace |
| `GET /api/operator/capper-recap` | Expand | Not yet surfaced — per-capper breakdown for Intelligence |
| `GET /` (operator-web root) | Keep as debug | Standalone HTML dashboard — not the primary interface; keep as debug/emergency read surface only |
| `GET /api/operator/picks-pipeline` | Remove candidate | Redundant with snapshot — verify zero consumers before removing |
| `GET /api/operator/recap` | Remove candidate | Redundant with snapshot — verify zero consumers before removing |
| `GET /api/operator/stats` | Remove candidate | Likely unused by CC — audit external consumers before removing |

---

## Section 4 — Primary Navigation Structure

**Pattern:** Workspace switcher — four top-level navigation items, one per workspace.

```
[ Research | Decision | Operations | Intelligence ]
```

**Rules:**
- Exactly four top-level nav items — one per workspace
- No additional top-level nav items beyond these four
- Within each workspace, secondary navigation (sidebar or tabs) organizes individual modules
- The workspace switcher is the persistent primary nav — it does not collapse or nest

### Workspace nav groups and pages

**Research**
- Prop Explorer
- Line-Shopper
- Player Card
- Matchup Card
- Hit Rate (shell — volume warning active)
- Trend Filters (disabled — "Coming soon: requires stat history ingest")

**Decision**
- Score Breakdown
- Promotion Preview
- Routing Preview
- Board Saturation
- Review History (moved from current `/decisions` page)
- Hedge Overlays (shell — empty state valid)
- Middling Overlays (do not surface — blocked, no shell)

**Operations**
- Dashboard (renamed from root `/`)
- Readiness / Health Scorecard (renamed from "Burn-In")
- Picks List
- Pick Detail
- Review Queue
- Held Picks
- Exceptions
- Intervention Log (renamed nav label from "Audit")

**Intelligence**
- Performance (merged with current `/performance`)
- Form Windows (merged from current `/intelligence`)
- Scoring Calibration (shell)
- CLV Cohorts (blocked — do not surface until UTV2-335 closes)
- ROI by Tier / Capper / Market (shell — volume warning active)

**Current nav labels that must change:**
- "Burn-In" → "Readiness / Health Scorecard"
- "Audit" (nav) → "Intervention Log"
- "Decisions" → "Review History" (and move to Decision workspace)

---

## Section 5 — Shippable Now vs Blocked

Consolidated across all four workspaces.

### Shippable Now (no blockers)

| Module | Workspace | Data source |
|---|---|---|
| Prop explorer | Research | `provider_offers` |
| Player card — identity | Research | `players`, `player_team_assignments`, `teams` |
| Matchup card — event identity | Research | `events`, `event_participants`, `teams` |
| Line-shopper | Research | `provider_offers` (multi-bookmaker) |
| Score breakdown | Decision | `pick_promotion_history` |
| Promotion preview | Decision | `pick_promotion_history` + live engine re-eval |
| Routing preview | Decision | `picks`, `distribution_outbox` |
| Board saturation | Decision | `picks`, `distribution_outbox` |
| All Operations surfaces | Operations | All existing operator-web endpoints (see Section 3) |

### Shell Only (ship with explicit data-limited state — no fake data, no empty loading)

| Module | Workspace | Limitation |
|---|---|---|
| Hit rate / avg / median | Research | Volume gate: show N count, volume warning when N < 100 |
| Hedge overlays | Decision | `hedge_opportunities` sparsely populated; empty is valid state |
| ROI by capper | Intelligence | Volume gate: needs 50+ settled picks per capper |
| ROI by tier | Intelligence | Same volume gate |
| ROI by market | Intelligence | Same volume gate |
| Scoring calibration | Intelligence | Code exists in `packages/domain` but not operationally scheduled |

### Blocked (do not implement — do not ship shell unless noted)

| Module | Workspace | Exact blocker | Resolution path |
|---|---|---|---|
| Player card — historical stats | Research | No `player_game_stats` table in DB | New historical box score ingest pipeline (not in current milestone) |
| Matchup card — comparative stats | Research | Same gap | Same pipeline |
| Trend/split filters | Research | Same gap; must not ship partial version | Same pipeline |
| Middling overlays | Decision | byBookmaker ingestion not proven stable across 2+ books | Prove stability, then wire `hedge-detection.ts` |
| CLV trend cohorts | Intelligence | `settlement_records.clv_at_close` values not proven end-to-end | UTV2-335 must close first |

---

## Section 6 — Conflicts with Backend Write Authority

The following IA decisions would require new write surfaces if taken to implementation. They are flagged here for PM awareness. None are resolved in this ratification — resolution requires explicit PM approval per merge policy.

| IA Decision | Conflict | Risk tier |
|---|---|---|
| Promotion preview for validated picks requires a live re-evaluation call through `promotion-service.ts` | This re-evaluation is currently only triggered by the submission flow. A Decision workspace preview call would need a new read-only API route in `apps/api` that runs `evaluatePromotionEligibility()` without persisting to `pick_promotion_history`. This is a new route but read-only — no write surface. No T1 trigger by current classification, but requires careful scoping. | T2 |
| Research workspace requires new operator-web endpoints (`prop-offers`, `line-shopper`, `hit-rates`, `events/:id`) | These are new read-only endpoints in `apps/operator-web`. Per tier classification, adding read-only endpoints is T2, not T1. However, the `hit-rates` endpoint requires a DB query against `settlement_records` that has not been previously implemented. | T2 |
| Intelligence workspace ROI views require joins across `settlement_records`, `picks`, `member_tiers`, and `market_types` | These joins are computable but the endpoint to expose them does not exist. New read-only endpoint in operator-web — T2 by classification. If these queries require a new DB view or materialized view → T1 escalation required. | T2 / T1-flag |
| `/api/operator/picks-pipeline`, `/api/operator/recap`, and `/api/operator/stats` removal | Removing endpoints is a non-additive change. Even if currently unused by CC, external consumers must be confirmed absent before removal. Removal requires explicit audit. | T2 |

**No IA decision in this document introduces a new Discord channel, new write path to Supabase, migration, or change to the pick lifecycle state machine.** All four workspaces are read-only from the Command Center perspective — all writes continue through `apps/api` via Bearer-authenticated server actions in the Operations workspace.

---

## Section 7 — Open Issues

The following questions cannot be resolved by this IA ratification. They require implementation truth or PM decision.

| # | Open issue | Blocking what | Resolution path |
|---|---|---|---|
| 1 | `GET /api/operator/stats` — does any consumer exist outside `apps/command-center`? | Cannot safely remove until confirmed | Audit all consumers: `apps/operator-web`, any external scripts or monitoring tooling |
| 2 | Intelligence workspace merge of `/performance` and `/intelligence` pages — does merging require a new route structure or can it reuse existing routes with tabs? | UTV2-425 (analytics dashboard rebuild sequencing) | Sequencing decision — resolve in UTV2-425 before implementation |
| 3 | Promotion preview live re-evaluation — does running `evaluatePromotionEligibility()` as a preview have side effects on board saturation state? | Module 2 implementation (Decision workspace) | Verify in `promotion-service.ts` that the preview path does not write to `pick_promotion_history` |
| 4 | `GET /api/operator/events/:id` — does this endpoint already exist in operator-web under a different path? | Research workspace matchup card implementation | Verify before creating a new endpoint |
| 5 | Operator-web root (`GET /`) HTML dashboard — is it used by any external monitor or alert agent? | Removal or demotion decision | Audit `apps/alert-agent` and any external monitoring for usage of the operator-web root HTML page |
| 6 | Board saturation cap values (15/slate, 10/sport, 2/game) — are these enforced in code as constants or configured in contracts? | Board saturation module must display accurate cap values | Verify in `apps/api/src/promotion-service.ts` and `@unit-talk/contracts` |
| 7 | CLV in hit rate module (Module 5, Research) — when UTV2-335 closes, does CLV belong in Research or Intelligence? | Future scope decision | Resolve when UTV2-335 closes. Current ratification: CLV stays in Intelligence workspace. Research hit rate module does not surface CLV even when UTV2-335 closes. |
| 8 | `capper-recap` endpoint — is per-capper breakdown Research (per-capper prop context) or Intelligence (per-capper ROI)? | Workspace assignment for when this surface is built | Recommendation: capper ROI → Intelligence; per-capper prop context → Research. Resolve at UTV2-422 (Intelligence MVP). |

---

## Ratification Sign-Off

This document ratifies the four-workspace model for the Command Center. It is grounded in four upstream Phase 1 documents derived from live repo and DB truth as of 2026-04-07.

**What is ratified:**
- Four-workspace structure: Research, Decision, Operations, Intelligence
- Module-level status for every module in all four workspaces (shippable/shell/blocked)
- Full Operations workspace surface inventory — nothing removed
- Primary nav: workspace switcher with exactly four top-level items
- Consolidated shippable vs blocked classification across all workspaces
- Flagged write-authority conflicts requiring PM attention
- Open questions that cannot be resolved without implementation truth

**What is not ratified:**
- Implementation sequence or sprint assignment (see UTV2-425)
- Intelligence workspace MVP scope in detail (see UTV2-422)
- Scoring explanation contract (see UTV2-418)
- Advanced decision overlay specs (see UTV2-419)

**Merge tier:** T2 — architecture doc, no runtime change. Review diff, verify CI green, merge.
