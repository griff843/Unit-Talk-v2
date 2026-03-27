# T2 Contract: Operator Entity & Ingest Health Surface

> Tier: T2 (read-only operator surface extension — no migrations, no write paths, no cross-package type changes)
> Contract status: **RATIFIED** (corrected 2026-03-26 — prior CLOSED status was premature; entityHealth, participant route, and HTML sections are NOT implemented in apps/operator-web as of 2026-03-26)
> Ratified: 2026-03-26 — T1 Feed Entity Resolution CLOSED (all ACs verified); T2 Discord Bot Foundation CLOSED; dependency satisfied
> Produced: 2026-03-26
> Implementation issue: UTV2-42 (lane:codex)
> Depends on: T1 Feed Entity Resolution — CLOSED (AC-1 through AC-9 all verified)
> Authority: `docs/06_status/PROGRAM_STATUS.md` wins on conflict
> Implementation owner: Codex
> T2 note: Written contract is provided here because the surface scope is non-trivial; not required by tier rules.

---

## 1. Objective

After Feed Entity Resolution closes, `events`, `participants`, and `event_participants` tables are populated by the ingestor. The `GET /api/operator/events` route exists. But the operator HTML dashboard has no sections for this data, no ingest cycle health summary, and no participant search surface.

This lane adds:
1. **Entity health signals to the operator snapshot** — counts of resolved events/players/teams
2. **HTML dashboard sections** — Upcoming Events mini-table, Entity Catalog health card
3. **`GET /api/operator/participants`** — player and team search (deferred from entity resolution lane)
4. **Ingest cycle summary in HTML dashboard** — last `ingestor.cycle` run status surfaced clearly

This is the minimum to make entity resolution data operator-visible without building a full Command Center UI.

---

## 2. Why This Lane Before Discord Bot Implementation Work

1. **Operator visibility gap is immediate.** After entity resolution closes, 10+ events and 150+ player participants exist in the DB. The HTML dashboard shows none of them. An operator running the ingestor has no visual confirmation of resolution health without querying Supabase directly.

2. **Ingest health is currently invisible in the dashboard.** `system_runs` data appears only in the Incident Triage section (failed/cancelled runs). A successful ingest cycle produces no visible signal. This is a blind spot.

3. **Participant search unblocks Smart Form UX.** `GET /api/operator/participants?type=player&q=brunson` enables future operator tooling and Smart Form autocomplete — both blocked without this surface.

4. **Scope is minimal.** All data already exists in the DB. This lane adds only read surfaces and HTML rendering — no new interfaces, no new repositories, no migrations. Codex can complete it in a single session.

---

## 3. Scope

### 3.1 Entity Health Extension to Snapshot

Extend `OperatorSnapshot` in `apps/operator-web/src/server.ts` with a new optional field:

```typescript
entityHealth?: {
  resolvedEventsCount: number;         // total rows in events WHERE external_id IS NOT NULL
  upcomingEventsCount: number;         // events within ±7 days of now
  resolvedPlayersCount: number;        // participants WHERE participant_type = 'player'
  resolvedTeamsWithExternalIdCount: number; // participants WHERE participant_type = 'team' AND external_id IS NOT NULL
  totalTeamsCount: number;             // all team participants (seeded + resolved)
  observedAt: string;
}
```

Populated by parallel DB count queries in `createOperatorSnapshotProvider().getSnapshot()`.

If the `events` and `participants` tables are empty (no entity resolution yet), all counts return 0 — no error.

### 3.2 HTML Dashboard Sections

**Upcoming Events mini-table** — new section in `renderOperatorDashboard()`:

```
## Upcoming Events (next 7 days)
| Event | Date | Sport | Teams | Player Count |
|-------|------|-------|-------|--------------|
| Knicks vs. Celtics | 2026-03-26 | nba | NYK, BOS | 18 |
```

Queries `GET /api/operator/events?windowDays=7` data already present in the snapshot provider. Does not add a new query — uses `entityHealth.upcomingEventsCount` for the summary count and a lightweight events list (up to 5 events, names and dates only).

**Entity Catalog health card** — new card in the health cards section:

```
[ Entity Catalog ]
Events resolved:  10  (7 upcoming)
Players resolved: 84
Teams with SGO ID: 8 / 124
```

**Ingest cycle summary** — new section showing most recent `ingestor.cycle` system run:

```
## Last Ingest Cycle
Status: succeeded | Failed / Cancelled
League: NBA
Started: 2026-03-26T23:15:00Z
Duration: 2.3s
```

Filter `recentRuns` (already in snapshot) by `run_type = 'ingestor.cycle'`. No new DB query.

### 3.3 `GET /api/operator/participants` Route

New route in `apps/operator-web/src/server.ts`:

**Query params:**
- `?type=player|team` (optional, default: both)
- `?sport=nba` (optional)
- `?q=<name fragment>` (optional, case-insensitive contains match)
- `?limit=N` (optional, default 20, max 100)

**Response shape:**

```typescript
interface OperatorParticipantsResponse {
  participants: Array<{
    id: string;
    displayName: string;
    participantType: string;
    sport: string | null;
    league: string | null;
    externalId: string | null;
    metadata: Record<string, unknown>;
  }>;
  total: number;
  observedAt: string;
}
```

**Behavior:**
- Returns participants ordered by `display_name ASC`
- `?q=` filter uses `ilike '%<q>%'` on `display_name`
- Read-only. No write surface.
- Falls back to empty array if no participants match — no error.

### 3.4 `OperatorSnapshotProvider.getParticipants` Extension

Add optional method to `OperatorSnapshotProvider` interface:

```typescript
getParticipants?(filter?: {
  type?: 'player' | 'team';
  sport?: string;
  q?: string;
  limit?: number;
}): Promise<OperatorParticipantsResponse>;
```

Same optional-method pattern as `getEvents`, `getPickDetail`, `getManualReview`.

---

## 4. Non-Goals

- **No write surfaces** — operator-web remains strictly read-only
- **No new migrations** — all data queried from existing tables
- **No new packages or repositories** — all queries via existing `DatabaseClient` pattern in `createOperatorSnapshotProvider()`
- **No Discord** — no bot changes in this lane
- **No auto-settlement** — no event status polling or automation
- **No pagination UI** — participant search is a JSON API; no HTML table for participants in this lane
- **No Redis or caching** — same pattern as existing routes: live query per request
- **No Smart Form changes** — autocomplete is a separate T2/T3 slice that consumes this route
- **No entity editing** — read-only throughout
- **No event status auto-transition** — events remain 'scheduled' as set by ingestor

---

## 5. Dependencies

This lane cannot open until Feed Entity Resolution is CLOSED with all ACs verified:

| Prerequisite | Required | Why |
|---|---|---|
| Migration 010 applied (events_external_id_idx, participants_external_id_idx) | Required | Entity counts return 0 without resolved rows |
| `events` table has ≥1 resolved row | Required | Upcoming Events section is meaningless otherwise |
| `participants` table has ≥1 player row | Required | Player search returns empty otherwise |
| `GET /api/operator/events` route live | Required | This lane extends that foundation, not builds from scratch |
| `pnpm verify` exits 0 at 548+ | Required | No regression allowed before opening new lane |

---

## 6. Implementation Surface

Codex touches only these files:

| File | Change |
|------|--------|
| `apps/operator-web/src/server.ts` | Add `entityHealth` to `OperatorSnapshot`; extend `createOperatorSnapshotProvider()` with entity count queries; add `GET /api/operator/participants` route; extend HTML dashboard with 3 new sections |
| `apps/operator-web/src/server.test.ts` | Tests for participant route, entity health counts, HTML sections |

**Do not touch:**
- `packages/db/src/**` — no new repository interfaces; queries via raw `client.from(...)` in operator-web
- `apps/api/**` — no API changes
- `apps/ingestor/**` — no ingestor changes
- `apps/smart-form/**` — no Smart Form changes
- `packages/domain/**` — no domain changes

---

## 7. Acceptance Criteria

| # | Criterion | Testable? |
|---|-----------|-----------|
| AC-1 | `GET /api/operator/snapshot` response includes `entityHealth` field with non-null counts after entity resolution | ✅ Unit test (in-memory with seeded events/participants) |
| AC-2 | `entityHealth.resolvedEventsCount` matches DB count of `events WHERE external_id IS NOT NULL` | ✅ Supabase MCP + snapshot response |
| AC-3 | `entityHealth.resolvedPlayersCount` matches DB count of `participants WHERE participant_type = 'player'` | ✅ Supabase MCP + snapshot response |
| AC-4 | HTML dashboard renders "Upcoming Events" section with ≥1 event row after entity resolution | ✅ HTML response check |
| AC-5 | HTML dashboard renders "Entity Catalog" health card with resolved counts | ✅ HTML response check |
| AC-6 | HTML dashboard renders "Last Ingest Cycle" section showing most recent `ingestor.cycle` run | ✅ HTML response check |
| AC-7 | `GET /api/operator/participants` returns 200 with participant list | ✅ Integration test |
| AC-8 | `GET /api/operator/participants?type=player` returns only player-type participants | ✅ Unit test |
| AC-9 | `GET /api/operator/participants?q=brunson` returns filtered results (case-insensitive) | ✅ Unit test |
| AC-10 | `GET /api/operator/participants` returns empty array gracefully when no participants exist (in-memory mode) | ✅ Unit test |
| AC-11 | `pnpm verify` exits 0; root test count ≥ (post-Feed-Entity-Resolution count) + ≥6 new | ✅ CI |
| AC-12 | Entity health counts return 0 (not error) in in-memory mode with no seeded entities | ✅ Unit test |

---

## 8. Proof Requirements (T2)

T2 does not require a formal T1 proof bundle. Close criteria:

1. `pnpm verify` exits 0 with ≥6 net-new tests
2. `GET /api/operator/snapshot` response includes `entityHealth` with counts matching live DB (confirmed via Supabase MCP or live response)
3. `GET /api/operator/participants?type=player` returns Jalen Brunson and other resolved players (live DB, after entity resolution ran)
4. HTML dashboard at `GET /` includes "Upcoming Events," "Entity Catalog," and "Last Ingest Cycle" sections — visually confirmed in browser or via response body check
5. No regression: all pre-existing operator routes continue to return 200 with valid data

---

## 9. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Entity tables empty at lane close time (entity resolution not yet run) | Low | AC-12 handles graceful empty state; HTML sections render with 0 counts rather than erroring |
| `ingestor.cycle` runs not in `recentRuns` window (only 12 rows fetched) | Low | Filter existing `recentRuns` array for `run_type = 'ingestor.cycle'` — if none present, section shows "No recent ingest cycles." |
| `ilike` participant name search is slow on large participant sets | Low | Not expected at current scale (124 teams + ~few hundred players). Add index if needed in a future lane. |
| Snapshot gets heavier with entity count queries | Low | All queries are COUNT-only (not full table scans). Parallel execution via `Promise.all` — same pattern as existing counts. |

---

## 10. Rollback

No migration to roll back. Code rollback:

1. Revert `apps/operator-web/src/server.ts` — remove `entityHealth` from snapshot, remove participant route, remove HTML sections
2. `pnpm verify` — confirm pre-lane test count passes
3. No DB cleanup required — no data was written

---

## 11. Open After This Lane

| Item | Tier | Notes |
|------|------|-------|
| Smart Form participant autocomplete | T3 | Consumes `GET /api/operator/participants` — UI slice only |
| Event status display enrichment (scheduled/live/final) | T2 | Requires event status polling — separate contract |
| CLV tracking wiring | T2 | Offer + resolved event = post-close CLV; math exists, data now exists |
| Command Center full HTML redesign | T2+ | Coordinate with product — not in this lane |
