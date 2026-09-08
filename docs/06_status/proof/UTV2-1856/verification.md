# PROOF: UTV2-1856

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-08T16:30:00.000Z
Issue: UTV2-1856
Tier: T1
Lane type: runtime
Branch: claude/utv2-1856-browse-participant-identity
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1536
Head SHA: 5fbf28c99b47fcdeac9376c8eedee8d45c0bd901
result: pass

> The `Head SHA` row above is generator-emitted and carries the **binding anchor**
> (`verified_source_sha`), which is what `proof-binding-validator.ts` reads. It is not the branch
> head: the head under review is `449b3c90bb809bde3c76b99d70e0ad449ff53cf2`, and the two differ by
> this bundle's own files only. The three SHAs this document relies on — execution anchor, binding
> anchor and CI receipt SHA — are separated and measured under "Where each receipt was taken".

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
- [x] `pnpm verify` is green **in CI**: run 34277374399, job 102236250239, which executed at
  `740f027704cbab3f94edefe370b67328a74230f7`. That is the authoritative full-suite result. It is
  deliberately *not* restated as a receipt taken at the final head — `740f02770` differs from
  `449b3c90b` only by this lane's own `verification.md` and `evidence.json`, measured and recorded
  under "Where each receipt was taken" below. **Corrected at PM review:** this bullet previously
  cited run 34250974852 and called it green "on this head". That run executed at the superseded
  anchor `83f4ea04c...`, a tree without the in-memory parity repair, so the attribution was wrong
  in both the run id and the SHA. **Corrected at the rebind:** this bullet previously cited a
  local full-suite count of 6074/6074 measured at the earlier anchor `762a97afe`. That run was real,
  but it was not re-performed after the six `main` resyncs, and a count carried across a tree change
  is a stale receipt. What was measured locally — at `f2ee3eacb`, the fifth resync, and not restated
  as the anchor — is `pnpm lint` exit 0, `pnpm type-check` exit 0, and the three suites this lane
  changes; see "Verification" for exactly which receipt was taken at which tree.
- [x] **The submission is issued and answered without interception, and the saved pick is read
  back.** `phase-one.spec.ts` — which stubs `POST /api/submissions` nowhere — passes 12/12 at
  `f2ee3eacb`, a tree differing from the anchor only by an automated readiness-ledger JSON; its
  no-event structured fallback asserts HTTP 201, `outboxEnqueued: false`, the persisted
  line, odds, `distributionMode: 'track-only'`, `eventId: null` and both canonical side ids via
  `GET /api/picks`, and `outboxId: null` via `GET /api/qa/pick-status/<pickId>`.
- [x] **An un-intercepted player prop now reaches the API and persists — browser to saved pick, no
  interception anywhere on the path.** Measured **HTTP 201**, `outboxEnqueued: false`, and the pick
  read back out of `GET /api/picks?status=validated` carrying `selection: "Celtics Starter Points
  O 27.5"`, `line: 27.5`, `odds: -110`, `metadata.distributionMode: "track-only"`,
  `metadata.eventId: null` and `participantResolution.player.teamId` equal to the participant id of
  the team the operator selected. Only the Auth.js session endpoint is stubbed; every
  `/api/reference-data/**` read and `POST /api/submissions` go to the real API. See "Browser
  Verification".
- [x] **The 422 measured at the previous head was a harness parity defect, not a server defect, and
  it is closed inside this lane's own scope.** `InMemoryReferenceDataRepository` diverged from
  `DatabaseReferenceDataRepository` in three ways — `searchTeams` returned a synthetic
  `team:<sport>:<name>` id that no participant id can ever equal, `searchPlayers` hardcoded
  `teamId: null`, and the seeded team rows carried `external_id: null` so no player could link to
  one. All three live in `packages/db/src/runtime-repositories.ts`, which **is** inside this lane's
  pinned `file_scope_lock`; the previous bundle's claim that the repair required
  `apps/api/src/server.ts` was wrong and is corrected here. **No server-side rule was weakened** —
  `validateSearchBackedPlayer` is untouched and still refuses a player whose team relationship
  cannot be established. The 422 disappeared because resolution genuinely succeeds.
- [x] **The player fixtures are opt-in and cannot appear in production.** They are seeded only when
  the repository's existing `UNIT_TALK_QA_SEED_ENABLED` flag is exactly `'true'` — the same flag
  `apps/api/src/routes/qa-seed.ts` already gates on and the contained Playwright config already
  sets — and are refused outright under `NODE_ENV=production`. A failure to read the environment
  seeds nothing. The default in-memory bundle every unit test builds is unchanged
  (`playersAvailable: false`), which `apps/api/src/server.test.ts:1076` still asserts.
- [x] **Three mutations, three distinct assertion sets.** Reverting each divergence individually
  turns a different subset of the four new tests red, and restoring returns 22/22. See "Mutation
  testing — the in-memory parity repair".
- [x] The live-DB step was **deferred to CI and obtained there**: `Writable DB proof (staging only)`
  is green at `740f027704cbab3f94edefe370b67328a74230f7` (run 34277374399, job 102233606034), with
  **0 skipped**. See "Runtime Verification" below: the manifest carries
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
1..22
# tests 22
# pass 22
# fail 0
(18 at the previous head; the four added here are the in-memory/Database parity tests)

$ pnpm type-check      -> exit 0
$ pnpm lint            -> exit 0
$ pnpm test            -> exit 0, zero `not ok` lines across every wired suite
(all three re-run locally at the tree carrying the parity repair, after the browser
 demonstration and after the three mutations were restored)

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

# ...and the live-DB half, obtained where the credential actually lives. Taken at the previous
# anchor 83f4ea04c4defb3b2755a292be486a5bd8ca9277, which carried this lane's server change and the
# UTV2-1859 client change but NOT the in-memory parity repair below. It is recorded at the SHA it
# was taken at rather than restated onto a later tree. The authoritative receipt for this bundle
# is run 34277374399, which executed at 740f027704cbab3f94edefe370b67328a74230f7 and is recorded
# under "CI receipts for this head" below:
$ gh api .../commits/83f4ea04c4defb3b2755a292be486a5bd8ca9277/check-runs
  verify                              completed  success   run 34250974852  job 102150517971
  Writable DB proof (staging only)    completed  success   run 34250974852  job 102145137124
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

The **binding anchor** is `5fbf28c99b47fcdeac9376c8eedee8d45c0bd901`, the seventh `main` resync
merge and the last commit on this branch touching any path outside
`docs/06_status/proof/UTV2-1856/`. It is the SHA the gates bind to; it is **not** the SHA any
receipt in this document was obtained at, which is the distinction the next section makes. Its
parent
`413823a85052500d0a62ba26c4dbc92c2532e567` is the in-memory / Database parity repair described
below, and it is the last commit this lane authored. The server change this lane exists for is
older still — `762a97afea7fabe1d7e5b92901bb9580203fdd37` — and has not changed since.

### Where each receipt was taken

**A receipt names a tree, not a changeset.** Three different SHAs are load-bearing in this bundle
and they are deliberately kept apart rather than collapsed onto one another:

| Role | SHA | What it is |
|---|---|---|
| **Execution anchor** | `413823a85052500d0a62ba26c4dbc92c2532e567` | the tree the local commands and the browser runs were actually executed against — the in-memory / Database parity repair |
| **Binding anchor** (`verified_source_sha`, and the `Execution SHA:` row of the Merge SHA Binding block) | `5fbf28c99b47fcdeac9376c8eedee8d45c0bd901` | the last commit on this branch touching any path outside `docs/06_status/proof/` and `docs/06_status/lanes/`, which is what `proof-binding-validator.ts` rule 4 requires |
| **CI receipt SHA** | `740f027704cbab3f94edefe370b67328a74230f7` | the head run 34277374399 executed at |

**Corrected at PM review.** An earlier draft of this table claimed the authoritative CI receipts
were taken at the binding anchor `5fbf28c99`. They were not: run 34277374399 executed at
`740f02770`, a proof-only commit after it. The run id was right and the SHA was wrong, which is
exactly the class of claim this section exists to prevent, committed against itself.

Each receipt is therefore recorded at the SHA it was obtained at, with the difference to the final
head `449b3c90bb809bde3c76b99d70e0ad449ff53cf2` measured by `git diff --name-only <sha> 449b3c90b`
rather than asserted:

| Evidence | Obtained at | Verified difference to the final head `449b3c90b` |
|---|---|---|
| `pnpm lint`, `pnpm type-check`, `pnpm test`, the browser runs, and the three mutations | `413823a85` — the execution anchor | `docs/06_status/readiness/readiness-score.json` plus this lane's own `diff-summary.md`, `evidence.json` and `verification.md`. The readiness ledger is why this SHA cannot also be the binding anchor. |
| `verify` (run 34277374399, job 102236250239) and `Writable DB proof (staging only)` (run 34277374399, job 102233606034) — **the authoritative CI receipts for this bundle** | `740f02770` | `docs/06_status/proof/UTV2-1856/evidence.json` and `verification.md` — proof-only, and nothing else |
| The `verify` and `Writable DB proof (staging only)` receipts printed in the mutation block above (run 34250974852) | `83f4ea04c4defb3b2755a292be486a5bd8ca9277`, the superseded anchor | the parity repair plus the readiness ledger — real code, so they are **not** claimed for this head and are retained only as the superseded receipt |

For the binding anchor itself, `git diff --name-only 5fbf28c99 449b3c90b` returns exactly
`docs/06_status/proof/UTV2-1856/{diff-summary.md,evidence.json,verification.md}` — proof-only, so
rule 4 holds.

`449b3c90b` is the head those three lists were measured at. This correction is itself an
evidence-only commit on top of it, and it touches exactly `evidence.json` and `verification.md` —
both already members of every difference set above. Each list is therefore identical at the head
that carries this bundle, and re-measuring at that head returns the same three sets. That was
checked with `git diff --name-only` after committing, not assumed; the head SHA is not restated
here because a commit cannot cite its own hash.

The anchor had to move for two independent reasons: the parity repair is real code outside the
proof directory, and `scripts/ci/proof-binding-validator.ts` rule 4 admits only
`docs/06_status/proof/` and `docs/06_status/lanes/` between `verified_source_sha` and HEAD, which
`readiness-score.json` is not.

One earlier resync matters on its own terms: UTV2-1859 (`9abb4ac62`) is in this branch, so the
browser evidence below exercises this lane's server change and the client change that unblocks it
**in one tree**.

### CI receipts for this head — obtained at `740f02770`

Recorded from `gh api .../commits/740f027704cbab3f94edefe370b67328a74230f7/check-runs` after run
34277374399 concluded. **That run executed at `740f02770`, not at the binding anchor `5fbf28c99`**;
the two differ by this bundle's own `evidence.json` and `verification.md` and by nothing else, as
measured in the table above. This is the first live-DB receipt taken on a tree that contains the
in-memory / Database parity repair.

```
$ gh api .../commits/740f027704cbab3f94edefe370b67328a74230f7/check-runs
  verify                            completed  success   run 34277374399  job 102236250239
  Writable DB proof (staging only)  completed  success   run 34277374399  job 102233606034
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

Tests 11, 12 and 14 are the controls that matter for this revision: the parity repair made a
canonical player prop *resolvable*, and these three prove it did not make the server *permissive*.
A player who is not on the named team, a confirmed proof fixture, and a player on neither entered
side are each still refused against the live staging database.

The `verify` receipt is the authoritative full-suite result. No local full-suite PASS is claimed;
the live-DB suite cannot execute on a contained workstation at all, which is exactly the condition
route B defers to CI.

### Non-required checks at this head

Read from `gh pr checks 1536` rather than assumed: `Close eligibility preflight`, `T1 Proof Gate`,
`Proof Auditor Gate`, `Runtime Verifier Gate`, `Lane authority`, `File scope lock`,
`R-Level Compliance Check`, `Executor Result Validator`, `P0 Protocol`, `Sync tier label`,
`Require live-DB proof for runtime changes` and `WFR-v2 Validators` all pass. Three are red and each
is read below rather than classified by status: `Merge Gate` (no T1 approval artifact on this head),
`Check issue references`, and `Return review packet`.

- [x] `pnpm lint`: exit 0
- [x] `pnpm type-check`: exit 0, no diagnostics
- [x] `pnpm test` — **the three suites this lane changes, run together**: 111 tests, 96 pass,
      15 fail, 0 skipped. The 15 failures are the live-DB suite and every one is
      `TypeError: fetch failed`: a contained workstation resolves Supabase to `http://127.0.0.1:1`
      by policy, so that suite cannot execute here at all. Over the two suites that *can* run
      locally the same command reports **96 tests / 96 pass / 0 fail / 0 skipped, exit 0**. The
      live-DB suite's receipt is the green `Writable DB proof (staging only)` job below, obtained
      at `740f02770` (run 34277374399, job 102233606034) — which is the route-B deferral working as
      ratified rather than a gap.
- [x] `pnpm verify`: **green in CI at `740f02770`** (run 34277374399, job 102236250239) — that is
      the authoritative full-suite result and it is what is claimed here. **Corrected at PM
      review:** this line previously cited run 34250974852 "on this head"; that run executed at the
      superseded anchor `83f4ea04c...`. No local full-suite pass is claimed at any head: locally the
      run was lint, type-check and the touched suites, and `test:live-db` is refused under
      containment as described above.
- [x] `npx tsx scripts/ci/r-level-check.ts --issue UTV2-1856`: `Verdict: PASS`,
      `Changed files: 10`, `Rules matched: (none)` — no R-level artifacts required for this diff.

## Runtime Verification

The live-DB obligation is **deferred, not waived**, under the ratified route B admission.
`assert-staging-target.ts` refuses writable verification against a contained workstation, whose
`SUPABASE_URL` resolves to `127.0.0.1` by policy. The deferral is recorded in two places that must
agree: the generated preflight token, and `docs/06_status/lanes/UTV2-1856.json`'s
`t1_live_db_precondition: "deferred_to_ci"`.

What that obligates, and where it is discharged — both green at `740f02770` (run 34277374399), the
CI receipt SHA recorded above, and `G6` re-asserts them on the merge SHA at closeout:

- `verify` — required check, green (job 102236250239).
- `Writable DB proof (staging only)` — green (job 102233606034), which is where
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

## Browser Verification — the un-intercepted path

Server-side evidence is structurally blind to a client that refuses before issuing a request.
UTV2-1859 proved that class exists on this exact path: a stale client mirror of the very rule this
lane removed made the form refuse a player prop while every server test, the full unit suite and a
green `verify` all passed. So the request being *issued* and *answered* is checked here directly.

Nothing about the submission is intercepted in the first run below. The Playwright API child runs
with every `SUPABASE_*` empty and `UNIT_TALK_API_RUNTIME_MODE=fail_open`, so
`apps/api/src/server.ts:303-321` falls back to `createInMemoryRepositoryBundle()`. **No staging or
production credential is placed in this harness**, deliberately — `run-e2e-gate.mjs` strips any
`SUPABASE|DATABASE_URL|SERVICE_ROLE` key from the child environment. Persistence against a real
database is proven separately under Runtime Verification, and the two are kept apart on purpose:
that separation is why the staging database is not re-contaminated with UI fixtures.

### 1. Un-intercepted submission, and the saved pick read back

```
$ NEXT_PUBLIC_SMART_FORM_QA_AUTH_BYPASS=1 npx playwright test \
    -c apps/smart-form/playwright.config.ts apps/smart-form/e2e/phase-one.spec.ts \
    --workers=1 --reporter=line
  12 passed (1.1m)
  PHASE_ONE_EXIT=0
```

`POST /api/submissions` is **not** routed or stubbed anywhere in this suite. The browser issues the
real request and the test waits on the real response. `phase-one.spec.ts:265` drives the no-event
structured fallback — NBA, manual matchup fallback, canonical Celtics/Knicks, spread `-3.5` at
`+105`, conviction 8 — and then:

- asserts HTTP **201** and `{ lifecycleState: 'validated', outboxEnqueued: false }`;
- reads the **saved pick back out of the API** with `GET /api/picks?status=validated&limit=200`
  and asserts `line: -3.5`, `odds: 105`, `metadata.distributionMode: 'track-only'`,
  `metadata.eventId: null`, and both canonical side participant ids;
- asserts non-delivery with `GET /api/qa/pick-status/<pickId>` → `outboxId: null`,
  `outboxStatus: null`.

That is a saved pick verified after an un-intercepted submission, which is the evidence gap this
run exists to close. The ticket is a **team** spread; the player variant is next, and it is bounded.

### 2. Un-intercepted player prop — issued, answered 201, and read back as a saved pick

**This supersedes the `422 SMART_FORM_RELATIONSHIP_INVALID` recorded in the previous revision of
this bundle.** That measurement was real at the head it was taken on, and the diagnosis attached to
it was wrong in a way worth stating: it said a successful run was *unreachable* in the contained
harness and that closing the gap required `apps/api/src/server.ts`, outside this lane's lock. Every
file the repair actually needed — `packages/db/src/runtime-repositories.ts` and its test — is inside
the lock. The refusal was the server correctly declining an unresolvable player; the fix was the
resolution, not the check.

Driven with **no `page.route` on any `/api/reference-data/**` path and none on `**/api/submissions`**.
The only fulfilled route is `**/api/auth/session`, which is authentication plumbing, not the path
under test. No credential is placed in the environment: the API child runs with every `SUPABASE_*`
empty and falls back to `createInMemoryRepositoryBundle()`.

The real reference-data API answers first, and the ids are real participant ids rather than
synthetic strings:

```
TEAMS   200 {"ok":true,"data":[
  {"participantId":"ea212f6a-50e5-47f0-a161-46422c4d0d9e","displayName":"Celtics","sport":"NBA"}]}

PLAYERS 200 {"ok":true,"data":[
  {"participantId":"08689a37-84f4-40a5-b6ea-084da0092c93","displayName":"Celtics Starter",
   "sport":"NBA","teamId":"ea212f6a-50e5-47f0-a161-46422c4d0d9e"},
  {"participantId":"26f26d13-e141-4f6c-8c1c-fbcaad15a35b","displayName":"Celtics Reserve",
   "sport":"NBA","teamId":"ea212f6a-50e5-47f0-a161-46422c4d0d9e"}]}
```

`teamId` equals the `participantId` `searchTeams` returned for the same team. That equality is
exactly what `validateSearchBackedPlayer` compares, and it is the thing all three divergences
prevented.

The browser then fills the ticket — NBA, date `2026-04-02`, manual matchup fallback, Knicks @
Celtics, Player Prop, team Celtics, player `Celtics Starter`, Points Over `27.5` at `-110`,
conviction 8 — and submits:

```
SUBMISSION_RESPONSE [
  { "status": 201,
    "body": {"ok":true,"data":{"submissionId":"2391ffa1-e34e-4446-8039-d11d0c43781f",
      "pickId":"150acecd-9afe-45ca-a4a6-aa616706bafe","lifecycleState":"validated",
      "promotionStatus":"qualified","promotionTarget":"best-bets","outboxEnqueued":false}} }
]
```

and the pick is read back out of the API — a saved row, not a captured request:

```
PICKS_STATUS 200      (GET /api/picks?status=validated&limit=200)
SAVED_PICK {
  "id": "150acecd-9afe-45ca-a4a6-aa616706bafe",
  "market": "points-all-game-ou",
  "selection": "Celtics Starter Points O 27.5",
  "line": 27.5,
  "odds": -110,
  "status": "validated",
  "metadata": { "eventId": null, "distributionMode": "track-only", ... }
}
PARTICIPANT_RESOLUTION {
  "resolution": "canonical", "sportId": "NBA", "eventId": null,
  "away":   {"participantId":"9ba7031f-...","displayName":"Knicks","participantType":"team"},
  "home":   {"participantId":"693f30d9-...","displayName":"Celtics","participantType":"team"},
  "player": {"participantId":"e665f0c6-...","displayName":"Celtics Starter",
             "teamId":"693f30d9-..."}
}
1 passed (27.9s)
```

`player.teamId` equals `home.participantId`. That is the participants observation edge this lane
exists to make usable, exercised end to end through a browser with nothing intercepted.

**What this run does and does not claim.** It is a browser → real API → saved pick demonstration
against the in-memory contained runtime. It is **not** a claim about the deployed system (production
is `d3f69b804` and none of this is running there), and it is **not** the live-DB receipt —
persistence against a real database is proven separately under Runtime Verification, against
staging, where the credential lives. The two are kept apart deliberately.

**The spec that drove it was temporary and is not committed.** `apps/smart-form/e2e/**` is outside
this lane's `file_scope_lock`, so committing a permanent assertion there belongs to its own lane
rather than to a widened scope here. That follow-up is real work, not a formality: without it, the
parity this lane restored can regress silently, which is the same duplicated-rule shape UTV2-1859
paid for. It is recorded as the immediate follow-up rather than smuggled in.

### Mutation testing — the in-memory parity repair

Each divergence was individually reverted, the suite run, and the file restored.

| Mutation | Suite result | Which assertions caught it |
|---|---|---|
| `searchTeams` returns `team:${sportId}:${t}` again | 19/22, **3 fail** | tests 20, 21, 22 |
| `searchPlayers` hardcodes `teamId: null` again | 20/22, **2 fail** | tests 19, 21 |
| seeded team `external_id` back to `null` | 21/22, **1 fail** | test 21 |
| restored | **22/22, 0 fail** | — |

The three failure sets are distinct, so no single test is carrying all three and none of the three
repairs is unasserted. Test 21 — *"the in-memory bundle seeds one participant set both repositories
agree on"* — is the only one that catches the `external_id` mutation, and it is the assertion that
names the actual invariant: `bundle.participants.findById(team.participantId)` resolves, and some
player's `teamId` equals that same id.

The `teamId: null` mutation was also run against the browser, and it fails **earlier** than the 422
it originally produced:

```
PLAYERS 200 {"ok":true,"data":[{"participantId":"e177e809-...","displayName":"Celtics Starter",
             "sport":"NBA","teamId":null}, ...]}

Error: locator.click: Test timeout of 30000ms exceeded.
  waiting for getByRole('button', { name: /^Celtics Starter/ })
```

With `teamId: null` the client's player picker — which filters on `participant.teamId ===
selectedTeamId` — renders empty, so the operator cannot select a player at all and no submission is
ever attempted. That is stated because it is *not* the 422 the earlier revision measured: the
original 422 came from a run that fixtured `search/players` in the browser and so bypassed the
picker's filter. Both are the same divergence surfacing at different layers.

### The intercepted test is request/payload coverage only

`apps/smart-form/e2e/smart-form-submission.spec.ts:1366` routes `**/api/submissions` and fulfils it
with a synthetic `201`. It asserts that exactly one POST is issued and that the captured payload is
truthful — and **nothing else**. It asserts no response from the real server, no persisted row and
no delivery state, because it never reaches the server. It is described that way here, in
UTV2-1859's own bundle and in the mission plan; reading it as persistence evidence is wrong.

## Non-required checks, read rather than classified as a group

`Return review packet` is red for the recorded `pr-review-packet.ts:487-491` defect — it
reconstructs the allowed scope from `expected_proof_paths` as an exact list rather than a
`docs/06_status/proof/<ID>/**` glob, so this bundle's own `verification.md` and `diff-summary.md`
read as scope bleed while the required `File scope lock` check passes on the identical diff.

`Close eligibility preflight`, `T1 Proof Gate`, `Proof Auditor Gate` and `Runtime Verifier Gate`
were red on the head that carried no proof bundle and were **green on the previous anchor
`83f4ea04c4defb3b2755a292be486a5bd8ca9277`**, read from `gh pr checks 1536` rather than assumed.
Their state is recorded under "Non-required checks at this head" below, read at the head it is
claimed for, and is not restated here from the superseded anchor.

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
`Writable DB proof (staging only)` staging write cycle on this branch, and including the
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
Execution SHA: 5fbf28c99b47fcdeac9376c8eedee8d45c0bd901
