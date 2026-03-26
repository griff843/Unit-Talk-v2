# Command Center — Lifecycle Minimum Spec

> Produced: 2026-03-25
> Scope: Minimum operator surface for E2E pick lifecycle truth verification.
> Non-goal: analytics dashboards, member-facing surfaces, leaderboards, or advanced reporting.

---

## 1. Objective

An operator must be able to trace a single pick from submission receipt through final settlement using only the operator surface — without resorting to direct database queries or log inspection. The minimum surface is defined by that requirement: every stage of the canonical lifecycle (`validated → queued → posted → settled`) must have at least one inspectable row that confirms the transition happened, the right actor wrote it, and the result is correct. This spec defines what data points are needed, which tables supply them, and the sequence in which they should be built.

---

## 2. Current Truth (Operator-Web Today)

### 2.1 Existing Routes

| Route | Method | What it returns |
|---|---|---|
| `GET /` | HTML | Operator dashboard: health signals, outbox counts, incident triage, canary readiness, best-bets health, trader-insights health, picks pipeline, recap summary |
| `GET /health` | JSON | Component health signals (`api`, `worker`, `distribution`), `persistenceMode`, `observedAt` |
| `GET /api/operator/snapshot` | JSON | Full `OperatorSnapshot` — all fields below, filtered by `outboxStatus`, `target`, `since`, `lifecycleState` |
| `GET /api/operator/picks-pipeline` | JSON | `PicksPipelineSummary` — counts by status, recent picks with promotion target and settlement result |
| `GET /api/operator/recap` | JSON | `SettlementSummary` — win/loss/push/void counts, hit rate, flat-bet ROI |

The `OperatorSnapshot` shape (as of Week 13):

```
observedAt, persistenceMode
health[]          — api / worker / distribution signals
counts            — pendingOutbox / processingOutbox / failedOutbox / sentOutbox
recentOutbox[]    — last 12 distribution_outbox rows (filterable)
recentReceipts[]  — last 12 distribution_receipts rows
recentSettlements[]  — last 12 settlement_records rows
recentRuns[]      — last 12 system_runs rows
recentPicks[]     — last 12 picks rows (filterable by status, since)
recentAudit[]     — last 12 audit_log rows
bestBets          — ChannelHealthSummary for discord:best-bets
traderInsights    — ChannelHealthSummary for discord:trader-insights
canary            — canary ChannelHealthSummary + graduationReady + blockers
picksPipeline     — counts (validated/queued/posted/settled/total), recentPicks as PickPipelineRow[]
recap             — SettlementSummary (win/loss/push/void, hit rate, ROI)
```

`PickPipelineRow` includes: `id`, `status`, `approvalStatus`, `promotionStatus`, `promotionTarget`, `promotionScore`, `settlementResult` (effective, correction-aware), `createdAt`, `settledAt`.

### 2.2 What Is Currently Visible

- **Pick status** — current `status` field (`validated`, `queued`, `posted`, `settled`, `voided`) via `recentPicks` and `picksPipeline`.
- **Promotion decision** — `promotionStatus`, `promotionTarget`, `promotionScore` on each pick row; visible in `PickPipelineRow`.
- **Distribution outbox** — `distribution_outbox` rows with status, target, timestamps; filterable by status and target.
- **Delivery receipts** — `distribution_receipts` rows with `external_id` (Discord message ID), `channel`, `recorded_at`.
- **Channel health** — per-channel sent/failed/dead-letter counts and latest message ID for `canary`, `best-bets`, `trader-insights`.
- **Settlement** — `settlement_records` rows with `result`, `status`, `corrects_id`, `confidence`, `evidence_ref`; effective (correction-aware) result surfaced in `picksPipeline`.
- **Settlement recap** — aggregated win/loss/push/void, hit rate, flat-bet ROI.
- **Worker health** — `system_runs` used to derive worker status signal.
- **Distribution health** — failed/dead-letter outbox counts drive distribution signal.

### 2.3 What Is Currently Invisible

The following cannot be answered from the current operator surface without direct DB access:

1. **Submission record** — No route surfaces `submissions` or `submission_events` rows. An operator cannot confirm a specific submission was received, what payload it carried, or whether it was rejected before pick creation.

2. **Pick lifecycle chain** — `pick_lifecycle` rows are never returned. An operator cannot see the ordered sequence of state transitions for a pick (`from_state → to_state`, `actor`, `timestamp`), only the current `status` field on the pick itself.

3. **Promotion history per pick** — `pick_promotion_history` rows are never returned. An operator cannot see that a pick was evaluated for both `best-bets` and `trader-insights`, which policy version ran, what scores were used, or whether a `not_eligible` decision was recorded.

4. **Pick-scoped audit trail** — `recentAudit` returns the last 12 audit rows globally. There is no route to retrieve all audit rows for a specific pick. `audit_log.entity_ref` holds the pick ID, but it is not queryable via the operator surface.

5. **Per-pick settlement chain** — `SettlementRepository.listByPick()` exists as a repository method but is not exposed through any operator route. An operator cannot see all settlement records for a single pick, only the most recent 12 settlement records globally.

6. **Submission-to-pick linkage** — No route correlates `submission_id` on the pick back to the originating submission record or its events.

7. **Outbox-to-pick linkage** — `distribution_outbox.pick_id` is not surfaced in `recentOutbox`. An operator cannot find the outbox row for a specific pick without knowing the outbox ID.

8. **Voided picks** — The counts query (`validated`, `queued`, `posted`, `settled`) does not include `voided`. Picks voided mid-lifecycle are invisible in the pipeline summary.

9. **Manual review queue** — `settlement_records` rows with `status = 'manual_review'` appear in `recentSettlements` but there is no dedicated surface or count for pending manual review items.

10. **Ingestion/provider source** — `submissions.payload` and `picks.source` are not exposed, making it impossible to verify which channel (smart-form, api, etc.) originated a pick.

---

## 3. Minimum Surfaces Required

### 3.1 Pick Detail View

**Purpose:** Allow an operator to trace a single pick through its complete lifecycle in one query.

**Required data points:**
- Pick record: `id`, `status`, `approval_status`, `promotion_status`, `promotion_target`, `promotion_score`, `source`, `market`, `selection`, `line`, `odds`, `stake_units`, `created_at`, `posted_at`, `settled_at`, `submission_id`
- Lifecycle chain: all `pick_lifecycle` rows for this pick, ordered by `created_at`, including `from_state`, `to_state`, `actor`, `created_at`
- Promotion history: all `pick_promotion_history` rows for this pick, ordered by `created_at`, including `target`, `promotion_status`, `promotion_score`, `promotion_reason`, `promotion_version`, `promotion_decided_at`, `promotion_decided_by`
- Outbox rows: `distribution_outbox` rows where `pick_id = <id>`, including `target`, `status`, `claimed_at`, `claimed_by`, `created_at`, `updated_at`
- Receipts: `distribution_receipts` rows linked to those outbox IDs, including `external_id`, `channel`, `recorded_at`, `status`
- Settlement chain: all `settlement_records` rows for this pick, ordered by `created_at`, including `result`, `status`, `confidence`, `evidence_ref`, `corrects_id`, `settled_by`, `settled_at`
- Audit trail: all `audit_log` rows where `entity_ref = <pick_id>`, ordered by `created_at`, including `entity_type`, `entity_id`, `action`, `actor`, `payload`, `created_at`
- Originating submission: the `submissions` row linked via `submission_id`, including `payload`, `created_at`

**Source tables:** `picks`, `pick_lifecycle`, `pick_promotion_history`, `distribution_outbox`, `distribution_receipts`, `settlement_records`, `audit_log`, `submissions`

**Why launch-critical:** This is the single most important surface. Every lifecycle verification check in the proof template requires correlating rows across these eight tables for one pick. Without a per-pick view, operators must manually join seven queries to verify E2E truth. The existing `packages/verification/src/scenarios/definitions.ts` defines five canonical scenarios (submission-validation, promotion-routing, distribution-delivery, settlement-resolution, full-lifecycle) — every one of them requires cross-table visibility that this surface would provide.

**New queries required:** Yes. `pick_lifecycle`, `pick_promotion_history` are not queried today. `distribution_outbox` needs a `pick_id` filter. `audit_log` needs an `entity_ref` filter. `submissions` is not queried at all.

**Schema changes required:** None. All columns exist. The `entity_ref` column on `audit_log` already holds the pick ID as text — the operator surface just needs to query it.

---

### 3.2 Submission Ingestion Trace

**Purpose:** Allow an operator to verify that a submission was received, what it contained, and whether it produced a pick or was rejected.

**Required data points:**
- Submission record: `id`, `payload`, `created_at`
- Submission events: all `submission_events` rows where `submission_id = <id>`, ordered by `created_at`, including `event_name`, `payload`
- Resulting pick: the `picks` row linked via `submission_id`, including `id`, `status`, `promotion_status`, `promotion_target`

**Source tables:** `submissions`, `submission_events`, `picks`

**Why launch-critical:** Without submission visibility, an operator cannot distinguish "pick never submitted" from "submission rejected" from "submission materialized but something else broke." The smart-form PRD explicitly shows the success state as including the resulting pick ID and lifecycle state — operators need to be able to verify that state from the dashboard, not just from the form response.

**New queries required:** Yes. Neither `submissions` nor `submission_events` is currently queried by operator-web. The `picks` table already has a `submission_id` column that can be used to join.

**Schema changes required:** None.

---

### 3.3 Manual Review Queue

**Purpose:** Surface all `settlement_records` rows with `status = 'manual_review'` that have not yet been corrected.

**Required data points:**
- Settlement record: `id`, `pick_id`, `review_reason`, `notes`, `source`, `created_at`, `settled_by`
- Associated pick: `status`, `market`, `selection`

**Source tables:** `settlement_records`, `picks`

**Why launch-critical:** The settlement contract states that a pick with only a `manual_review` record remains in `posted` state. These picks will never advance to `settled` without operator action. Without a dedicated surface, manual review items are invisible except as noise in the global `recentSettlements` list. Any pick stuck in manual review is a lifecycle gap that breaks E2E truth.

**New queries required:** Yes. A filtered query `settlement_records WHERE status = 'manual_review'` with a join to `picks` for context.

**Schema changes required:** None.

---

### 3.4 Pipeline Count Hardening (voided)

**Purpose:** Include voided picks in the pipeline summary so the operator sees the true count of all picks, including those that exited the lifecycle abnormally.

**Required data points:**
- Add `voided: number` to `PicksPipelineSummary.counts`
- Include voided picks in `total`

**Source:** `picks WHERE status = 'voided'` count query — same pattern as the existing validated/queued/posted/settled counts.

**Why launch-critical:** Voided picks indicate lifecycle exceptions (e.g., a pick in `validated` or `queued` that was voided before posting). Without this count, an operator's total does not add up and voided picks vanish from all visibility. This is a silent state gap.

**New queries required:** One additional count query alongside the existing four in `createOperatorSnapshotProvider()`.

**Schema changes required:** None. `voided` is already a valid value in `pickStatuses`.

---

## 4. Required Data Points Per Surface

### Pick Detail View

| Field | Table | Column |
|---|---|---|
| Pick identity | `picks` | `id`, `submission_id`, `source`, `status`, `approval_status` |
| Pick content | `picks` | `market`, `selection`, `line`, `odds`, `stake_units` |
| Pick promotion state | `picks` | `promotion_status`, `promotion_target`, `promotion_score`, `promotion_decided_at` |
| Pick timestamps | `picks` | `created_at`, `posted_at`, `settled_at` |
| Lifecycle transitions | `pick_lifecycle` | `from_state`, `to_state`, `actor`, `created_at` |
| Promotion evaluations | `pick_promotion_history` | `target`, `promotion_status`, `promotion_score`, `promotion_version`, `promotion_decided_at`, `promotion_decided_by`, `override_action` |
| Outbox routing | `distribution_outbox` | `id`, `target`, `status`, `claimed_at`, `claimed_by`, `created_at`, `updated_at` |
| Delivery receipts | `distribution_receipts` | `external_id`, `channel`, `status`, `recorded_at` (linked via `outbox_id`) |
| Settlement chain | `settlement_records` | `id`, `result`, `status`, `confidence`, `evidence_ref`, `corrects_id`, `settled_by`, `settled_at` |
| Audit trail | `audit_log` | `entity_type`, `entity_id`, `action`, `actor`, `payload`, `created_at` (filtered by `entity_ref = pick_id`) |
| Originating submission | `submissions` | `id`, `payload`, `created_at` |

### Submission Ingestion Trace

| Field | Table | Column |
|---|---|---|
| Submission record | `submissions` | `id`, `payload`, `created_at` |
| Submission events | `submission_events` | `event_name`, `payload`, `created_at` |
| Resulting pick | `picks` | `id`, `status`, `promotion_status`, `promotion_target` |

### Manual Review Queue

| Field | Table | Column |
|---|---|---|
| Review record | `settlement_records` | `id`, `pick_id`, `review_reason`, `notes`, `source`, `settled_by`, `created_at` |
| Pick context | `picks` | `status`, `market`, `selection` |

### Pipeline Counts (hardened)

| Signal | Table | Query |
|---|---|---|
| voided count | `picks` | `SELECT count(*) WHERE status = 'voided'` |

---

## 5. Filters and Search

These are the minimum filters needed for operational debugging. They are not analytics dimensions.

### Per-pick lookup (essential)

- `GET /api/operator/picks/:id` — retrieve all detail rows for a specific pick by ID
- This is the primary debugging tool. A pick ID from a proof run, Discord message, or error log should be immediately resolvable to a full lifecycle trace.

### Submission lookup (essential)

- `GET /api/operator/submissions/:id` — retrieve submission record, events, and linked pick

### Manual review list (essential)

- `GET /api/operator/manual-review` — list all open manual review settlement records, optionally filtered by `since`

### Existing filters (already present, sufficient)

- `outboxStatus` on `/api/operator/snapshot` — already works
- `target` on `/api/operator/snapshot` — already works
- `lifecycleState` on `/api/operator/snapshot` and `/api/operator/picks-pipeline` — already works
- `since` on all snapshot queries — already works

### What is not needed at minimum viability

- Free-text search across picks (market, selection, player name) — useful, not required for E2E proof
- Date-range analytics filters — useful for recap, not required for lifecycle debugging
- Sorting and pagination for the detail views — append-to-bottom with a hard limit (20 rows) is sufficient for debugging

---

## 6. What Is Deferred

The following surfaces are useful but not required for E2E lifecycle truth verification:

| Surface | Reason for deferral |
|---|---|
| Full-text search across picks (player, market, selection) | Requires index or full-scan; debugging by pick ID is sufficient for proof |
| Capper/source breakdown in recap | Analytics; settlement summary by capper requires grouping logic not yet in domain layer |
| Promotion score breakdown by component | `promotionScores` lives in `picks.metadata.promotionScores` (JSONB); surfacing component scores requires metadata parsing logic; pick-level promo score is sufficient for verification |
| Worker heartbeat history | `system_runs` already gives worker signal; a dedicated heartbeat timeline is monitoring, not lifecycle verification |
| Discord embed parity check | Useful for distribution audit; not required for lifecycle state verification |
| Pick correction history timeline | Settlement chain in pick detail already shows correction chain via `corrects_id`; a separate timeline view adds presentation, not new truth |
| Bulk pick status table (paginated) | The current `picksPipeline.recentPicks` list + per-pick detail is sufficient; pagination is an optimization |
| Automated settlement feed status | Feed settlement is blocked at service layer (`source === 'feed'` rejected); no surface needed until feed is enabled |
| Subscriber-facing metrics or ROI | Out of scope by PRD non-goal |
| Advanced retry control for failed outbox | Operational action, not a read surface; deferred until a retry contract is written |

---

## 7. Implementation Order

The sequence is ordered by "how many lifecycle gaps does this close per unit of effort."

### Step 1 — Pick detail route (highest value)

Implement `GET /api/operator/picks/:id`.

Closes gaps: lifecycle chain, promotion history, outbox linkage, receipt linkage, per-pick settlement chain, per-pick audit trail, submission linkage. Closes 8 of the 10 invisible gaps listed in §2.3.

Implementation: New route in `apps/operator-web/src/server.ts`. The provider calls parallel Supabase queries against `pick_lifecycle`, `pick_promotion_history`, `distribution_outbox` (filter `pick_id`), `distribution_receipts` (join via outbox IDs), `settlement_records` (filter `pick_id`), `audit_log` (filter `entity_ref`), `submissions` (filter `id = pick.submission_id`). Returns a single `PickDetailView` JSON object. No new packages or schema changes.

### Step 2 — Voided count in pipeline summary (lowest effort, closes a silent gap)

Add `voided` count to `createOperatorSnapshotProvider()` alongside the existing four count queries. Update `PicksPipelineSummary.counts` type and `createSnapshotFromRows()`.

Closes gaps: voided picks invisible in pipeline.

### Step 3 — Manual review queue

Implement `GET /api/operator/manual-review`.

Closes gaps: manual review items invisible, picks stuck in `posted` with no path to `settled`.

Implementation: New route. Query `settlement_records WHERE status = 'manual_review'` ordered by `created_at` descending, join `picks` for `market` and `selection` context.

### Step 4 — Submission trace route

Implement `GET /api/operator/submissions/:id`.

Closes gaps: submission receipt, payload, rejection vs success, submission-to-pick linkage.

Implementation: New route. Query `submissions`, `submission_events`, and `picks WHERE submission_id = <id>`.

### Step 5 — HTML dashboard links (usability, not new truth)

Add links from `PickPipelineRow` entries in the HTML dashboard to `/api/operator/picks/:id`. Add a manual review count badge to the dashboard health section when `manual_review` count > 0.

---

## 8. Integration Points

### What can be extended in the existing `apps/operator-web/src/server.ts`

- The `createOperatorSnapshotProvider()` function — extend with the voided count query (Step 2) by adding one more count query to the existing `Promise.all` block.
- The `routeOperatorRequest()` function — add the three new route cases (pick detail, manual review, submission trace).
- The `createSnapshotFromRows()` function — extend with `voided` in counts.
- The HTML `renderOperatorDashboard()` function — add manual review badge and pick ID links.

### What needs new route handler logic (not a new package)

- `GET /api/operator/picks/:id` — new route case + new `PickDetailView` interface + parallel query logic in the DB provider. The in-memory provider stub can return an empty detail or a static fixture for tests.
- `GET /api/operator/manual-review` — new route case + filtered settlement query.
- `GET /api/operator/submissions/:id` — new route case + `submissions` + `submission_events` queries.

### What does not require changes

- `packages/db/src/repositories.ts` — `SettlementRepository.listByPick()` already exists. `PickRepository.findPickById()` already exists. New operator queries can be made directly from the provider using the Supabase client without adding new repository interfaces (the operator-web provider queries Supabase directly, not through the repository layer).
- `packages/domain` — no domain logic changes needed; the pick detail view is a read-only projection.
- `apps/api` — no changes to the write API. The operator surface is read-only.

### Schema dependency check

All required columns exist in the live schema:
- `pick_lifecycle.from_state` — added in migration 002
- `pick_lifecycle.to_state` — canonical column
- `audit_log.entity_ref` — added in migration 002; holds pick ID as text
- `distribution_outbox.pick_id` — present (used in worker claim logic)
- `settlement_records.corrects_id` — added in migration 002
- `distribution_receipts.channel` — added in migration 003

No schema migration is required for any surface in this spec.
