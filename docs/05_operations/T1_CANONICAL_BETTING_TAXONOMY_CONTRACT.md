# T1 Canonical Betting Taxonomy Contract

**Status:** RATIFIED — 2026-04-01
**Authority:** T1 architecture contract. Owned by PM (A Griffin).
**Lane:** Claude (design). Implementation lanes TBD after PM approval.
**Cross-references:** `CONTROLLED_VALIDATION_PACKET.md`, `PROVIDER_DATA_DECISION_RECORD.md`, `reference-data.ts` (V1_REFERENCE_DATA)

---

## 1. Executive Summary

### The problem

Unit Talk V2 does not have a canonical, DB-backed registry for the betting domain's core entities: sports, leagues, teams, players, sportsbooks, market types, stat types, and combo markets. Instead it has:

- **`V1_REFERENCE_DATA`** — 256 lines of hardcoded static data in `packages/contracts/src/reference-data.ts` (9 sports, 12 books, hardcoded team lists, hardcoded stat types)
- **`MARKET_KEY_MAP`** — 17 hand-rolled market key mappings in `packages/domain/src/market-key.ts` (NBA + MLB only; no NFL, NHL, or college)
- **DB tables** (`sports`, `stat_types`, `sport_market_types`, `sportsbooks`) — partially populated but not integrated with Smart Form, ingestion, or grading in a unified way
- **`participants`** table — flat list with `participant_type` enum but no team-membership hierarchy, no canonical key strategy, and fuzzy name matching in the entity resolver

This produces a pattern where every new book, market, or stat type requires a patch to a hardcoded map, a new normalizer branch, and often a test fix — instead of a data insert.

### Why patching is the wrong pattern

Each one-off patch (add Fanatics, add Points+Assists, add PRA) creates:
- A new code change for what should be a data operation
- A new deployment for what should be a DB insert
- A new potential for drift between the hardcoded map and the DB
- A new test to maintain for what should be a lookup

### Why this is required now

1. **Smart Form** must evolve toward a sportsbook-like experience. Users need to select sport → team/player → market → stat type → book from canonical, complete lists — not from partially-hardcoded maps that break when the catalog expands.
2. **Provider normalization** must map SGO and Odds API into a canonical taxonomy — not into provider-specific key formats that leak through to grading and CLV.
3. **Settlement, CLV, scoring, and analytics** all need to resolve market context from a single source of truth, not from string matching against hardcoded maps.

---

## 2. Canonical Design Principles

| # | Principle | Implication |
|---|-----------|-------------|
| P1 | **Canonical truth lives in Unit Talk, not in any single provider** | SGO market keys and Odds API market keys are provider labels, not canonical truth. Unit Talk defines the canonical market taxonomy; providers map into it. |
| P2 | **Providers are sources, not authorities** | When SGO says `"luka-doncic-points-over"` and Odds API says `"player_points"`, both are aliases for the canonical market key `player_points_ou`. Neither provider's naming convention dictates the canonical key. |
| P3 | **Smart Form is a consumer of canonical registry data** | Smart Form reads from the same canonical tables that ingestion writes into and that grading resolves against. No parallel hardcoded catalog. |
| P4 | **Ingestion maps into canonical truth** | The entity resolver and market normalizer must resolve provider entities to canonical IDs at ingest time, not at query time. |
| P5 | **All downstream surfaces read canonical truth** | Operator dashboard, Discord embeds, recaps, analytics, Command Center — all read canonical display names and keys from the same source. |
| P6 | **Reference data must support degraded mode** | When live offer APIs are incomplete or temporarily unavailable, Smart Form must still present the full sport/team/player/market catalog from the canonical registry. Live odds enrich the experience; their absence must not break it. |
| P7 | **No duplicate parallel taxonomies** | `V1_REFERENCE_DATA` static data must be replaced by DB-backed tables, not supplemented by a second parallel system. One source of truth. |

---

## 3. Core Entity Model

### Entity relationship graph

```
Sport
 ├── League (1:N)
 │    ├── Team (1:N)
 │    │    └── Player (N:M via player_team_assignments)
 │    └── Season (future — not in initial scope)
 │
 ├── MarketFamily (1:N)
 │    └── MarketType (1:N)
 │         └── StatType (N:M via market_type_stat_types)
 │              └── ComboStatType (aggregation of stat types)
 │
 └── SelectionType (sport-agnostic: over/under, home/away, yes/no)

Sportsbook (independent entity, not sport-scoped)
 └── Referenced by provider_offers.provider_key

ProviderAlias (polymorphic mapping tables)
 ├── provider_entity_aliases (maps provider IDs → canonical participant/team IDs)
 ├── provider_market_aliases (maps provider market keys → canonical market type keys)
 └── provider_book_aliases (maps provider book keys → canonical sportsbook IDs)
```

### Entity definitions

| Entity | Description | Key example |
|--------|-------------|-------------|
| **Sport** | Top-level sport category | `basketball`, `football`, `baseball`, `hockey` |
| **League** | Competition within a sport | `nba`, `wnba`, `nfl`, `mlb`, `nhl`, `ncaab`, `ncaaf` |
| **Team** | Franchise / organization | `nba:lakers`, `nfl:chiefs`, `mlb:yankees` |
| **Player** | Individual athlete | UUID (names are display, not keys) |
| **Sportsbook** | Betting operator | `pinnacle`, `draftkings`, `fanduel`, `betmgm`, `sgo` |
| **MarketFamily** | High-level market category | `moneyline`, `spread`, `total`, `player_prop`, `team_prop` |
| **MarketType** | Specific market within family | `player_points_ou`, `player_rebounds_ou`, `game_total_ou`, `moneyline` |
| **StatType** | Atomic statistical measure | `points`, `rebounds`, `assists`, `strikeouts`, `passing_yards` |
| **ComboStatType** | Aggregation of stat types | `pra` (points+rebounds+assists), `pa` (points+assists) |
| **SelectionType** | Side of a wager | `over`, `under`, `home`, `away`, `yes`, `no` |
| **ProviderAlias** | Provider-specific label → canonical mapping | SGO `"points-all-game-ou"` → canonical `player_points_ou` |

---

## 4. Proposed Database Model

### 4.1 `sports` (exists — extend)

Already exists in DB. Keep as-is, ensure seeded for all supported sports.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | Canonical key: `basketball`, `football`, `baseball`, `hockey`, `soccer`, `mma`, `tennis` |
| `display_name` | text | `Basketball`, `Football`, etc. |
| `active` | boolean | Soft-enable for Smart Form visibility |
| `sort_order` | int | Display ordering |
| `metadata` | jsonb | Future extensibility |

**Queried by:** Smart Form (sport selector), ingestion (sport resolution), all downstream.

### 4.2 `leagues` (new)

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | Canonical key: `nba`, `nfl`, `mlb`, `nhl`, `wnba`, `ncaab`, `ncaaf`, `mls`, `epl` |
| `sport_id` | text FK → sports | Parent sport |
| `display_name` | text | `NBA`, `NFL`, `WNBA`, etc. |
| `country` | text | `US`, `UK`, etc. (optional) |
| `active` | boolean | Soft-enable |
| `sort_order` | int | Display ordering within sport |
| `metadata` | jsonb | Season info, etc. |

**Queried by:** Smart Form (league selector after sport), ingestion (league normalization), grading.

**Note:** Current system uses sport and league interchangeably (sport_id = 'NBA'). Migration must normalize: `NBA` → sport `basketball`, league `nba`.

### 4.3 `teams` (new — replaces team participants)

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | Canonical key: `nba:lakers`, `nfl:chiefs`, `mlb:yankees` |
| `league_id` | text FK → leagues | Parent league |
| `display_name` | text | `Los Angeles Lakers`, `Kansas City Chiefs` |
| `short_name` | text | `Lakers`, `Chiefs`, `Yankees` |
| `abbreviation` | text | `LAL`, `KC`, `NYY` |
| `city` | text | `Los Angeles`, `Kansas City` |
| `active` | boolean | Current active franchise |
| `sort_order` | int | Alphabetical or division ordering |
| `metadata` | jsonb | Division, conference, logos, colors |

**Queried by:** Smart Form (team selector filtered by league), ingestion (team resolution), Discord embeds.

**How seeded:** Initially from V1_REFERENCE_DATA team lists (30 NBA, 32 NFL, 30 MLB, 32 NHL). Future: SGO entity resolution updates metadata.

### 4.4 `players` (new — replaces player participants)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | System-generated; NOT name-based |
| `display_name` | text | `LeBron James`, `Patrick Mahomes` |
| `first_name` | text | `LeBron` |
| `last_name` | text | `James` |
| `active` | boolean | Currently rostered |
| `metadata` | jsonb | Position, jersey number, headshot URL, DOB |

**Natural key:** None — UUIDs only. Names are display, not identity. Two players can share a name.

**Queried by:** Smart Form (player autocomplete filtered by team), CLV (participant resolution), grading.

### 4.5 `player_team_assignments` (new)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `player_id` | uuid FK → players | |
| `team_id` | text FK → teams | |
| `league_id` | text FK → leagues | Denormalized for query convenience |
| `effective_from` | date | Start of assignment (e.g., trade date) |
| `effective_until` | date NULL | NULL = current assignment |
| `is_current` | boolean | Computed convenience flag; `effective_until IS NULL` |
| `source` | text | `ingestor`, `manual`, `roster-sync` |

**Queried by:** Smart Form (player → team lookup), grading (which team was player on at game time).

**Why not a simple FK on `players`?** Players change teams. Mid-season trades must not break historical grading or CLV. The assignment table preserves history.

### 4.6 `sportsbooks` (exists — keep)

Already exists and is functional. 15 rows (11 original + 4 `odds-api:*` added today).

**Recommendation:** Keep the `odds-api:*` entries as-is for now. They serve as provider-specific sportsbook identifiers. The `provider_book_aliases` table (below) will eventually allow cleaner mapping, but the FK constraint is satisfied.

### 4.7 `market_families` (new)

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | `moneyline`, `spread`, `total`, `player_prop`, `team_prop`, `game_prop` |
| `display_name` | text | `Moneyline`, `Spread`, `Total`, `Player Prop`, etc. |
| `sort_order` | int | |

**Purpose:** Top-level categorization. Smart Form uses this to present market type groups.

### 4.8 `market_types` (new — replaces `sport_market_types`)

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | Canonical key: `moneyline`, `spread`, `game_total_ou`, `player_points_ou`, `player_pra_ou` |
| `market_family_id` | text FK → market_families | Parent family |
| `display_name` | text | `Points O/U`, `PRA O/U`, `Moneyline` |
| `short_label` | text | `PTS`, `PRA`, `ML` |
| `selection_type` | text | `over_under`, `home_away`, `yes_no` |
| `requires_line` | boolean | true for spreads/totals/props; false for moneyline |
| `requires_participant` | boolean | true for player props; false for game-level markets |
| `active` | boolean | |
| `sort_order` | int | |

**Queried by:** Smart Form (market grid), submission normalization, grading (market key resolution).

### 4.9 `sport_market_type_availability` (new — replaces `sport_market_types`)

| Column | Type | Notes |
|--------|------|-------|
| `sport_id` | text FK → sports | |
| `market_type_id` | text FK → market_types | |
| `active` | boolean | Whether this market is available for this sport |
| PK | (sport_id, market_type_id) | Composite |

**Purpose:** Not all markets apply to all sports. NBA has `player_points_ou`; MMA does not. This table defines which markets are valid for which sports.

**Queried by:** Smart Form (filter market grid by selected sport).

### 4.10 `stat_types` (exists — extend)

Already exists in DB. Extend with canonical key and linkage to market types.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | Canonical key: `points`, `rebounds`, `assists`, `passing_yards`, `strikeouts` |
| `sport_id` | text FK → sports | Which sport this stat belongs to |
| `display_name` | text | `Points`, `Rebounds`, `Passing Yards` |
| `short_label` | text | `PTS`, `REB`, `PASS YDS` |
| `active` | boolean | |
| `sort_order` | int | |

### 4.11 `combo_stat_types` (new)

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | Canonical key: `pra`, `pa`, `pr`, `ra`, `pts_reb`, `total_bases` |
| `sport_id` | text FK → sports | |
| `display_name` | text | `Pts + Rebs + Asts`, `Pts + Asts` |
| `short_label` | text | `PRA`, `P+A`, `P+R` |
| `market_type_id` | text FK → market_types | Links to the market type this combo resolves to |
| `active` | boolean | |
| `sort_order` | int | |

### 4.12 `combo_stat_type_components` (new)

| Column | Type | Notes |
|--------|------|-------|
| `combo_stat_type_id` | text FK → combo_stat_types | |
| `stat_type_id` | text FK → stat_types | |
| `weight` | numeric DEFAULT 1 | Multiplier (usually 1; allows weighted combos) |
| PK | (combo_stat_type_id, stat_type_id) | Composite |

**Purpose:** Defines that `pra` = `points` + `rebounds` + `assists`. Used by grading to compute actual values from component stats, and by Smart Form to display what a combo stat includes.

### 4.13 `provider_entity_aliases` (new)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `provider_key` | text | `sgo`, `odds-api` |
| `entity_type` | text | `player`, `team`, `league`, `event` |
| `provider_external_id` | text | Provider's ID for this entity |
| `provider_label` | text | Provider's display name (for debugging) |
| `canonical_id` | text | Resolved canonical ID in our system |
| `confidence` | text | `exact`, `fuzzy`, `manual`, `unresolved` |
| `created_at` | timestamptz | |
| UNIQUE | (provider_key, entity_type, provider_external_id) | |

**Purpose:** Replaces the current fuzzy `namesMatch()` resolution with a persistent lookup table. Once resolved, subsequent ingests use the cached mapping.

### 4.14 `provider_market_aliases` (new)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `provider_key` | text | `sgo`, `odds-api` |
| `provider_market_key` | text | Provider's market key (e.g., `points-all-game-ou`, `h2h`, `player_points`) |
| `canonical_market_type_id` | text FK → market_types | Resolved canonical market type |
| `sport_id` | text FK → sports | Sport context (same provider key may map differently by sport) |
| `created_at` | timestamptz | |
| UNIQUE | (provider_key, provider_market_key, sport_id) | |

**Purpose:** Replaces `MARKET_KEY_MAP` with a DB-backed, provider-aware mapping. Adding a new provider's market key is an INSERT, not a code change.

### 4.15 `provider_book_aliases` (new — future)

| Column | Type | Notes |
|--------|------|-------|
| `provider_key` | text | `odds-api`, `sgo` |
| `provider_book_key` | text | Provider's book identifier (e.g., `pinnacle`, `draftkings`) |
| `canonical_sportsbook_id` | text FK → sportsbooks | |
| UNIQUE | (provider_key, provider_book_key) | |

**Purpose:** Maps provider-specific book identifiers to canonical sportsbook entries. This allows the `odds-api:pinnacle` → `pinnacle` mapping to live in data rather than in provider key naming conventions.

**Note:** Deferred — current `odds-api:*` sportsbook entries work as a stopgap. Implement when a third provider is added or when `provider_key` format cleanup happens.

---

## 5. Canonical Key Strategy

### Key format rules

| Entity | Key format | Example | Rationale |
|--------|-----------|---------|-----------|
| Sport | lowercase singular noun | `basketball` | Stable, unambiguous |
| League | lowercase abbreviation | `nba`, `nfl`, `wnba` | Matches industry convention |
| Team | `{league}:{lowercase_mascot}` | `nba:lakers`, `nfl:chiefs` | Disambiguates across leagues (there could be a team named "Eagles" in multiple sports) |
| Player | UUID | `5a36ffbf-...` | Names are not unique; UUIDs are |
| Sportsbook | lowercase brand | `pinnacle`, `draftkings` | Stable, unambiguous |
| Market family | lowercase snake_case | `player_prop`, `moneyline` | Descriptive |
| Market type | `{context}_{stat}_{selection}` | `player_points_ou`, `game_total_ou`, `moneyline` | Encodes what, where, and selection type |
| Stat type | lowercase snake_case | `points`, `passing_yards`, `strikeouts` | Matches domain language |
| Combo stat | lowercase abbreviation | `pra`, `pa`, `pr`, `ra` | Short, industry-standard |

### Display labels vs canonical keys

Canonical keys are machine identifiers. Display labels are human-readable. They are always separate fields.

| Canonical key | Display label | Provider aliases |
|---------------|--------------|-----------------|
| `player_points_ou` | `Points O/U` | SGO: `points-all-game-ou`; OddsAPI: `player_points` |
| `pra` | `Pts + Rebs + Asts` | SGO: `pra-all-game-ou`; Smart Form legacy: `PRA`; DK: `Pts+Rebs+Asts` |
| `nba:lakers` | `Los Angeles Lakers` | SGO: `los-angeles-lakers`; OddsAPI: `Los Angeles Lakers` |
| `pinnacle` | `Pinnacle` | OddsAPI book key: `pinnacle`; current DB: `odds-api:pinnacle` |

### Key immutability rule

Canonical keys must never change once assigned. If a team rebrands (e.g., Washington Football Team → Commanders), the canonical key (`nfl:commanders`) is created new; the old key (`nfl:washington_football_team`) is soft-deactivated with `active=false`. Historical records retain the old key.

---

## 6. Provider Mapping Strategy

### Provider priority for reference data seeding

| Data domain | Primary seed source | Secondary | Manual |
|-------------|-------------------|-----------|--------|
| Sports | Static (known set) | — | — |
| Leagues | Static (known set) | — | — |
| Teams | V1_REFERENCE_DATA (initial) | SGO entity resolver (ongoing) | Operator for corrections |
| Players | SGO entity resolver | Odds API descriptions | Operator for corrections |
| Sportsbooks | Static + Odds API bookmaker list | — | Operator for new books |
| Market types | Static seed + provider alias mapping | — | — |
| Stat types | Static seed from current `MARKET_KEY_MAP` + SGO `SGO_MARKET_KEY_TO_STAT_FIELDS` | — | — |

### Mapping rules

1. **Providers map into canonical keys.** The ingestor resolves provider-specific identifiers to canonical IDs at ingest time. If no mapping exists, the offer is stored with a `provider_market_key` as-is and flagged as `unresolved` in the alias table.

2. **Provider labels are stored as aliases.** When a new provider label is encountered, it creates a row in `provider_entity_aliases` or `provider_market_aliases` with `confidence: 'unresolved'`. An operator (or automated heuristic) then resolves it to a canonical ID.

3. **Provider mismatches do not create new canonical concepts automatically.** If SGO sends a player name that doesn't match any canonical player, it creates an alias row, not a new player. Player creation requires either automated match confidence ≥ threshold or operator approval.

4. **New provider aliases are attachable without schema churn.** Adding Fanatics as a sportsbook = 1 row in `sportsbooks` + N rows in `provider_book_aliases`. No code changes, no deployments, no new migration.

### When providers disagree

| Scenario | Resolution |
|----------|------------|
| Two providers use different names for the same player | Both stored as aliases pointing to the same canonical player ID |
| Provider sends unknown market key | Stored in `provider_market_aliases` with `canonical_market_type_id = NULL`; offer still persisted with raw `provider_market_key`; flagged for operator review |
| Provider shows a team that doesn't exist in canonical registry | Logged as warning; offer persisted with provider team ID; alias row created with `confidence: 'unresolved'` |
| Providers disagree on team name spelling | Canonical `display_name` is authoritative; both provider spellings stored as aliases |

---

## 7. Smart Form Usage Model

### What Smart Form reads from canonical registry

| Step | Data source | Fallback if empty |
|------|------------|-------------------|
| 1. Sport selection | `sports` WHERE `active = true` ORDER BY `sort_order` | Static fallback (should never be empty) |
| 2. League selection (if sport has multiple) | `leagues` WHERE `sport_id = ?` AND `active = true` | Skip step; use sport directly |
| 3. Team selection | `teams` WHERE `league_id = ?` AND `active = true` | Free text input (degraded mode) |
| 4. Player autocomplete | `players` JOIN `player_team_assignments` WHERE `team_id = ?` AND `is_current = true` | API search against `participants` (current behavior) |
| 5. Sportsbook selection | `sportsbooks` WHERE `active = true` ORDER BY `sort_order` | Static fallback |
| 6. Market family selection | `market_families` ORDER BY `sort_order` | Grid with all families |
| 7. Market type selection | `market_types` JOIN `sport_market_type_availability` WHERE `sport_id = ?` AND `active = true` | Show all market types |
| 8. Stat type / combo stat (for player props) | `stat_types` WHERE `sport_id = ?` UNION `combo_stat_types` WHERE `sport_id = ?` | Show all stat types for sport |
| 9. Line input | Free text numeric | Required for props/spreads/totals |
| 10. Odds input | Free text American odds | Required |
| 11. Confidence input | Slider 1-10 → normalized to 0-1 | Required |

### Static vs live-offer-driven

| Component | Static (canonical registry) | Live (offer API enrichment) |
|-----------|---------------------------|---------------------------|
| Sport list | ✅ | — |
| Team list | ✅ | — |
| Player list | ✅ | — |
| Sportsbook list | ✅ | — |
| Market type list | ✅ | — |
| Stat type list | ✅ | — |
| **Current odds for selection** | — | ✅ (from `provider_offers`) |
| **Line suggestion** | — | ✅ (from latest offer) |
| **Odds pre-fill** | — | ✅ (from latest offer) |
| **"Market available" badge** | — | ✅ (offer exists in last 30 min) |

**Degraded mode:** When live offers are unavailable, Smart Form still presents the full catalog. The user manually enters line and odds. No live offer enrichment. The pick is submitted and evaluated at promotion time against whatever provider data exists.

### Combo market support

Smart Form presents combo stat types (PRA, P+A, P+R, etc.) alongside atomic stat types in the stat selector. The `combo_stat_types` table provides display labels and the `combo_stat_type_components` table defines the composition. At grading time, the system sums the component stats from `game_results` to compute the actual value for combo markets.

---

## 8. Downstream Usage Model

| Consumer | How it uses canonical data | Key tables |
|----------|--------------------------|------------|
| **Ingestion** | Resolves provider entities/markets to canonical IDs at ingest time via alias tables | `provider_entity_aliases`, `provider_market_aliases`, `teams`, `players` |
| **Submission service** | Normalizes market key to canonical `market_type_id` at submission; resolves team/player | `market_types`, `provider_market_aliases`, `teams`, `players` |
| **Promotion/scoring** | Reads canonical market type to determine scoring applicability | `market_types`, `sport_market_type_availability` |
| **Real edge service** | Matches pick to provider offers using canonical market key + participant | `provider_offers`, `market_types`, `provider_market_aliases` |
| **CLV service** | Finds closing line by canonical market key + provider + participant | `provider_offers`, `market_types` |
| **Grading service** | Resolves game result by event + participant + canonical market key; sums combo stats | `game_results`, `market_types`, `combo_stat_type_components`, `stat_types` |
| **Settlement service** | Records settlement with canonical market key for audit | `settlement_records`, `market_types` |
| **Command Center** | Displays picks with canonical display names for sport/team/player/market | `sports`, `leagues`, `teams`, `players`, `market_types` |
| **Discord embeds** | Uses canonical `short_label` and `display_name` for compact display | `market_types`, `teams`, `players` |
| **Recap service** | Aggregates by canonical sport/market/capper | `sports`, `market_types`, `cappers` |
| **Analytics** | Segments performance by canonical sport/market/team/capper | All canonical tables |

---

## 9. Capability Matrix

Not all markets are created equal. Some have full intelligence backing; others support only intake and display. This matrix defines what the system can do per market family.

| Market family | Intake | Scoring | Real edge | CLV | Settlement | Recap/display |
|---------------|--------|---------|-----------|-----|------------|---------------|
| **Moneyline** | ✅ | ✅ | ✅ (Pinnacle/consensus) | ✅ (when closing line exists) | ✅ (automated via game result) | ✅ |
| **Spread** | ✅ | ✅ | ✅ (Pinnacle/consensus) | ✅ (when closing line exists) | ✅ (automated) | ✅ |
| **Game total** | ✅ | ✅ | ✅ (Pinnacle/consensus) | ✅ (when closing line exists) | ✅ (automated) | ✅ |
| **Player prop (atomic)** | ✅ | ✅ | ⚠️ (SGO only; Odds API props less structured) | ⚠️ (SGO closing line only) | ✅ (automated via stat lookup) | ✅ |
| **Player prop (combo)** | ✅ | ✅ | ⚠️ (limited — combo key matching harder across providers) | ⚠️ (rare closing line match) | ✅ (sum components from game_results) | ✅ |
| **Team total** | ✅ | ⚠️ (scoring possible if market resolved) | ❌ (no provider data typically) | ❌ | ⚠️ (needs team score isolation) | ✅ |
| **Game prop** | ✅ (manual intake) | ❌ | ❌ | ❌ | ❌ (manual settlement only) | ✅ |
| **Futures** | ❌ (out of scope) | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Parlays** | ❌ (out of scope) | ❌ | ❌ | ❌ | ❌ | ❌ |

**Key:** ✅ = fully supported, ⚠️ = partial/conditional, ❌ = not supported

**Do not claim intelligence (real edge, CLV) for market families that lack provider data coverage.** The system must gracefully degrade: intake and display always work; intelligence enrichment is conditional on data availability.

---

## 10. Migration and Rollout Strategy

### Phase 0: Schema design + approval (this document)
- PM approves entity model and canonical key strategy
- No code or migration yet

### Phase 1: Core taxonomy tables + seed data
**Tables created:** `leagues`, `teams`, `players`, `player_team_assignments`, `market_families`, `market_types`, `sport_market_type_availability`, `combo_stat_types`, `combo_stat_type_components`, `provider_entity_aliases`, `provider_market_aliases`

**Tables extended:** `sports` (verify populated), `stat_types` (add canonical keys)

**Seed data:**
- 4 sports (basketball, football, baseball, hockey) + 5 extended (soccer, mma, tennis, college basketball, college football)
- 7+ leagues (NBA, NFL, MLB, NHL, WNBA, NCAAB, NCAAF)
- ~123 teams from V1_REFERENCE_DATA (30 NBA + 32 NFL + 30 MLB + 31 NHL)
- Market families (6) + market types (all from current `MARKET_KEY_MAP` + moneyline/spread/total)
- Stat types (all from current reference data, across all sports)
- Combo stats (PRA, P+A, P+R, R+A for NBA; total bases for MLB)
- Provider market aliases (SGO keys from `SGO_MARKET_KEY_TO_STAT_FIELDS`; Odds API keys)

**Risk:** Low — additive only, no existing tables modified.

### Phase 2: Provider alias mapping
- Populate `provider_entity_aliases` from existing `participants` data (backfill external_id → canonical team/player)
- Populate `provider_market_aliases` from current `MARKET_KEY_MAP` and SGO normalizer logic
- Verify alias resolution matches current behavior

**Risk:** Low — backfill only, no runtime behavior change.

### Phase 3: Smart Form refactor
- Replace `V1_REFERENCE_DATA` lookups with API calls to canonical tables
- Sport → league → team → player cascade from DB
- Market type grid from `sport_market_type_availability`
- Sportsbook selector from `sportsbooks` table
- Player autocomplete from `players` + `player_team_assignments`

**Risk:** Medium — user-facing change. Requires testing with real form submissions.

### Phase 4: Ingestion normalization refactor
- Entity resolver uses `provider_entity_aliases` for cached lookups (instead of fuzzy `namesMatch()`)
- Market normalizer uses `provider_market_aliases` for canonical market key resolution (instead of `MARKET_KEY_MAP`)
- New provider aliases auto-created as `unresolved` for operator review

**Risk:** Medium — changes ingestion path. Requires parallel run to verify no regressions.

### Phase 5: Backfill + reconciliation
- Migrate existing `participants` (player type) → `players` table
- Migrate existing `participants` (team type) → `teams` table
- Create `player_team_assignments` from existing metadata
- Update `picks.market` to use canonical `market_type_id` where mappable
- Flag unmappable picks for operator review

**Risk:** High — modifies existing records. Requires careful backup and validation.

### Phase 6: Operator visibility
- Command Center: taxonomy browser (sports/leagues/teams/players/markets)
- Unresolved alias queue for operator review
- Player team assignment editor
- Market type capability indicator

**Risk:** Low — read-only surfaces.

---

## 11. Risks / Failure Modes

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Canonical drift** — canonical tables diverge from what providers send | Medium | Provider alias tables absorb drift; unresolved aliases are surfaced for review |
| **Provider drift** — provider changes key format without notice | Medium | Ingestor logs unresolved aliases; operator review queue catches new patterns |
| **Duplicate alias creation** — same provider entity gets multiple alias rows | Low | UNIQUE constraint on (provider_key, entity_type, provider_external_id) prevents duplicates |
| **Stale player/team membership** — player traded but assignment not updated | Medium | `player_team_assignments` with `effective_from/until` dates; ingestor roster sync updates |
| **Over-normalization** — canonical model too rigid for edge cases | Medium | `metadata` jsonb columns on every entity provide escape hatch for sport-specific fields |
| **Smart Form coupling to provider labels** — UI shows SGO keys instead of canonical display names | Low | Smart Form reads only from canonical tables; provider labels never surface to UI |
| **Missing fallback paths** — canonical table empty or stale → Smart Form broken | Medium | Static fallback data seeded at Phase 1; `active` flags allow graceful degradation |
| **Migration data loss** — backfill from `participants` to `teams`/`players` loses records | High | Phase 5 runs as additive copy, not destructive move; original `participants` table retained as reference |
| **Sport-league normalization breakage** — current code assumes `sport_id = 'NBA'`; new model uses `basketball` | High | Migration must update all references; dual-key lookup (by old ID or new ID) during transition |

---

## 12. Explicit Recommendations

### Must build first (Phase 1-2)

1. **Create taxonomy tables** — `leagues`, `teams`, `market_families`, `market_types`, `combo_stat_types`, `combo_stat_type_components`, `provider_entity_aliases`, `provider_market_aliases`
2. **Seed core reference data** — sports, leagues, teams, market types, stat types from existing V1_REFERENCE_DATA and MARKET_KEY_MAP
3. **Populate provider alias mappings** — SGO and Odds API market key → canonical market type mappings
4. **Create `players` table** — separate from `participants`; backfill from existing data
5. **Create `player_team_assignments`** — current roster snapshots from ingestor metadata

### Can defer to Phase 7

- Smart Form full refactor (Phase 3) — can use current static data during burn-in
- Ingestion normalizer refactor (Phase 4) — current normalizers work; alias tables add a parallel path
- Full backfill/reconciliation of existing picks (Phase 5) — historical data can be reconciled later
- Operator taxonomy browser (Phase 6)
- `provider_book_aliases` table — current `odds-api:*` sportsbook entries work as stopgap

### Out of scope for this contract

- Live odds streaming / WebSocket integration
- Futures and parlay market support
- Cross-sport player disambiguation (same person, different sport)
- Season/year-based team versioning
- Automated roster sync from external roster APIs
- Provider-specific confidence scoring for alias resolution
- Historical odds archival beyond `provider_offers` snapshots

---

## Authority and Update Rule

This document is T1. Schema changes to canonical taxonomy tables require PM approval. Adding new rows to canonical tables (new team, new market type, new stat) is a data operation that does not require T1 approval — only new table structures or FK changes do.
