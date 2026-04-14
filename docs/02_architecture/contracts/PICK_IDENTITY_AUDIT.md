# Pick Identity Audit — Command Center Read Paths

**Issue:** UTV2-564
**Contract:** `docs/02_architecture/contracts/PICK_IDENTITY_CONTRACT.md`
**Date:** 2026-04-13

---

## 1. Per-Surface Field Gap Matrix

### Legend

- **R** = Returned in response payload
- **A** = Available in DB but not selected/returned by this route
- **M** = Missing upstream (not in DB as column or reliable metadata key)
- **P** = Partially available (FK exists but no join to resolve display value)
- **V** = Available via `picks_current_state` view (used by pick-search only)

---

### 1.1 Review Queue (`/api/operator/review-queue`)

**Query:** `picks` table, `select('*')`, filtered by `status=awaiting_approval OR approval_status=pending`

| Contract Field | Tier | Status | Column / Source | Notes |
|---|---|---|---|---|
| Sport / League | T1 | **P** | `sport_id` (FK) | Raw UUID returned via `*`; no join to `sports.display_name` |
| Matchup / Event | T1 | **A** | `metadata.eventName` | In metadata JSONB, not extracted |
| Selection | T1 | **R** | `picks.selection` | |
| Market | T1 | **R** | `picks.market` | Raw normalized key, no human label |
| Line | T1 | **R** | `picks.line` | |
| Odds | T1 | **R** | `picks.odds` | |
| Source | T1 | **R** | `picks.source` | |
| Lifecycle Status | T1 | **R** | `picks.status` | |
| Capper / Submitted By | T2 | **P** | `capper_id` (FK) | Raw UUID returned; no join to `cappers.display_name`; no metadata extraction |
| Event Start Time | T2 | **A** | `metadata.eventTime` | In metadata JSONB, not extracted |
| Approval Status | T2 | **R** | `picks.approval_status` | |
| Stake Units | T2 | **R** | `picks.stake_units` | |
| Confidence | T2 | **R** | `picks.confidence` | |
| Pick ID | T2 | **R** | `picks.id` | |
| Created At | T2 | **R** | `picks.created_at` | |

**Tier 1 compliance: 6/8** (Sport: partial FK only; Matchup: available but not extracted)
**Tier 2 compliance: 5/7** (Capper: partial FK only; Event Time: available but not extracted)

---

### 1.2 Pick Search (`/api/operator/pick-search`)

**Query:** `picks_current_state` view, `select('*', { count: 'exact' })`

| Contract Field | Tier | Status | Column / Source | Notes |
|---|---|---|---|---|
| Sport / League | T1 | **R** | `sport_display_name` (view join) | Extracted in route as `sport` field; falls back to `sport_id` then `metadata.sport` |
| Matchup / Event | T1 | **A** | `metadata.eventName` | In metadata JSONB, not extracted by route |
| Selection | T1 | **R** | `picks.selection` | |
| Market | T1 | **R** | `picks.market` | Raw key; `market_type_display_name` available from view but not surfaced explicitly |
| Line | T1 | **R** | `picks.line` | |
| Odds | T1 | **R** | `picks.odds` | |
| Source | T1 | **R** | `picks.source` | |
| Lifecycle Status | T1 | **R** | `picks.status` | |
| Capper / Submitted By | T2 | **R** | `capper_display_name` (view join) | Route extracts as `submitter` field; falls back through `capper_id`, `submitted_by`, `metadata.capper`, `metadata.submittedBy` |
| Event Start Time | T2 | **A** | `metadata.eventTime` / `metadata.eventStartTime` | In metadata JSONB, not extracted |
| Approval Status | T2 | **R** | `picks.approval_status` | |
| Stake Units | T2 | **R** | `picks.stake_units` | |
| Confidence | T2 | **R** | `picks.confidence` | |
| Pick ID | T2 | **R** | `picks.id` | |
| Created At | T2 | **R** | `picks.created_at` | |

**Tier 1 compliance: 7/8** (Matchup: available but not extracted)
**Tier 2 compliance: 6/7** (Event Start Time: available but not extracted)

---

### 1.3 Pick Detail (`/api/operator/pick-detail/:id`)

**Query:** `picks` table `select('*')` + 6 parallel related-table queries (lifecycle, promotion history, outbox, settlements, audit, receipts) + submission lookup

| Contract Field | Tier | Status | Column / Source | Notes |
|---|---|---|---|---|
| Sport / League | T1 | **P** | `sport_id` in raw `metadata` | Raw `sport_id` UUID in `metadata` object; no join to `sports.display_name` |
| Matchup / Event | T1 | **A** | `metadata.eventName` | Returned inside `metadata` object but not extracted to top-level field |
| Selection | T1 | **R** | `picks.selection` | Mapped to `pick.selection` |
| Market | T1 | **R** | `picks.market` | Mapped to `pick.market` |
| Line | T1 | **R** | `picks.line` | Mapped to `pick.line` |
| Odds | T1 | **R** | `picks.odds` | Mapped to `pick.odds` |
| Source | T1 | **R** | `picks.source` | Mapped to `pick.source` |
| Lifecycle Status | T1 | **R** | `picks.status` | Mapped to `pick.status` |
| Capper / Submitted By | T2 | **R** | Resolved via `readSubmittedBy()` | Checks `pick.submitted_by` (not on picks table), `submission.submitted_by`, `metadata.capper`, `metadata.submittedBy`, `submissionPayload.submittedBy` |
| Event Start Time | T2 | **A** | `metadata.eventTime` | Inside metadata object, not top-level |
| Approval Status | T2 | **R** | `picks.approval_status` | Mapped to `pick.approvalStatus` |
| Stake Units | T2 | **R** | `picks.stake_units` | Mapped to `pick.stakeUnits` |
| Confidence | T2 | **A** | `picks.confidence` | Column exists but **not mapped** in `PickDetailView` type |
| Pick ID | T2 | **R** | `picks.id` | Mapped to `pick.id` |
| Created At | T2 | **R** | `picks.created_at` | Mapped to `pick.createdAt` |
| Promotion Status | T3 | **R** | `picks.promotion_status` | Mapped to `pick.promotionStatus` |
| Promotion Target | T3 | **R** | `picks.promotion_target` | Mapped to `pick.promotionTarget` |
| Promotion Score | T3 | **R** | `picks.promotion_score` | Mapped to `pick.promotionScore` |
| Settlement Result | T3 | **R** | `settlement_records.result` | Via `settlements` array |
| Settlement Date | T3 | **R** | `picks.settled_at` | Mapped to `pick.settledAt` |
| Submission ID | T3 | **R** | `picks.submission_id` | Mapped to `pick.submissionId` |
| Posted At | T3 | **R** | `picks.posted_at` | Mapped to `pick.postedAt` |

**Tier 1 compliance: 6/8** (Sport: partial, FK only; Matchup: in metadata blob, not top-level)
**Tier 2 compliance: 5/7** (Event Start Time: in metadata, not top-level; Confidence: column exists but omitted from mapped type)
**Tier 3 compliance: 7/7**

---

### 1.4 Board Queue (`/api/operator/board-queue`)

**Query:** `syndicate_board` + `pick_candidates` + `market_universe` (multi-table join)

This surface renders board candidates, not picks directly. The contract applies when a `pick_id` is linked.

| Contract Field | Tier | Status | Column / Source | Notes |
|---|---|---|---|---|
| Sport / League | T1 | **R** | `syndicate_board.sport_key` / `market_universe.sport_key` | Sport key, not display name |
| Matchup / Event | T1 | **M** | — | Not available; board rows have no event/matchup context |
| Selection | T1 | **M** | — | Not available; board rows describe market universe entries, not pick selections |
| Market | T1 | **R** | `market_universe.canonical_market_key` | |
| Line | T1 | **R** | `market_universe.current_line` | |
| Odds | T1 | **R** | `market_universe.current_over_odds` / `current_under_odds` | Over/under split, not single odds value |
| Source | T1 | **M** | — | Board candidates have no source field |
| Lifecycle Status | T1 | **M** | — | Board rows have `pick_candidates.status` (different semantics) |
| Capper / Submitted By | T2 | **M** | — | Not applicable to board candidates |
| Event Start Time | T2 | **M** | — | Not available on board/market tables |
| Approval Status | T2 | **M** | — | Not applicable to board candidates |
| Stake Units | T2 | **M** | — | Not applicable |
| Confidence | T2 | **M** | — | Not applicable |
| Pick ID | T2 | **R** | `pick_candidates.pick_id` | Only populated when candidate is written as a pick |
| Created At | T2 | **M** | — | Board rows have no created_at exposed |

**Note:** Board Queue is a pre-pick surface. Most pick identity fields are structurally N/A. When `pick_id` is linked, the route does not fetch the associated pick row to display identity fields. This is the primary gap for compliance.

**Tier 1 compliance: 3/8** (Matchup, Selection, Source, Status: missing/N/A)
**Tier 2 compliance: 1/7** (only Pick ID when linked)

---

### 1.5 Held Queue (`/api/operator/held-queue`)

**Query:** `picks` table, `select('*')`, filtered by `status=awaiting_approval OR approval_status=pending`, then filtered to held reviews

Structurally identical to Review Queue with additional hold metadata.

| Contract Field | Tier | Status | Column / Source | Notes |
|---|---|---|---|---|
| Sport / League | T1 | **P** | `sport_id` (FK) | Raw UUID; no join |
| Matchup / Event | T1 | **A** | `metadata.eventName` | In metadata JSONB, not extracted |
| Selection | T1 | **R** | `picks.selection` | |
| Market | T1 | **R** | `picks.market` | |
| Line | T1 | **R** | `picks.line` | |
| Odds | T1 | **R** | `picks.odds` | |
| Source | T1 | **R** | `picks.source` | |
| Lifecycle Status | T1 | **R** | `picks.status` | |
| Capper / Submitted By | T2 | **P** | `capper_id` (FK) | Raw UUID; no join; no metadata extraction |
| Event Start Time | T2 | **A** | `metadata.eventTime` | In metadata JSONB, not extracted |
| Approval Status | T2 | **R** | `picks.approval_status` | |
| Stake Units | T2 | **R** | `picks.stake_units` | |
| Confidence | T2 | **R** | `picks.confidence` | |
| Pick ID | T2 | **R** | `picks.id` | |
| Created At | T2 | **R** | `picks.created_at` | |

**Tier 1 compliance: 6/8** (Sport: partial; Matchup: not extracted)
**Tier 2 compliance: 5/7** (Capper: partial; Event Time: not extracted)

---

### 1.6 Exception Queues (`/api/operator/exception-queues`)

**Query:** Multiple sub-queries across `distribution_outbox`, `settlement_records`, `picks` (various filters)

This surface has 8+ sub-queues, each with different selected columns. Analyzing the pick-related sub-queues:

#### Stale Validated / Awaiting Approval Drift / Rerun Candidates

| Contract Field | Tier | Status | Column / Source | Notes |
|---|---|---|---|---|
| Sport / League | T1 | **A** | `sport_id` exists but not selected | Queries select specific columns, not `*` |
| Matchup / Event | T1 | **A** | `metadata` not selected | |
| Selection | T1 | **R** | `picks.selection` | Selected in stale/drift/rerun queries |
| Market | T1 | **R** | `picks.market` | Selected in stale/drift/rerun queries |
| Line | T1 | **A** | `picks.line` | Not selected in any exception sub-query |
| Odds | T1 | **A** | `picks.odds` | Not selected in any exception sub-query |
| Source | T1 | **R** | `picks.source` | Selected in stale/drift/rerun queries |
| Lifecycle Status | T1 | **R** | `picks.status` | Selected in all pick sub-queries |
| Capper / Submitted By | T2 | **A** | `capper_id` exists but not selected | |
| Event Start Time | T2 | **A** | `metadata.eventTime` | metadata not selected |
| Approval Status | T2 | **R** | `picks.approval_status` | Selected in rerun candidates |
| Stake Units | T2 | **A** | `picks.stake_units` | Not selected |
| Confidence | T2 | **A** | `picks.confidence` | Not selected |
| Pick ID | T2 | **R** | `picks.id` | |
| Created At | T2 | **R** | `picks.created_at` | |

#### Failed Delivery / Dead Letter (outbox rows, enriched with pick context)

Pick context is fetched separately with `select('id, market, selection, source, status')` - only 4 pick fields.

**Tier 1 compliance: 4/8** (Sport, Matchup, Line, Odds: not selected)
**Tier 2 compliance: 3/7** (Capper, Event Time, Stake, Confidence: not selected)

---

### 1.7 Picks Pipeline (`/api/operator/picks-pipeline`)

**Query:** Uses `getSnapshot()` which queries `picks` table via `select('*')`, then maps through `summarizePicksPipeline()`

The `PickPipelineRow` type explicitly maps only these fields:

| Contract Field | Tier | Status | Column / Source | Notes |
|---|---|---|---|---|
| Sport / League | T1 | **A** | `sport_id` in full row | Available in raw query but dropped during `PickPipelineRow` mapping |
| Matchup / Event | T1 | **A** | `metadata.eventName` | Available in raw row but dropped |
| Selection | T1 | **A** | `picks.selection` | Available but **not mapped** to `PickPipelineRow` |
| Market | T1 | **A** | `picks.market` | Available but **not mapped** |
| Line | T1 | **A** | `picks.line` | Available but **not mapped** |
| Odds | T1 | **A** | `picks.odds` | Available but **not mapped** |
| Source | T1 | **A** | `picks.source` | Available but **not mapped** |
| Lifecycle Status | T1 | **R** | `picks.status` | Mapped to `status` |
| Capper / Submitted By | T2 | **A** | `capper_id` in full row | Available but not mapped |
| Event Start Time | T2 | **A** | `metadata.eventTime` | Available but not mapped |
| Approval Status | T2 | **R** | `picks.approval_status` | Mapped to `approvalStatus` |
| Stake Units | T2 | **A** | `picks.stake_units` | Available but not mapped |
| Confidence | T2 | **A** | `picks.confidence` | Available but not mapped |
| Pick ID | T2 | **R** | `picks.id` | Mapped to `id` |
| Created At | T2 | **R** | `picks.created_at` | Mapped to `createdAt` |

**Tier 1 compliance: 1/8** (only Status; all betting identity fields dropped in mapping)
**Tier 2 compliance: 3/7** (only Approval Status, Pick ID, Created At)

---

### 1.8 Public API — Picks Query (`/api/picks`)

**Query:** `listByLifecycleStates()` returns full `PickRecord` (all 32 columns)

| Contract Field | Tier | Status | Column / Source | Notes |
|---|---|---|---|---|
| Sport / League | T1 | **P** | `sport_id` (FK) | Raw UUID; no join |
| Matchup / Event | T1 | **A** | `metadata.eventName` | In metadata JSONB blob |
| Selection | T1 | **R** | `picks.selection` | |
| Market | T1 | **R** | `picks.market` | |
| Line | T1 | **R** | `picks.line` | |
| Odds | T1 | **R** | `picks.odds` | |
| Source | T1 | **R** | `picks.source` | |
| Lifecycle Status | T1 | **R** | `picks.status` | |
| Capper / Submitted By | T2 | **P** | `capper_id` (FK) | Raw UUID; no join |
| Event Start Time | T2 | **A** | `metadata.eventTime` | In metadata JSONB blob |
| Approval Status | T2 | **R** | `picks.approval_status` | |
| Stake Units | T2 | **R** | `picks.stake_units` | |
| Confidence | T2 | **R** | `picks.confidence` | |
| Pick ID | T2 | **R** | `picks.id` | |
| Created At | T2 | **R** | `picks.created_at` | |

**Tier 1 compliance: 6/8** (Sport: partial; Matchup: in metadata blob)
**Tier 2 compliance: 5/7** (Capper: partial; Event Time: in metadata blob)

---

### 1.9 Public API — Picks Routes (`/api/picks/:id/*`)

**Note:** `apps/api/src/routes/picks.ts` contains only write/action endpoints (settle, review, retry, rerun, override, requeue, trace). No read-path for individual pick retrieval. The trace endpoint returns a diagnostic trace, not a pick identity view.

Not applicable for pick identity audit.

---

## 2. Gap Summary

### Most commonly missing fields across surfaces

| Field | Surfaces Missing/Partial | Gap Type |
|---|---|---|
| **Matchup / Event** | 7/8 surfaces | Available in `metadata.eventName` but not extracted |
| **Sport / League** | 6/8 surfaces (partial or missing) | `sport_id` FK exists; only pick-search resolves via view join |
| **Capper / Submitted By** | 5/8 surfaces (partial or missing) | `capper_id` FK exists; only pick-search and pick-detail resolve |
| **Event Start Time** | 8/8 surfaces | Always in metadata, never extracted to top-level |
| **Confidence** | 2/8 surfaces missing (pick-detail, picks-pipeline) | Column exists, just not mapped |

### Fields never missing when the route selects `*`

Selection, Market, Line, Odds, Source, Status, Approval Status, Stake Units, Pick ID, Created At -- these are all top-level columns on `picks` and are returned whenever `select('*')` is used.

---

## 3. Classification of Gaps

### 3.1 Fields available in `picks` table but not selected by the route

| Field | Column | Affected Surfaces |
|---|---|---|
| Confidence | `picks.confidence` | Pick Detail (omitted from `PickDetailView` mapping), Picks Pipeline (omitted from `PickPipelineRow`) |
| Selection | `picks.selection` | Picks Pipeline (omitted from `PickPipelineRow`) |
| Market | `picks.market` | Picks Pipeline (omitted from `PickPipelineRow`) |
| Line | `picks.line` | Picks Pipeline, Exception Queues (not in selected columns) |
| Odds | `picks.odds` | Picks Pipeline, Exception Queues (not in selected columns) |
| Source | `picks.source` | Picks Pipeline (omitted from `PickPipelineRow`) |
| Stake Units | `picks.stake_units` | Picks Pipeline, Exception Queues |

### 3.2 Fields in `metadata` JSONB but not extracted

| Field | Metadata Key(s) | Affected Surfaces |
|---|---|---|
| Matchup / Event | `metadata.eventName` | All surfaces except pick-search (which also does not extract it) |
| Event Start Time | `metadata.eventTime`, `metadata.eventStartTime` | All surfaces |
| Sport (fallback) | `metadata.sport` | Only pick-search extracts this as fallback |

**Note on metadata reliability:** `eventName` is set by the submitter in `SubmissionPayload.eventName` and persisted to `metadata` by the submission service. It is present for smart-form and some feed sources but may be absent for system-generated picks. `eventTime` is resolved from the `events` table during submission enrichment and is reliably present when an `eventId` is available.

### 3.3 Fields requiring FK joins

| Field | FK Column | Target Table | Target Column | Currently Joined |
|---|---|---|---|---|
| Sport display name | `picks.sport_id` | `sports` | `display_name` | Only via `picks_current_state` view (pick-search) |
| Capper display name | `picks.capper_id` | `cappers` | `display_name` | Only via `picks_current_state` view (pick-search) |
| Market type label | `picks.market_type_id` | `market_types` | `display_name` | Only via `picks_current_state` view (pick-search, not surfaced) |

**The `picks_current_state` view already joins all three FK tables.** Routes that query `picks` directly (review-queue, held-queue, pick-detail, exception-queues) could switch to using this view to get resolved display names without additional query cost.

### 3.4 Fields genuinely missing from persistence

| Field | Contract Source | Gap Description |
|---|---|---|
| Team names (for matchup) | Derived from teams/participants | No `team_name` columns on `picks`. `metadata.eventName` is the only source; when absent, matchup cannot be derived. `participant_id` FK exists but links to a participant entry, not necessarily team names in display format. |
| Player name (for player props) | Derived from metadata | `player_id` FK exists on `picks` but the column is sparsely populated. Player name typically embedded in `selection` text (e.g., "LeBron James Over 25.5 Pts") but not available as a structured field. |

---

## 4. Upstream Gaps (require write-path or enrichment changes)

| Gap | Description | Recommended Fix |
|---|---|---|
| **Team names not reliably persisted** | `metadata.eventName` is the only source of matchup/team info. When missing, the pick is unidentifiable per the contract. | Enrich at submission time: resolve `eventId` to team names from `event_participants` or external data. Store as `metadata.homeTeam` / `metadata.awayTeam`. |
| **Player name not structured** | Player identity is embedded in the `selection` string. No structured `player_name` field. | Enrich at submission time for player-prop markets: extract/resolve player name and store as `metadata.playerName`. |
| **Event start time not a top-level column** | Stored only in metadata. `CanonicalPick` has `eventStartTime` but the `picks` table does not. | Either add a `picks.event_start_time` column or standardize metadata extraction at read time. |
| **Capper name requires FK join** | `capper_id` is a UUID FK. Display name requires joining `cappers` table. | Routes should use `picks_current_state` view or add explicit joins. |

---

## 5. Updated Compliance Matrix

| Surface | Route | Tier 1 (8 fields) | Tier 2 (7 fields) | Tier 3 (7 fields) | Compliant |
|---|---|---|---|---|---|
| Review Queue | `/api/operator/review-queue` | 6/8 (75%) | 5/7 (71%) | N/A (list) | **No** |
| Pick Search | `/api/operator/pick-search` | 7/8 (88%) | 6/7 (86%) | N/A (list) | **No** |
| Pick Detail | `/api/operator/pick-detail/:id` | 6/8 (75%) | 5/7 (71%) | 7/7 (100%) | **No** |
| Board Queue | `/api/operator/board-queue` | 3/8 (38%) | 1/7 (14%) | N/A (list) | **No** |
| Held Queue | `/api/operator/held-queue` | 6/8 (75%) | 5/7 (71%) | N/A (list) | **No** |
| Exception Queues | `/api/operator/exception-queues` | 4/8 (50%) | 3/7 (43%) | N/A (list) | **No** |
| Picks Pipeline | `/api/operator/picks-pipeline` | 1/8 (13%) | 3/7 (43%) | N/A (list) | **No** |

**No surface is currently compliant with the Pick Identity Contract.**

### Closest to compliance

1. **Pick Search** (88% T1 / 86% T2) -- uses `picks_current_state` view which resolves FK joins. Only missing Matchup and Event Start Time extraction from metadata.
2. **Pick Detail** (75% T1 / 71% T2 / 100% T3) -- comprehensive but missing Sport join, Matchup extraction, Event Time extraction, and Confidence mapping.

### Furthest from compliance

1. **Picks Pipeline** (13% T1) -- maps only workflow/status fields; all betting identity fields are dropped.
2. **Board Queue** (38% T1) -- structurally different (pre-pick candidates); would need to fetch linked pick rows for identity.

---

## 6. Recommendations (prioritized)

### P0 — Quick wins (available data, just not mapped)

1. **Add `confidence` to `PickDetailView`:** The column is selected via `*` but omitted from the type mapping. One-line fix.
2. **Expand `PickPipelineRow`:** Add `selection`, `market`, `line`, `odds`, `source` to the mapped type. Data is already fetched via `select('*')` but dropped in `summarizePicksPipeline()`.
3. **Extract `eventName` from metadata** on all `select('*')` surfaces (review-queue, held-queue, pick-detail, picks-pipeline). Pattern: `(pick.metadata as Record<string, unknown>)?.eventName ?? null`.
4. **Extract `eventTime`/`eventStartTime` from metadata** on all surfaces. Same extraction pattern.

### P1 — Switch to `picks_current_state` view

5. **Review Queue, Held Queue, Pick Detail:** Switch from `picks` table to `picks_current_state` view. This immediately provides `sport_display_name`, `capper_display_name`, `market_type_display_name`, `settlement_result`, and `review_decision` without additional queries.
   - Review Queue already does a secondary `pick_reviews` query that would become unnecessary.
   - Held Queue similarly queries `pick_reviews` separately.
   - Pick Detail could use it for the primary pick fetch (settlement and review still need full history queries).

6. **Exception Queues:** For pick sub-queries (stale validated, awaiting approval drift, rerun candidates), switch to `picks_current_state` or add `sport_id`, `line`, `odds`, `metadata` to the select list.

### P2 — Upstream enrichment (write-path changes)

7. **Persist team names at submission:** When `eventId` resolves to an event with participant data, write `metadata.homeTeam` and `metadata.awayTeam` during submission enrichment.
8. **Persist structured player name:** For player-prop markets, extract player name from selection or resolve from `player_id` FK and store as `metadata.playerName`.
9. **Standardize event start time:** Consider adding `event_start_time` as a top-level column on `picks` to avoid metadata extraction at every read path.

### P3 — Board Queue special case

10. **Fetch linked pick data:** When `pick_candidates.pick_id` is non-null, fetch the associated pick row to display pick identity fields alongside board metadata. This could use `picks_current_state` view for a single query.

---

## Appendix: `picks` Table Columns (32 total)

Source: `packages/db/src/database.types.ts`

```
id, status, approval_status, source, market, selection, line, odds,
stake_units, confidence, capper_id, sport_id, market_type_id,
participant_id, player_id, metadata (JSONB), idempotency_key,
submission_id, promotion_status, promotion_target, promotion_score,
promotion_version, promotion_reason, promotion_decided_at,
promotion_decided_by, posted_at, settled_at, created_at, updated_at
```

## Appendix: `picks_current_state` View Columns

Source: `supabase/migrations/202604050007_utv2_396_picks_current_state_view.sql`

All 32 `picks` columns plus:
- `capper_display_name` (from `cappers.display_name`)
- `sport_display_name` (from `sports.display_name`)
- `market_type_display_name` (from `market_types.display_name`)
- `promotion_status_current`, `promotion_target_current`, `promotion_score_current`, `promotion_decided_at_current` (latest `pick_promotion_history`)
- `settlement_result`, `settlement_status`, `settlement_source`, `settlement_recorded_at` (latest `settlement_records`)
- `review_decision`, `review_decided_by`, `review_decided_at` (latest `pick_reviews`)

## Appendix: Metadata Keys Written at Submission

Source: `apps/api/src/submission-service.ts`, `packages/contracts/src/submission.ts`

| Key | Source | Reliability |
|---|---|---|
| `eventName` | `SubmissionPayload.eventName` | Present when submitter provides it (smart-form, some feeds) |
| `eventTime` | Resolved from `events` table via `eventId` | Present when event row exists with `starts_at` or `event_date` |
| `submittedBy` | `SubmissionPayload.submittedBy` | Present when submitter identifies themselves |
| `capper` | `SubmissionPayload.metadata.capper` | Submitter-dependent |
| `sport` | `SubmissionPayload.metadata.sport` | Submitter-dependent |
| `thesis` | `SubmissionPayload.thesis` | Optional |
| `thumbnailUrl` | Enrichment | When team logo resolved |
| `shadowMode` | System-generated | Present on shadow submissions |
| `deviggingResult` | Enrichment | When devigging succeeds |
| `kellySizing` | Enrichment | When Kelly criterion computed |
| `eventStartTime` | `SubmissionPayload.metadata.eventStartTime` | Submitter-dependent; overlaps with enriched `eventTime` |
