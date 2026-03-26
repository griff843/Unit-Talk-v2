# Media Enrichment Support Pack — Unit Talk V2

**Document type:** T2/T3 Support Pack — not a contract, not a readiness decision
**Status:** Active — aligned with T1 Feed Entity Resolution lane
**Non-collision guarantee:** No schema proposals, no implementation code, no Discord command work, no auto-settlement
**Authoritative upstream:** `T1_FEED_ENTITY_RESOLUTION_CONTRACT.md §11` owns all canonical `metadata` key definitions; this doc extends enrichment guidance only

---

## 1. Purpose

The T1 Feed Entity Resolution lane establishes the canonical `metadata` jsonb keys for `participants` and `events` rows and writes whatever SGO provides — leaving future enrichment slots as `null`. This support pack answers what comes next: exact key naming conventions, external ID mapping candidates, fallback rules for missing assets, metadata shape guidance, and how Command Center and Discord surfaces consume these keys.

This doc does not add keys not already ratified by the T1 contract. It clarifies, extends conventions, and defines consumption rules that the T1 lane intentionally deferred.

---

## 2. Ratified Metadata Keys (T1 Contract — Do Not Alter)

These keys are authoritative. Amend only via a T1 contract amendment.

### `participants.metadata` — player rows

| Key | Type | T1 populates from SGO? |
|---|---|---|
| `headshot_url` | `string \| null` | No — set null; future enrichment lane |
| `position` | `string \| null` | No — **not in SGO data**; set null |
| `jersey_number` | `string \| null` | No — set null; future enrichment lane |
| `team_external_id` | `string \| null` | Yes — from `player.teamID` |

### `participants.metadata` — team rows

| Key | Type | T1 populates from SGO? |
|---|---|---|
| `logo_url` | `string \| null` | No — set null; future enrichment lane |
| `abbreviation` | `string \| null` | Yes — from `teams.home/away.names.short` (e.g., `NYK`, `CHA`) |
| `city` | `string \| null` | Yes — from `teams.home/away.names.location` |

### `events.metadata`

| Key | Type | T1 populates from SGO? |
|---|---|---|
| `venue` | `string \| null` | Yes — from `ev.info.venue.name` |
| `broadcast` | `string \| null` | No — not in SGO data; set null |
| `home_team_external_id` | `string \| null` | Yes — from `ev.teams.home.teamID` |
| `away_team_external_id` | `string \| null` | Yes — from `ev.teams.away.teamID` |

---

## 3. Team Logo Key Conventions

**Canonical key:** `participants.metadata.logo_url`

- Single key for all sports. No per-sport variants (`nba_logo_url`, etc.).
- Value: direct HTTPS URL, publicly accessible, no expiry, no auth headers required.
- Consumers read only this key. URL construction logic belongs in enrichment lanes, never in embed builders.

**SGO team external_id format:**
```
{CITY}_{TEAM_NAME}_{SPORT}  — uppercase, underscore-separated
e.g., "NEW_YORK_KNICKS_NBA", "CHARLOTTE_HORNETS_NBA"
```

**Lowest-friction enrichment path for logos:**
The `abbreviation` key is already populated by T1. An ESPN CDN URL can be constructed from it with no new API dependency:
```
https://a.espncdn.com/i/teamlogos/nba/500/{abbreviation.toLowerCase()}.png
e.g., https://a.espncdn.com/i/teamlogos/nba/500/nyk.png
```
Validate reachability before writing. A 404 must not be stored as a `logo_url` value. An unverified URL must be `null`, not stored.

---

## 4. Player Headshot Key Conventions

**Canonical key:** `participants.metadata.headshot_url`

- Single key across all sports.
- Value: same rules as `logo_url` — direct HTTPS, no expiry, no auth.
- Consumers read only this key.

**SGO player external_id format:**
```
{FIRST}_{LAST}_{NUMBER}_{SPORT}  — uppercase, underscore-separated
e.g., "JALEN_BRUNSON_1_NBA", "KARLANTHONY_TOWNS_32_NBA"
```
⚠️ Hyphenated names are compressed (`Karl-Anthony → KARLANTHONY`). Do not parse the external_id to recover a display name. Use `participants.display_name` for all display and lookup purposes.

**Recommended headshot source (not yet contracted):**
ESPN player CDN: `https://a.espncdn.com/i/headshots/nba/players/full/{espn_player_id}.png`
This requires `espn_player_id` — not currently stored. It is the primary unresolved dependency (see §8.1).

---

## 5. External ID Mapping Candidates

IDs in the DB after the T1 lane closes:

| Entity | Field | Format | Example |
|---|---|---|---|
| Team | `participants.external_id` | `{CITY}_{NAME}_{SPORT}` | `NEW_YORK_KNICKS_NBA` |
| Player | `participants.external_id` | `{FIRST}_{LAST}_{NUM}_{SPORT}` | `JALEN_BRUNSON_1_NBA` |
| Event | `events.external_id` | SGO opaque hash | `bIUrzoAFiGovbutrHC2e` |

**Recommended additional IDs for future enrichment (all in `metadata` jsonb — no schema migration needed):**

| New ID | Key path | Purpose | Lowest-friction source |
|---|---|---|---|
| ESPN team ID | `participants.metadata.espn_team_id` | ESPN logo CDN, team data API | ESPN teams endpoint, cross-ref by `abbreviation` |
| ESPN player ID | `participants.metadata.espn_player_id` | ESPN headshot CDN, stats, position | ESPN roster endpoint, cross-ref by `display_name` + team |
| NBA.com player ID | `participants.metadata.nba_player_id` | NBA.com stats, official headshots | NBA stats API, cross-ref by `display_name` |

**ESPN teams bulk lookup (no auth required):**
```
GET https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams?limit=32
```
Returns `id`, `abbreviation`, `logos[]` for all NBA teams. Cross-reference by `participants.metadata.abbreviation` already in DB. Enables `logo_url` and `espn_team_id` population with zero new API keys.


---

## 6. Fallback Rules When No Asset Exists

### 6.1 Player headshot fallback chain
```
1. participants.metadata.headshot_url is a non-empty string → use as embed thumbnail
2. headshot_url is null → look up team via participants.metadata.team_external_id
   → if that team row has metadata.logo_url → use team logo as thumbnail
3. Both null → render embed without thumbnail (text-only; never block post)
```

### 6.2 Team logo fallback chain
```
1. participants.metadata.logo_url is a non-empty string → use as embed thumbnail
2. logo_url is null → render without thumbnail
```

### 6.3 Event-level fallback (spread / total / moneyline picks)
```
1. Resolve home team via events.metadata.home_team_external_id
   → load participants row → use logo_url if present
2. home team logo absent → try away team via away_team_external_id
3. Both absent → render without thumbnail
```

### 6.4 Hard rules — never violate
- Never block a Discord post because an asset is missing.
- Never write a broken, unverified, or 404 URL to `headshot_url` or `logo_url`. Absent asset = `null`.
- Never render a placeholder image (silhouette, question mark) in a public-facing channel. Text-only is correct.
- Never use a headshot where player-to-image match confidence is below 100%. Set `null`; flag for manual review.
- Never construct fallback URLs in embed builders. Asset construction belongs in enrichment lanes only.

---

## 7. Consumption by Command Center and Discord Surfaces

### 7.1 Data access path

Both surfaces read asset keys via `GET /api/operator/events` (new operator route from T1 lane). Response includes `participants[].metadata` in full. No separate asset endpoint is needed.

### 7.2 Discord embed consumption

| Discord surface | Primary asset use | Pick type |
|---|---|---|
| `discord:best-bets` | Team logo or headshot as thumbnail | Both team and player prop picks |
| `discord:trader-insights` | Headshot preferred for player props | Player props primarily |
| `discord:exclusive-insights` | Same as trader-insights | Both |
| `discord:canary` | Same — canary testing surface | Both |
| `discord:game-threads` | Team logo for game context | Team/game only |
| `discord:strategy-room` | TBD — architectural gap in V2 | Unknown |

Embed builder consumption pattern:
```
event → participants[].metadata.headshot_url / logo_url
      → apply fallback chain (§6)
      → embed.setThumbnail(url) or render without thumbnail
```
Asset presence never gates promotion eligibility, routing, or post timing.

### 7.3 Command Center operator-web

- Event list view: team logos as visual row identifiers (fallback: `abbreviation` text)
- Pick detail view: headshot thumbnail in player prop context (fallback: player name text)
- Media is enhancement only. All operator views must remain functional with zero asset coverage.

### 7.4 Enrichment write path

Future enrichment lanes write through `apps/api` via a ratified mutation route. No enrichment lane may write directly to the DB. Single-writer discipline applies to `metadata` updates equally.

Planning-hint route shape (not contracted):
```
PATCH /api/operator/participants/{id}/metadata
body: { headshot_url?: string | null, logo_url?: string | null, ... }
```

---

## 8. Unresolved Enrichment Unknowns

| # | Unknown | Blocker for | Recommended resolution |
|---|---|---|---|
| 8.1 | No headshot source is contracted. ESPN CDN requires `espn_player_id`, which is not stored. No other source has been evaluated. | Player headshot enrichment lane | Evaluate ESPN roster API bulk match by `display_name` + team `abbreviation`. Document match rate. Contract only if ≥90% coverage. Otherwise add manual override as primary path. |
| 8.2 | No logo source is contracted. ESPN CDN is the lowest-friction candidate (`abbreviation`-driven) but is not authorized. | Team logo enrichment lane | Contract ESPN CDN for logos first — no new ID dependency, just `abbreviation` already in DB. Logos are unblocked before headshots. |
| 8.3 | `position` not in SGO data. Confirmed in T1 contract §7.2. Set null for all player rows. | Position display in embeds and Command Center | Bundle position lookup with headshot enrichment lane — ESPN/NBA.com roster APIs provide both. Same API call, same player ID dependency. |
| 8.4 | `broadcast` field has no source. SGO does not provide it. No alternative source identified. | "Airing on ESPN" embed field | Low priority. Defer. Not a blocker for any current surface. |
| 8.5 | SGO `eventID` is an opaque hash, not human-readable. Cross-provider event matching cannot use the SGO ID. | Second-provider event entity resolution | Future second-provider contract must define event matching strategy (by event_name + event_date + team names), not by external_id. Unresolved ID-alignment problem. |
| 8.6 | Multi-sport coverage: ESPN CDN URL patterns differ by sport. NBA `abbreviation`-driven paths do not apply directly to NFL or MLB. Enrichment conventions proven for NBA only. | Non-NBA enrichment | Validate ESPN CDN patterns per sport before extending. Do not assume sport-agnostic correctness from NBA experience alone. |

---

## 9. Authority References

| Document | Role |
|---|---|
| `docs/05_operations/T1_FEED_ENTITY_RESOLUTION_CONTRACT.md §11` | Canonical metadata key definitions — authoritative |
| `docs/discord/discord_embed_system_spec.md` | Embed family rules, asset priority per embed type |
| `docs/discord/discord_embed_system_spec_addendum_assets.md` | Headshot, logo, and fallback policy for Discord embeds |
| `docs/03_product/COMMAND_CENTER_LIFECYCLE_MINIMUM_SPEC.md` | Command Center operator route structure |
| `docs/05_operations/discord_routing.md` | Channel IDs and target strings for Discord surfaces |
| `docs/02_architecture/contracts/writer_authority_contract.md` | Single-writer discipline — enrichment writes go through apps/api |
