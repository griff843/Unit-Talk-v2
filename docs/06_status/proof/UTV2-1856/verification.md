# PROOF: UTV2-1856

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-08T10:20:00.000Z
Issue: UTV2-1856
Tier: T1
Lane type: runtime
Branch: claude/utv2-1856-browse-participant-identity
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1536
Head SHA: 762a97afea7fabe1d7e5b92901bb9580203fdd37
result: pass

## ASSERTIONS:

- [x] **The defect was measured on the executing path, not inferred.** `getEventBrowse` resolved a
  player's team identity through exactly two sources — `loadCanonicalTeamsByParticipantIds`
  (`provider_entity_aliases` where `entity_kind='team'` → `teams`) and `loadCurrentAssignments`
  (`player_team_assignments`). Production holds **0 team aliases, 0 `teams` rows and 0
  `player_team_assignments` rows**, so both maps are empty unconditionally and every browse player
  came back with `teamId: null`. The consequence was not cosmetic: `smart-form-validation.ts:401-406`
  refuses a submission when a player row carries no `teamId`, and `BetForm.tsx:909,957` filters the
  player picker on `participant.teamId === selectedTeamId`, so the picker rendered empty and the
  API refused the pick even if a player were chosen. Team-only picks were unaffected, which is why
  the defect survived UTV2-1854.
- [x] `getEventBrowse` now resolves a player's team from the **provider observation edge** —
  `participants.metadata->>'team_external_id'` matched against the `external_id` of a team
  participant **on the same event** — whenever no canonical `player_team_assignments` row exists.
  The canonical assignment is still consulted first and still wins. Reverting this fallback turns
  2 tests red.
- [x] The index is **event-scoped, and that is load-bearing**. A repository-wide index would relate a
  player to a same-named team from a different matchup. A test constructs exactly that: a player
  whose `team_external_id` names a team that exists but is not attached to this event stays
  unrelated (`teamId: null`) rather than borrowing it. Falling through to any matching team turns
  that test red.
- [x] `teamName` is resolved from the same source as `teamId`, so a row can never report an
  identified team with an anonymous name. Dropping only the name half turns 1 test red.
- [x] `searchBrowse` carries the identical repair, keyed **per event id** rather than globally, for
  the same cross-matchup reason — `searchBrowse` spans many events in one call, so a single flat
  index there would be precisely the mistake the event-scoped index in `getEventBrowse` avoids.
- [x] **A confirmed proof fixture is excluded from browse and from the picker.** A participant whose
  `metadata.proofIssue` is non-null is skipped in both `getEventBrowse` and `searchBrowse`. This is
  the same `isConfirmedProofFixture` predicate UTV2-1854 landed, applied at the two entry points
  UTV2-1854 did not reach.
- [x] **Where an existing control already guaranteed it, that control is proven rather than
  duplicated.** `handleSearchPlayers` and `handleSearchTeams` intersect UTV2-1854's already-filtered
  repository results with the event's participants, so a fixture cannot enter through them and no
  second filter was added there. `getEventBrowse` and `searchBrowse` are *not* reached through those
  handlers, which is why the predicate was applied only to those two.
- [x] **The exclusion is demonstrated against a constructed fixture, not against the absence of
  one.** Production today has zero `proofIssue`-marked participants attached to any event, so
  current data cannot exercise this criterion — and that is a reason to construct the case, not to
  drop it. Both the unit suite and the live-DB suite create a marked participant, **attach it to an
  event**, and give it a *valid* `team_external_id` so it would otherwise resolve and be selectable.
  Operational browse excludes it while the legitimate player beside it — same event, same team key —
  is retained. Unwiring the exclusion turns 1 unit test and 1 live test red.
- [x] A `proofIssue` that is JSON `null` names no issue, is therefore not a *confirmed* fixture, and
  is kept — asserted as its own boundary test.
- [x] **No row is deleted and no table is seeded.** The 26 confirmed proof fixtures in production
  stay exactly where they are; the repair is a read filter. Production data deletion is reserved
  decision 1. The canonical `teams` / `players` / `player_team_assignments` tables stay empty:
  populating them would require unparking provider ingestion, which containment forbids for the
  duration of Milestone 1.
- [x] **No validation contract was loosened, and the one validator change tightens rather than
  relaxes.** For the browse defect, `apps/api/src/smart-form-validation.ts` was deliberately left
  alone: the participant-relationship check at `:401-406` and `:440-450` is correct as written, and
  the defect was that the repository handed it a `teamId` of `null`. Changing the validator there
  would have weakened a real control to accommodate a data-layer bug, and it was not changed. The
  separate edit that *is* in this diff replaces a blanket refusal — which verified nothing, it
  simply declined to look — with `validateSearchBackedPlayer`, which resolves the relationship from
  reference data the server reads itself and refuses on five distinct conditions. **A pick that
  could not be submitted at all before can now be submitted only if the database confirms it**; no
  previously-refused-for-cause case is now admitted. Two live controls assert the pre-existing
  refusals still hold: a player who is not on the named team, and a fixture named directly by id.
- [x] **No client change was needed, and that was verified rather than assumed.** `BetForm` sets
  `selectedTeamId` from `team.teamId ?? team.participantId` — the team *participant* id while the
  canonical `teams` table is empty — which is exactly the id this change now emits as the player's
  `teamId`. The ids line up by construction.
- [x] **The classification was corrected before the lane opened.** `packages/db/src/runtime-repositories.ts`
  is on `TIER_C_EXACT_PATHS` in `scripts/ops/merge-risk.ts`, so `classifyMechanicalMinimum` returns
  `T1` with `rule_id: tier-c-exact`. An earlier draft proposed T3; that was wrong and the lane was
  opened at T1 under the ratified route B admission instead of being reclassified down.
- [x] **`picks.player_id` is resolved against the canonical `players` table rather than written
  through.** This was found by CI, not by reading: run `34209883355` failed the live player-prop
  tests on `picks_player_id_fkey`. `metadata.playerId` carries whatever identity the submitting
  surface had, and for the Smart Form that is a `participants.id` — a different id space from
  `players.id`, which the FK targets. Measured on production: `players` holds **12** rows, **0** of
  **840** player aliases resolve to one, and **6016** picks carry `participant_id` against **12**
  carrying `player_id`. `resolveCanonicalPlayerId` now performs the same existence check
  `capperId` already uses and yields `null` on a miss. **No identity is lost by that null** — the
  observation-layer id is carried by `picks.participant_id` (FK → `participants`, which the same
  value satisfies) and by `metadata.participantResolution`. `mapPickToRecord`'s InMemory path is
  deliberately unchanged, because InMemory enforces no FK. The pre-existing hit case is already
  locked by `t1-proof-runtime-truth-spine.test.ts:60-108`, which creates the `players` row first and
  asserts `player_id === participant.id`; the miss case is asserted live below.
- [x] **A database-backed player selection is admitted when no upcoming canonical event exists.**
  The structured no-event fallback previously refused *every* player selection with *"canonical
  player selection requires a canonical event so team membership can be verified"*. That premise was
  true when written: membership was then derivable only from `player_team_assignments`, which an
  event browse read, and containment leaves that table empty. `searchPlayers` now answers with a
  team `participants.id` resolved from the observation edge — the same id space the two structured
  sides are expressed in — so membership is verifiable here, against the same authority, with no
  event row involved. Reverting to the blanket refusal turns 5 tests red.
- [x] **The caller's own `teamId` is never the source of the relationship.** `validateSearchBackedPlayer`
  resolves the team from reference data the server reads itself and only *compares* the caller's
  claim against it. The control is deliberately constructed so that every other check would pass:
  the claimed team is a legitimate side of the entered matchup *and* the selected team, and only the
  comparison against resolved truth refuses it. Making the caller's value the source turns 1 test red.
- [x] **The refusal is kept for the case where it is still true.** A player whose team relationship
  the database cannot establish is refused and directed to the explicit manual path — inventing a
  relationship to admit the pick would be exactly the fabricated provenance that path exists to
  avoid. Accepting a null relationship turns 1 test red; dropping the both-sides membership check
  turns 1 unit test and 1 live test red.
- [x] **No contract change was required, and that was checked rather than assumed.**
  `CanonicalParticipantResolution` already permits `eventId: null` alongside canonical participant
  identities, `waivesEventExistenceGate` already waives the event-existence gate for
  `structured-team-fallback` + `track-only`, and `BetForm.tsx:2025` already requires and sends a
  canonical player in structured-fallback mode. **Live event ingestion is therefore not a
  prerequisite for contained Track Only submission**, and the only change needed was the one
  server-side refusal.
- [x] `pnpm verify` passes on this head through lint, type-check, build and the full unit suite —
  **6074 tests, 6074 pass, 0 failures across 100 wired suites** — and the required CI `verify` check
  is green on the same head.
- [x] The live-DB step was **deferred to CI and obtained there**: `Writable DB proof (staging only)`
  is green on this head, with **0 skipped**. See "Runtime Verification" below: the manifest carries
  `t1_live_db_precondition: "deferred_to_ci"`, and closeout check `G6` refuses this lane without
  `verify` **and** `Writable DB proof (staging only)` green on the merge SHA.

## EVIDENCE:

```
$ pnpm verify
> @unit-talk/v2@0.1.0 lint    — eslint . --cache --cache-location .cache/eslint/   (clean)
> @unit-talk/v2@0.1.0 type-check — pnpm exec tsc -b tsconfig.json                  (clean)
> @unit-talk/v2@0.1.0 build   — turbo/tsc build across every package and app       (clean)
> @unit-talk/v2@0.1.0 test    — aggregate over every wired suite:
    # suites 132
    # tests  6074
    # pass   6074
    # fail   0
    # skipped 0

$ pnpm type-check
(clean — no diagnostics; run inside pnpm verify above)

$ pnpm test
(100 suite summaries, 0 failures; the suite this lane changed is pinned below)

$ pnpm exec tsx --test packages/db/src/canonical-reference-schema.test.ts
1..18
# tests 18
# pass 18
# fail 0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 5
Rules matched: (none) — no R-level artifacts required for this diff

$ pnpm test:db          # the deferred step, refused on the workstation by design
> pnpm ci:assert-staging && tsx --test apps/api/src/database-smoke.test.ts
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
  Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci
  GitHub environment with CI_SUPABASE_* credentials.

$ # UTV2-1856 — four mutations, each turning a distinct assertion red
  revert the player teamId fallback in getEventBrowse (canonical maps only)
    not ok  getEventBrowse resolves a player team through the participants edge while the canonical tables are empty
    not ok  getEventBrowse keeps a row whose proofIssue is null: that names no issue and is not a confirmed fixture   (# fail 2)
  drop only the teamName half of the fallback, keeping teamId
    not ok  getEventBrowse resolves a player team through the participants edge while the canonical tables are empty  (# fail 1)
  unwire the browse proof-fixture exclusion (isConfirmedProofFixture -> false)
    not ok  getEventBrowse excludes a confirmed proof fixture attached to an event while retaining the legitimate player beside it  (# fail 1)
  fall through to any team with a matching external_id when the event has no such side
    not ok  getEventBrowse leaves a player whose team key names a team outside this event unrelated  (# fail 1)

$ # UTV2-1856 — four further mutations on the no-event player admission
  make the caller-supplied identity.teamId the source of the relationship instead of the comparand
    not ok 21 - structured no-event fallback does not believe a caller-supplied team relationship   (# fail 1)
  drop the both-sides membership check
    not ok 20 - structured no-event fallback rejects a player who is on neither side of the entered matchup   (# fail 1)
  accept a player whose team relationship reference data cannot establish
    not ok 19 - structured no-event fallback rejects a player whose team relationship cannot be verified   (# fail 1)
  unwire: restore the blanket refusal ahead of validateSearchBackedPlayer
    not ok 18 - structured no-event fallback accepts a player whose team relationship reference data confirms
    not ok 19 - structured no-event fallback rejects a player whose team relationship cannot be verified
    not ok 20 - structured no-event fallback rejects a player who is on neither side of the entered matchup
    not ok 21 - structured no-event fallback does not believe a caller-supplied team relationship
    not ok 22 - structured no-event fallback rejects a player reference data does not know at all   (# fail 5)

$ # UTV2-1856 — the picks.player_id mutation was performed by CI before the repair existed, not
  # constructed afterwards. Head 52e086f86 wrote metadata.playerId straight through:
  gh run view 34209883355
    Writable DB proof (staging only)   failure
    verify                             failure   (fails closed behind the DB proof job)
      insert or update on table "picks" violates foreign key constraint "picks_player_id_fkey"
  # head 90d558454 added resolveCanonicalPlayerId and nothing else:
  gh api .../commits/90d558454/check-runs
    Writable DB proof (staging only)   success
    verify                             success

# ...and the live-DB half, obtained where the credential actually lives, on this exact head:
$ gh api .../commits/762a97afea7fabe1d7e5b92901bb9580203fdd37/check-runs
  verify                              completed  success   run 34212031091  job 102017851482
  Writable DB proof (staging only)    completed  success   run 34212031091  job 102015702830
    1..14   # tests 14   # pass 14   # fail 0   # skipped 0
    ok  8 - UTV2-1856 live DB: browse resolves the player team from participants while
             teams and player_team_assignments stay empty
    ok  9 - UTV2-1856 live DB: a canonical-event TEAM pick submits, persists its participant
             ids and values, and creates no delivery row
    ok 10 - UTV2-1856 live DB: a canonical-event PLAYER PROP submits, persists both
             participant ids and its values, and creates no delivery row
    ok 11 - UTV2-1856 live DB: the canonical player-prop path still refuses a player who is
             not on the named team
    ok 12 - UTV2-1856 live DB: a confirmed proof fixture attached to an event cannot be
             submitted as a player prop
    ok 13 - UTV2-1856 live DB: a structured NO-EVENT player prop resolves the team from
             participants, persists honest no-event provenance, and creates no delivery row
    ok 14 - UTV2-1856 live DB: a structured NO-EVENT player prop is refused when the player
             is on neither entered side
```

## Verification
- [x] `pnpm type-check`: clean
- [x] `pnpm test`: 6078 tests, 6078 pass, 0 fail, 0 skipped — exit 0, zero `not ok` lines,
      counted by summing every `# tests`/`# pass`/`# fail`/`# skipped` line in the captured run
      rather than from a truncated tail. An earlier partial capture of this same command was read
      as "1 fail"; re-run in full on this head it does not reproduce, and the required `verify`
      check is green on the same head.
- [x] `pnpm verify`: green in CI on this head; locally green through lint, type-check, build and
  test, with only `test:live-db` refused under containment and discharged by the CI receipt above
- [x] `npx tsx scripts/ci/r-level-check.ts --base c3679fda71de97c29e3750d92046943365345e96 --head 762a97afea7fabe1d7e5b92901bb9580203fdd37`: `Verdict: PASS`, `Changed files: 10`,
  `Rules matched: (none)` — no R-level artifacts required for this diff. Explicit SHAs are
  required: the script forces cwd to the root checkout, so `--head HEAD` would measure `main`.

## Runtime Verification

The live-DB obligation is **deferred, not waived**, under the ratified route B admission.
`assert-staging-target.ts` refuses writable verification against a contained workstation, whose
`SUPABASE_URL` resolves to `127.0.0.1` by policy. The deferral is recorded in two places that must
agree: the generated preflight token, and `docs/06_status/lanes/UTV2-1856.json`'s
`t1_live_db_precondition: "deferred_to_ci"`.

What that obligates, and where it is discharged — both green on this head, and `G6` re-asserts them
on the merge SHA at closeout:

- `verify` — required check, green.
- `Writable DB proof (staging only)` — green, which is where
  `apps/api/src/t1-proof-utv2-1842-fallback-event-gate.test.ts` actually executes against the
  staging database (`xskgrzbteyqdufktjrjx`, pinned by `scripts/ci/assert-staging-target.ts`; never
  production). **`skipped: 0` is the load-bearing figure** — those suites are `{ skip: skipReason }`-gated
  on `SUPABASE_SERVICE_ROLE_KEY`, so a missing credential would produce a *passing* job with every
  test skipped.
- Closeout check `G6` asserts both contexts directly on the merge SHA and refuses the lane if either
  is missing, unreadable or not green.

### What the live suite actually demonstrates

Seven tests were added to that file, taking it from 7 to 14 (counted from the file, not
recalled), and together they are the complete contained submission
demonstration this release is gated on — both pick shapes, with and without a canonical event, end
to end, against a real database:

1. **Browse resolves the player team, and excludes the fixture.** The test asserts `teams` and
   `player_team_assignments` are empty *in the same run*, so the resolution provably came from the
   participants edge and not from canonical data that happened to exist. In the same call it asserts
   the marked fixture — attached to the event, carrying a valid team key — is absent while the
   legitimate player is present.
2. **A canonical-event TEAM pick** submits (201), persists its line and odds and its away/home
   `participants.id` values, and creates **zero** `distribution_outbox` rows.
3. **A canonical-event PLAYER PROP** submits (201), persists the same values plus
   `resolution.player.teamId`, and creates **zero** `distribution_outbox` rows. This is the path that
   was refused before this lane.
4. **Control** — a player who is not on the named team is still refused, and the assertion matches
   the refusal *reason* (`/participant|assigned|relationship/iu`), not merely that something failed.
   A refusal for auth, rate limiting or a malformed market would otherwise pass this control while
   proving nothing.
5. **Control** — a confirmed proof fixture named directly by participant id is refused.
6. **A structured NO-EVENT PLAYER PROP** — the same fixture participants, the only difference being
   `eventId: null` — submits (201), persists honest provenance (`resolution: 'canonical'` because
   both sides *and* the player were resolved against the database, with `eventId` staying `null`
   because no canonical event backed it), preserves the away, home and player `participants.id`
   values, and creates **zero** `distribution_outbox` rows. It also asserts
   `picks.participant_id == <player participants.id>` and `picks.player_id == null` — the FK repair
   above, measured on the row rather than argued. Its line and odds differ from test 3's so it
   cannot be absorbed as an idempotent replay of it.
7. **Control** — a player who is genuinely in the database with a genuinely resolvable team, but
   whose team is neither entered side, is refused, and the assertion matches the membership reason
   specifically (`/not on either side of the structured matchup/`).

The fixture pins its sport with `sports?select=id&id=eq.NBA` rather than taking an arbitrary row.
That is not incidental: the `events.sport_id` FK, the case-sensitive canonical-sport guard at
`smart-form-validation.ts:107-113`, and `TEAM_SPORTS.has(sportId)` deciding whether the home/away
role assertions run at all each depend on it. An arbitrary sport would have silently skipped the
role checks — a first draft of this fixture did exactly that and was corrected before it ran.

All four created participants and the event are deleted in a dedicated `after` hook with exact-count
assertions, and the leak query is pinned to this lane's own `utv2-1856-<run>` prefix rather than
reusing the preceding lane's, so a leak from either lane cannot be masked by the other's sweep.

## Non-required checks, read rather than classified as a group

`Return review packet` is red for the recorded `pr-review-packet.ts:487-491` defect — it
reconstructs the allowed scope from `expected_proof_paths` as an exact list rather than a
`docs/06_status/proof/<ID>/**` glob, so this bundle's own `verification.md` and `diff-summary.md`
read as scope bleed while the required `File scope lock` check passes on the identical diff.

`Close eligibility preflight`, `T1 Proof Gate`, `Proof Auditor Gate` and `Runtime Verifier Gate`
were red on the head that carried no proof bundle and are **green on `762a97afea7fabe1d7e5b92901bb9580203fdd37`**, read
from `gh pr checks 1536` rather than assumed.

`Check issue references` is **red on this head, deliberately and knowingly**, and this is the one
non-required red that is not a defect in the check. It reports:

```
All PR issue references must match branch issue UTV2-1856; found UTV2-1856, UTV2-303
```

The guard (`scripts/ops/branch-discipline-guard.ts` -> `extractIssueIds` ->
`issueIdScanPattern()`, `shared.ts:450-452`) scans the PR title, the PR body **and every commit
message body**. The PR title and body are clean. The single reference is inside commit
`90d558454`'s own message, which explains that the `picks.player_id` FK repair "keeps the existing
UTV2-303/614 runtime-truth proof green" — a descriptive citation of the proof it must not regress,
not a claim of scope over another issue.

Removing it requires rewriting `90d558454`'s message, which changes that commit's SHA and every
SHA after it. That would discard the CI receipts this bundle is bound to — including the
`Writable DB proof (staging only)` staging write cycle on `762a97afea7fabe1d7e5b92901bb9580203fdd37`, and including the
mutation evidence recorded above, which is *itself* a pair of CI conclusions at `52e086f86`
(failure) and `90d558454` (success). The receipt is worth more than the green non-required check.

This is the identical trade `docs/mission/plan.md` records for #1479, whose `Check issue
references` red is one commit message citing the ratification that governs its merge-SHA anchor,
and which that lane also left uncorrected for the same reason.

Neither category is being waved through as "non-required": each was read, and each has a measured
cause. "Non-required" is a statement about merge mechanics, never about whether the finding is
real.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1536
Approved PR head: pending merge
Execution SHA: 762a97afea7fabe1d7e5b92901bb9580203fdd37
