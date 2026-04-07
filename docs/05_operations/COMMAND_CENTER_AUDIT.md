# Command Center Audit — UTV2-412

**Audit date:** 2026-04-07
**Scope:** `apps/command-center/src/` and `apps/operator-web/src/` vs. target unified 4-workspace model
**Status:** Read-only audit — no source files modified

---

## Target Unified Model Reference

| Workspace | Intended capability |
|---|---|
| **Research** | Prop explorer, player card, matchup card, trend/split filters, hit rate/avg/median, line-shopper |
| **Decision** | Score breakdown, promotion preview, routing preview, board saturation, hedge/middling overlays |
| **Operations** | Snapshot, picks pipeline, lifecycle detail, manual review, recap status, channel health |
| **Intelligence** | ROI by tier/capper/market, scoring calibration, CLV/trend cohorts |

---

## Section 1 — Command Center: Complete Route/Page Inventory

### 1.1 Pages

| Route | Current Label | What It Renders | Data Sources | Classification | Target Workspace | Notes |
|---|---|---|---|---|---|---|
| `/` | Dashboard | Health signals drill-down, delivery state, worker runtime, provider health, stats summary, pick lifecycle table | `/api/operator/dashboard`, `/api/operator/snapshot`, `/api/operator/exception-queues` | `keep` | Operations | Good snapshot/channel health surface. Lacks board saturation detail. |
| `/burn-in` | Burn-In Scorecard | Entry conditions, intelligence truth, delivery/runtime truth, provider truth, daily checklist, Section 7 gate, Section 8 readiness, incident pointer | `/api/operator/snapshot`, `/api/operator/intelligence-coverage`, `/api/operator/provider-health`, `/api/operator/exception-queues` | `rename` + `move` | Operations | Label "Burn-In" is a controlled-validation artefact name, not a workspace concept. Rename to "Readiness / Health Scorecard". Content belongs in Operations. |
| `/picks-list` | Picks | Filterable pick search table (source, status, approval, score), pagination | `/api/operator/pick-search` | `keep` | Operations | Core picks pipeline surface. Fits Operations (lifecycle view). |
| `/picks/[id]` | Pick Detail | Submission details, lifecycle transitions, promotion state, Discord delivery status, score + metadata, intelligence presence, settlement records, correction history, audit trail | `/api/operator/picks/:id` | `keep` | Operations | Primary lifecycle detail surface. Complete and correct. |
| `/review` | Review Queue | Pending approval picks with filters, bulk review UI | `/api/operator/review-queue` | `keep` | Operations | Manual review fits Operations workspace. |
| `/held` | Held Picks | Picks with hold decision, age, hold reason, release/approve/deny actions | `/api/operator/held-queue` | `keep` | Operations | Manual review sub-state. Belongs in Operations. |
| `/exceptions` | Exception Operations | Failed delivery, dead-letter, pending manual review, stale validated, rerun candidates | `/api/operator/exception-queues` | `keep` | Operations | Correct framing. Exception management is an Operations concern. |
| `/performance` | Performance | Time-window stats (today/7d/30d/MTD), capper vs system, decision outcomes, sport breakdown, per-source breakdown, capper leaderboard | `/api/operator/performance`, `/api/operator/leaderboard` | `expand` | Intelligence | Has ROI/hit-rate by capper/sport — Intelligence territory. Missing: market-level ROI, member tier breakdown, CLV cohort analysis. Expand to include those slices. |
| `/intelligence` | Intelligence | Recent form windows (last 5/10/20), score quality (bands, score-outcome correlation), decision quality (approved vs denied ROI delta), feedback loop | `/api/operator/intelligence` | `expand` | Intelligence | Core Intelligence surface. Missing: CLV trend cohort view, market-level calibration, tier-stratified ROI. Expand. |
| `/decisions` | Decision Audit | Review history table (approve/deny/hold/return) filterable by decision type; shows pick outcome | `/api/operator/review-history` | `rename` + `move` | Decision | Label "Decision Audit" belongs to the Decision workspace, not as a standalone audit page. Rename to "Review History" and integrate into Decision workspace. |
| `/interventions` | Audit | Intervention audit log from `audit_log` filtered to operator actions | `/api/operator/snapshot` (recentAudit) | `rename` | Operations | Nav label is "Audit" but page title is "Intervention Audit". Rename nav label to "Intervention Log" to remove ambiguity. Content belongs in Operations. |

### 1.2 Server Actions

| File | Actions | Writes To | Classification | Notes |
|---|---|---|---|---|
| `src/app/actions/intervention.ts` | `retryDelivery`, `rerunPromotion`, `overridePromotion`, `requeueDelivery` | `apps/api` via Bearer token | `keep` | Operations actions. All correct. |
| `src/app/actions/review.ts` | Review decision (approve/deny/hold/return) | `apps/api` via Bearer token | `keep` | Operations actions. Correct. |
| `src/app/actions/settle.ts` | Manual settlement, correction submission | `apps/api` via Bearer token | `keep` | Operations actions. Correct. |

### 1.3 Components

| Component | What It Does | Classification | Target Workspace | Notes |
|---|---|---|---|---|
| `BulkReviewBar` | Multi-select approve/deny/hold across review queue | `keep` | Operations | Correct. |
| `CorrectionForm` | Submit correction to a settled pick | `keep` | Operations | Correct. |
| `ExceptionPanel` | Renders exception summary cards with drill-down links | `keep` | Operations | Correct. |
| `HealthSignalsPanel` | Renders lifecycle signals (submission/scoring/promotion/delivery/settlement) with drill-down links | `keep` | Operations | Correct. |
| `InterventionAction` | Single-action button (retry/rerun/force-promote) calling server actions | `keep` | Operations | Correct. |
| `NavLinks` | Top navigation bar | `rename` | All | Nav labels do not match workspace model. "Audit" → "Intervention Log"; no Research or Decision workspaces are present. See gaps table. |
| `PickFilters` | Source/status/approval filter UI for picks list | `keep` | Operations | Correct. |
| `PickLifecycleTable` | Compact picks table on dashboard | `keep` | Operations | Correct. |
| `QueueFilters` | Source/sort filter for review and held queues | `keep` | Operations | Correct. |
| `ReviewActions` | Approve/deny/hold/return pick action buttons | `keep` | Operations | Correct. |
| `ReviewQueueClient` | Client component rendering review queue cards | `keep` | Operations | Correct. |
| `SettlementForm` | Manual settlement form for posted picks | `keep` | Operations | Correct. |
| `ui/Breadcrumb` | Breadcrumb navigation helper | `keep` | All | Utility. |
| `ui/Button` | Styled button primitive | `keep` | All | Utility. |
| `ui/Card` | Card layout container | `keep` | All | Utility. |
| `ui/EmptyState` | Empty state placeholder | `keep` | All | Utility. |
| `ui/StatusBadge` | Status label with colour coding | `keep` | All | Utility. |
| `ui/Table` | Table layout primitives | `keep` | All | Utility. |

### 1.4 Hooks and Lib

| File | Purpose | Classification | Notes |
|---|---|---|---|
| `hooks/useAutoRefresh.ts` | `AutoRefreshStatusBar` client component; periodic page reload at configurable interval | `keep` | Used by all pages with auto-refresh. Correct. |
| `lib/api.ts` | Client-side fetch wrappers for operator-web endpoints | `keep` | Correct data-access layer. |
| `lib/server-api.ts` | Server-side env resolution (`OPERATOR_WEB_URL`, `UNIT_TALK_CC_API_KEY`, `OPERATOR_IDENTITY`) | `keep` | Correct. |
| `lib/pick-actions.ts` | `getAllowedActions(status)` — maps lifecycle state to available action set | `keep` | Domain helper. |
| `lib/types.ts` | Frontend type definitions mirroring operator-web contract | `keep` | Correct. |

---

## Section 2 — Operator-Web: Complete Route/API Inventory

| Route | Path | What It Returns | Consumed By CC Page | Classification | Notes |
|---|---|---|---|---|---|
| `GET /health` | `handleHealthRequest` | Service health, persistence mode, health signals | No direct CC page (used in dashboard via `/api/operator/dashboard`) | `keep` | Correct. Internal health check. |
| `GET /` | `handleDashboardRequest` | HTML server-side rendered status page (light theme) | Not consumed by Command Center | `rename` | This route renders a standalone HTML page at the operator-web root. It uses "Unit Talk V2 Operator" branding, not "Command Center". Conflicts with CC branding. |
| `GET /api/operator/snapshot` | `handleSnapshotRequest` | Full operator snapshot: counts, health, picks pipeline, aging, recap, board exposure, canary/best-bets/trader-insights channel health, recent outbox/receipts/settlements/runs/audit | `/` (Dashboard), `/burn-in`, `/interventions` | `keep` | Comprehensive. Correct. |
| `GET /api/operator/picks-pipeline` | `handlePicksPipelineRequest` | Picks pipeline counts + recent picks | No direct CC consumer (CC uses snapshot instead) | `remove` | Redundant: `snapshot` already includes picks pipeline data. No CC page calls this directly. Dead endpoint. |
| `GET /api/operator/recap` | `handleRecapRequest` | Settlement recap from snapshot | No direct CC consumer | `remove` | Redundant: recap data is available via `/snapshot`. No CC page calls this endpoint. Dead endpoint. |
| `GET /api/operator/stats` | `handleStatsRequest` | Windowed stats (7/14/30/90d) by optional capper/sport filter | No direct CC consumer | `remove` | Performance page uses `/api/operator/performance` instead. Stats endpoint appears unused by CC. Verify before removing. |
| `GET /api/operator/leaderboard` | `handleLeaderboardRequest` | Capper leaderboard (7/14/30/90d, optional sport filter, limit) | `/performance` | `keep` | Consumed by Performance page leaderboard section. |
| `GET /api/operator/capper-recap` | `handleCapperRecapRequest` | Per-capper pick recap (requires `submittedBy`) | No direct CC consumer | `expand` | Not yet surfaced in any CC page. Would belong in Research or Intelligence workspace for per-capper breakdown. |
| `GET /api/operator/participants` | `handleParticipantsRequest` | Players/teams with optional sport/type/search filter | No direct CC consumer | `expand` | Not surfaced in CC. Required for Research workspace (player card, prop explorer). |
| `GET /api/operator/picks/:id` | `handlePickDetailRequest` | Full pick detail view: pick, lifecycle, promotion history, outbox rows, receipts, settlements, audit trail | `/picks/[id]` | `keep` | Core pick detail data. Correct and complete. |
| `GET /api/operator/review-queue` | `handleReviewQueueRequest` | Pending approval picks, excluding held | `/review` | `keep` | Correct. |
| `GET /api/operator/held-queue` | `handleHeldQueueRequest` | Picks with latest review decision = 'hold' | `/held` | `keep` | Correct. |
| `GET /api/operator/pick-search` | `handlePickSearchRequest` | Filterable pick search with pagination | `/picks-list` | `keep` | Correct. |
| `GET /api/operator/review-history` | `handleReviewHistoryRequest` | Review decision history (approve/deny/hold/return), optional decision filter | `/decisions` | `keep` | Correct. Powers Decision Audit page. |
| `GET /api/operator/performance` | `handlePerformanceRequest` | Rich performance stats: time windows, capper vs system, decision outcomes, per-sport, per-source, operator insights | `/performance` | `keep` | Well-implemented. Correct. |
| `GET /api/operator/intelligence` | `handleIntelligenceRequest` | Recent form (last 5/10/20), score bands, score-outcome correlation, decision quality, feedback loop, warnings | `/intelligence` | `keep` | Well-implemented. Correct. |
| `GET /api/operator/intelligence-coverage` | `handleIntelligenceCoverageRequest` | Domain analysis / devigging / Kelly / real edge coverage rates by window; CLV coverage on settled picks | `/burn-in` | `keep` | Correct. Also needed for Intelligence workspace expansions. |
| `GET /api/operator/provider-health` | `handleProviderHealthRequest` | Per-provider rows, freshness status, ingestor health, quota summary | `/burn-in` | `keep` | Correct. |
| `GET /api/operator/exception-queues` | `handleExceptionQueuesRequest` | Failed delivery, dead-letter, manual review, stale validated, rerun candidates, missing book/market aliases | `/`, `/exceptions`, `/burn-in` | `keep` | Correct. Core exception management surface. |
| `GET /api/operator/dashboard` | (via `fetchDashboardData` in lib/api.ts) | Dashboard summary: signals, picks, stats, exceptions, observedAt | `/` | `keep` | Powers main dashboard signals panel and stats summary. |

---

## Section 3 — Gaps Table

Items the target unified model requires that do not currently exist in either surface:

| Workspace | Required Capability | Current State | Gap Type |
|---|---|---|---|
| **Research** | Prop explorer / prop browser | Not implemented | Missing workspace + route |
| **Research** | Player card (player profile with recent props, hit rates) | Not implemented | Missing workspace + route |
| **Research** | Matchup card (game-level context, both teams) | Not implemented | Missing workspace + route |
| **Research** | Trend/split filters (recent vs season, home/away, etc.) | Not implemented | Missing filter UI |
| **Research** | Hit rate / avg / median by prop type | Not implemented | Missing aggregation endpoint + UI |
| **Research** | Line-shopper (compare opening vs current line across books) | Not implemented | Missing data endpoint + UI; partial data via `provider_offers` |
| **Decision** | Score breakdown panel (per-component promotion scores visualized) | Partial — pick detail has raw score components as key-value pairs | Needs dedicated Decision workspace UI |
| **Decision** | Promotion preview (simulate what score a draft pick would receive) | Not implemented | Missing endpoint + UI |
| **Decision** | Routing preview (show what target a pick would route to before submission) | Not implemented | Missing endpoint + UI |
| **Decision** | Board saturation overlay (how many picks already live for same game/market) | Not implemented | `boardExposure` exists in snapshot but not surfaced as a Decision tool |
| **Decision** | Hedge/middling overlays | Not implemented | Missing |
| **Intelligence** | ROI by member tier | Not implemented | `performance` route has source/sport split but not tier stratification |
| **Intelligence** | ROI by market type | Not implemented | Performance route has sport split but not market-level breakdown |
| **Intelligence** | Scoring calibration view (expected vs actual hit rate per score band over time) | Partial — intelligence page shows score bands but no time-series calibration | Needs time-series aggregation |
| **Intelligence** | CLV trend cohorts (track CLV performance over time windows, by tier/capper) | Not implemented | CLV coverage rate exists but no cohort trend view |
| **Operations** | Recap status surface (has recap posted, when, to which channels) | Partial — burn-in scorecard has recap check but no dedicated recap status page | Needs dedicated recap status UI or integration into Operations workspace |
| **Operations** | Per-channel health cards as first-class Operations view | Partial — burn-in page has channel health; dashboard has delivery target summary | Best-bets/canary/trader-insights health should be first-class in Operations, not buried in burn-in |

---

## Section 4 — Overlap and Conflict Table

| Conflict | Description | Recommendation |
|---|---|---|
| Dual dashboards: operator-web root (`GET /`) vs CC dashboard (`/`) | `operator-web` renders a standalone HTML page titled "Unit Talk V2 Operator" (light theme). Command Center renders the same conceptual dashboard in React (dark theme, interactive). Both cover health signals, worker runtime, outbox counts, picks pipeline. | The operator-web HTML dashboard should be kept as a debug/emergency read surface only, not promoted as a user-facing dashboard. Add a comment/note that it is not the primary interface. |
| `/performance` vs `/intelligence` overlap | Performance page covers recent form by source/sport; Intelligence page also shows recent form windows. Data source is the same (`shared-intelligence.ts`). Two pages cover the same conceptual territory with different framing. | Merge into Intelligence workspace with tabs: Performance (ROI/record stats), Form (trend windows), Calibration (score bands). |
| `/decisions` vs `/interventions` naming conflict | Nav links to "Decisions" (review history) and "Audit" (intervention log). Both are audit-type surfaces. Decision Quality is also on the Intelligence page. | Rename "Decisions" → "Review History" (Decision workspace). Rename "Audit" → "Intervention Log" (Operations workspace). Remove "Decision Quality" duplication from Intelligence page or clearly label it as operator self-assessment. |
| Burn-in scorecard vs channel health in dashboard | Channel health (canary/best-bets/trader-insights sent/failed/dead-letter counts) appears in both the burn-in scorecard and partially in the dashboard delivery state card. | Promote channel health to the Operations workspace dashboard. Burn-in scorecard should only contain readiness/certification checks, not runtime monitoring. |
| Missing operator-web branding on HTML dashboard | The operator-web root dashboard uses "Unit Talk V2 Operator" as its heading and "operator" in its copy. The system brand is "Command Center". | Add a clear note that operator-web is an internal read surface, not the operator-facing brand. The Command Center brand should only appear in `apps/command-center`. |
| `/api/operator/picks-pipeline` and `/api/operator/recap` — redundant endpoints | Both data payloads are subsets of `/api/operator/snapshot`. No CC page calls them directly. | Mark for removal after confirming zero consumers. |
| `/api/operator/stats` — appears unused by CC | CC Performance page calls `/api/operator/performance` (not `/api/operator/stats`). Stats endpoint accepts capper/sport filters but its consumer is not identifiable in CC code. | Audit external consumers before removing. Candidate for removal or consolidation into `/api/operator/performance`. |
| `capper-recap` and `participants` endpoints have no CC surface | Both endpoints exist in operator-web but are not consumed by any CC page. | Required for Research workspace (participants → player cards; capper-recap → per-capper breakdown). Mark as `expand` targets. |

---

## Section 5 — Classification Summary

| Classification | Count | Items |
|---|---|---|
| `keep` | 33 | Most routes, all server actions, most components, all utility components and lib files |
| `expand` | 4 | `/performance` (add market/tier/CLV cohort), `/intelligence` (add CLV cohorts, calibration, tier ROI), `capper-recap` endpoint (surface in CC), `participants` endpoint (surface in CC) |
| `rename` | 4 | `/burn-in` label → "Readiness / Health Scorecard"; `/decisions` label → "Review History"; `/interventions` nav label "Audit" → "Intervention Log"; operator-web root branding |
| `move` | 1 | `/decisions` page → Decision workspace (currently floats as standalone) |
| `remove` | 3 | `/api/operator/picks-pipeline` (redundant with snapshot), `/api/operator/recap` (redundant with snapshot), `/api/operator/stats` (likely unused by CC — verify first) |
| **Total** | **45** | |

---

## Section 6 — Workspace Coverage Assessment

| Workspace | Current Coverage | Gap Severity |
|---|---|---|
| **Research** | 0% — no Research workspace exists | Critical. Entire workspace missing: no prop explorer, no player card, no matchup card, no line-shopper, no trend/split UI. |
| **Decision** | ~25% — Decision Audit page covers review history; pick detail has score components | High. No promotion preview, no routing preview, no board saturation overlay, no hedge/middling overlays. Score breakdown is raw KV pairs, not a designed workspace. |
| **Operations** | ~85% — dashboard, picks pipeline, lifecycle detail, review/held queues, exception management, channel health (partial) | Low. Gaps: recap status as first-class view, channel health promoted out of burn-in. |
| **Intelligence** | ~60% — performance stats, form windows, score bands, decision quality, score-outcome correlation, CLV coverage rate | Medium. Gaps: CLV trend cohorts, market-level ROI, tier-stratified ROI, calibration time-series. |

---

## Section 7 — Summary of Key Findings

1. **Operations workspace is the most complete.** 10 of 11 pages map cleanly to Operations. The surface is functional and production-capable.

2. **Research workspace is entirely absent.** No prop explorer, player card, matchup card, or line-shopper exists in any form. The `participants` endpoint exists in operator-web but is unconnected to any CC page.

3. **Decision workspace is a stub.** The `/decisions` page covers review history only. No promotion preview, routing preview, or board saturation tool exists.

4. **Intelligence workspace covers the right concepts but is incomplete.** `/performance` and `/intelligence` overlap in form-window coverage. CLV cohort analysis, market-level ROI, and calibration time-series are absent.

5. **Three operator-web endpoints are candidates for removal:** `picks-pipeline`, `recap`, and possibly `stats` — all are redundant with or unused relative to current CC consumers.

6. **Branding conflict exists on operator-web root.** The standalone HTML dashboard uses "Unit Talk V2 Operator" not "Command Center". This is acceptable as a debug surface but should be explicitly documented as non-primary.

7. **Nav labels do not match workspace model.** The current nav (Dashboard, Burn-In, Picks, Review, Held, Exceptions, Performance, Intelligence, Decisions, Audit) does not group by the four unified workspaces. A future nav redesign should group pages under Research / Decision / Operations / Intelligence.
