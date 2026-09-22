# T1 Command Center Burn-In Truth Contract

**Status:** RATIFIED — 2026-04-01
**Issue:** UTV2-263
**Authority:** T1 contract. Owned by PM (A Griffin).
**Lane:** Claude (design). Codex (implementation).
**Cross-references:** `CONTROLLED_VALIDATION_PACKET.md`, `PROVIDER_DATA_DECISION_RECORD.md`, `PROGRAM_STATUS.md`

---

## Purpose

Define the minimum required Command Center and operator-truth surfaces before formal burn-in starts. This contract turns the burn-in daily checklist requirements into concrete implementation tasks that Codex can execute against.

**What this is:** A contract for the operator surfaces needed to run the controlled validation phase — daily checks, incident detection, intelligence coverage monitoring, provider health, and delivery truth.

**What this is not:** A product expansion spec, a Phase 7 feature design, or a speculative dashboard roadmap.

---

## Current State Assessment

### What already exists

The `/api/operator/snapshot` endpoint (operator-web) returns substantial data:

| Data | In snapshot | In Command Center UI |
|------|------------|---------------------|
| Pick counts by lifecycle state | ✅ `picksPipeline.counts` | ✅ Dashboard |
| Outbox counts (pending/sent/failed/dead-letter) | ✅ `counts.*` | ✅ Exceptions page |
| Worker runtime drain state | ✅ `workerRuntime` | ❌ Not surfaced |
| Ingestor health (last run, status) | ✅ `ingestorHealth` | ❌ Not surfaced |
| API quota summary | ✅ `quotaSummary` | ❌ Not surfaced |
| Entity health (events, participants) | ✅ `entityHealth` | ❌ Not surfaced |
| Recent picks with metadata | ✅ `recentPicks` | ✅ Dashboard (12 most recent) |
| Aging (stale validated/posted/processing) | ✅ `aging` | ❌ Not surfaced |
| Health signals (6 signals) | ✅ `health` | ✅ Dashboard |
| Delivery target health (canary/best-bets) | ✅ `canary`, `bestBets` | ❌ Not surfaced |
| Rollout config | ✅ `rolloutConfig` | ❌ Not surfaced |
| Performance metrics (W/L/ROI by window) | ✅ `/performance` | ✅ Performance page |
| Score quality / decision quality | ✅ `/intelligence` | ✅ Intelligence page |
| CLV% in leaderboard | ✅ `/performance` | ✅ Performance page |

### What's missing

| Gap | Needed for burn-in | Current state |
|-----|-------------------|---------------|
| **Intelligence enrichment coverage** | Daily checklist §5.1 | No surface shows % of picks with domainAnalysis, deviggingResult, kellySizing, realEdge |
| **EdgeSource distribution** | Daily checklist §5.1 | No surface shows real-edge vs confidence-delta vs sgo-edge breakdown |
| **CLV coverage rate** | Daily checklist §5.3 | CLV% shown per capper in leaderboard; no aggregate coverage indicator |
| **Provider row counts by provider_key** | Daily checklist §5.4 | Not surfaced; snapshot has ingestor health but not per-provider granularity |
| **Provider freshness (latest snapshot_at per provider)** | Daily checklist §5.4 | Not surfaced |
| **Outbox state in Command Center** | Daily checklist §5.2 | Data in snapshot; no CC page surfaces it |
| **Worker runtime in Command Center** | Daily checklist §5.2 | Data in snapshot; not surfaced |
| **Delivery metrics per target** | Daily checklist §5.2 | Partial in snapshot (`canary`, `bestBets`); not in CC |
| **Burn-in scorecard** | Controlled Validation Packet §5, §7, §8 | Entirely new surface |

---

## Required Surfaces

### Surface 1: Submission Truth

**Location:** Command Center — enhance existing Dashboard or new `/burn-in` page section.

**Data required:**

| Field | Source | Query |
|-------|--------|-------|
| Recent picks (last 24h) | `picks` | `SELECT * FROM picks WHERE created_at > now() - interval '24h' ORDER BY created_at DESC` |
| Capper | `picks.submitted_by` | Already in pick record |
| Source | `picks.source` | Already in pick record (`smart-form`, `discord-bot`, `api`) |
| Conviction / trust | `picks.metadata.promotionScores.trust` | JSON field extraction |
| Promotion status | `pick_promotion_history` | Latest row per pick: `qualified` / `not_eligible` / `suppressed` |
| Promotion target | `pick_promotion_history.promotion_target` | `best-bets` / `trader-insights` / `null` |
| Lifecycle state | `picks.status` | `validated` / `queued` / `posted` / `settled` |
| Count by state | Derived | GROUP BY `picks.status` |

**Display:** Table with columns: pick ID (linked), created_at, capper, source, market, odds, trust score, promotion status, target, lifecycle state. Sort by created_at DESC. Color-code lifecycle state.

**Implementation note:** Most data already returned in `snapshot.recentPicks` and `snapshot.picksPipeline`. The gap is surfacing promotion status and conviction/trust per pick in the CC table, and expanding beyond 12 most recent.

---

### Surface 2: Intelligence Truth

**Location:** Command Center — new section on Dashboard or dedicated `/burn-in` page.

**Data required — new endpoint: `GET /api/operator/intelligence-coverage`**

This endpoint must compute enrichment coverage across recent picks (configurable window, default 7 days).

| Metric | Computation | Pass condition (burn-in) |
|--------|------------|------------------------|
| Total picks in window | `COUNT(*) FROM picks WHERE created_at > ?` | Informational |
| Has `domainAnalysis` | `COUNT(*) WHERE metadata ? 'domainAnalysis'` | ≥50% of picks with odds |
| Has `deviggingResult` | `COUNT(*) WHERE metadata ? 'deviggingResult'` | ≥10% (depends on provider offer match rate) |
| Has `kellySizing` | `COUNT(*) WHERE metadata ? 'kellySizing'` | ≥10% |
| Has `realEdge` | `COUNT(*) WHERE metadata->'domainAnalysis' ? 'realEdge'` | ≥1 pick (proves pipeline works) |
| EdgeSource = `real-edge` | `COUNT(*) WHERE metadata->'domainAnalysis'->>'realEdgeSource' = 'pinnacle'` | ≥1 |
| EdgeSource = `consensus-edge` | `COUNT(*) WHERE metadata->'domainAnalysis'->>'realEdgeSource' = 'consensus'` | ≥0 (acceptable if no multi-book match) |
| EdgeSource = `confidence-delta` (fallback) | Remainder | Informational — high % means provider data gap |
| Has `confidenceDelta` field | `COUNT(*) WHERE metadata->'domainAnalysis' ? 'confidenceDelta'` | Only on picks created after UTV2-222/223 |
| CLV present on settled picks | `COUNT(*) FROM settlement_records WHERE payload ? 'clvRaw'` / total settled | ≥80% of picks with closing line data |

**Response shape:**

```typescript
interface IntelligenceCoverage {
  window: string;           // e.g., '7d'
  totalPicks: number;
  picksWithOdds: number;
  domainAnalysis: { count: number; rate: number };
  deviggingResult: { count: number; rate: number };
  kellySizing: { count: number; rate: number };
  realEdge: { count: number; rate: number };
  edgeSourceDistribution: {
    realEdge: number;
    consensusEdge: number;
    sgoEdge: number;
    confidenceDelta: number;
    explicit: number;
    unknown: number;
  };
  clvCoverage: {
    settledPicks: number;
    withClv: number;
    rate: number;
  };
}
```

**Display:** Card grid showing each metric with count, percentage, and pass/fail indicator against burn-in thresholds. EdgeSource distribution as a horizontal bar chart or donut.

---

### Surface 3: Delivery / Runtime Truth

**Location:** Command Center — new section on Dashboard or `/burn-in` page.

**Data source:** Already in `snapshot.counts`, `snapshot.workerRuntime`, `snapshot.aging`, `snapshot.canary`, `snapshot.bestBets`. No new endpoint needed — just surface existing snapshot data.

| Metric | Source field | Display |
|--------|-------------|---------|
| Outbox pending | `counts.pendingOutbox` | Count badge |
| Outbox processing | `counts.processingOutbox` | Count badge |
| Outbox sent | `counts.sentOutbox` | Count badge |
| Outbox failed | `counts.failedOutbox` | Count badge (red if >0) |
| Outbox dead-letter | `counts.deadLetterOutbox` | Count badge (red if >0 — kill condition) |
| Worker drain state | `workerRuntime.drainState` | `healthy` / `degraded` / `stalled` indicator |
| Latest distribution run | `workerRuntime.latestDistributionRunAt` | Timestamp + "X minutes ago" |
| Stale queued rows | `aging.staleQueued` | Count (warn if >0 after 2h) |
| Stale processing rows | `aging.staleProcessing` | Count (warn if >0 after 30min) |
| Stale validated rows | `aging.staleValidated` | Count (warn if >0 after 48h) |
| Canary: recent sent | `canary.recentSentCount` | Count |
| Canary: recent failures | `canary.recentFailureCount` | Count (red if >0) |
| Best-bets: recent sent | `bestBets.recentSentCount` | Count |
| Best-bets: recent failures | `bestBets.recentFailureCount` | Count (red if >0) |
| Simulated deliveries | `counts.simulatedDeliveries` | Count (note if simulation mode) |

**Display:** Three-column layout:
1. **Outbox state** — horizontal bar showing pending → processing → sent → failed → dead-letter
2. **Worker health** — status indicator + latest run timestamp + drain state
3. **Per-target delivery** — canary + best-bets + trader-insights sent/failed counts

**Implementation note:** This requires only UI work in Command Center — all data is already in the snapshot response.

---

### Surface 4: Provider Truth

**Location:** Command Center — new section.

**Data required — new endpoint: `GET /api/operator/provider-health`**

| Metric | Computation |
|--------|------------|
| Rows by provider_key | `SELECT provider_key, count(*) FROM provider_offers GROUP BY provider_key` |
| Rows inserted last 24h by provider | `...WHERE created_at > now() - interval '24h' GROUP BY provider_key` |
| Latest snapshot_at by provider | `SELECT provider_key, max(snapshot_at) FROM provider_offers GROUP BY provider_key` |
| SGO ingestor last run | `snapshot.ingestorHealth.lastRunAt` |
| SGO ingestor status | `snapshot.ingestorHealth.status` |
| SGO quota remaining | `snapshot.quotaSummary.providers` (filter for SGO) |
| Odds API quota remaining | `snapshot.quotaSummary.providers` (filter for Odds API) |
| Distinct events with offers (last 24h) | `SELECT count(DISTINCT provider_event_id) FROM provider_offers WHERE created_at > now() - interval '24h'` |

**Response shape:**

```typescript
interface ProviderHealth {
  providers: Array<{
    providerKey: string;
    totalRows: number;
    last24hRows: number;
    latestSnapshotAt: string | null;
    minutesSinceLastSnapshot: number | null;
    status: 'active' | 'stale' | 'absent';  // stale if >30min, absent if 0 rows
  }>;
  ingestorHealth: {
    status: string;
    lastRunAt: string | null;
  };
  quotaSummary: {
    sgo: { creditsUsed: number; creditsRemaining: number | null } | null;
    oddsApi: { creditsUsed: number; creditsRemaining: number | null } | null;
  };
  distinctEventsLast24h: number;
}
```

**Display:** Table with one row per provider: provider key, total rows, last 24h rows, latest snapshot time, status indicator (green/yellow/red). Below: ingestor status card + quota cards for SGO and Odds API.

**Stale thresholds:**
- `active`: latest snapshot_at within 30 minutes
- `stale`: latest snapshot_at 30min–6h ago
- `absent`: no rows, or latest snapshot >6h ago

---

### Surface 5: Burn-In Scorecard

**Location:** Command Center — new `/burn-in` page (or section on Dashboard).

**Purpose:** Single-page view that maps directly to the Controlled Validation Packet daily checklist. An operator should be able to complete the daily checklist by reading this page alone.

**Sections and data mapping:**

#### 5a. Entry Conditions Checklist

| Condition | Source | Auto-check |
|-----------|--------|------------|
| `pnpm verify` passes | Manual (last known) | Badge (manual set) |
| At least one capper actively submitting | `picks WHERE created_at > now() - interval '24h'` count > 0 | ✅ if count > 0 |
| SGO ingestor running | `ingestorHealth.status === 'healthy'` | ✅ / ❌ |
| Odds API data present | Provider health: `odds-api:pinnacle` rows > 0 | ✅ / ❌ |
| Worker running | `workerRuntime.drainState !== 'stalled'` | ✅ / ❌ |
| Operator snapshot accessible | Snapshot returns 200 | ✅ (implied by page loading) |
| Discord delivery confirmed | `distribution_receipts` with `status='sent'` in last 24h | ✅ / ❌ |

#### 5b. Daily Checklist Values

Map directly to Controlled Validation Packet §5:

| Checklist item | Source | Display |
|----------------|--------|---------|
| Picks submitted today | `picks WHERE created_at > today` count | Count |
| Submission events recorded | `submission_events` count today | Count |
| Domain analysis computed | Intelligence coverage: `domainAnalysis.count` today | Count + % |
| Devig result attached | Intelligence coverage: `deviggingResult.count` today | Count + % |
| Kelly sizing attached | Intelligence coverage: `kellySizing.count` today | Count + % |
| Real edge computed | Intelligence coverage: `realEdge.count` today | Count + % |
| Edge source distribution | Intelligence coverage: `edgeSourceDistribution` today | Bar chart |
| Picks promoted | `pick_promotion_history` qualified today | Count |
| Outbox rows created | `distribution_outbox` created today | Count |
| Picks delivered | `distribution_receipts` sent today | Count |
| Duplicate deliveries | `distribution_receipts` with duplicate outbox_id | 0 / N (red if >0) |
| Dead-letter rows | `counts.deadLetterOutbox` | 0 / N (red if >0) |
| Game results ingested | `game_results` created today | Count |
| Picks graded | `settlement_records` created today | Count |
| CLV populated | Settlement records with `clvRaw` today | Count + % |
| Recap posted | System runs with `run_type='recap.post'` today | Yes / No |
| Operator interventions | Audit log intervention actions today | Count |
| Alert agent ran | System runs with `run_type='alert.*'` today | Yes / No |
| Incidents today | Manual entry or derived from kill condition checks | Count + severity |

#### 5c. Section 7 Scoring (from Controlled Validation Packet §7)

Display each Section 7 gate criterion with current status indicator:

| Criterion | Status source | Auto-derivable |
|-----------|--------------|----------------|
| 7.4 Live odds from ≥2 providers | Provider health: SGO + Odds API both `active` | ✅ |
| 7.5 Automated grading + settlement | Settlement records created in last 7d | ✅ |
| 7.6 CLV tracking live | CLV coverage rate from intelligence-coverage | ✅ |
| 7.7 Recap automation | Recap system_runs in last 7d | ✅ |
| 7.9 Alert system live | Alert system_runs in last 7d | ✅ |
| 7.11 Domain math consumers wired to live data | Intelligence coverage (realEdge > 0) | ✅ |
| 7.12 `pnpm verify` green | Manual | Badge |

#### 5d. Section 8 Readiness Notes

Static text section showing the math layer proof status from the Provider Decision Record §10:

| Component | Verdict |
|-----------|---------|
| Devigging | PROVEN |
| Kelly | PARTIAL (not surfaced to members) |
| CLV | PROVEN |
| Real edge | CONDITIONAL (depends on ingest) |
| Calibration | TEST-ONLY |
| Risk engine | TEST-ONLY |
| Market signals | DEAD-CODE |

This section is informational — not auto-computed. Updated manually when evidence changes.

#### 5e. Incident Log Pointer

Link to `out/controlled-validation/incidents.md` (if it exists) or display instruction to create it. Show count of P0/P1/P2 incidents from today if an incident log endpoint is available.

---

## Implementation Specification

### New API endpoints required

| Endpoint | Method | Purpose | Implementation complexity |
|----------|--------|---------|--------------------------|
| `GET /api/operator/intelligence-coverage` | GET | Intelligence enrichment rates | Medium — new queries against picks + settlement_records |
| `GET /api/operator/provider-health` | GET | Per-provider row counts, freshness, status | Medium — aggregate queries on provider_offers |

### Existing endpoints to consume (no changes needed)

| Endpoint | Surface consuming it |
|----------|---------------------|
| `GET /api/operator/snapshot` | Delivery truth (§3), entry conditions (§5a), daily checklist partials |
| `GET /api/operator/performance` | Section 7 scoring support |
| `GET /api/operator/intelligence` | Score quality context |
| `GET /api/operator/exception-queues` | Exception counts |

### New Command Center pages/sections

| Page/Section | Components | Data sources |
|-------------|-----------|-------------|
| `/burn-in` (new page) | Entry conditions checklist, daily scorecard, Section 7/8 status | snapshot + intelligence-coverage + provider-health |
| Dashboard enhancement | Provider health card, delivery state card, worker runtime card | snapshot (existing data, new UI) |

### Implementation priority

| Priority | Component | Why |
|----------|-----------|-----|
| **P0** | `GET /api/operator/intelligence-coverage` endpoint | Cannot assess burn-in readiness without it |
| **P0** | `GET /api/operator/provider-health` endpoint | Cannot verify provider data flow without it |
| **P1** | `/burn-in` page in Command Center | Primary operator surface for daily checklist |
| **P2** | Dashboard delivery/worker/provider cards | Enhances operational awareness |

---

## Data Freshness and Caching

| Endpoint | Recommended cache | Rationale |
|----------|------------------|-----------|
| `/intelligence-coverage` | 5 min | Aggregate queries; don't need real-time |
| `/provider-health` | 2 min | Provider freshness matters for detecting stale ingest |
| `/snapshot` | 30 sec (existing) | Already cached |

---

## Done Criteria

- [ ] `GET /api/operator/intelligence-coverage` endpoint implemented and returning correct data
- [ ] `GET /api/operator/provider-health` endpoint implemented and returning correct data
- [ ] `/burn-in` page exists in Command Center with all 5 sections (entry conditions, daily checklist, Section 7, Section 8, incident pointer)
- [ ] Dashboard shows delivery state, worker runtime, and provider health from existing snapshot data
- [ ] All surfaces render correctly with real production data (not just test fixtures)
- [ ] Contract is explicitly aligned to burn-in entry conditions and daily checklist from `CONTROLLED_VALIDATION_PACKET.md`

---

## Constraints

- **Read-only surfaces only** — no write operations from these endpoints
- **No schema changes** — all data derivable from existing tables
- **No new DB tables** — aggregate queries against `picks`, `provider_offers`, `settlement_records`, `distribution_receipts`, `system_runs`, `audit_log`
- **No Phase 7 feature design** — minimum required for burn-in, nothing speculative
- **No provider-specific UI** — surfaces show canonical data, not provider-internal details

---

## Allowed Files (Codex implementation)

### Operator-web (new endpoints)
- `apps/operator-web/src/routes/intelligence-coverage.ts` (new)
- `apps/operator-web/src/routes/provider-health.ts` (new)
- `apps/operator-web/src/server.ts` (route registration)

### Command Center (new page + enhancements)
- `apps/command-center/app/burn-in/page.tsx` (new)
- `apps/command-center/app/components/` (new components for provider health, delivery state, etc.)
- `apps/command-center/app/page.tsx` (dashboard enhancements)

### Forbidden files
- `packages/contracts/` — no contract changes
- `packages/db/` — no schema changes
- `apps/api/` — no API changes
- `apps/ingestor/` — no ingestor changes
- `packages/domain/` — no domain logic changes

---

## Authority and Update Rule

This document is T1. Surfaces may be added but existing surfaces must not be removed without PM approval. The intelligence-coverage and provider-health endpoint contracts are binding — implementations must return at minimum the fields specified in the response shapes above.
