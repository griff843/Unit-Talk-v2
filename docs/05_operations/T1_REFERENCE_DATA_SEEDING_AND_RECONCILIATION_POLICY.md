# T1 Reference-Data Seeding and Reconciliation Policy

**Status:** RATIFIED — 2026-04-02
**Issue:** UTV2-270
**Authority:** T1 governance policy. Owned by PM (A Griffin).
**Lane:** Claude (design).
**Cross-references:** `T1_CANONICAL_BETTING_TAXONOMY_CONTRACT.md`, `T1_CANONICAL_MIGRATION_AND_COMPATIBILITY_CONTRACT.md`, `canonical_reference_data_current_state_audit_2026-04-01.md`

---

## Purpose

Define how canonical reference data (leagues, teams, players, player-team assignments, sportsbooks, market types, stat types) is seeded, refreshed, reconciled, and maintained over time — so the canonical backbone does not drift or become provider-owned by accident.

---

## 1. Source-of-Truth Hierarchy

| Data domain | Primary seed source | Ongoing refresh source | What providers contribute | What providers do NOT own |
|-------------|-------------------|----------------------|--------------------------|--------------------------|
| **Sports** | Governed static seed (migration) | None (effectively immutable) | Nothing | Canonical sport ID or display name |
| **Leagues** | Governed static seed (migration) | None (add new leagues manually) | Nothing | League-to-sport mapping |
| **Teams** | Governed static seed from V1_REFERENCE_DATA | SGO entity resolver (team names from events) | Display name observations, external IDs | Canonical team ID, abbreviation, league assignment |
| **Players** | SGO entity resolver (first encounter creates canonical row) | SGO (ongoing ingest encounters) | Display name, external ID, team hints | Canonical player UUID, deduplicated identity |
| **Player-team assignments** | SGO event rosters (player appears for team in event) | SGO (each event confirms current roster) | Roster observations with dates | Historical assignment chain, effective dates, `is_current` flag |
| **Sportsbooks** | Governed static seed (migration) | None (add new books manually) | Nothing | Canonical book ID, sort order, active flag |
| **Market families** | Governed static seed (migration) | None | Nothing | Canonical family ID |
| **Market types** | Governed static seed (migration + seed SQL) | None (add new types manually) | Nothing | Canonical market type ID, display name, selection type |
| **Stat types** | Governed static seed (migration + seed SQL) | None | Nothing | Canonical key, display name, sport assignment |
| **Combo stat types** | Governed static seed | None | Nothing | Canonical key, component composition |
| **Provider aliases** | Bootstrap from existing `participants` | Ingestor (each new provider label creates unresolved alias) | Raw provider labels, external IDs | Canonical resolution target |

### Core principle

> **Providers are sources of observations, not sources of truth.** A provider observation (SGO says "LeBron James plays for Lakers") creates or updates a provider alias and may trigger a player-team assignment. It never directly modifies a canonical team ID, player UUID, or market type key.

---

## 2. Initial Seeding Rules

### Minimum coverage requirements

| Entity | Minimum seed coverage | Source |
|--------|----------------------|--------|
| Sports | 4 major (NBA, NFL, MLB, NHL) + 5 extended | Migration seed SQL |
| Leagues | 1 per seeded sport minimum | Migration seed SQL (PR #130 seeds 9) |
| Teams | All franchises for NBA (30), NFL (32), MLB (30), NHL (32) | V1_REFERENCE_DATA → migration seed or bootstrap |
| Players | All players encountered by SGO ingestor | Bootstrap from `participants` (PR #132: ~876 players) |
| Sportsbooks | All currently active (15 including `odds-api:*` variants) | Existing `sportsbooks` table rows |
| Market types | All currently supported markets | Migration seed SQL (PR #131) |
| Stat types | All stat types per sport from current `stat_types` table | Migration seed SQL extending existing rows with canonical keys |
| Combo stat types | NBA: PRA, P+A, P+R, R+A. MLB: total bases | Migration seed SQL |

### Provenance requirements on initial insert

Every canonical row must record:

| Field | Required | Purpose |
|-------|----------|---------|
| `created_at` | Yes (auto) | When the row was created |
| `source` (where applicable) | Yes | `governed-seed`, `bootstrap`, `ingestor`, `manual` |
| `metadata.seeded_from` (where applicable) | Recommended | E.g., `'V1_REFERENCE_DATA'`, `'bootstrap_from_participants'` |

### What counts as a valid canonical seed row

1. **Teams:** Must have `id` (deterministic: `{league}:{normalized_mascot}`), `league_id` (FK), `display_name`, `short_name`, `abbreviation`. All five fields required. Cannot be created from a provider observation alone — must be seeded from governed data or operator-approved.

2. **Players:** Must have `id` (UUID), `display_name`, at least one `provider_entity_alias` linking a provider external ID. Can be auto-created from ingestor observation if no existing player matches.

3. **Market types:** Must have `id` (canonical key), `market_family_id` (FK), `display_name`, `selection_type_id`. Must be seeded by migration, not auto-created from provider market keys.

---

## 3. Refresh and Update Cadence

| Entity | Refresh frequency | Mechanism | Notes |
|--------|-------------------|-----------|-------|
| **Sports** | Never | Immutable after seed | Add new sport = new migration |
| **Leagues** | Rarely (new league launch) | Manual migration | E.g., adding UFL or XFL |
| **Teams** | Rarely (franchise change) | Manual + operator | Expansion team, relocation, rebrand |
| **Players** | Every ingest cycle | Ingestor creates new players on first encounter; updates `display_name` if provider sends a different label | Players never deleted, only soft-deactivated |
| **Player-team assignments** | Every ingest cycle | Ingestor observes player appearing for team in event → upsert assignment | Previous assignments get `effective_until` set when a new team is observed |
| **Sportsbooks** | Rarely (new book partnership) | Manual | E.g., adding Fanatics |
| **Market types** | Rarely (new market support) | Manual migration | E.g., adding alt spreads, live betting |
| **Stat types** | Rarely (new stat coverage) | Manual migration | E.g., adding "fantasy points" |
| **Provider aliases** | Every ingest cycle | Auto-created when new provider label encountered | Never deleted; may be manually resolved |

### Effectively static entities (seed once, rarely change)

- Sports, leagues, sportsbooks, market families, market types, stat types, combo stat types

### Dynamic entities (change regularly)

- Players (new players each season), player-team assignments (trades, signings, releases)

---

## 4. Reconciliation Rules

### Provider row → canonical row mapping

| Step | Rule |
|------|------|
| 1 | Check `provider_entity_aliases` for exact match on `(provider, entity_kind, provider_entity_key)` |
| 2 | If found: use the linked canonical ID. Done. |
| 3 | If not found and entity is a **team**: fuzzy-match `display_name` against `teams` in the same league. If exactly one match: create alias with `confidence: 'fuzzy'`, link to team. |
| 4 | If not found and entity is a **player**: fuzzy-match `display_name` against `players` in the same sport. If exactly one match: create alias with `confidence: 'fuzzy'`, link to player. |
| 5 | If zero or multiple matches: create alias with `confidence: 'unresolved'` and no canonical link. Flag for operator review. |
| 6 | If entity is a **player** with zero matches: create new canonical player row + alias. Confidence = `auto-created`. |

### When to add a new alias vs create a new entity

| Condition | Action |
|-----------|--------|
| Same provider, same external_id, already has alias | No action (idempotent) |
| Same provider, new external_id, display_name matches existing entity | Add alias to existing entity (fuzzy or exact) |
| New provider, any external_id, display_name matches existing entity | Add alias to existing entity |
| No match possible | **Players:** Create new canonical player. **Teams:** Do NOT create — flag as unresolved. Teams require governed seed data. |

### Duplicate and collision handling

| Scenario | Policy |
|----------|--------|
| Two aliases from different providers point to different canonical players but appear to be the same person | Operator merges: one player is kept, other soft-deleted, aliases re-pointed |
| Two aliases from same provider point to same canonical player | Valid (provider may use different IDs for same player in different contexts) |
| Provider sends a team name that doesn't match any canonical team | Create unresolved alias. Log warning. Do not create a new team. |
| Provider sends a player with a name that matches two canonical players | Create alias with `confidence: 'ambiguous'`. Flag for operator resolution. |

### Incomplete or conflicting provider data

| Scenario | Policy |
|----------|--------|
| Provider A says player is on Team X; Provider B says Team Y | Trust the most recent observation. Both observations stored as assignments. `is_current` reflects the latest. |
| Provider sends player without team context | Create player with no team assignment. Assignment will be created when player appears in an event with a team. |
| Provider stops sending a previously-active player | Player remains `active = true`. Ingestor does not deactivate players. Roster cleanup is a separate scheduled job (deferred). |

---

## 5. Player-Team Assignment Policy

### How assignments are maintained

1. **Ingestor observes player in event with a team** → upsert `player_team_assignments`:
   - If no current assignment exists: INSERT with `effective_from = today`, `effective_until = NULL`, `is_current = true`.
   - If current assignment exists for same team: no change (idempotent).
   - If current assignment exists for different team: close current (`effective_until = today`, `is_current = false`), insert new assignment.

2. **Source:** `source` field records how the assignment was created (`ingestor`, `bootstrap`, `manual`).

### Effective-dated history expectations

| Event | Effect on assignments |
|-------|----------------------|
| Trade | Old assignment gets `effective_until`. New assignment gets `effective_from`. Both persisted. |
| Free agent signing | New assignment created. No old assignment exists (or old one already closed). |
| Player retirement / release | Assignment gets `effective_until`. Player `active = false` (manual operator action). |
| Season start (no roster change) | No change. Existing assignment remains `is_current = true`. |

### What is NOT automated

- **Roster cleanup:** Detecting that a player is no longer on any team (free agent) is not done automatically. This is a future scheduled job.
- **Historical backfill:** Assignments only record team membership from the point of first observation forward. Pre-observation history is not reconstructed.
- **Cross-sport players:** A player who plays two sports (rare) gets separate canonical player records per sport. No cross-sport identity linking.

---

## 6. Manual Override and Operator Policy

### When manual intervention is allowed

| Action | Allowed | Audit required |
|--------|---------|----------------|
| Resolve an unresolved alias | Yes | Alias row updated with `confidence: 'manual'` |
| Merge two canonical players | Yes | Surviving player noted; merged player soft-deleted; aliases re-pointed |
| Correct a team assignment | Yes | New assignment row with `source: 'manual'` |
| Add a new team | Yes | Must follow canonical key format: `{league}:{lowercase_mascot}` |
| Add a new player | Yes | Must provide `display_name` + at least one alias or reason |
| Change a canonical key | **No** | Canonical keys are immutable. Create new entity if needed. |
| Delete a canonical entity | **No** | Soft-delete (`active = false`) only. Historical references must survive. |

### Audit / provenance expectations

Every manual override must be traceable:
- `source: 'manual'` on the affected row
- `metadata.override_reason` with a brief explanation
- `updated_at` timestamp reflects the override time
- If alias resolution: `confidence` field updated to `'manual'`

---

## 7. Failure Handling

### When SGO is incomplete

| Scenario | Impact | Response |
|----------|--------|----------|
| SGO doesn't cover a sport (e.g., MMA) | No teams or players seeded for that sport | Governed static seed fills teams; players only populated when provider data arrives |
| SGO omits a known team from event data | Team not linked to events | Existing canonical team persists. Missing event_participant link logged as warning. |
| SGO sends a player without team context | Player created but no team assignment | Assignment created on next event with team context |
| SGO event data has wrong team name | Fuzzy match may fail | Unresolved alias created. Operator reviews. |

### When providers disagree

| Scenario | Resolution |
|----------|------------|
| Different display names for same entity | Both stored as aliases. Canonical `display_name` is authoritative (from governed seed or first observation). |
| Different external IDs for same entity | Both stored as separate aliases pointing to same canonical ID. |
| Different player stats (for grading) | SGO is settlement authority (per Provider Decision Record). Odds API stats are not used for grading. |

### When a refresh would create destructive churn

| Scenario | Policy |
|----------|--------|
| Bulk roster update would close many active assignments | Require operator approval before executing bulk assignment changes (>10 changes per league). |
| Provider changes team name format | Create new alias, don't modify canonical team. |
| Provider re-IDs all entities (new external_id scheme) | Old aliases remain. New aliases created. No canonical IDs change. |

---

## 8. Explicit Recommendations

### Immediate post-seed operating policy

1. **Run bootstrap on live DB** (PR #132 function `bootstrap_canonical_reference_data()`). This backfills canonical teams, players, and aliases from existing `participants`.
2. **Verify gap report.** Run `scripts/report-canonical-reference-bootstrap.ts` and review NFL (0 players — expected; SGO doesn't return NFL player data currently), unassigned player counts, and league coverage.
3. **Seed missing teams manually** for any league where bootstrap found fewer teams than expected (NFL = 32 expected, 0 found if SGO doesn't send NFL team entities).
4. **Enable ingestor alias creation.** After canonical tables are live, the ingestor should create `provider_entity_aliases` on each run. This is the ongoing reconciliation path.

### What Codex should automate next

| Task | Priority | Notes |
|------|----------|-------|
| Ingestor writes `provider_entity_aliases` on player/team resolution | P1 | Keeps alias table current with each ingest cycle |
| Ingestor writes `player_team_assignments` from event rosters | P1 | Enables temporal roster tracking |
| Operator-visible unresolved alias queue in Command Center | P2 | Surfaces alias rows with `confidence: 'unresolved'` or `'ambiguous'` |
| Scheduled player activity check (mark inactive if not seen in 90 days) | P3 | Prevents stale roster data; run monthly |

### What should remain manual / governed for now

| Task | Why manual |
|------|-----------|
| Adding new teams | Teams should match official franchise list; no auto-creation from provider labels |
| Adding new sports or leagues | Rare; requires migration |
| Adding new market types or stat types | Requires thoughtful canonical key design; no auto-creation |
| Merging duplicate canonical players | Requires human judgment on identity |
| Bulk roster cleanup (off-season) | Too much churn to automate without validation |

---

## Authority and Update Rule

This document is T1. Changes to the source-of-truth hierarchy, reconciliation rules, or manual override policy require PM approval. Adding new reconciliation heuristics (e.g., fuzzy match tuning) is T2 and may be adjusted by the implementing lane with test coverage.
