# Reference-Data Audit and Production-Write Authorization Packet — 2026-09-13

**This packet authorizes nothing.** It is a read-only audit plus a *prepared* authorization for a production
data write that remains **reserved decision 1** (`docs/mission/intent.md`). No SQL was run to produce it beyond
the read-only measurements supplied to the author; nothing was written to any database or to the repository.

Production project: `zfzdnfwdarxucxtaojxm`. Measurements taken read-only 2026-09-13 ~14:05Z (cited "measured").
Every other number is cited to a repo file or a public source; where a source was unreachable it says so.

---

## 1. Mechanisms that exist in the repo, and what each can and cannot populate

The live catalog the Smart Form searches is `participants` (`apps/api/src/handlers/reference-data.ts:31-38`
calls `repository.searchTeams` / `searchPlayers` against it). The canonical `teams` / `players` /
`player_team_assignments` tables are the *policy* backbone and are effectively empty (measured: `players` 12
fixture rows, `player_team_assignments` 0, `participant_memberships` 0).

| Mechanism | Location | Writes | Needs SGO key? | Can fill NFL players? | Can fill NCAAF teams? |
|---|---|---|---|---|---|
| Governed static team seed | `supabase/migrations_archive/202603200008_reference_data_foundation.sql:281-315` (`INSERT INTO participants … 'team:NFL:Cardinals'`), rekeyed by `202604230001_utv2_719_fix_team_external_ids_and_league.sql` to `CITY_TEAM_NFL` with `metadata.legacy_external_id` | `participants` (teams only) | **No** | No | **Yes — this is the only sanctioned route.** Policy §2: teams "cannot be created from a provider observation alone — must be seeded from governed data or operator-approved". `V1_REFERENCE_DATA` (`packages/contracts/src/reference-data.ts:178-181`) has `teams: []` for NCAAF, so a governed list must be *authored* first. |
| Ingestor entity resolver | `apps/ingestor/src/entity-resolver.ts:216-235` — `participants.upsertByExternalId({participantType:'player', metadata.team_external_id: player.teamId})` from an SGO **event** payload | `participants` (players), `events`, `event_participants` (`write-surface.ts:26-30`) | **Yes** — players come from live `get_events` | Only if SGO returns NFL player entities; `SUPPORTED_SGO_LEAGUES = ['NBA','NFL','MLB','NHL']` (`ingestor-runner.ts:32`), but the policy's own §8.2 records "NFL (0 players — expected; SGO doesn't return NFL player data currently)" and production has 0 NFL players (measured) despite NFL being a supported league | No — NCAAF is not in `SUPPORTED_SGO_LEAGUES`; the resolver never creates teams anyway |
| Canonical bootstrap RPC | `bootstrap_canonical_reference_data()` (`supabase/migrations/00000000000000_baseline_live_schema.sql`), driver `scripts/run-canonical-reference-bootstrap.ts`, hardened on PR #1484 (UTV2-1773) | `teams`, `players`, `provider_entity_aliases`, `player_team_assignments` — **derived from existing `participants`** | No | No — it copies, it does not discover | No |
| Alias backfill | `scripts/backfill-sgo-participant-aliases.ts:78` — inserts `provider_entity_aliases` for `market_universe.provider_participant_id` values matching `participants.external_id` | `provider_entity_aliases` | No | No | No |
| Gap report | `scripts/report-canonical-reference-bootstrap.ts` | read-only | No | — | — |
| `player_team_assignments` writer | **None on `main`.** Policy §8 table lists "Ingestor writes `player_team_assignments` from event rosters — P1" as *not yet automated*; the ingestor writes only `metadata.team_external_id`. | — | — | — | — |

**Exact answer to the question asked.**
- **NCAAF teams:** an authored governed static seed into `participants` (and, if PM wants the canonical backbone
  to match, `teams`). No provider, no key. The V1 catalog carries no NCAAF list, so the list must be authored from
  an authoritative source (§2) and reviewed as governed data.
- **NFL players:** no static source exists in the repo. The only *implemented* writer is the ingestor resolver,
  which requires (a) an active SGO key (decision 4) and (b) SGO actually emitting NFL player entities, which the
  policy records it did not. A static roster seed from a public source (§2) would be a **new** mechanism — a
  governed seed file plus a one-shot script — not a reuse of anything on `main`.
- **PR #1484** does not close either gap. Its own `diff-summary.md` (branch `codex/utv2-1773-canonical-reference-bootstrap`)
  records a **zero-write production packet**, refused on `UNGOVERNED_TEAM_IDENTITY` because the live NHL row is
  `Utah Hockey Club` while `V1_REFERENCE_DATA` still says `Coyotes` (`reference-data.ts:153`), and on a sportsbook
  count conflict (policy says 15, catalog 11). It hardens the *teams/players/aliases* copy from `participants`; it
  adds no rows to `participants`.

## 2. Authoritative public sources for today (2026-09-13)

| Item | Finding | Source |
|---|---|---|
| NFL 2026 franchise count | 32. The measured 32 nicknames match `V1_REFERENCE_DATA` NFL (`reference-data.ts:109-116`) one-for-one: Cardinals … Commanders. No relocation or rename for 2026 surfaced in search; the only item found is a Jets stadium note, not an identity change. | [NBC 2026 kickoff guide, all 32 teams](https://www.nbcnews.com/sports/nfl/nfl-kickoff-season-preview-2026-all-teams-rcna594317); [ESPN 2026 cutdown tracker, all 32 teams](https://www.espn.com/nfl/story/_/id/49681232/2026-nfl-cuts-all-32-teams-cutdown-moves-updates-tracker) |
| NFL 53-man rosters | Options: team sites (official initial 53 announced ~2026-08-26, e.g. [Giants](https://www.giants.com/news/roster-update-giants-announce-initial-53-man-roster-for-2026-nfl-season-week-1-john-harbaugh)); ESPN public roster feed (used by [Predict the 53](https://www.predictthe53.com/)); NFL.com and Pro-Football-Reference (not fetched here — no formal API confirmed; PFR terms restrict scraping); SGO `get_players(leagueID:"NFL")` **if** the key is active (returns `playerID, names, position, jerseyNumber, teamID, playerTeams` — `PROVIDER_KNOWLEDGE_BASE.md:633`). Expected volume: 32 × 53 = **1,696** active-roster players, plus practice squads (16–17 each) if wanted. | [ESPN 53-man projections](https://www.espn.com/nfl/story/_/id/49609341/2026-nfl-53-man-roster-projections-every-team-positions-cuts) |
| FBS team count 2026 | **138** per ESPN's 2026 realignment page (its SP+ link reads "all 138 FBS teams"); Deseret reported **136** as of July 2025 before North Dakota State and Sacramento State moved up from FCS for 2026 (136 + 2 = 138, consistent). Treat 138 as the working target and confirm against the NCAA's official FBS list before authoring the seed — I did not fetch an NCAA roster-of-schools page. | [ESPN 2026 realignment](https://www.espn.com/college-football/story/_/id/49498819/college-football-conference-changes-realignment-fbs); [Deseret, 136 after CUSA adds](https://www.deseret.com/sports/2025/07/05/how-many-fbs-teams-conference-realingment-expansion/); [FBSchedules, changes effective 2026-07-01](https://fbschedules.com/college-football-realignment-conference-changes-for-2026-take-effect-today/) |
| NCAAF 2026 realignment affecting identity | Conference moves only, **no school name changes found**: Pac-12 reforms as 8 (Boise St, Colorado St, Fresno St, Oregon St, San Diego St, Texas St, Utah St, Washington St); Louisiana Tech → Sun Belt; UTEP, Northern Illinois, North Dakota State → Mountain West; Sacramento State → MAC (from FCS). Conference is not part of the proposed `external_id`, so these do not change identity keys; they matter only if a `metadata.conference` field is seeded. | same as above |
| NHL identity drift (found in passing) | Production carries `UTAH_HOCKEY_CLUB_NHL` (measured; `202604230001…sql:118` maps `Coyotes`→`UTAH_HOCKEY_CLUB_NHL`). `V1_REFERENCE_DATA` still says `Coyotes`. The franchise's current name was not re-verified here; the repo's own two sources already disagree, which is what #1484 refuses on. | repo files cited |

## 3. Findings

### 3.1 Missing entities (measured)

| Sport | Teams | Players | In season now? | Consequence for the Smart Form |
|---|---|---|---|---|
| MLB | 30 | 951 | Yes (regular season ends late Sept) | Team and player picks resolve; roster staleness risk (§3.2) |
| NFL | 32 | **0** | Yes (Week 2) | Team-vs-team resolves canonically; **every player prop falls to coverage-gap** |
| NCAAF | **0** | **0** | Yes | **Every pick falls to coverage-gap** |
| NBA / NHL | 30 / 32 | 254 / 318 | No (preseason Oct) | Fine for now; rosters 2.5–5 months stale before opening night |
| Soccer (MLS in season), Tennis (US Open concluded), MMA, NCAAB | 0 | 0 | Soccer/MMA yes | Coverage-gap only; `leagues`/`sports` rows exist (9 each, measured) so the sport is selectable |

`events`: max `event_date` 2026-07-02, 0 future, sports MLB/NBA/NHL only (measured). So even where teams exist,
the tier reached is "structured team fallback" (`eventId: null`), never "canonical + event" (intent §4).

### 3.2 Stale team assignments
Player→team lives **only** in `participants.metadata.team_external_id` (measured keys: position, headshot_url,
jersey_number, team_external_id), written by the resolver at ingest time (`entity-resolver.ts:233`) and last
touched ≤ 2026-07-01 (measured). There is no `player_team_assignments` row to date-bound it. Risk, concretely:
the MLB trade deadline (2026-07-31) and September call-ups both post-date every player row, so a player-prop pick
entered today may resolve a real canonical player ID attached to the **wrong** team in metadata. The Smart Form
`teamId` filter on player search (`participant-search.ts:58-59`) would then hide traded players under their new
club and show them under the old one. This is a *display/filter* defect, not a provenance defect — the player ID
is still correct — but it must be named in any seed packet so the fix (append-only assignments) is scoped.

### 3.3 Duplicate identities
None by `display_name` within any sport/type (measured). Alias risk: every team row carries two identifiers —
`external_id` (`SAN_FRANCISCO_49ERS_NFL`) and `metadata.legacy_external_id` (`team:NFL:49ers`). Any new seed
must use the SGO-style `external_id` as the idempotency key and must **not** re-introduce `team:` keys, or the
`upsertByExternalId` onConflict path will create a second row per team.

### 3.4 Unresolved aliases
`provider_entity_aliases`: 840 rows, all `provider=sgo entity_kind=player`, **0 team aliases**, last updated
2026-04-25 (measured). Consequences: (a) every SGO team offer, if ingestion ever resumes, is resolved by
`external_id` string equality rather than an alias row — it works today only because UTV2-719 made
`participants.external_id` *equal* the SGO team ID; (b) 840 of 1,523 players (55%) have an alias, 683 do not;
(c) #1484's completeness criterion requires 100% team-alias coverage and currently measures 0.

## 4. Prepared production-write authorization (NOT requested, NOT performed)

**Reserved:** production data writes are decision 1. Rollback by delete is *also* decision 1 (see below).

| Field | Content |
|---|---|
| Tables | `participants` only, in this order: (1) NCAAF teams, (2) NFL players. **No** write to `teams`/`players`/`player_team_assignments` in this packet — the canonical backbone is #1484's domain and is refused until the NHL/sportsbook conflicts are PM-resolved. |
| Expected rows | NCAAF teams: **138** (§2; confirm against the NCAA list before authoring). NFL players: **1,696** (32 × 53) active roster; practice squad optional and, if included, flagged in `metadata.roster_status`. |
| Idempotency key | `external_id`, SGO format: teams `CITY_NICKNAME_NCAAF` (must match SGO's `teamID` scheme — verify one live key via `get_teams(leagueID:"NCAAF")` if the key is active; otherwise record `metadata.id_scheme: 'authored'`); players `FIRST_LAST_1_NFL` **only** if taken from SGO — an authored seed from ESPN/team sites must use a distinct namespaced key (e.g. `espn:<id>`) and never guess SGO's `_1_` disambiguator. |
| Provenance on every row | `metadata.seeded_from` (source URL/file + fetch date), `metadata.source: 'governed-seed'` or `'manual'`, `metadata.seed_batch_id` (one UUID per run) — policy §2 "Provenance requirements". |
| No deletes, no updates to history | INSERT … ON CONFLICT (`external_id`) DO NOTHING. Existing rows are not touched. Player→team is recorded as a **new** `metadata.team_external_id` on new rows only; for existing MLB/NBA/NHL players a later, separate packet appends `player_team_assignments` rows with `effective_from` and closes the prior one with `effective_until` (policy §5) — never rewrites `metadata.team_external_id` in place. That table has no writer on `main`, so that packet needs code first. |
| Mechanism to reuse | The governed-seed shape already used: a migration-style SQL file under `supabase/migrations/` mirroring `202603200008…sql:281-315` (teams) — this is DDL-free data but still lands via the migration workflow, so `pnpm supabase:types` is unaffected. For players, a new `scripts/seed-nfl-rosters.ts` reading a checked-in JSON and calling `participants.upsertByExternalId` through the existing `INGESTOR_WRITE_SURFACE`-listed method, gated by `assert-staging-target.ts` for its two-pass staging proof exactly as #1484 does (`self-test` + second-run no-op). |
| Evidence to attach | (1) this audit; (2) the authored seed file with per-row source; (3) staging two-pass run: pass 1 row counts = expected, pass 2 = 0 inserts, both against `xskgrzbteyqdufktjrjx`; (4) a read-only production pre-image: `SELECT sport, participant_type, count(*) FROM participants GROUP BY 1,2` and `max(updated_at)`; (5) the diff = expected post-image minus pre-image, row-exact. |
| Non-secret success criterion | After the run: `participants` NCAAF/team = 138 and NFL/player = 1,696 (or the confirmed authored counts); MLB/NBA/NHL counts and `max(updated_at)` for those sports unchanged; `SELECT count(*) FROM participants WHERE metadata->>'seed_batch_id' = '<id>'` equals the sum of inserts; `GET /reference-data/availability?sport=NCAAF` returns `teamsAvailable: true`. |
| Rollback | `DELETE FROM participants WHERE metadata->>'seed_batch_id' = '<id>'` (or by `created_at` window) is a production **deletion** — itself reserved decision 1 and policy §6 forbids deleting canonical entities (soft-deactivate only). So the rollback is `UPDATE … SET active=false` by batch id if an `active` column is used by the search path, else a second reserved decision. State this in the ask; do not present delete-by-batch as pre-authorized. |
| Blast radius | Read paths: Smart Form search/availability, `findCanonicalCoverage` (which will start *refusing* manual NCAAF overrides once teams exist — intended). No pick, submission, outbox or grading row is touched; containment settings untouched. |

**Still reserved after this packet:** the SGO key check (decision 4, prepared in
`RESULTS_BACKFILL_AUTHORIZATION_PACKET.md`) — needed only if SGO is chosen as the player source; a paid provider
commitment (decision 3) if the key is inactive; the write itself (decision 1); any `player_team_assignments`
appends for existing players (decision 1, plus code). Provider ingestion stays parked throughout; nothing here
depends on unparking (intent §4.1 table: seeding and provider activation are independent).

## 5. What the Smart Form can do today, with no write at all

An NFL **team-vs-team** pick (moneyline, spread, total) resolves through the structured-team tier: both sides get
real canonical participant IDs from the 32 measured NFL team rows, `eventId: null` because no future event
exists, provenance `canonical` for participants and honest about the missing event — the same shape as the
Milestone 1 pick. An NFL **player prop**, and **every** NCAAF, MLS, tennis or MMA pick, cannot resolve a
participant and falls to the explicit manual `canonical-coverage-gap` path with `null` participant IDs, which
`findCanonicalCoverage` will permit because the catalog genuinely lacks them. MLB player props resolve today but
may show a traded or called-up player under a stale team filter (§3.2). All of this is the intended honest
fallback, not a defect; the packet above is what turns coverage-gap into canonical for two sports in season.
