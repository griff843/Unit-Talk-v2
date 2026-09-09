# DIFF SUMMARY: UTV2-1856

MERGE_SHA: c840ea827f8d222d0281790252340177b08b79a1

Issue: UTV2-1856
Tier: T1
Lane type: runtime
Branch: claude/utv2-1856-browse-participant-identity
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1536

## Files changed

```
312	19	packages/db/src/runtime-repositories.ts
 72	1	apps/api/src/smart-form-validation.ts
 98	13	apps/api/src/smart-form-validation.test.ts
451	0	packages/db/src/canonical-reference-schema.test.ts
735	0	apps/api/src/t1-proof-utv2-1842-fallback-event-gate.test.ts
206	0	.ops/sync/UTV2-1856.yml            (lane metadata)
 40	0	docs/06_status/lanes/UTV2-1856.json (lane manifest)
```

Every changed source path is inside the lane's pinned `file_scope_lock`, and all five of the
lock's declared paths are now touched.

**`apps/api/src/smart-form-validation.ts` was deliberately untouched through the first two
commits, and the reason it is touched now is a different one.** The browse defect was a
data-layer bug and changing the validator to accommodate it would have loosened a real
control — that reasoning stands and no check was loosened. The edit here is the opposite
shape: it *replaces* a blanket refusal with a verification, and the verification is stricter
than what the refusal protected, because it compares the caller's claimed relationship against
one the server resolved itself rather than merely declining to look.

## `packages/db/src/runtime-repositories.ts` — hunks 5-8: the in-memory / Database parity repair

Added after the un-intercepted browser player prop was measured returning `422
SMART_FORM_RELATIONSHIP_INVALID`. **The server was correct; the harness data could not satisfy it.**
`InMemoryReferenceDataRepository` — the bundle the fail-open runtime builds when no Supabase
credential is present — diverged from `DatabaseReferenceDataRepository` in three ways, and together
they made a successful canonical player prop impossible in the contained harness:

5. **`searchTeams` returned a synthetic id.** It emitted `team:<sport>:<name>`, which no
   `participants.id` can ever equal, while the database path returns `row.id`. Since
   `validateSearchBackedPlayer` compares a player's resolved `teamId` against the team the operator
   selected, the comparison could never succeed. It now answers with the seeded team participant's
   own row id, keeping the synthetic form **only** where no seeded team participant exists — there
   is no real id to return there, and no player to match it.

6. **`searchPlayers` hardcoded `teamId: null`.** It now mirrors
   `DatabaseReferenceDataRepository.searchPlayers`: resolve `metadata.team_external_id` against a
   team participant in the same sport, and return an honest `null` when no relationship can be
   established. A guessed team is never substituted.

7. **Seeded team participants carried `external_id: null`,** so no player could ever link to one.
   They now carry a deterministic key derived from the catalog — not a provider identifier.

8. **One participant array, both repositories.** `createInMemoryRepositoryBundle` builds the team
   and player rows once and hands the same array to the participant repository and the
   reference-data repository, so a team returned by `searchTeams` and the `teamId` a player resolves
   to are the same object by construction rather than by coincidence.

**The player half is opt-in and cannot reach production.** It seeds only when the repository's
existing `UNIT_TALK_QA_SEED_ENABLED` flag is exactly `'true'` — the same flag
`apps/api/src/routes/qa-seed.ts` already gates on and the contained Playwright config already sets —
and is refused outright under `NODE_ENV=production`. A failure to read the environment seeds
nothing; the safe direction is the blank bundle. The default in-memory runtime every unit test
builds is therefore unchanged (`playersAvailable: false`), which `apps/api/src/server.test.ts:1076`
still asserts.

**No server rule was weakened.** `apps/api/src/smart-form-validation.ts` is untouched by this
repair. The 422 disappeared because resolution genuinely succeeds.

`packages/db/src/canonical-reference-schema.test.ts` gains four tests covering exactly these three
divergences plus the opt-in default; each divergence, reverted individually, turns a distinct subset
red (19/22, 20/22, 21/22), and restoring returns 22/22.

## `packages/db/src/runtime-repositories.ts` — hunks 1-4 (+125 / -7)

Four hunks, all inside `DatabaseReferenceDataRepository`.

1. **`getEventBrowse` — an event-scoped team index.** After `teamNameMap` is built, the
   event's own team participants are indexed by `external_id`. Scoping to the event is the
   load-bearing part: a repository-wide index would relate a player to a same-named team from
   a different matchup.

2. **`getEventBrowse` — the player branch.** A player's team is taken from
   `player_team_assignments` when a current assignment exists, and otherwise from the provider
   observation edge (`participants.metadata->>'team_external_id'` matched against the indexed
   team `external_id`). The canonical assignment is consulted first and still wins. Team rows
   are deliberately unchanged.

3. **`getEventBrowse` and `searchBrowse` — proof-fixture exclusion.** A participant whose
   `metadata.proofIssue` is non-null is skipped. This is applied only at these two entry
   points; see the note below on why the search endpoints needed nothing.

4. **`searchBrowse` — the same resolution, indexed per event id.** `searchBrowse` spans many
   events at once, so a single index would be exactly the cross-matchup mistake hunk 1 avoids;
   the map is therefore keyed by `event_id`.

Plus two helpers: `resolveTeamFromParticipantsEdge`, and a shared frozen empty map so a miss
allocates nothing.

## `packages/db/src/canonical-reference-schema.test.ts` (+273)

Five tests, each driving `getEventBrowse` through a fixture harness whose canonical tables are
**deliberately empty** — that is the condition production is actually in, and populating them
would prove the repair against data the system does not have. The fifth test pins the boundary
that a `proofIssue` of JSON `null` names no issue and is therefore not a confirmed fixture.

## `apps/api/src/t1-proof-utv2-1842-fallback-event-gate.test.ts` (+735)

**Seven** live-DB tests appended to the existing smart-form fallback proof suite, taking it from
7 to 14, each with its own `after` cleanup hook and a leak assertion pinned to this lane's own
`utv2-1856-` prefix rather than reusing the preceding lane's. Counted from the file rather than
recalled:

```
UTV2-1856 live DB: browse resolves the player team from participants while teams and
                   player_team_assignments stay empty
UTV2-1856 live DB: a canonical-event TEAM pick submits, persists its participant ids and
                   values, and creates no delivery row
UTV2-1856 live DB: a canonical-event PLAYER PROP submits, persists both participant ids and
                   its values, and creates no delivery row
UTV2-1856 live DB: the canonical player-prop path still refuses a player who is not on the
                   named team
UTV2-1856 live DB: a confirmed proof fixture attached to an event cannot be submitted as a
                   player prop
UTV2-1856 live DB: a structured NO-EVENT player prop resolves the team from participants,
                   persists honest no-event provenance, and creates no delivery row
UTV2-1856 live DB: a structured NO-EVENT player prop is refused when the player is on neither
                   entered side
```

The first five cover the canonical-event path, which the suite did not previously exercise at
all, on both submission shapes and with two refusal controls. The last two are the no-event
structured-fallback path — the one Griff's directive names — and they are the reason the
release criterion is a *complete* contained submission demonstration rather than a repaired
lookup: the admitting test asserts persistence and non-delivery, and the refusing test asserts
the membership control that admission does not remove.


## `packages/db/src/runtime-repositories.ts` — the fifth hunk (+42 / -2)

**`resolveCanonicalPlayerId` + `resolvePickForeignKeys`.** `picks.player_id` is a foreign key
into the canonical `players` table; `metadata.playerId` carries the submitting surface's
identity, which for the Smart Form is a `participants.id`. Writing it through unchecked makes
every player prop fail on `picks_player_id_fkey` while canonical player coverage is absent —
which is what CI run `34209883355` did. The new resolver performs the same existence check
`capperId` already uses and returns `null` on a miss; `resolvePickForeignKeys` computes it once
and returns it from both of its return statements, and the two 8-space call sites read
`player_id: foreignKeys.playerId`. `mapPickToRecord` (the InMemory path) is unchanged on
purpose — InMemory enforces no FK.

## `apps/api/src/smart-form-validation.ts` (+72 / -1)

One line removed, one function added.

Removed: the unconditional `fail('canonical player selection requires a canonical event so team
membership can be verified')` in `validateStructuredTeamFallback`.

Added: `validateSearchBackedPlayer`, which resolves the player through
`referenceData.searchPlayers(sportId, displayName, 25)` and then checks, in order — the identity
is a player; reference data knows it for this sport; the display name matches; a team
relationship exists at all (refusing to the manual path when it does not); that team is one of
the two entered sides; it agrees with any explicitly selected team; and it agrees with the
caller's own `identity.teamId`. The caller's value is only ever a comparand.

## Not changed, on purpose

- **No production or staging row is deleted.** The 26 confirmed proof fixtures in production
  stay exactly where they are; the repair is a read filter. Production data deletion is a
  reserved decision.
- **No canonical table is seeded.** Populating `teams` / `player_team_assignments` would mean
  unparking provider ingestion, which containment forbids for the duration of Milestone 1.
- **No client change.** `BetForm` already keys its picker on `team.teamId ?? team.participantId`,
  which is the team participant id while `teams` is empty — the same id this change now emits
  as the player's `teamId`.
