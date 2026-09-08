# DIFF SUMMARY: UTV2-1856

MERGE_SHA: pending merge

Issue: UTV2-1856
Tier: T1
Lane type: runtime
Branch: claude/utv2-1856-browse-participant-identity
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1536

## Files changed

```
167	9	packages/db/src/runtime-repositories.ts
 72	1	apps/api/src/smart-form-validation.ts
 98	13	apps/api/src/smart-form-validation.test.ts
273	0	packages/db/src/canonical-reference-schema.test.ts
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
