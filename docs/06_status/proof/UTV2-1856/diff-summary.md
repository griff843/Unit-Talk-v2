# DIFF SUMMARY: UTV2-1856

MERGE_SHA: pending merge

Issue: UTV2-1856
Tier: T1
Lane type: runtime
Branch: claude/utv2-1856-browse-participant-identity
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1536

## Files changed

```
125	7	packages/db/src/runtime-repositories.ts
273	0	packages/db/src/canonical-reference-schema.test.ts
530	0	apps/api/src/t1-proof-utv2-1842-fallback-event-gate.test.ts
206	0	.ops/sync/UTV2-1856.yml            (lane metadata)
 40	0	docs/06_status/lanes/UTV2-1856.json (lane manifest)
```

Every changed source path is inside the lane's pinned `file_scope_lock`. Two paths the lock
also declares — `apps/api/src/smart-form-validation.ts` and its test — are **not** touched:
the validation contract is correct as written, and the defect was that the repository handed
it a `teamId` of `null`. Changing the validator instead would have loosened the participant
relationship check to accommodate a data-layer bug.

## `packages/db/src/runtime-repositories.ts` (+125 / -7)

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

## `apps/api/src/t1-proof-utv2-1842-fallback-event-gate.test.ts` (+530)

Four live-DB tests appended to the existing smart-form fallback proof suite, with their own
`after` cleanup hook and a leak assertion pinned to this lane's own `utv2-1856-` prefix rather
than reusing the preceding lane's. They cover the canonical-event path, which the suite did
not previously exercise at all, on both submission shapes and with two refusal controls.

## Not changed, on purpose

- **No production or staging row is deleted.** The 26 confirmed proof fixtures in production
  stay exactly where they are; the repair is a read filter. Production data deletion is a
  reserved decision.
- **No canonical table is seeded.** Populating `teams` / `player_team_assignments` would mean
  unparking provider ingestion, which containment forbids for the duration of Milestone 1.
- **No client change.** `BetForm` already keys its picker on `team.teamId ?? team.participantId`,
  which is the team participant id while `teams` is empty — the same id this change now emits
  as the player's `teamId`.
