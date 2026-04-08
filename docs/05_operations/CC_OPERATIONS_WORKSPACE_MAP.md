# CC Operations Workspace Map

**Issue:** UTV2-420
**Date:** 2026-04-07
**Authority:** This document maps every existing operator-web module into the Operations workspace. It is derived from reading `COMMAND_CENTER_AUDIT.md` (45-item audit), `CC_IA_RATIFICATION.md`, and the actual routes in `apps/operator-web/src/routes/` and pages in `apps/command-center/src/app/`. No capability is removed.
**Merge tier:** T2 — doc, no runtime change.

---

## Governing Statement

**The Operations workspace preserves 100% of current operator-web capability.** No route is removed. No endpoint is decommissioned. No write surface is altered. This document maps existing surfaces to their target slot in the Operations workspace and identifies gaps flagged as `expand` in the audit.

---

## Section 1 — Module Inventory: Command Center Pages

All Command Center pages that map to the Operations workspace. Routes are preserved exactly as they exist today. Labels in the "Ratified label" column are the approved display names after CC unification — no route rename occurs at this stage, only nav label changes.

| Current route | Current nav label | Ratified nav label | Operations workspace slot | Current state | Notes |
|---|---|---|---|---|---|
| `/` | Dashboard | Dashboard | Primary dashboard | Live | Renders health signals, delivery state, worker runtime, provider health, lifecycle table. Data: `/api/operator/dashboard`, `/api/operator/snapshot`, `/api/operator/exception-queues`. |
| `/burn-in` | Burn-In Scorecard | Readiness / Health Scorecard | Readiness / Health Scorecard | Live | Label "Burn-In" is a controlled-validation artifact name. Rename nav label only — content and route unchanged. Data: `/api/operator/snapshot`, `/api/operator/intelligence-coverage`, `/api/operator/provider-health`, `/api/operator/exception-queues`. |
| `/picks-list` | Picks | Picks | Picks Pipeline | Live | Filterable pick search with pagination. Data: `/api/operator/pick-search`. |
| `/picks/[id]` | Pick Detail | Pick Detail | Pick Lifecycle Detail | Live | Submission details, lifecycle transitions, promotion state, delivery status, score metadata, settlement records, correction history, audit trail. Data: `/api/operator/picks/:id`. |
| `/review` | Review Queue | Review Queue | Manual Review Queue | Live | Pending approval picks, bulk review UI. Data: `/api/operator/review-queue`. |
| `/held` | Held Picks | Held Picks | Held Picks Queue | Live | Picks with hold decision, release/approve/deny actions. Data: `/api/operator/held-queue`. |
| `/exceptions` | Exception Operations | Exceptions | Exceptions Management | Live | Failed delivery, dead-letter, manual review, stale validated, rerun candidates. Data: `/api/operator/exception-queues`. |
| `/interventions` | Audit | Intervention Log | Intervention Log | Live | Operator audit log from `audit_log` filtered to operator actions. Nav label rename only — content and route unchanged. Data: `/api/operator/snapshot` (recentAudit field). |

**Total CC pages mapping to Operations: 8**

---

## Section 2 — Module Inventory: Operator-Web API Endpoints

All operator-web endpoints that serve Operations workspace surfaces. Routes are identical to current implementation. No endpoint is removed or renamed.

| Endpoint | Handler | Consumed by CC page | Operations workspace slot | Current state |
|---|---|---|---|---|
| `GET /api/operator/snapshot` | `handleSnapshotRequest` | `/` (Dashboard), `/burn-in`, `/interventions` | Primary data source for dashboard, readiness scorecard, intervention log | Live |
| `GET /api/operator/dashboard` | `fetchDashboardData` (via `lib/api.ts`) | `/` (Dashboard) | Dashboard signals panel and stats summary | Live |
| `GET /api/operator/picks/:id` | `handlePickDetailRequest` | `/picks/[id]` | Pick lifecycle detail | Live |
| `GET /api/operator/review-queue` | `handleReviewQueueRequest` | `/review` | Manual review queue | Live |
| `GET /api/operator/held-queue` | `handleHeldQueueRequest` | `/held` | Held picks queue | Live |
| `GET /api/operator/pick-search` | `handlePickSearchRequest` | `/picks-list` | Picks pipeline search | Live |
| `GET /api/operator/exception-queues` | `handleExceptionQueuesRequest` | `/`, `/exceptions`, `/burn-in` | Exceptions management, dashboard exception cards | Live |
| `GET /api/operator/intelligence-coverage` | `handleIntelligenceCoverageRequest` | `/burn-in` | Readiness / Health Scorecard — coverage rates | Live |
| `GET /api/operator/provider-health` | `handleProviderHealthRequest` | `/burn-in` | Readiness / Health Scorecard — provider freshness | Live |

**Endpoints mapped to Operations workspace: 9**

**Note on remove candidates:** The audit identified three endpoints as candidates for removal (`/api/operator/picks-pipeline`, `/api/operator/recap`, `/api/operator/stats`). These are NOT removed at this stage. They remain live pending external consumer audit. This document records their audit status only.

| Endpoint | Audit classification | Reason | Action at this stage |
|---|---|---|---|
| `GET /api/operator/picks-pipeline` | Remove candidate | Redundant with snapshot; no direct CC consumer identified | No action — keep live until consumer audit confirms zero external consumers |
| `GET /api/operator/recap` | Remove candidate | Redundant with snapshot; no direct CC consumer identified | No action — keep live until consumer audit confirms zero external consumers |
| `GET /api/operator/stats` | Remove candidate | CC Performance page calls `/api/operator/performance`, not `/api/operator/stats`; consumer not identifiable | No action — keep live; audit external consumers before any removal decision |

---

## Section 3 — Module Inventory: Server Actions

All Command Center server actions that belong in the Operations workspace. Write authority flows through `apps/api` via Bearer token — no server action writes directly to Supabase.

| File | Actions exposed | Target in ops workspace | Current state |
|---|---|---|---|
| `src/app/actions/intervention.ts` | `retryDelivery`, `rerunPromotion`, `overridePromotion`, `requeueDelivery` | Intervention actions on pick detail and exceptions pages | Live |
| `src/app/actions/review.ts` | `approvePickReview`, `denyPickReview`, `holdPickReview`, `returnPickReview` | Review queue and held picks write actions | Live |
| `src/app/actions/settle.ts` | Manual settlement, correction submission | Settlement form on pick detail page | Live |

**Server actions rule:** Operations workspace is the ONLY workspace that contains write surfaces. No write action may be added to Research, Decision, or Intelligence workspaces.

---

## Section 4 — Module Inventory: Components

All components that serve Operations workspace pages. Components shared across all workspaces (`ui/*`) are listed separately.

| Component | Operations workspace consumer | Current state |
|---|---|---|
| `BulkReviewBar` | Review queue — multi-select approve/deny/hold | Live |
| `CorrectionForm` | Pick detail — correction submission form | Live |
| `ExceptionPanel` | Exceptions, dashboard — exception summary cards | Live |
| `HealthSignalsPanel` | Dashboard — lifecycle signal drill-down | Live |
| `InterventionAction` | Pick detail, exceptions — retry/rerun/force-promote buttons | Live |
| `PickFilters` | Picks list — source/status/approval filter | Live |
| `PickLifecycleTable` | Dashboard — compact picks table | Live |
| `QueueFilters` | Review queue, held picks — sort and filter controls | Live |
| `ReviewActions` | Review queue, held picks — approve/deny/hold/return buttons | Live |
| `ReviewQueueClient` | Review queue — client-side review card rendering | Live |
| `SettlementForm` | Pick detail — manual settlement form | Live |
| `NavLinks` | All pages — top navigation bar | Live (requires label changes only) |

**Shared utility components (all workspaces):**

| Component | Notes |
|---|---|
| `ui/Breadcrumb` | Used across all workspaces |
| `ui/Button` | Used across all workspaces |
| `ui/Card` | Used across all workspaces |
| `ui/EmptyState` | Used across all workspaces |
| `ui/StatusBadge` | Used across all workspaces |
| `ui/Table` | Used across all workspaces |

---

## Section 5 — Module Inventory: Hooks and Lib

Library files that support Operations workspace pages. No changes required.

| File | Role | Current state |
|---|---|---|
| `hooks/useAutoRefresh.ts` | Periodic page reload at configurable interval — used by dashboard and picks pages | Live |
| `lib/api.ts` | Client-side fetch wrappers for all operator-web endpoints | Live |
| `lib/server-api.ts` | Server-side env resolution (`OPERATOR_WEB_URL`, `UNIT_TALK_CC_API_KEY`, `OPERATOR_IDENTITY`) | Live |
| `lib/pick-actions.ts` | `getAllowedActions(status)` — maps lifecycle state to available action set | Live |
| `lib/types.ts` | Frontend types mirroring operator-web contract | Live |

---

## Section 6 — Operations Workspace: Full Module Slot Map

The canonical slot structure for the Operations workspace. Each slot is mapped to its current implementation state.

| Slot | Ratified label | Route | Current state | Gap? |
|---|---|---|---|---|
| Primary dashboard | Dashboard | `/` | Live | Partial — channel health promoted out of burn-in is a gap (see Section 7) |
| Health scorecard | Readiness / Health Scorecard | `/burn-in` | Live — rename only | No gap in data; label rename pending |
| Picks pipeline | Picks | `/picks-list` | Live | None |
| Pick lifecycle detail | Pick Detail | `/picks/[id]` | Live | None |
| Manual review queue | Review Queue | `/review` | Live | None |
| Held picks queue | Held Picks | `/held` | Live | None |
| Exceptions management | Exceptions | `/exceptions` | Live | None |
| Intervention log | Intervention Log | `/interventions` | Live — label rename only | None |
| Recap status | (see gap) | No dedicated route | Partial | Gap — see Section 7 item 1 |
| Channel health (first-class) | (see gap) | No dedicated route | Partial — buried in burn-in | Gap — see Section 7 item 2 |

---

## Section 7 — Capability Gaps

Items that the audit flagged as `expand` that are not currently fully implemented in the Operations workspace. These are not new features — they are existing data surfaced in a more first-class way.

### Gap 1: Recap Status as First-Class Surface

**Audit classification:** `expand`
**Current state:** Recap data is available in `/api/operator/snapshot` (the `recap` field). The burn-in scorecard shows a recap check, but there is no dedicated recap status view showing: has the recap posted, when did it post, to which channels, and did it succeed.
**Data sources:** `distribution_receipts` filtered by recap delivery type + recap tracking fields already in snapshot.
**Required to close gap:** Promote recap status to a first-class panel within the Operations workspace (either as a section of the dashboard or a dedicated module). No new operator-web endpoint required — snapshot data is sufficient.
**No new DB columns required.**

### Gap 2: Per-Channel Health as First-Class Operations View

**Audit classification:** `expand`
**Current state:** Channel health (canary / best-bets / trader-insights sent/failed/dead-letter counts) appears in the burn-in scorecard and partially in the dashboard delivery state card. It is not a primary Operations surface.
**Data sources:** `distribution_receipts` by target + circuit-breaker state. Already available via `/api/operator/snapshot` (`channelHealth` field).
**Required to close gap:** Promote channel health cards to a primary position in the Operations workspace dashboard. No new endpoint required. No new DB columns required.
**No new write surfaces.**

### Gap 3: Nav Label Renames (pending implementation)

**Audit classification:** `rename`
**Items that need label changes (route paths do not change):**
- "Burn-In Scorecard" nav label → "Readiness / Health Scorecard"
- "Audit" nav label → "Intervention Log"
- The nav bar must add Research, Decision, and Intelligence workspace links (out of scope for this document — addressed in workspace-level implementation issues)

---

## Section 8 — Non-Goals for This Document

This document is a mapping document, not a design specification for new features.

- No new operator-web routes are created or specified here
- No new DB columns are required by any mapping in this document
- No existing routes are removed or renamed (route paths stay identical)
- No write surfaces are added to Research, Decision, or Intelligence workspaces
- Operator-web root (`GET /`) HTML dashboard is mapped as keep/debug — not promoted, not removed

---

## Section 9 — Complete Operations Workspace: Current Coverage Assessment

| Category | Count currently live | Gap |
|---|---|---|
| CC pages | 8 | 0 pages missing; 2 partial surfaces (recap, channel health) |
| Operator-web endpoints | 9 primary (3 candidates under audit) | 0 endpoints missing for Operations capability |
| Server actions | 3 files, multiple actions | None missing |
| Components | 11 Operations-specific + 6 shared utilities | None missing |
| Lib / hooks | 5 files | None missing |

**Coverage: ~85% operational.** The two partial surfaces (recap status as first-class view, channel health promoted out of burn-in) are capability promotions, not new features. All data exists — no backend work is required to close these gaps.
