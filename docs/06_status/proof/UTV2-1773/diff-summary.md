# UTV2-1773 canonical reference bootstrap diff summary

## Measurable completeness criterion

This criterion was recorded before any bootstrap execution. It is derived from
the currently checked-in governed sources; no provider observation is promoted
to canonical identity merely because it exists.

| Table / bridge                     | Required measurable state                                                                                                                                                                                                                                                                                                                                                     | Source of the requirement                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `leagues`                          | Exactly the 9 governed mappings are present: `nba→NBA`, `nfl→NFL`, `mlb→MLB`, `nhl→NHL`, `ncaab→NCAAB`, `ncaaf→NCAAF`, `soccer→Soccer`, `mma→MMA`, `tennis→Tennis`. Coverage target: 9/9 (100%).                                                                                                                                                                              | `packages/contracts/src/reference-data.ts`; ratified T1 reference-data policy                               |
| `teams`                            | All 124 governed team identities in `V1_REFERENCE_DATA` are present with IDs `{lowercase league}:{normalized governed team name}`: NBA 30/30, NFL 32/32, MLB 30/30, NHL 32/32. No source row may create an additional team or map to a different canonical ID. Coverage target: 124/124 (100%), duplicate/conflict count 0.                                                   | `packages/contracts/src/reference-data.ts`; ratified T1 reference-data policy                               |
| `provider_entity_aliases` (team)   | Every distinct nonblank SGO team key derivable from `events` + `event_participants` resolves to exactly one of the governed team IDs. Coverage target: 100%; ambiguous, conflicting, or unresolved keys: 0.                                                                                                                                                                   | Existing bootstrap source contract plus the policy that provider observations do not own canonical identity |
| `provider_entity_aliases` (player) | Every distinct nonblank SGO player external ID selected by the bootstrap resolves to exactly one source participant/player identity. Coverage target: 100%; duplicate-key conflicts: 0.                                                                                                                                                                                       | Existing bootstrap source contract                                                                          |
| `players`                          | Every conflict-free, in-league player participant selected by the existing RPC has one canonical player row with the same UUID. Coverage target: 100%; identity conflicts: 0.                                                                                                                                                                                                 | Existing bootstrap source contract                                                                          |
| `player_team_assignments`          | Every player with a nonblank `metadata.team_external_id` has exactly one derivable current assignment through an unambiguous team alias, or is enumerated as an unresolved gap. Duplicate current assignments for the same player/team are forbidden.                                                                                                                         | Existing bootstrap source contract                                                                          |
| `sportsbooks`                      | **Not yet certifiable.** The ratified seeding policy says 15 active books; the current runtime catalog enumerates 10, while schema history seeded 11 and later deactivated SGO/provider labels. This lane will not invent a target or mutate this table. The exact existing rows and active flags must be included in the fresh production read packet for PM reconciliation. | Conflicting governed sources; fail-closed disposition                                                       |

For the intended game-line/event-resolution path, the pass condition is all 9
leagues, all 124 governed teams, and 100% of observed SGO team keys linked to a
single governed team. Any missing governed team, extra provider-derived team,
duplicate canonical ID, or ambiguous alias is a hard refusal, not a partial
success.

## Read-only production baseline

The latest checked-in read-only production evidence located before execution is
the UTV2-1384 snapshot against project `zfzdnfwdarxucxtaojxm` on 2026-07-06:

- `leagues`: 9
- `teams`: 0
- `players`: 12 (identified there as proof fixtures)
- `player_team_assignments`: 0
- `provider_entity_aliases`: 840; all player-kind and all canonical links null
- `participants`: 1,647

This establishes the known empty/missing state but is not fresh enough to
authorize a production mutation. UTV2-1773 requires a new read-only inventory
and exact candidate diff from the hardened script before its production packet
can be marked executable.

## Fresh production API observation — 2026-09-02

The deployed API at `https://api.unit-talk.com` reported healthy database-backed
operation at deployment `e48106fc9a5eb5904b322833d0968da5ae0b0665`.
Read-only GET requests established:

- all 9 league mappings above are present;
- `teamsAvailable=false` and `playersAvailable=false` for every one of the 9
  sports (the availability handler performs a canonical team/player search);
- the live source catalog contains NBA 30, NFL 32, MLB 30, and NHL 32 team
  observations (124 total);
- the live source catalog contains 11 active sportsbooks.

The fresh read also exposed two governed-source conflicts:

- live production source catalog: NHL `Utah Hockey Club`; checked-in
  `V1_REFERENCE_DATA`: NHL `Coyotes`;
- live production active sportsbook set includes `williamhill`; checked-in
  `V1_REFERENCE_DATA` does not, while the ratified policy separately says 15.

Those are not silently reconciled. The hardened bootstrap derives the candidate
identity and refuses `UNGOVERNED_TEAM_IDENTITY` for the NHL mismatch. The
production packet therefore authorizes **zero writes** until PM resolves the
canonical NHL identity and a direct read supplies the alias/participant IDs
needed for an exact diff. The API observations prove the empty resolution
surface, but they intentionally do not expose provider alias keys or source
participant UUIDs and cannot substitute for that direct read.

## Scope fence

Production execution is out of scope. This lane may read production to derive a
packet, but the bootstrap RPC may run only when the target is positively
identified as staging project `xskgrzbteyqdufktjrjx`. Provider resubscription,
ingestion restart, member delivery, and production mutation remain forbidden.
