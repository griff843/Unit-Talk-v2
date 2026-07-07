# Dual Participant System Audit and PM Decision Packet (DEBT-001)

Issue: UTV2-1384
Date: 2026-07-06
Author: Claude (T1 audit lane)

## Summary

Unit Talk V2 has two participant-identity systems living side by side:

- **Old system** (`participants`, `participant_memberships`, `event_participants`): the live, load-bearing identity system. Every write path (submission, ingestion, promotion) and every financial-truth path (grading, CLV, settlement) reads and writes exclusively through this system today.
- **New system** (`leagues`, `teams`, `players`, `player_team_assignments`, plus the `provider_entity_aliases` bridge table): fully schema-modeled, with one live read path (`DatabaseReferenceDataRepository`, used by a reference-data browse API), but **effectively unpopulated in production**: `teams` has 0 rows, `player_team_assignments` has 0 rows, `players` has 12 rows (all written by a schema-shape proof test, not real data), and the bridge table `provider_entity_aliases` has 840 rows but **zero** of them have a `team_id` or `player_id` filled in — the bridge is structurally present but functionally empty.

**Headline finding:** the "new" canonical system is not a live parallel system with a divergence risk today — it is dormant scaffolding. The actual near-term correctness risk is not "which system does grading trust" (grading/CLV/settlement all correctly and exclusively use the old system, with a consistent fail-closed/fail-open-to-null pattern on ambiguous matches) but rather that **`picks.player_id` and the entire new-system read path in `DatabaseReferenceDataRepository` silently produce empty/null results in production today**, because the tables they depend on are empty. This is not a data-correctness bug (no wrong data is being shown), but it does mean the reference-data browse UI has been serving `teamId: null` / missing team-browse rows for its entire existence without any error signal, and this audit could not find where the intended backfill process was supposed to run.

## Old System Inventory

Live reads/writes/joins against `participants`, `participant_memberships`, `event_participants` (excludes test files):

| File | Function/Path | Read/Write/Join |
|---|---|---|
| `apps/api/src/grading-service.ts:732,750` | `resolvePickEvent`, `resolvePickParticipantId` | Read — resolves `pick.participant_id` → `participants.findById` / `listByType` fuzzy-name fallback |
| `apps/api/src/clv-service.ts:601,606,747` | `resolveParticipantId` | Read — same fallback pattern, feeds CLV computation |
| `apps/api/src/settlement-service.ts:1017,1024,527,730` | participant resolution for CLV lookup, settlement recording | Read — same fallback pattern; also passes `participants`/`eventParticipants` into `event_participants`-based CLV lookups |
| `apps/api/src/submission-service.ts:325,330,543,548,688` | `resolveParticipantIdentityContext` | Read — resolves participant identity at pick-submission time |
| `apps/api/src/candidate-pick-scanner.ts`, `candidate-scoring-service.ts`, `board-pick-writer.ts`, `system-pick-scanner.ts` | scanner/scoring pipelines | Read — all take `ParticipantRepository` as a dependency for candidate generation |
| `apps/api/src/player-enrichment-service.ts:245` | `listByType('player')` scan | Read + Write — scans participants missing `headshot_url`, calls `updateMetadata` (6h interval job) |
| `apps/api/src/team-logo-enrichment-service.ts` | analogous team-logo job | Read + Write — same pattern for teams |
| `apps/api/src/pick-asset-resolver.ts:35,57` | `listByType('player'\|'team', sport)` | Read — resolves display assets for a pick selection string |
| `apps/ingestor/src/entity-resolver.ts:220,342` | `upsertByExternalId`, `listByType('team', sportId)` | Write — creates/updates `participants` rows from provider odds data (the entity-resolution hot path) |
| `apps/ingestor/src/ingest-odds-api.ts:375-376` | `listByType('team'\|'player', sportId)` | Read — used during odds ingestion for matching |
| `apps/ingestor/src/availability-feed.ts:68,75` | `resolveParticipant`, `updateMetadata` | Read + Write — availability/injury feed enrichment |
| `apps/ingestor/src/results-resolver.ts:162,226` | `findByExternalId` | Read — result resolution during grading-feed ingestion |
| `packages/db/src/repositories.ts:716-753,1062-1064` | `ParticipantRepository`, `EventParticipantRepository` interfaces | Definition — the repository contract every above caller depends on |
| `packages/db/src/runtime-repositories.ts` (multiple, see New System Inventory below for the cross-reference cases) | `DatabaseParticipantRepository`, `DatabaseReferenceDataRepository` helpers | Read — canonical implementation backing `ParticipantRepository`, plus three private helpers that join old-system participant IDs into the new-system tables (see below) |

`participant_memberships` (old system's own sub-table for parent/child participant relationships): **zero application code references found**, and the live row count is **0**. This table is dead in both code and data — a second, smaller instance of the same "modeled but never used" pattern as the new system.

## New System Inventory

Live reads/writes/joins against `leagues`, `teams`, `players`, `player_team_assignments` (excludes test files):

| File:Line | Function | Read/Write | Notes |
|---|---|---|---|
| `packages/db/src/runtime-repositories.ts:6081` (`DatabaseReferenceDataRepository`) | `listLeagues` | Read (`leagues`) | Backs `GET /api/reference-data/leagues` |
| `packages/db/src/runtime-repositories.ts:6683` | `loadCanonicalTeamsByParticipantIds` | Read (`provider_entity_aliases` WHERE `entity_kind='team'`, then `teams`) | **Cross-system join**: takes old-system `participant_id`s, looks up canonical `team_id` via the alias bridge, then loads the `teams` row. Used by `listMatchups`/`getEventBrowse`. |
| `packages/db/src/runtime-repositories.ts:6739` | `loadCurrentAssignments` | Read (`player_team_assignments`, then `leagues`) | **Cross-system join**: takes old-system `participant_id`s (as `player_id`), looks up current team assignment, then the assignment's league→sport. Used by the same two browse methods. |
| `packages/db/src/runtime-repositories.ts:6247-6330` (`listMatchups`) | reference-data browse | Read, composes both joins above | Public API: `GET /api/reference-data/matchups` |
| `packages/db/src/runtime-repositories.ts:6335-6420` (`getEventBrowse`) | reference-data browse | Read, composes both joins above | Public API: `GET /api/reference-data/events/:id/browse` |
| `apps/api/src/routes/reference-data.ts` | route handlers | Read (delegates to the repository above) | The only consumer-facing surface for the new system |
| `packages/db/src/canonical-reference-bootstrap.ts:84` (`summarizeCanonicalBootstrapSource`) | pure transform, no I/O | N/A | Computes what a migration/bootstrap *would* produce from old-system data; **does not write anything** — confirmed no `.from(`/`.insert(`/`.upsert(` calls anywhere in this file. Only consumed by its own test file. |
| `scripts/backfill-sgo-participant-aliases.ts:78` | one-off backfill script | Write (`provider_entity_aliases`, insert only) | Populates the alias *mapping* rows (participant_id ↔ provider key), but **does not populate `team_id`/`player_id`** on those rows (confirmed live: 840/840 alias rows have both columns null) and does not write to `teams`/`players`/`leagues`/`player_team_assignments` themselves. |

**No file anywhere in the codebase writes to `teams`, `players` (outside one proof test), `leagues` (outside migration DDL), or `player_team_assignments`.** Grep across `apps/`, `packages/db/src/`, and `scripts/` for `.insert(`/`.upsert(` against these four table names returns zero application-code hits.

### `picks.player_id` — confirmed dormant

`packages/db/src/database.types.ts` shows `picks.player_id` as a live FK to `players.id`. Grep across `apps/api/src`, `apps/ingestor/src`, `packages/db/src` (excluding tests) for `.player_id` returns **zero hits** referencing `picks.player_id` specifically (the two hits that exist are for `player_team_assignments.player_id` and `provider_entity_aliases.player_id`, unrelated columns). The only code that sets `picks.player_id` is `apps/api/src/t1-proof-runtime-truth-spine.test.ts:99,108` — a schema round-trip proof test, not application logic. This matches the live data: 12 of 60,747 picks have `player_id` set (0.02%), and all 12 are attributable to repeated CI runs of that one test.

## Live Data Snapshot (read-only, 2026-07-06)

| Table | Row count |
|---|---|
| `leagues` | 9 |
| `teams` | **0** |
| `players` | 12 |
| `player_team_assignments` | **0** |
| `provider_entity_aliases` | 840 (840/840 `entity_kind='player'`; 0/840 have `team_id` or `player_id` set) |
| `participants` | 1,647 |
| `participant_memberships` | **0** |
| `picks` total | 60,747 |
| `picks.player_id` populated | 12 (0.02%, all from the proof test above) |

## Grading Path Finding

`apps/api/src/grading-service.ts:713` (`resolvePickParticipantId`) resolves participant identity in priority order: (1) `pick.participant_id` direct FK, (2) `metadata.participantId`/`teamId`/`playerId` string looked up via `participants.findById` with a `participant_type` check, (3) fuzzy name match (`normalizeName` equality) against `participants.listByType(type, sport)`, **requiring exactly one match** — 0 or 2+ matches both return `null`.

The caller (`gradePicks`, line ~133) treats `resolvedParticipantId === null` as fail-closed when the market rule requires a participant: the pick is explicitly skipped with `reason: 'missing_participant_id'`, never silently graded against a wrong or absent participant. **Grading uses the old system exclusively and fails closed on ambiguity — invariant 10 is upheld, not violated, in this path.**

## CLV Path Finding

`apps/api/src/clv-service.ts:747` (`resolveParticipantId`) uses the identical priority-order/exactly-one-match pattern, with an explicit code comment: `"fail-open: CLV stays null"`. `apps/api/src/settlement-service.ts:1000-1029` implements the same pattern a third time (grading, CLV, and settlement each have their own copy of this logic rather than a shared helper — a duplication worth flagging for future hygiene work, out of scope here).

**CLV uses the old system exclusively.** Its "fail-open" is a null CLV value, not a wrong one — consistent with invariant 10 (no silent wrong result, only silent absence of a result).

## Silent Risk List

1. **Reference-data browse API silently serves null/empty canonical fields.** `getEventBrowse`/`listMatchups` call `loadCanonicalTeamsByParticipantIds`/`loadCurrentAssignments`, which will always return empty maps today (their source tables are empty or their bridge rows are unpopulated). Every event-browse response's `teamId`/`teamName` fields are silently `null` for every participant, and no error, log line, or metric signals this. Low severity (UI/reference-data only, not financial), but it has presumably been happening since this code shipped with zero visibility.
2. **Triplicated participant-resolution logic** (grading, CLV, settlement each reimplement the same fuzzy-match-with-ambiguity-guard) is a correctness-adjacent hygiene risk: a future edit to one copy that isn't mirrored to the other two could silently create a behavior divergence between grading and CLV/settlement. Not a current bug, but a latent one.
3. **`participant_memberships` (old system) and the new system are both fully dormant tables with zero write paths** — this audit was scoped to the two *systems*, but found a third dormant surface (`participant_memberships`) with the identical "modeled, never populated, never read" pattern. Worth a follow-up debt ticket if the codebase wants to systematically clean up dormant schema (out of scope for this audit).
4. **No migration/backfill job has ever run for `teams`/`player_team_assignments`.** If a future engineer assumes the new system is "half-migrated" and builds on top of the empty `teams` table without checking live row counts first, they would silently build on a foundation with zero real data — this audit's row-count evidence should be treated as the current source of truth, not the schema's mere existence.

## Decision Packet

Both options below are presented neutrally. **No default is recommended** — this is a PM decision per the issue's explicit requirement.

### Option A — View/adapter compatibility layer

Keep `picks.participant_id` as the canonical FK. Build a Postgres view (or application-level adapter) that lets any future new-system-shaped query resolve through the old system without touching `picks`.

- **Risk:** Low. No schema mutation on `picks`, no changes to grading/CLV/settlement's proven-safe resolution logic.
- **Effort:** Low-to-medium. The view/adapter itself is straightforward given `participants`/`event_participants` are well-modeled; most effort is deciding what shape the adapter should expose to match `leagues`/`teams`/`players`/`player_team_assignments` semantics (e.g., does "team" adapter output look like a `teams` row or continue looking like a `participants` row filtered by type).
- **Data migration scope:** None — no data moves. The new tables (`teams`, `player_team_assignments`) would remain empty, or be populated later independently of this option.
- **Rollback:** Trivial — drop the view/remove the adapter; no data was touched.
- **Consideration:** Does not resolve the pre-existing "reference-data browse silently returns null" issue (Silent Risk #1) unless the adapter is also wired into `DatabaseReferenceDataRepository`'s two cross-join helpers.

### Option B — Full FK migration

Migrate `picks.participant_id` to FK `players.id`/`teams.id` (via the new system), deprecate `participants`/`participant_memberships`/`event_participants`.

- **Risk:** Medium. Every one of the ~15 call sites in the Old System Inventory table above would need to be rewritten against the new repository shape, including three copies of financial-truth-critical participant-resolution logic (grading, CLV, settlement). Higher review burden given Rule 9's financial/compliance-logic trigger applies to each of those three files.
- **Effort:** **Lower than a typical "full migration" would suggest**, because — per the live data snapshot above — there is effectively no real data to migrate: `teams` and `player_team_assignments` are empty, and only 1,647 `participants` rows (vs. 12 `players` rows) would need backfilling into the new shape. This is closer to "build the new system's write path for the first time and cut over" than "migrate accumulated production data."
- **Data migration scope:** Backfill ~1,647 `participants` rows into `players`/`teams` (need a canonical dedup/merge step, since `participants` mixes both types in one table), rebuild `player_team_assignments` from whatever the old system's `participant_memberships`-equivalent-in-practice is today (unclear — `participant_memberships` is itself empty; team affiliation may currently live only in `participants.metadata`, needs confirmation before committing to this option), and populate `provider_entity_aliases.team_id`/`player_id` for all 840 existing alias rows.
- **Rollback:** Harder — once `picks.participant_id` is repointed and call sites are rewritten, reverting means re-deploying old code against old data, with a risk window between the FK cutover and full validation.

### PM Decision Required

Neither option is implemented as part of this lane. A migration-implementation lane (either option) is a separate future T1 lane requiring its own PM approval, per the issue's explicit scope boundary.

## Evidence Sources

- Code: `apps/api/src/grading-service.ts`, `clv-service.ts`, `settlement-service.ts`, `submission-service.ts`, `player-enrichment-service.ts`, `team-logo-enrichment-service.ts`, `pick-asset-resolver.ts`, `candidate-pick-scanner.ts`, `candidate-scoring-service.ts`, `board-pick-writer.ts`, `system-pick-scanner.ts`, `routes/reference-data.ts`; `apps/ingestor/src/entity-resolver.ts`, `ingest-odds-api.ts`, `availability-feed.ts`, `results-resolver.ts`; `packages/db/src/repositories.ts`, `runtime-repositories.ts`, `canonical-reference-bootstrap.ts`, `database.types.ts`, `schema.ts`; `scripts/backfill-sgo-participant-aliases.ts`.
- Migrations: `supabase/migrations/00000000000000_baseline_live_schema.sql` (confirmed no seed `INSERT` statements for `teams`/`leagues`/`players`/`player_team_assignments`).
- Live database (read-only `SELECT count(*)` queries, project `zfzdnfwdarxucxtaojxm`, executed 2026-07-06): row counts for `leagues`, `teams`, `players`, `player_team_assignments`, `provider_entity_aliases` (with `entity_kind`/null-column breakdown), `participants`, `participant_memberships`, and `picks`/`picks.player_id`.

No source files were modified as part of this audit. No live data was mutated — all database access was read-only `SELECT`.
