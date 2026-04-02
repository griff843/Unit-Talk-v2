# T1 Canonical Migration and Compatibility Contract

**Status:** RATIFIED — 2026-04-02
**Issue:** UTV2-269
**Authority:** T1 architecture contract. Owned by PM (A Griffin).
**Lane:** Claude (design). Codex (implementation follow-up).
**Cross-references:** `T1_CANONICAL_BETTING_TAXONOMY_CONTRACT.md`, `T1_COMMAND_CENTER_BURNIN_TRUTH_CONTRACT.md`, Codex PRs #130–#133

---

## Purpose

The canonical betting taxonomy contract (2026-04-01) defined the target entity model. Codex has now completed a first implementation wave (UTV2-265/266/267/268 — PRs #130–#133) that creates the backbone tables, seeding logic, market taxonomy, and browse APIs.

This contract resolves the open migration questions so that broader rollout, backfill, and consumer refactoring do not drift:

1. Sport / league key strategy
2. `participants` compatibility plan
3. Canonical player identity and deduplication policy
4. Combo-stat grading policy
5. Rollout safety rules

---

## 1. Sport / League Key Strategy

### Current state

| Surface | Current key | Example |
|---------|-------------|---------|
| `sports.id` | Uppercase abbreviation | `NBA`, `NFL`, `MLB`, `NHL` |
| `participants.sport` | Uppercase abbreviation (freeform text) | `NBA` |
| `events.sport_id` | FK to `sports.id` | `NBA` |
| `provider_offers.sport_key` | Provider-specific | `basketball_nba` (Odds API), `NBA` (SGO) |
| `picks.sport` | Freeform string from submission | `NBA` |
| `leagues.id` (new, PR #130) | Lowercase abbreviation | `nba` |
| `leagues.sport_id` (new) | FK to `sports.id` | `NBA` |

### Decision: Keep `NBA`-style keys as the canonical sport ID. Leagues use lowercase.

**Rationale:** Migrating `sports.id` from `NBA` to `basketball` would require updating every FK reference across `events`, `picks`, `participants`, `stat_types`, `sport_market_types`, `provider_offers`, and all code that constructs queries. The gain (semantic purity) does not justify the risk and churn. The system has used `NBA` as sport_id since day one and it works.

**Rules:**

| Entity | Canonical key format | Example | Immutable after creation |
|--------|---------------------|---------|-------------------------|
| Sport | Uppercase abbreviation | `NBA`, `NFL`, `MLB`, `NHL` | Yes |
| League | Lowercase abbreviation | `nba`, `nfl`, `mlb`, `nhl`, `wnba`, `ncaab` | Yes |
| `leagues.sport_id` | FK to `sports.id` | `NBA` → league `nba` | Yes |

**Migration action:** None required. The new `leagues` table (PR #130) already uses lowercase IDs with FK to the existing `sports.id` uppercase keys. This is the correct design. Do not change `sports.id`.

**Display rule:** `sports.display_name` is for UI. `sports.id` is for code and queries. They may differ (`NBA` vs `National Basketball Association`) but the ID is canonical.

---

## 2. Participants Compatibility Strategy

### Current state

The `participants` table stores teams, players, leagues, and events in a flat polymorphic table differentiated by `participant_type`. It has 1,000+ rows. Existing consumers:

| Consumer | How it uses `participants` | Replaceable now? |
|----------|--------------------------|-----------------|
| `entity-resolver.ts` (ingestor) | `upsertByExternalId()`, `listByType()` for team matching | No — active write path |
| `clv-service.ts` (API) | `resolveParticipantId()` reads `listByType('player', sport)` | No — active resolution path |
| `grading-service.ts` (API) | `pick.participant_id` used in `game_results` lookup | No — active grading path |
| Smart Form participant search | Operator-web queries `participants` | No — active UI path |
| `event_participants` | FK to `participants.id` | No — structural FK |
| `game_results` | FK to `participants.id` for `participant_id` | No — structural FK |

### Decision: `participants` is a long-lived compatibility layer, not deprecated.

**Rationale:** The `participants` table has active FK dependencies from `event_participants`, `game_results`, and picks. Dropping or replacing it would require migrating all FKs — high risk, high churn, no immediate product value. Instead:

**Rules:**

1. **`participants` remains the active entity store for the existing runtime path.** Ingestor continues to write teams and players as participant rows. Grading and CLV continue to read from it.

2. **New canonical tables (`teams`, `players`, `player_team_assignments`) are the canonical source of truth for reference-data browsing.** Smart Form browse APIs, Command Center taxonomy browser, and analytics read from canonical tables.

3. **The bootstrap (PR #132) creates canonical rows from existing participants.** Each canonical `player.id` reuses the participant UUID. Each canonical `team.id` is a deterministic key (e.g., `nba:lakers`). `provider_entity_aliases` links the two.

4. **New code must read from canonical tables when available.** If a consumer needs team/player reference data (display names, team assignments, league membership), use `teams`/`players`/`player_team_assignments`. If a consumer needs entity resolution for grading or CLV (by `participant_id`), use `participants`.

5. **No new code should add rows to `participants` for teams or players that don't also have canonical rows.** The ingestor creates participants; the bootstrap creates canonical equivalents. Both paths must stay in sync.

6. **Future unification:** When the system is ready to drop `participants` (not in this phase), the migration path is:
   - Add `player_id` FK to `game_results` alongside `participant_id`
   - Add `player_id` FK to `picks` alongside `participant_id`
   - Migrate consumers one at a time
   - Eventually drop `participants` or make it a view over `teams` UNION `players`

**This future migration is explicitly NOT in scope for this contract.**

---

## 3. Canonical Player Identity / Deduplication Policy

### How aliases map to canonical players

```
Provider A sends: "LeBron James" (external_id: "sgo-lebron-123")
Provider B sends: "L. James" (external_id: "odds-api-lbj-456")
                       ↓
              provider_entity_aliases
                       ↓
              canonical player (UUID: 5a36ffbf-...)
```

### Rules for creating vs attaching

| Condition | Action |
|-----------|--------|
| Provider sends external_id that matches an existing `provider_entity_aliases` row | Attach: reuse the canonical player |
| Provider sends external_id not seen before, but display_name matches exactly one existing player in the same sport | Attach: create alias, link to existing player. Confidence = `fuzzy`. |
| Provider sends external_id not seen before, display_name matches zero or multiple players | Create: new canonical player + alias. Confidence = `auto-created`. |
| Operator manually links a provider alias to a canonical player | Update alias: set `canonical_id`, confidence = `manual`. |

### Collision / merge policy

| Scenario | Policy |
|----------|--------|
| Two canonical players discovered to be the same person | Operator merges: soft-delete one player, update all aliases to point to the survivor. Update `player_team_assignments`. Leave `participants` rows alone (historical). |
| Two providers disagree on a player's team | Trust the most recent `player_team_assignments` row. Create a new assignment if the player moved. |
| Player name change (marriage, legal name) | Update `display_name` on canonical player. Old display name is implicit in alias `provider_display_name`. |

### Deduplication safeguards

1. **Never auto-merge.** Automatic alias creation may link to an existing player (fuzzy match), but it never merges two existing canonical players. Merges require operator action.
2. **One-alias-per-provider-per-entity.** The UNIQUE constraint `(provider, entity_kind, provider_entity_key)` prevents duplicate aliases from the same provider.
3. **Cross-provider dedup is manual.** If SGO and Odds API both create canonical players for the same person, operator resolves by merging one into the other.

---

## 4. Combo-Stat Grading Policy

### How combo stats are represented

PR #131 creates `combo_stat_types` and `combo_stat_type_components`:

```
combo_stat_types: { id: 'pra', sport_id: 'NBA', display_name: 'Pts + Rebs + Asts' }
combo_stat_type_components:
  (pra, points, weight=1)
  (pra, rebounds, weight=1)
  (pra, assists, weight=1)
```

### Grading computation rules

| Rule | Policy |
|------|--------|
| **Primary computation:** Compute from component stats | Sum: `Σ(component_stat_actual_value × weight)` from `game_results` rows |
| **Provider aggregate available:** SGO sends PRA directly | Store as `game_results` row with `market_key = 'pra-all-game-ou'`. Use only as cross-check, not as settlement truth. |
| **Settlement truth:** Always use computed value | The computed sum from components is canonical. Provider aggregates may have rounding or timing differences. |
| **Disagreement:** Computed value differs from provider aggregate | Log as warning. Use computed value for settlement. Flag for operator review if delta > 0.5. |
| **Missing component stat:** One component stat missing from `game_results` | Cannot grade combo. Pick remains ungraded. Do not use partial sums. |

### Why computed-from-components is canonical

1. **Auditability:** Each component stat can be independently verified against box scores.
2. **Provider independence:** If SGO rounds PRA differently than our component sum, our sum is traceable.
3. **Consistency:** All combo stats (PRA, P+A, P+R, R+A) use the same computation method.

### Implementation note

The grading service currently resolves `market_key` → `game_results.actual_value` directly. For combo stats, the grading service must:
1. Look up `combo_stat_type_components` for the market key
2. Fetch each component stat's `game_results.actual_value`
3. Sum with weights
4. Compare against the pick line

This is a code change in `grading-service.ts` that should follow the canonical market alias mapping work. **Not in scope for this contract — flagged as follow-on implementation.**

---

## 5. Rollout Safety Rules

### Phase ordering

| Phase | What | Pre-requisite | Rollback |
|-------|------|---------------|----------|
| **A. Merge backbone schema** (PR #130) | Create `leagues`, `teams`, `players`, `player_team_assignments` | `pnpm verify` green | Drop tables (no existing deps) |
| **B. Merge market taxonomy** (PR #131) | Create `market_families`, `market_types`, `combo_stat_types`, alias tables | Phase A merged | Drop tables (no existing deps) |
| **C. Merge bootstrap** (PR #132) | Populate canonical tables from existing `participants` | Phases A+B merged | Truncate canonical tables (participants untouched) |
| **D. Merge browse APIs** (PR #133) | Expose reference-data endpoints | Phases A+B+C merged | Remove routes (no runtime deps yet) |
| **E. Smart Form refactor** | Consume browse APIs instead of static catalog | Phase D merged | Revert to static catalog |
| **F. Ingestion refactor** | Entity resolver uses alias tables | Phases A+B+C merged | Revert to current `namesMatch()` |
| **G. Backfill / reconciliation** | Update `picks.market` to canonical keys; reconcile historical records | Phases A–F stable | Accept partial reconciliation |

### What must be additive

- Phases A–D: **Purely additive.** New tables, new rows, new endpoints. Nothing existing is modified or removed.
- Phase E: Additive at the API level (new browse endpoints); substitutive at the UI level (Smart Form data source swap).
- Phase F: Substitutive (replace resolution logic) — requires parallel run verification.
- Phase G: Mutative (update existing records) — requires backup and operator review.

### What can ship before burn-in

- Phases A–D can all ship before burn-in starts. They are additive and do not affect existing runtime behavior.

### What must wait until after burn-in

- Phases E–G should wait until burn-in validates the existing runtime. Changing Smart Form data sources or ingestion resolution logic during burn-in would invalidate the validation.

### Rollback principles

1. **Schema rollback:** Any new table can be dropped if no runtime consumer depends on it. Phases A–D are droppable.
2. **Data rollback:** Bootstrap (Phase C) populates canonical tables from existing data. Truncating canonical tables restores the pre-bootstrap state without affecting `participants`.
3. **API rollback:** Browse APIs (Phase D) are new endpoints. Removing them doesn't break existing consumers.
4. **Never roll back `participants`.** It is the active runtime table. Canonical tables are supplementary during this phase.

---

## 6. Explicit Recommendations

### Immediate next implementation policy

1. **Merge PRs #130–#133 in order** (A → B → C → D). Verify `pnpm verify` green after each merge.
2. **Run bootstrap on live DB** after Phase C merge. Verify canonical row counts match the gap report from the bootstrap script.
3. **Do not refactor Smart Form or ingestion yet.** Let canonical tables exist alongside `participants` during burn-in.
4. **Expose browse APIs** (Phase D) so Smart Form can begin consuming them in a follow-on sprint.

### Deferred decisions

| Decision | Why deferred | When to revisit |
|----------|-------------|-----------------|
| Dropping `participants` table | Active FK dependencies; high-risk migration | After burn-in, when canonical tables have proven stable |
| Provider book alias cleanup (`odds-api:pinnacle` → `pinnacle`) | Current FK entries work; cleanup is cosmetic | Phase 7 or when third provider is added |
| Automated cross-provider player dedup | Requires confidence scoring and fuzzy match tuning | Phase 7 |
| Combo stat grading code change | Grading service must sum components; currently resolves single market_key | Follow-on implementation issue after this contract |

### Red lines — Codex must not do without a new contract

1. **Do not modify `participants` table schema.** No column additions, no column removals, no type changes.
2. **Do not add FKs from existing tables to new canonical tables.** FKs flow from canonical tables to existing tables (e.g., `player_team_assignments.player_id` → `players.id`), not the reverse.
3. **Do not change `picks.market` format** without a migration plan and operator review.
4. **Do not auto-merge canonical players.** All player merges require operator action.
5. **Do not delete or soft-delete `participants` rows** as part of canonical bootstrap or reconciliation.

---

## Authority and Update Rule

This document is T1. Migration phase ordering and compatibility rules may not be changed without PM approval. Individual phase implementation details (exact SQL, exact TypeScript) are T2 and may be adjusted by the implementing lane.
