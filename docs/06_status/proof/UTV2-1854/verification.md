# PROOF: UTV2-1854

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-07T21:30:00.000Z
Issue: UTV2-1854
Tier: T1
Lane type: runtime
Branch: claude/utv2-1854-reference-data-participants
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1535
Head SHA: 869c0d2c382dda22eb3f57ab71a6ddc9f1ddd8f7
result: pass

## ASSERTIONS:

- [x] `searchTeams` reads `participants` scoped by `participant_type='team'` and `sport`, and answers with `participants.id` — the same id space `getCatalog`, `getEventBrowse` and every consumer in `apps/api/src/handlers/reference-data.ts` already use. A test asserts the recorded query calls, not only the returned rows.
- [x] `searchTeams` no longer reads the canonical `teams` or `leagues` tables. Reverting either method to those tables turns 6 of the 8 unit tests in `packages/db/src/canonical-reference-schema.test.ts` red.
- [x] An empty query still means "what is available?". `handleGetReferenceDataAvailability` probes with `searchTeams(sport, '', 1)`; a rewrite that short-circuits to `[]` would report every sport as having no teams, and a test fails on that.
- [x] A team is findable by city and by abbreviation, not only by nickname. `display_name` holds the nickname alone, the city lives in `external_id` and the code in `metadata.abbreviation`, so a `display_name`-only `ilike` cannot answer "milwaukee" or "mil".
- [x] `searchPlayers` applies `sport` as a predicate in the query itself. The sport-scope property the previous paging loop existed to hold is now held by construction — sport is a column, so there is no batch boundary for it to fall outside of. Deleting `.eq('sport', sportId)` turns 3 tests red.
- [x] `searchPlayers` resolves each player's team through `metadata->>'team_external_id'` matched against team `external_id`, in one batched round trip, and reports `teamId: null` when the key is absent or names no team in that sport. Fabricating a team id for a keyless player turns 1 test red.
- [x] A participant carrying a non-null `metadata.proofIssue` is a **confirmed proof fixture** and is excluded from player search and from the availability probe, on the database repository and the in-memory one alike. 26 such rows exist in production (13 `UTV2-614`, 13 `UTV2-618`, created 2026-05-28/29); **none is deleted** -- the repair is a read filter, and production data deletion is reserved decision 1.
- [x] The database exclusion is a **query predicate applied before `limit`**, not a post-filter, so a fixture cannot consume the page and displace a real player. The in-memory repository applies it before its own `slice` for the same reason, and a test with `limit: 1` and the fixture sorting first fails on either implementation being a post-filter.
- [x] The predicate is the **marker**, never "has no team". Measured read-only against production 2026-09-07 the 26 marked rows are *exactly* the 26 players with no `team_external_id` and there are zero legitimate team-less players, so a "drop players with no team" implementation would agree with every current production observation and still be wrong. The preservation case is therefore asserted against a **constructed** row: a player with neither marker nor team survives and reports `teamId: null`.
- [x] A `proofIssue` that is JSON `null` names no issue, is therefore not a *confirmed* fixture, and is kept.
- [x] `handleGetReferenceDataAvailability` needed no change: it derives `teamsAvailable`/`playersAvailable` entirely from `searchTeams(sport,'',1)` and `searchPlayers(sport,'',100)`, so excluding fixtures in the two repository methods is what stops a fixture establishing operational availability. Demonstrated through that handler, not asserted about it.
- [x] The published `TeamSearchResult` / `PlayerSearchResult` shapes in `packages/db/src/repositories.ts` are unchanged; this lane changes where the values come from, not what the interface promises.
- [x] `pnpm verify` passes on this head through lint, type-check, build and the full unit suite — 6230 tests, 0 failures — and the required CI `verify` check is green on the same head (run 34176268952, job 101908596186).
- [x] The live-DB step was **deferred to CI and has now been obtained there**: `Writable DB proof (staging only)` is green on this head — run 34176268952, job 101906179501, 7 tests / 7 pass / 0 fail / **0 skipped** in 79.6s. See "Runtime Verification" below: the manifest carries `t1_live_db_precondition: "deferred_to_ci"`, and closeout check `G6` refuses this lane without `verify` **and** `Writable DB proof (staging only)` green on the merge SHA.

## EVIDENCE:

```
$ pnpm verify
> @unit-talk/v2@0.1.0 lint    — eslint . --cache --cache-location .cache/eslint/   (clean)
> @unit-talk/v2@0.1.0 type-check — pnpm exec tsc -b tsconfig.json                  (clean)
> @unit-talk/v2@0.1.0 build   — turbo/tsc build across every package and app       (clean)
> @unit-talk/v2@0.1.0 test    — aggregate over every wired suite:
    # tests 6230
    # pass  6230
    # fail  0
[lint-migrations] 134 migration file(s) checked — no findings.
[executable-wiring] capabilities total=163 wired=145 orphan=18 (baselined=18 new=0)
[automation-coverage] verdict=PASS fail=0 warn=1 classified=15

$ pnpm type-check
(clean — no diagnostics; run inside pnpm verify above)

$ pnpm test
(0 failures across every suite; the suites this lane changed are pinned below)

$ pnpm exec tsx --test packages/db/src/canonical-reference-schema.test.ts
1..13
# tests 13
# pass 13
# fail 0

$ pnpm exec tsx --test apps/api/src/smart-form-validation.test.ts
# tests 74
# pass 74
# fail 0

$ pnpm test:db          # the deferred step, refused on the workstation by design
> pnpm ci:assert-staging && tsx --test apps/api/src/database-smoke.test.ts
[assert-staging] host=127.0.0.1 ref=unidentified expected=xskgrzbteyqdufktjrjx
[assert-staging] REFUSED: target identity could not be resolved from its URL (host=127.0.0.1).
  Writable DB verification requires xskgrzbteyqdufktjrjx. Run it through the staging-ci
  GitHub environment with CI_SUPABASE_* credentials.

$ # UTV2-1854 PROOF_FIXTURE_EXCLUSION -- four mutations, each turning a distinct assertion red
  drop `.is(PROOF_FIXTURE_METADATA_PATH, null)` from the DB searchPlayers query
    not ok  searchPlayers excludes confirmed proof fixtures as a query predicate, before the limit
    not ok  searchPlayers preserves a legitimate team-less player while excluding a fixture   (# fail 2)
  drop the isConfirmedProofFixture filter from searchTeams
    not ok  searchTeams excludes confirmed proof fixtures without dropping ordinary teams      (# fail 1)
  unwire isConfirmedProofFixture so it always returns false
    not ok  searchTeams excludes confirmed proof fixtures without dropping ordinary teams      (# fail 1)
  drop the isConfirmedProofFixture filter from InMemoryReferenceDataRepository.searchPlayers
    not ok  the in-memory repository applies the same proof-fixture exclusion, before its limit (# fail 1)

$ # browser -> API, real Chromium against the real API process
$ UNIT_TALK_SMART_FORM_E2E=1 pnpm --filter @unit-talk/smart-form test:e2e:fixture
  25 passed (41.9s)

# ...and obtained where the credential actually lives, on this exact head:
$ gh api .../commits/869c0d2c382dda22eb3f57ab71a6ddc9f1ddd8f7/check-runs
  verify                              completed  success
  Writable DB proof (staging only)    completed  success
    run 34176268952  job 101906179501
    1..7   # tests 7   # pass 7   # fail 0   # skipped 0   # duration_ms 79627.298926
```

## Verification
- [x] `pnpm type-check`: clean
- [x] `pnpm test`: 6230 tests, 0 failures
- [x] `pnpm verify`: green in CI on this head; locally green through lint, type-check, build and test, with only `test:live-db` refused under containment and discharged by the CI receipt above
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: evaluated by the required CI checks on this head

## Runtime Verification

The live-DB obligation is **deferred, not waived**, under the ratified route B admission.
`assert-staging-target.ts` refuses to run writable verification against a contained
workstation, whose `SUPABASE_URL` resolves to `127.0.0.1` by policy. The deferral is
recorded in two places that must agree: the generated preflight token, and
`docs/06_status/lanes/UTV2-1854.json`'s `t1_live_db_precondition: "deferred_to_ci"`.

What that obligates, and where it is discharged. **Both are already green on this head**, and
`G6` will re-assert them on the merge SHA at closeout:

- `verify` — required check, green (run 34176268952, job 101908596186).
- `Writable DB proof (staging only)` — green (run 34176268952, job 101906179501), which is where
  `apps/api/src/t1-proof-utv2-1842-fallback-event-gate.test.ts` actually executes against
  the staging database. `skipped: 0` is the load-bearing figure: those suites are
  `{ skip: skipReason }`-gated on `SUPABASE_SERVICE_ROLE_KEY`, so a missing credential would
  produce a *passing* job with every test skipped.
- Closeout check `G6` asserts both contexts directly on the merge SHA and refuses the lane
  if either is missing, unreadable or not green.

This lane's live proofs live in that proof file. Two of its seven tests are the
proof-fixture demonstration Griff asked for, run through the search/API path rather than
against the repository directly: `handleSearchPlayers` and
`handleGetReferenceDataAvailability` are called with the real staging repository bundle in a
sport namespace this run owns. With only a `metadata.proofIssue`-marked player present the
handler answers `[]` and `playersAvailable` is `false`; once a player carrying neither the
marker nor a `team_external_id` is added, the handler answers with exactly that player,
`teamId: null`, and `playersAvailable` becomes `true` -- the fixture still excluded. Both rows
are created and deleted inside the run and the `after` hook asserts none leaked. The remaining
five are the UTV2-1842 and UTV2-1854 submission proofs: a structured Track Only submission whose
away and home sides both resolve from `participants`, persist their `participants.id`
values in `metadata.participantResolution`, and create zero `distribution_outbox` rows;
and a control asserting the structured path still refuses a participant id naming no row.
`validateSmartFormRelationships` signals that refusal by *throwing* an `ApiError` out of
`submit-pick-controller.ts:46`, so the control asserts a rejection and matches the refusal
*reason* rather than merely that something failed -- a refusal for auth, rate limiting or a
malformed market would otherwise pass as this control while proving nothing about participant
verification. The first form of this control awaited a response object instead, and staging is
where that was caught: the refusal fired exactly as intended
(`SMART_FORM_RELATIONSHIP_INVALID`, "participant ... is not canonical for sport NBA") and
reached the test as a rejection it was not shaped to observe. Its fixture rows are created
and deleted inside the run, and an `after` hook asserts none leaked.

## Non-required checks, read rather than classified as a group

`Check issue references` is **red on this head, deliberately.** It reports
`multiple_issue_references` -- *"All PR issue references must match branch issue UTV2-1854;
found UTV2-1842, UTV2-1854, UTV2-614, UTV2-618"*. Every one of those references is load-bearing
in the commit body it appears in: the 26 excluded rows were created by the UTV2-614 and UTV2-618
proof lanes, and the live-DB file this lane extends is UTV2-1842's. Rewriting those messages to
satisfy the check would move the head and invalidate the two CI receipts this bundle is bound to,
which is the same trade #1479 made and for the same reason: a verifiable receipt is worth more
than a green non-required check. The check is not one of the four required contexts and blocks no
merge.

`Return review packet` is red for the recorded `pr-review-packet.ts:487-491` defect -- it
reconstructs the allowed scope from `expected_proof_paths` as an exact list rather than a
`docs/06_status/proof/<ID>/**` glob, so this bundle's own `verification.md` and `diff-summary.md`
read as scope bleed while the required `File scope lock` check passes on the identical diff.

Neither is being waved through as "non-required": each was read, and each has a measured cause.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1535
Approved PR head: pending merge
Execution SHA: 869c0d2c382dda22eb3f57ab71a6ddc9f1ddd8f7
