# T1 Contract: Feed Entity Resolution — Events & Participants Foundation

> Tier: T1 (new migration, new ingestor write path to canonical tables, new operator read surface)
> Contract status: **CLOSED — FEED_ENTITY_RESOLUTION_CLOSED** (2026-03-26)
> Produced: 2026-03-26
> Ratified: 2026-03-26 — T1 Provider Ingestion + Smart Form V1 closed; schema audit complete; all T1 requirements met
> Closed: 2026-03-26 — 581/581 tests, resolvedEventsCount=10, resolvedParticipantsCount=65, runId=cf46240d-5094-41a6-8bfc-4bd12748ab9b. Idempotency confirmed. Sentinel fix applied. 0 bogus rows.
> Implementation note: §9 `listUpcoming(sportId?, windowDays?)` is the authoritative signature — supersedes §5 which shows only one parameter
> Supersedes: none
> Depends on: T1 Provider Ingestion — SGO Primary (CLOSED), migration 009 live, `provider_offers` populated
> Authority: `docs/06_status/PROGRAM_STATUS.md` wins on conflict

---

## 1. Objective

This contract authorizes and defines the Feed Entity Resolution slice. The slice closes the link between raw SGO odds data and the canonical entity model: after the ingestor runs, canonical `events`, `participants`, and `event_participants` rows must exist for every entity present in `provider_offers`. Operator surfaces and future pick submissions can then reference real event names and player names rather than opaque external ID strings.

**The specific gap being closed:**

The SGO ingestor currently stores 600+ `provider_offers` rows with fields like:
```
provider_event_id = "NBA_20260326_NYK_BOS"
provider_participant_id = "JALEN_BRUNSON_1_NBA"
```

These strings are not resolved to canonical DB rows. `events` is empty. `participants` has 124 team rows (all with `external_id` in V2 `team:SPORT:Name` format) but 0 player rows. `listEvents()` and `searchPlayers()` return `[]`. Smart Form submissions for player props cannot reference resolved players. The operator cannot see "Knicks vs. Celtics, March 26" — only raw SGO IDs.

This lane fixes all of that without requiring new tables. The schema already has everything needed.

---

## 2. Why This Lane Before Command Center UI Work

The argument for doing this before any operator UI investment:

1. **Data must exist before surfaces can be meaningful.** An operator route for events that queries an empty `events` table returns nothing. Building a UI surface before the data foundation is building a window that looks out onto nothing.

2. **Smart Form player props are blocked.** `picks.participant_id` is a FK to `participants`. A Smart Form submission for "Jalen Brunson assists over 7.5" needs a resolved `participants.id` for Brunson. Without entity resolution, player prop submissions cannot be accurately linked — the pick is either submitted with a null/wrong participant or blocked at validation.

3. **`provider_offers` is currently an island.** 600+ rows exist with no join path to canonical entity data. The domain analytics and CLV computation layers that should consume offer data cannot function until offers can be enriched with resolved event/participant context.

4. **Every downstream lane is unblocked by this one.** Discord embed quality (event names, headshot URLs), auto-grading triggers (which game settled?), CLV tracking (which line was it at game time?), and operator recap enrichment — all require resolved entities. This is the infrastructure unlock for multiple future slices.

5. **The cost of doing it later is compounding.** Every `provider_offers` row written without a resolved entity reference is a row that will require backfill or reprocessing later. Building entity resolution now, while the ingestor is the only producer, is the low-cost moment.

---

## 3. Scope

The following are in scope for this contract:

1. **Migration 010** — unique partial indexes on `events.external_id` and `participants.external_id` (WHERE NOT NULL). Enables idempotent upsert-by-external-id. No new columns, no new tables.

2. **SGO event extraction** — extend `sgo-fetcher.ts` to also extract event metadata (`eventID`, `leagueID`, `info.startTime`, `teams`) from the SGO `/v2/events` response. Currently these fields are ignored.

3. **SGO player extraction** — extend `sgo-fetcher.ts` to extract player metadata (`players` field) from the SGO event response.

4. **Entity resolver** — new module `apps/ingestor/src/entity-resolver.ts` implementing:
   - `resolveEvent(sgoEvent)` → upsert canonical `events` row keyed on `external_id = provider_event_id`
   - `resolveParticipant(sgoPlayer)` → upsert canonical `participants` row keyed on `external_id = provider_participant_id`
   - `resolveEventParticipants(eventId, playerIds)` → upsert `event_participants` join rows

5. **`EventRepository` interface** — in `packages/db/src/repositories.ts`:
   - `upsertByExternalId(event: EventUpsertInput): Promise<EventRow>`
   - `findByExternalId(externalId: string): Promise<EventRow | null>`
   - `listUpcoming(sportId?: string): Promise<EventRow[]>`

6. **`EventParticipantRepository` interface** — in `packages/db/src/repositories.ts`:
   - `upsert(input: EventParticipantUpsertInput): Promise<EventParticipantRow>`

7. **`InMemory*` implementations** — for both new repositories, for tests.

8. **`Database*` implementations** — for both new repositories, using live Supabase.

9. **`ParticipantRepository` extensions** — add `upsertByExternalId` and `findByExternalId` to the existing participant repository interface and both implementations.

10. **`listEvents()` implementation** — replace the no-op in `DatabaseReferenceDataRepository` with a real query to the `events` table, returning events with their participant list joined.

11. **`searchPlayers()` implementation** — replace the no-op in `DatabaseReferenceDataRepository` with a real query to `participants WHERE participant_type = 'player'`.

12. **Ingestor wiring** — extend `ingest-league.ts` to call entity resolution after fetching odds, before storing offers. Entity resolution output (resolved event IDs) is included in the cycle result.

13. **Enrichment metadata convention** — establish and document the canonical keys for `metadata` jsonb on `participants` and `events`:
    - `participants.metadata.headshot_url` — string | null, direct URL to player headshot image
    - `participants.metadata.position` — string | null, player position (PG, SG, SF, PF, C, etc.)
    - `participants.metadata.jersey_number` — string | null
    - `events.metadata.venue` — string | null, venue name
    - `events.metadata.broadcast` — string | null, broadcast network

    Keys are established now. Actual values are populated when available from SGO response `info` fields. This contract does NOT add a CDN, image fetching pipeline, or manual enrichment UI — just the key convention so future lanes use consistent field names.

14. **Operator read surface** — new route `GET /api/operator/events` in `apps/operator-web/src/server.ts`:
    - Returns resolved events with: `id`, `event_name`, `event_date`, `status`, `sport_id`, `external_id`, and linked participants (name, external_id, participant_type, metadata)
    - Read-only. No write surface on operator-web.
    - Filters to upcoming and recent events (within ±7 days of today) by default

15. **Tests** — ≥8 net-new tests:
    - Entity resolver: idempotent event upsert (duplicate external_id produces one row)
    - Entity resolver: idempotent participant upsert
    - Entity resolver: event_participants link correctness
    - `listEvents()` returns resolved rows
    - `searchPlayers()` returns player-type participants
    - `GET /api/operator/events` returns enriched event list
    - Entity resolution cycle result includes `resolvedEventsCount`, `resolvedParticipantsCount`

16. **Ingest cycle result extension** — add `resolvedEventsCount` and `resolvedParticipantsCount` to the cycle result output so the proof run can verify resolution happened.

---

## 4. Non-Goals

The following are explicitly out of scope:

- **Auto-settlement or auto-grading** — no event result lookup, no settlement trigger. Settlement remains operator-initiated.
- **Redis or caching** — no caching layer. Operator route queries live DB on every request, same as existing snapshot routes.
- **Discord implementation** — no bot commands, no embed changes in this lane.
- **OddsAPI or second provider** — SGO only. Entity resolution patterns established here will be reused for second provider but that is a separate slice.
- **Image CDN or headshot fetching pipeline** — `headshot_url` key is established in this contract; actual headshot URLs must be populated by future enrichment lanes or manual data entry. No image fetching or CDN is built here.
- **CLV tracking wiring** — offer data + resolved events is a prerequisite for CLV; the CLV consumption slice is a separate T2 lane.
- **Temporal integration** — not required for this slice.
- **Capper identity resolution** — linking Discord user IDs or Smart Form cappers to `cappers` rows is a separate T1 concern.
- **Participant membership tracking** — `participant_memberships` table exists; populating team rosters from feed is deferred.
- **Global slug or SEO-friendly IDs for events/participants** — not required for V1.
- **Event status automation** — `events.status` is set to 'scheduled' at creation time. Auto-transition to 'in_progress' or 'final' is a separate slice (requires polling or webhook, not in scope here).
- **Backfilling existing `provider_offers` rows** — rows written before this lane opens already have `provider_event_id` and `provider_participant_id`. A future maintenance script can create canonical rows retroactively; this is not a blocker for lane closure.

---

## 5. Current Schema Truth (Relevant Subset)

### What exists and is live

| Table | Relevant columns | State | Notes |
|-------|-----------------|-------|-------|
| `events` | id, sport_id, event_name, event_date, status, external_id (nullable), metadata | 0 rows | No unique index on external_id |
| `participants` | id, display_name, participant_type, external_id (nullable), sport, league, metadata | 124 rows (teams only) | **All 124 rows have non-null external_id in `team:SPORT:Name` format** (e.g., `team:NBA:Celtics`) — seeded with this format in migration 008. Zero rows have `external_id IS NULL`. No unique index on external_id. |
| `event_participants` | id, event_id, participant_id, role | 0 rows | `unique(event_id, participant_id)` exists |
| `provider_offers` | provider_event_id (text), provider_participant_id (text nullable) | 600+ rows | No FK to events or participants — raw strings only |
| `sports` | id, display_name | 9 rows | Seeded; `id` values are **uppercase** (`NBA`, `NFL`, `MLB`, `NHL`, `NCAAB`, etc.) — SGO `leagueID` maps directly with no case transformation |

### What is incomplete

| Surface | Current state | This lane |
|---------|--------------|-----------|
| `DatabaseReferenceDataRepository.listEvents()` | Returns `[]` — no-op | Implement real query |
| `DatabaseReferenceDataRepository.searchPlayers()` | Returns `[]` — no-op | Implement real query |
| `events.external_id` uniqueness | Nullable, no unique index | Migration 010 adds unique partial index |
| `participants.external_id` uniqueness | Nullable, no unique index | Migration 010 adds unique partial index |
| Ingestor entity resolution | Not implemented | New `entity-resolver.ts` module |

### What does NOT need to change

The `provider_offers` schema is correct as-is. The `provider_event_id` and `provider_participant_id` columns serve as the resolution keys — the ingestor reads them to find/create canonical rows. No new columns on `provider_offers`.

---

## 6. Entity Resolution Model

### 6.1 Event Resolution

```
SGO Event { eventID: "NBA_20260326_NYK_BOS", leagueID: "NBA", info: { startTime: "..." } }
                    ↓ resolveEvent()
events row:
  external_id = "NBA_20260326_NYK_BOS"   ← resolution key
  sport_id    = "NBA"                     ← mapped from leagueID → sports.id directly (no case transformation; sports.id is uppercase in DB)
  event_name  = "Knicks vs. Celtics"      ← derived from teams data or info
  event_date  = "2026-03-26"              ← parsed from info.startTime
  status      = 'scheduled'              ← initial status; auto-transition deferred
  metadata    = { venue: "...", broadcast: "..." }
```

Resolution is idempotent: `INSERT ... ON CONFLICT (external_id) DO UPDATE`. If external_id already exists, update `event_name`, `event_date`, and `metadata` only — never change `status` if it has already been set beyond 'scheduled'.

### 6.2 Participant (Player) Resolution

```
SGO Player { id: "JALEN_BRUNSON_1_NBA", name: "Jalen Brunson", teamId: "NYK", position: "PG" }
                    ↓ resolveParticipant()
participants row:
  external_id      = "JALEN_BRUNSON_1_NBA"   ← resolution key
  display_name     = "Jalen Brunson"          ← from SGO player.name (preferred) or derived from ID
  participant_type = 'player'
  sport            = 'NBA'                    ← from context (uppercase, matching sports.id)
  league           = 'NBA'
  metadata         = { headshot_url: null, position: "PG", jersey_number: null }
```

If the SGO API does not provide a structured `players` array for an event, player participants are created from `provider_participant_id` values in `provider_offers` for that event using the ID derivation fallback:
- `"JALEN_BRUNSON_1_NBA"` → strip trailing sport/number segments → `"JALEN BRUNSON"` → title-case → `"Jalen Brunson"`

This is a lossy derivation. `display_name` will be overwritten on the next ingest cycle if the SGO API provides a structured name. It is a valid bootstrap — future enrichment lanes correct it.

### 6.3 Team Resolution

**Amendment (2026-03-26 — live DB truth):** The team resolution strategy in this section was based on a false assumption. The 124 seeded team rows in `participants` were created with non-null external_ids in `team:SPORT:Name` format (e.g., `'team:NBA:Celtics'`). There are zero team rows with `external_id IS NULL`. The original strategy of "fuzzy match by display_name, set external_id if null" is invalid because there are no null slots to fill.

**Corrected approach for this lane: team event_participant linking is deferred.**

The ingestor does NOT attempt to link SGO team IDs to existing seeded team rows. Reasons:
1. Seeded team rows already have V2-format external_ids (`team:NBA:Name`) — overwriting them with SGO format (`CHARLOTTE_HORNETS_NBA`) would corrupt the V2 canonical key
2. Creating duplicate team participant rows (one V2-seeded, one SGO-resolved) is a future enrichment concern — not this lane
3. Team external_id backfill was always "best-effort, not a hard requirement" — it is now explicitly deferred

**What this lane resolves instead:**
- Events → `events` rows (event_date, event_name derived from teams, sport_id, external_id)
- Players → `participants` rows with `participant_type = 'player'` and `external_id = SGO playerID`
- Player-to-event links → `event_participants` rows with `role = 'competitor'`
- Home/away team metadata → stored in `events.metadata.home_team_external_id` and `events.metadata.away_team_external_id` for future enrichment use

The team participant rows (seeded) must not be mutated by the ingestor in this lane.

### 6.4 Event Participant Linking

After resolving an event and its players:
```
event_participants row:
  event_id       = resolved events.id
  participant_id = resolved participants.id
  role           = 'competitor'           ← for individual players (participant_type='player')
              OR = 'home' / 'away'        ← for team participants
```

Valid roles per `packages/db/src/schema.ts`: `['home', 'away', 'competitor']`. The value `'player'` is NOT a valid `EventParticipantRole` — do not use it.

`unique(event_id, participant_id)` enforces idempotency. `INSERT ... ON CONFLICT DO NOTHING` is the correct upsert behavior — no data to update on the join row.

---

## 7. SGO API Field Mapping

**Field discovery completed 2026-03-26.** The following mappings are confirmed from live SGO `/v2/events?leagueID=NBA` response inspection.

### 7.1 Confirmed Event Structure

Top-level event keys: `eventID, sportID, leagueID, type, teams, status, info, links, odds, players, results`

| SGO Field | Type | Maps To | Notes |
|-----------|------|---------|-------|
| `ev.eventID` | string | `events.external_id` | Opaque ID (e.g., `"bIUrzoAFiGovbutrHC2e"`), NOT human-readable — contract §6.1 example was illustrative only |
| `ev.leagueID` | string | `events.sport_id` | e.g., `"NBA"` → `"NBA"` — **no case transformation**; `sports.id` is uppercase in DB (confirmed migration 008); inserting lowercase causes `events_sport_id_fkey` FK violation |
| `ev.status.startsAt` | ISO string | `events.event_date` | NOT `info.startTime` — start time is in `ev.status.startsAt` |
| `ev.teams.home.teamID` | string | home team external_id | e.g., `"CHARLOTTE_HORNETS_NBA"` |
| `ev.teams.away.teamID` | string | away team external_id | e.g., `"NEW_YORK_KNICKS_NBA"` |
| `ev.teams.home.names.long` | string | home team display_name | e.g., `"Charlotte Hornets"` |
| `ev.teams.away.names.long` | string | away team display_name | e.g., `"New York Knicks"` |
| `ev.teams.home.names.short` | string | `participants.metadata.abbreviation` | e.g., `"CHA"` |
| `ev.teams.home.names.location` | string | `participants.metadata.city` | e.g., `"Charlotte"` |
| `ev.info.venue.name` | string | `events.metadata.venue` | e.g., `"Spectrum Center"` |

**event_name derivation** — no single name field exists; derive as:
```typescript
`${ev.teams.away.names.long} vs. ${ev.teams.home.names.long}`
// e.g., "New York Knicks vs. Charlotte Hornets"
```

### 7.2 Confirmed Player Structure

`ev.players` is a **plain object keyed by playerID** (not an array):
```typescript
ev.players = {
  "JALEN_BRUNSON_1_NBA": {
    playerID: "JALEN_BRUNSON_1_NBA",   // → participants.external_id
    teamID:   "NEW_YORK_KNICKS_NBA",   // → metadata.team_external_id
    firstName: "Jalen",
    lastName:  "Brunson",
    name:      "Jalen Brunson"         // → participants.display_name
  },
  ...
}
```

| SGO Field | Maps To | Notes |
|-----------|---------|-------|
| `player.playerID` | `participants.external_id` | Resolution key |
| `player.name` | `participants.display_name` | Preferred over ID derivation when present |
| `player.teamID` | `participants.metadata.team_external_id` | Links player to team |
| `player.firstName` + `player.lastName` | fallback for `display_name` | Use `player.name` first |

**`position` is NOT available** in SGO player data — set `metadata.position = null`. The contract §11 noted "from SGO if available" — it is not. Position backfill is deferred.

**Iterating players:**
```typescript
for (const [playerID, player] of Object.entries(ev.players ?? {})) {
  // player.playerID === playerID
}
```

### 7.3 Team Data — Deferred

**Amendment (2026-03-26):** Team external_id backfill is deferred from this lane. See §6.3 amendment.

The `ev.teams.home` / `ev.teams.away` fields contain useful metadata that IS used for two purposes:
1. **`event_name` derivation**: `${ev.teams.away.names.long} vs. ${ev.teams.home.names.long}` — still required
2. **`events.metadata`**: store `home_team_external_id` and `away_team_external_id` for future enrichment

The ingestor does NOT attempt to create or update `participants` rows for teams. Do not call `upsertByExternalId` with SGO team IDs in this lane.

### 7.4 Status Initial Value

Use `'scheduled'` as the initial `events.status`. SGO's `ev.status.started`, `ev.status.completed`, and `ev.status.cancelled` booleans exist but auto-transition is out of scope (§4).

---

## 8. Migration 010

```sql
-- Migration 010: Entity resolution indexes
-- Enables idempotent upsert-by-external-id for events and participants.
-- No new tables. No new columns. Index-only migration.

-- Unique partial index: events resolved from feed data
CREATE UNIQUE INDEX IF NOT EXISTS events_external_id_idx
  ON events (external_id)
  WHERE external_id IS NOT NULL;

-- Unique partial index: participants resolved from feed data
CREATE UNIQUE INDEX IF NOT EXISTS participants_external_id_idx
  ON participants (external_id)
  WHERE external_id IS NOT NULL;
```

This migration has zero risk:
- Adds indexes only — no data mutations, no column changes
- Partial (WHERE IS NOT NULL) — the 124 seeded team rows have `external_id` in `team:SPORT:Name` format (non-null); they are already indexed by this partial index with their existing external_ids; no collision with future SGO-format IDs
- Rollback is index drop — instant, no data loss

After applying this migration, `pnpm supabase:types` does NOT need to be re-run — index additions do not change generated TypeScript types. `database.types.ts` remains unchanged.

---

## 9. Repository Interfaces

### EventRepository (new)

```typescript
export interface EventUpsertInput {
  externalId: string;
  sportId: string;
  eventName: string;
  eventDate: string;        // ISO date string
  status: EventStatus;
  metadata: Record<string, unknown>;
}

export interface EventRepository {
  upsertByExternalId(input: EventUpsertInput): Promise<EventRow>;
  findByExternalId(externalId: string): Promise<EventRow | null>;
  listUpcoming(sportId?: string, windowDays?: number): Promise<EventRow[]>;
}
```

### EventParticipantRepository (new)

```typescript
export interface EventParticipantUpsertInput {
  eventId: string;
  participantId: string;
  role: EventParticipantRole;
}

export interface EventParticipantRepository {
  upsert(input: EventParticipantUpsertInput): Promise<EventParticipantRow>;
  listByEvent(eventId: string): Promise<EventParticipantRow[]>;
}
```

### ParticipantRepository extensions (existing interface)

Add to the existing `ParticipantRepository` interface:
```typescript
  upsertByExternalId(input: ParticipantUpsertInput): Promise<ParticipantRow>;
  findByExternalId(externalId: string): Promise<ParticipantRow | null>;
  listByType(participantType: ParticipantType, sport?: string): Promise<ParticipantRow[]>;
```

### IngestorRepositoryBundle extension

```typescript
export interface IngestorRepositoryBundle {
  providerOffers: ProviderOfferRepository;
  systemRuns: SystemRunRepository;
  events: EventRepository;          // NEW
  eventParticipants: EventParticipantRepository;  // NEW
  participants: ParticipantRepository;            // NEW — existing interface, new slot
}
```

---

## 10. Ingest Cycle Result Extension

The cycle result JSON currently includes:
```json
{
  "league": "NBA",
  "status": "succeeded",
  "eventsCount": 10,
  "pairedCount": 618,
  "normalizedCount": 618,
  "insertedCount": 618,
  "updatedCount": 0,
  "skippedCount": 0,
  "runId": "..."
}
```

After this lane, the result includes:
```json
{
  "league": "NBA",
  "status": "succeeded",
  "eventsCount": 10,
  "pairedCount": 618,
  "normalizedCount": 618,
  "insertedCount": 618,
  "updatedCount": 0,
  "skippedCount": 0,
  "resolvedEventsCount": 10,
  "resolvedParticipantsCount": 84,
  "runId": "..."
}
```

`resolvedEventsCount` and `resolvedParticipantsCount` are required proof fields.

---

## 11. Enrichment Metadata Convention

Established by this contract. Canonical keys for `metadata` jsonb:

### `participants.metadata` (player rows)

| Key | Type | Description | When populated |
|-----|------|-------------|----------------|
| `headshot_url` | `string \| null` | Direct URL to player headshot image | Future enrichment lane |
| `position` | `string \| null` | Player position (PG, SG, SF, PF, C, QB, WR…) | This lane (from SGO if available) |
| `jersey_number` | `string \| null` | Jersey number as string | Future enrichment lane |
| `team_external_id` | `string \| null` | SGO team ID the player was on at resolution time | This lane (from SGO) |

### `participants.metadata` (team rows)

| Key | Type | Description | When populated |
|-----|------|-------------|----------------|
| `logo_url` | `string \| null` | Direct URL to team logo | Future enrichment lane |
| `abbreviation` | `string \| null` | Three-letter team abbreviation (NYK, BOS…) | This lane (if SGO provides) |
| `city` | `string \| null` | City name | This lane (if SGO provides) |

### `events.metadata`

| Key | Type | Description | When populated |
|-----|------|-------------|----------------|
| `venue` | `string \| null` | Venue/arena name | This lane (from SGO info if available) |
| `broadcast` | `string \| null` | Broadcast network | Future enrichment lane |
| `home_team_external_id` | `string \| null` | SGO team ID for home team | This lane |
| `away_team_external_id` | `string \| null` | SGO team ID for away team | This lane |

**Rule:** All keys listed here are optional within the jsonb — the metadata object is never required to contain all keys. Missing keys are treated as null by consumers. Keys not listed here must not be added by this lane without an amendment to this contract.

---

## 12. Operator Read Surface

### `GET /api/operator/events`

New route in `apps/operator-web/src/server.ts`.

**Response shape:**

```typescript
interface EnrichedEventSummary {
  id: string;
  externalId: string | null;
  eventName: string;
  eventDate: string;
  status: EventStatus;
  sportId: string;
  participants: {
    participantId: string;
    externalId: string | null;
    displayName: string;
    participantType: ParticipantType;
    role: EventParticipantRole;
    metadata: Record<string, unknown>;
  }[];
}

interface OperatorEventsResponse {
  events: EnrichedEventSummary[];
  windowDays: number;
  observedAt: string;
}
```

**Behavior:**
- Default window: ±7 days from today (configurable via `?windowDays=N` query param, max 30)
- Returns events in ascending `event_date` order
- Includes all resolved participants per event
- Falls back to empty array if `events` table is empty (no error)
- Read-only. No write surface.

**Implementation note:** Uses `createOperatorSnapshotProvider()` pattern — receives repository bundle, queries `EventRepository.listUpcoming()` + `EventParticipantRepository.listByEvent()`, assembles response. Pure function, testable without live DB.

---

## 13. Single-Writer Discipline

This lane extends the ingestor's write authority to include canonical entity tables. This is bounded by the following rules:

| Table | Writer | Rule |
|-------|--------|------|
| `events` | `apps/ingestor` | Ingestor only creates/updates events resolved from feed data (external_id IS NOT NULL). Manually created events (external_id IS NULL) are never touched by the ingestor. |
| `participants` | `apps/ingestor` | Ingestor creates player participants resolved from feed data (`participant_type = 'player'`, `external_id = SGO playerID`). The 124 seeded team rows (which have `external_id` in `team:SPORT:Name` format) are **never touched by the ingestor** — team resolution is deferred (§6.3 amendment). |
| `event_participants` | `apps/ingestor` | Join rows only. INSERT ... ON CONFLICT DO NOTHING. |
| `provider_offers` | `apps/ingestor` | Unchanged from Provider Ingestion lane. |
| `picks`, `submissions`, `settlement_records`, `audit_log` | `apps/api` | Unchanged. Ingestor never writes these. |

The ingestor's write authority is strictly scoped to ingestion artifacts (`provider_offers`) and feed-resolved reference data (events/participants with external_ids). It does NOT write picks, submissions, settlements, or any lifecycle data.

---

## 14. Implementation Surface

Codex touches only these files:

| File | Change |
|------|--------|
| `supabase/migrations/202603200010_entity_resolution_indexes.sql` | NEW — unique partial indexes |
| `apps/ingestor/src/sgo-fetcher.ts` | Extend to also extract event metadata and player list from SGO response |
| `apps/ingestor/src/entity-resolver.ts` | NEW — resolveEvent, resolveParticipant, resolveEventParticipants |
| `apps/ingestor/src/ingest-league.ts` | Wire entity resolver after odds fetch; add resolvedEventsCount/resolvedParticipantsCount to result |
| `apps/ingestor/src/ingestor.test.ts` | Tests for entity resolution idempotency and cycle result fields |
| `packages/db/src/repositories.ts` | Add EventRepository, EventParticipantRepository interfaces; extend ParticipantRepository |
| `packages/db/src/runtime-repositories.ts` | Add InMemory* and Database* implementations for new repositories; extend DatabaseReferenceDataRepository |
| `apps/operator-web/src/server.ts` | Add GET /api/operator/events route |
| `apps/operator-web/src/server.test.ts` | Tests for new events route |

**Do not touch:**
- `apps/api/**` — no API changes in this lane
- `apps/smart-form/**` — no Smart Form changes
- `packages/domain/**` — no domain changes
- `apps/worker/**` — no worker changes
- `packages/db/src/database.types.ts` — migration 010 adds only indexes; no type regeneration needed
- `packages/db/src/schema.ts` — no new enum values in this lane

---

## 15. Acceptance Criteria

All of the following must be satisfied before implementation is complete:

| # | Criterion | Testable? |
|---|-----------|-----------|
| AC-1 | Migration 010 applied: `events_external_id_idx` and `participants_external_id_idx` exist in live DB | ✅ Supabase MCP query |
| AC-2 | After NBA ingest cycle: `events` table has ≥1 row with `external_id` matching a `provider_offers.provider_event_id` | ✅ Supabase MCP |
| AC-3 | After NBA ingest cycle: `participants` table has ≥1 player row (`participant_type='player'`) with `external_id` matching a `provider_offers.provider_participant_id` | ✅ Supabase MCP |
| AC-4 | After NBA ingest cycle: `event_participants` table has rows linking resolved events to resolved players | ✅ Supabase MCP |
| AC-5 | `resolvedEventsCount` and `resolvedParticipantsCount` appear in cycle result JSON, both > 0 | ✅ Ingest run output |
| AC-6 | Entity resolution is idempotent: second ingest cycle produces no new rows for same external_ids | ✅ Ingest run + DB count |
| AC-7 | `DatabaseReferenceDataRepository.listEvents()` returns resolved event rows (not empty array) | ✅ Unit test + DB query |
| AC-8 | `DatabaseReferenceDataRepository.searchPlayers()` returns resolved player rows (not empty array) | ✅ Unit test + DB query |
| AC-9 | `GET /api/operator/events` returns enriched event list with participant names and external IDs | ✅ Integration test |
| AC-10 | `GET /api/operator/events` returns empty array gracefully when no events are resolved (in-memory mode) | ✅ Unit test |
| AC-11 | Seeded team rows are unaffected: `SELECT count(*) FROM participants WHERE participant_type = 'team'` returns the same count before and after ingestor runs; no seeded team row was deleted or mutated | ✅ Count check — note: all 124 seeded rows have non-null external_id (`team:SPORT:Name` format); the query `WHERE external_id IS NULL` will return 0, which is correct |
| AC-12 | `pnpm verify` exits 0; root test count ≥548 (no regression); Smart Form package test count unchanged | ✅ CI |
| AC-13 | `pnpm --filter @unit-talk/discord-bot build` still passes (no accidental dependency added to discord-bot) | ✅ Build |

---

## 16. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| SGO `teams` / `players` fields have different structure than expected | Medium | Contract §7 explicitly requires field-name discovery before mapping. Use same diagnostic approach as odds normalizer fix. |
| SGO may not return structured player data for all events | Medium | ID-derivation fallback (§6.2) handles absent player data gracefully. Players missing from SGO response are created from `provider_participant_id` strings with derived names. |
| Team name fuzzy matching produces false matches | Medium | Fuzzy match is best-effort and logged. Unmatched teams are skipped with a warning — they do not block the lane close. |
| Unique index migration fails due to existing duplicate external_ids | Low | The 124 seeded team rows have `external_id` in `team:SPORT:Name` format — all unique. No SGO-format external_ids exist yet. The partial index applies to all non-null external_ids (including the seeded `team:SPORT:Name` rows) — no duplicates present, index applies cleanly. |
| `events` table empty → `GET /api/operator/events` returns empty array in production | Low | Expected initial state. Returns empty array with 200 OK — not an error. Documentation note: run ingestor first. |
| Ingestor write time increases per cycle | Low | Entity resolution adds DB upserts per cycle. Expected ~100ms additional latency for a 10-event NBA cycle. Acceptable. |
| display_name derived from ID is wrong (e.g., "Karlanthony Towns" vs "Karl-Anthony Towns") | Low | Derivation is a bootstrap. Future enrichment lanes correct it. `display_name` is never used for identity — only for display. Resolution key is `external_id`, not name. |

---

## 17. Proof Requirements (T1)

Before Claude marks this sprint CLOSED, the following must be demonstrated:

1. **`pnpm verify` exits 0** with root test count ≥548 and ≥8 new tests passing
2. **Migration 010 applied**: query `information_schema.indexes WHERE table_name = 'events' AND index_name = 'events_external_id_idx'` returns a row — confirmed via Supabase MCP
3. **Live NBA ingest with entity resolution**:
   - Run: `UNIT_TALK_INGESTOR_AUTORUN=true UNIT_TALK_INGESTOR_MAX_CYCLES=1 UNIT_TALK_INGESTOR_LEAGUES=NBA npx tsx apps/ingestor/src/index.ts`
   - Capture: `resolvedEventsCount > 0` and `resolvedParticipantsCount > 0` in output
4. **Events in DB**: `SELECT id, event_name, external_id, event_date FROM events ORDER BY created_at DESC LIMIT 5` — returns rows with real event names — confirmed via Supabase MCP
5. **Players in DB**: `SELECT id, display_name, external_id, participant_type FROM participants WHERE participant_type = 'player' LIMIT 5` — returns rows with `participant_type = 'player'` — confirmed via Supabase MCP
6. **Event participants linked**: `SELECT ep.*, e.event_name, p.display_name FROM event_participants ep JOIN events e ON e.id = ep.event_id JOIN participants p ON p.id = ep.participant_id LIMIT 5` — returns linked rows — confirmed via Supabase MCP
7. **Idempotency**: second NBA ingest cycle shows `resolvedEventsCount` matching first run but no new rows in `events` table — confirmed via count check
8. **Operator route**: `GET /api/operator/events` returns non-empty JSON with event names and participants (requires live operator-web running against live DB)
9. **Existing team rows preserved**: `SELECT count(*) FROM participants WHERE participant_type = 'team'` — total team count unchanged; no seeded team row was deleted. Note: `WHERE external_id IS NULL` will return 0 — this is correct, not a failure; all 124 seeded team rows have `external_id` in `team:SPORT:Name` format (migration 008 truth).

---

## 18. Rollback Plan

Migration 010 is index-only — safest possible migration to roll back:

```sql
-- Rollback migration 010
DROP INDEX IF EXISTS events_external_id_idx;
DROP INDEX IF EXISTS participants_external_id_idx;
```

No data is mutated by the migration. Rolling back the indexes does not remove any event or participant rows created during the lane. Those rows remain and can be re-indexed when the lane is reopened.

Code rollback:
1. Revert `apps/ingestor/src/entity-resolver.ts` — delete file
2. Revert `apps/ingestor/src/sgo-fetcher.ts` — remove entity extraction
3. Revert `apps/ingestor/src/ingest-league.ts` — remove entity resolver call
4. Revert `packages/db/src/repositories.ts` — remove new interfaces
5. Revert `packages/db/src/runtime-repositories.ts` — remove new implementations
6. Revert `apps/operator-web/src/server.ts` — remove `GET /api/operator/events`
7. `pnpm verify` — confirm 548/548 root tests pass

Entity rows created in the DB during the lane are NOT removed by rollback. They are harmless reference data. Cleanup query is optional and safe:
```sql
DELETE FROM event_participants;
DELETE FROM events WHERE external_id IS NOT NULL;
DELETE FROM participants WHERE participant_type = 'player';
```

---

## 19. Deferred Items (Do Not Include in This Lane)

| Item | When |
|------|------|
| Auto-settlement / auto-grading (event result lookup) | After automated grading contract — requires event result schema design |
| Redis / caching for event lookups | When query latency becomes measurable — not yet |
| Discord implementation | Separate lane — Discord Bot Foundation spec exists |
| Headshot / logo image fetching pipeline | Future enrichment lane — key convention established here |
| OddsAPI or second provider entity resolution | After second provider ingestion slice |
| Player performance statistics (points, assists averages) | Requires statistics ingestion layer — separate contract |
| CLV tracking wiring (offer + resolved event = post-close CLV) | T2 lane after this lane closes — data will exist |
| Capper identity resolution (Discord user → cappers row) | T1 lane — separate concern |
| Participant membership / team roster tracking | Future reference data enrichment lane |
| Event status automation (scheduled → in_progress → final) | Requires event result polling or webhook — separate T1 contract |
| `GET /api/operator/participants` (player search route) | Can be added in follow-on T2 lane — `searchPlayers()` will be implemented |
| Backfilling provider_offers rows written before this lane | Optional maintenance script — not a blocker |
| Global slug or canonical ID scheme for participants | Future concern — external_id is sufficient for V1 |
| Smart Form player prop participant autocomplete | Depends on this lane; UI slice is separate T2/T3 |
