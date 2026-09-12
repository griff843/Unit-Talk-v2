# PROOF: UTV2-1889

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-12T19:25:26.000Z
Issue: UTV2-1889
Tier: T1
Lane type: runtime
Branch: claude/utv2-1889-operator-attested-results
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1567
Head SHA: 9e3554df42a99c90d41b0c153adfd018beeeb3d2
result: pass

## ASSERTIONS:

### The operator-attestation route is removed from this release

Rewritten 2026-09-12 at `9e3554df42a99c90d41b0c153adfd018beeeb3d2` under the CHANGES_REQUIRED verdict on PR 1567
(comment 5647259357). The verdict's first two required changes are done by deletion rather
than by a flag, because a flag is a write path with one more condition and a deletion is no
write path at all.

- [x] `scripts/ops/track-only/operator-attest-result.ts` is **deleted**. There is no
      reachable `--apply`, no sequential PostgREST write, no fresh event UUID per upsert and
      no generation-1 default left to review. The four review threads that named those
      defects (`PRRT_kwDORr3vD86hpVMb`, `…VMf`, `…VMj`, `…VMp`) are each answered with this
      disposition and resolved; their findings are recorded as preconditions on any return
      of the route, not fixed here. The design is preserved in history at `4701685541` and
      no second results route is built to replace it.
- [x] `operator` is **not** in the production grading trust allow-list.
      `TRUSTED_GRADING_EVENT_PROVIDERS` is `{sgo}` and `REQUIRED_INGESTION_SOURCE_BY_PROVIDER`
      has the single entry `sgo: ingestor.cycle`. An event carrying `operator` provenance is
      refused as `event_provenance_untrusted_provider`; asserted by test 76 and mutation-tested
      by `grading-3`, which re-admits it and turns exactly that test red.
- [x] The SGO moneyline, paired-score and participant fixes, the Track Only behaviour and the
      stats aggregate are unchanged. Every grading fixture that used to carry `operator`
      provenance now carries `sgo` / `ingestor.cycle`, which is the only provenance that
      ships, and the composed Track Only journey settles from an ingested result.
- [x] The read-side `classifyResultProvenance` still names `operator` as a class so a row
      with that provenance is reported as what it is rather than folded into `sgo`. That is a
      reporting decision, not a trust one, and its comment now says so.
- [x] The staging proof's failure-6 explanation is **corrected from measurement** -- see the
      Runtime Verification section. The earlier text said grading "never cross-checks the
      participants"; it does. The real mechanism was submission idempotency.


### The SGO journey -- three gaps repaired, and the journey completes

Rewritten 2026-09-12 at `b22617cae7e23e485813437173e8df2c35b2abbc`. The block that stood here reported four gaps as
*proven defects*. Three of them (A, B and D) are now **repaired in one change**, and the
journey the proof exercises **completes end to end** through the shipped normalizer, the
shipped resolver, the shipped submission path, the shipped grading pass and the shipped
stats aggregate. The old text is not corrected in place because it was not wrong -- it was a
true report of a state this lane has since left. What follows is the state now.

The only substitution anywhere in the journey is the HTTP transport, injected through
`fetchImpl`, so the proof cannot reach the provider -- SGO activation is unapproved.

- [x] The real SGO normalizer erases the side from the market key, and that is still true
      after the repair. `points-home-game-ml-home` and `points-away-game-ml-away` BOTH
      normalize to `points-all-game-ml`, because `normalizeSgoProviderMarketKey` builds
      `` `${statId}-all-${periodId}-${betTypeId}` `` with `-all-` as a hardcoded literal.
      The repair does not change the normalizer; it stops depending on a key the normalizer
      cannot emit. `providerSide` is what carries the side (UTV2-1868).
- [x] **GAP A -- REPAIRED.** Sixteen of `SGO_GAME_LINE_CANONICAL_ID`'s seventeen entries were
      keyed `<league>-<bet>-all-game`, a shape the template above cannot produce, so the raw
      provider key fell through the `??`. They are **removed, not corrected**: a key that
      cannot be emitted is not a typo, and correcting it would have invented a mapping no
      payload can reach. What remains is the two keys the normalizer actually emits --
      `points-all-game-ou` and `points-all-game-ml` -- mapped to `game_total_ou` and
      `game_moneyline_win`, the keys grading actually reads. The deferred UTV2-450 note the
      table carried (the key format was never verified against live payloads) is answered by
      this change rather than deferred again.
- [x] **GAP B -- REPAIRED.** `actual_value` was a raw team score, and grading accepts only
      `1 | 0 | 0.5`. `computeMoneylineOutcomeBySide` now derives the outcome from the
      COMPARISON of the two sides -- `{1,0}`, `{0,1}`, or `{0.5,0.5}` on a tie -- and the
      resolver writes that. Asserted in the strong direction as well as the weak one: no row
      written under an outcome key may carry `5` or `3`, the fixture's raw scores.
- [x] **GAP C -- CLOSED BY A AND B TOGETHER.** The journey now completes:
      `joinedMarketKeys === ['game_moneyline_win']`, the pick settles, and
      `computeTrackOnlyStats` prices it. No third name is introduced; the resolver writes the
      key the grading pass already read.
- [x] **GAP D -- REPAIRED, and its failure mode is the load-bearing assertion in this lane.**
      Each written row carries the `participant_id` of the team whose outcome it is, resolved
      from `event_participants` by side. **When the side cannot be resolved, nothing is
      written.** An event with no `event_participants` rows -- the exact shape of the 3,000+
      historical game-line rows measured in production -- yields zero inserts and
      `skippedTeamSideUnresolved: 2`. A half-scored event yields zero inserts and
      `skippedMoneylineOutcomeUnresolved: 1`. Guessing in either place would silently
      attribute a win to a team that was never attested.
- [x] **Historical rows are protected structurally, not by policy.** Every stored game-line
      row is keyed `points-all-game-ml` (or `-sp`, `-ml3way`, `-1h-*`) with
      `participant_id = NULL`. New writes are keyed `game_moneyline_win`. The grading
      moneyline guard refuses every key but `game_moneyline_win`, so the 280 production rows
      remain uninterpretable by the grading path. **No backfill, no reinterpretation, and no
      guess** -- new-ingestion readiness is established without implying any historical
      repair.
- [x] **The control.** A game total runs the same fixture through the same real code and is
      untouched by the moneyline path: `game_total_ou`, `actualValue === 5` (a total is a
      quantity, not an outcome), `participantId === null`. Without it the repairs above could
      be explained by the harness rather than by the code.
- [x] The classifier was never the gap, and still is not. `game_moneyline`, `gradeable: true`,
      `usesLine: false` are asserted separately so a reader cannot conclude the moneyline
      grading was never wired. It was; until this lane it had nothing to join to.
- [x] **The two copies of the result market key cannot drift apart.** Core invariant 8 forbids
      `apps/ingestor` importing from `apps/api`, so `game_moneyline_win` is necessarily
      written twice. `scripts/` is the sanctioned join point, and
      `scripts/ops/track-only/sgo-journey-proof.ts` carries a module-scope assertion that
      `SGO_MONEYLINE_RESULT_MARKET_KEY === MONEYLINE_RESULT_MARKET_KEY`, throwing at import
      time. Changing either copy alone fails the whole suite before a single test runs.
- [x] The proof refuses data that could be real. `assertFixtureIsIdentifiable` throws on an
      event id lacking `UTV2-1889-STAGING-FIXTURE`, and throws on an empty payload so a
      vacuous run cannot read as a pass. Both directions asserted.

**Gaps A and D are repaired in `apps/ingestor/**`, which is outside this lane's pinned
`file_scope_lock`.** Three files are affected -- `results-resolver.ts`,
`results-resolver.test.ts` and `ingestor.test.ts` -- and a fourth path, root `package.json`,
carries the one-line `test:t1-proof:live` wiring entry for the staging journey suite. A lock
cannot be widened by an agent, so a single `scope-override/v1` covering exactly those four
paths is requested on PR 1567 at the final head. The repairs are not split across lanes
because each one alone leaves the journey broken: the market key without the outcome writes
a raw score under a graded key, and the outcome without the attribution writes an
unattributable one.

- [x] A moneyline pick is admitted to the grading pass instead of being skipped on market
      family. `classifyMarketFamilyForGrading('moneyline')` returns a `game_moneyline`
      family with `gradeable: true` and `participantRequirement: 'required'`.
- [x] A moneyline's `line = null` no longer reads as missing data. `MarketFamilyRule`
      carries `usesLine`, and the `missing_line` skip is keyed on it. Mutation `grading-1`
      restores the blind skip and turns 9 assertions red.
- [x] A moneyline outcome is read from an attested win flag rather than from an
      over/under comparison, through a `Map` of exactly `{1: win, 0: loss, 0.5: push}`.
      Mutation `grading-5` drops the push entry and test 71 fails.
- [x] The win flag is refused under any market key but the dedicated
      `game_moneyline_win`. This is what keeps the 280 production `points-all-game-ml`
      rows -- every one of which carries a raw score with `participant_id = NULL` --
      uninterpretable by this path. Mutation `grading-2` disables the guard and tests 72
      and 73 fail.
- [x] `operator` provenance is refused, and the refusal is a control rather than a gap.
      `TRUSTED_GRADING_EVENT_PROVIDERS` is `{sgo}`; an event whose metadata names
      `providerKey: operator` skips with `event_provenance_untrusted_provider`. Mutation
      `grading-3` re-admits `operator` with its own ingestion source and test 76 fails.
- [x] The required ingestion source is keyed BY PROVIDER, not by a flat allow-list, so `sgo`
      cannot borrow another source: `providerKey: sgo` with `ingestionSource:
      operator.attestation` skips with `event_provenance_invalid_ingestion_cycle`. Mutation
      `grading-4` substitutes a flat two-value allow-list and test 77 fails. An unknown
      provider has no entry and fails closed.
- [x] The Track Only journey composes on ingested data. `createTrackOnlyMoneylineFixture`
      submits through the real `processSubmission` with Griff's exact pick shape and asserts
      that nothing grades before a result exists, then that an `sgo`-sourced
      `game_moneyline_win` row makes it settle as a win, the pick stays `validated`, and
      `outbox.listByPickId(pickId).length === 0`.
- [x] The report gains an aggregate. `computeTrackOnlyStats` returns record, non-decisions,
      pending, units staked/net/ROI and `measuredOver` over the governed cohort.
- [x] An unrecognised settlement result is named in `excluded` and never folded into
      `pending`. Mutation `stats-1` folds it and test 19 fails.
- [x] An empty or all-pending cohort reports `roi: null`, never `0`. Mutation `stats-2`
      reports `0` and four assertions fail.
- [x] The settlement's own stake wins over the pick's, so a corrected settlement is not
      priced at the original amount. `SettlementRow` declares `stake_units`, which already
      arrived via `select: '*'`. Mutations `stats-3` and `adapter-2` each drop it and the
      corresponding assertions fail.
- [x] A settlement row with a null result is distinguished from no settlement row at all:
      both are pending, but only one can later carry a correction. Mutation `adapter-1`
      conflates them and test 24 fails.
- [x] The two copies of the result market key cannot drift apart. Core invariant 8 forbids
      `apps/ingestor` importing from `apps/api`, so `game_moneyline_win` is declared in both
      `results-resolver.ts` and `grading-service.ts`. The third copy, in the operator CLI, is
      gone with the CLI; the remaining pair is joined by the import-time assertion in
      `scripts/ops/track-only/sgo-journey-proof.ts`, which throws before any test runs if
      either side is renamed alone.
- [x] No member delivery is created and no path to one is added. Containment is untouched:
      no `SYNDICATE_MACHINE_MODE` change, no delivery target released, no migration, no
      secret, no production write.

## EVIDENCE:

```
$ pnpm type-check
  exit 0

$ pnpm exec eslint apps/api/src/grading-service.ts apps/api/src/grading-service.test.ts \
    scripts/ops/track-only-report.ts scripts/ops/track-only-report.test.ts \
    scripts/ops/track-only/sgo-journey-proof.ts scripts/ops/track-only/sgo-journey-staging.t1-proof.test.ts
  exit 0
  (the full `pnpm lint` is exercised by the CI `verify` job below)

$ pnpm exec tsx --test scripts/ops/track-only-report.test.ts
  # tests 35
  # pass 35
  # fail 0
  # skipped 0
  (50 at 8c57fc3f4; the fifteen tests whose subject was the deleted operator CLI --
   its planner, --help control, parseCli, entrypoint and the writer/reader coupling
   assertion against it -- are removed with it. The stats tests and the ten integrated
   SGO journey tests are unchanged.)

$ pnpm exec tsx --test apps/ingestor/src/results-resolver.test.ts
  # tests 9
  # pass 9
  # fail 0
  # skipped 0

$ pnpm exec tsx --test apps/ingestor/src/ingestor.test.ts
  # tests 93
  # pass 93
  # fail 0
  # skipped 0

$ pnpm test:ops
  # tests 3106
  # pass 3106
  # fail 0
  # skipped 0
  21 suites, 98.8s
  (3121 at 8c57fc3f4; the difference is the fifteen removed tests above. A first run at
   this tree reported 4 failures -- the exact signature of mutation stats-4 -- because the
   mutation battery was editing stats.ts concurrently; the suite was re-run alone and this
   is that clean run. The contaminated run is named rather than dropped.)

$ pnpm exec tsx --test apps/api/src/grading-service.test.ts
  # tests 86
  # pass 86
  # fail 0
  # skipped 0
  (82 at 8c57fc3f4; the provenance-crossing test is replaced by two refusal tests, and the
   restrictToPickIds tests remain)

$ pnpm test
  exit 0
  (captured through a file tail, so the aggregate per-suite totals are not summed by hand;
   the authoritative aggregate is the CI `verify` job on PR 1567. The chained package
   scripts are &&-joined, so exit 0 is a statement about every one of them.)

$ pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1889 --base origin/main --head 9e3554df42a99c90d41b0c153adfd018beeeb3d2
  Verdict: PASS
  Changed files: 17
  Rules matched: ingestor-provider

$ mutation battery -- 14 mutations, each applied at a single anchor, suite run, file restored
  stats-1     1 failing  not ok 19 - an unrecognised result is excluded, NOT folded into pending
  stats-2     4 failing  not ok 14 - void and cancelled are not decisions and never enter the record or ROI
  stats-3     2 failing  not ok 20 - the settlement's own stake wins over the pick's
  stats-4     4 failing  not ok 10 - a -110 winner returns the right profit, not the stake
  adapter-1   1 failing  not ok 24 - the adapter preserves an in-progress settlement row as a row
  adapter-2   1 failing  not ok 25 - the adapter carries the settlement's own stake through to the price
  grading-1   10 failing  not ok 70 - runGradingPass settles a moneyline from an ingested win flag
  grading-2   2 failing  not ok 72 - a score stored under the pick's own market key is refused by the guard
  grading-3   1 failing  not ok 76 - operator provenance is refused: the deferred attestation route has no trust entry
  grading-4   1 failing  not ok 77 - provenance is keyed by provider: sgo may not borrow another source
  grading-5   1 failing  not ok 71 - an ingested loss and push settle as loss and push
  resolver-1  1 failing  not ok 7 - UTV2-1889: a half-scored event writes nothing — the outcome is never inferred from one side
  resolver-2  2 failing  not ok 5 - UTV2-1889 (gaps A+B+D): a moneyline writes an outcome per side, attributed to the team
  resolver-3  1 failing  not ok 8 - UTV2-1889: an unresolvable side writes nothing and is never guessed
  every file restored from captured bytes, sha256 asserted equal afterwards
  (17 at 8c57fc3f4. help-1, couple-1 and couple-2 targeted the deleted CLI or the coupling
   test against it and have no subject. grading-3 is INVERTED: removing `operator` from the
   trusted set used to be the mutation and is now the shipped state, so the mutation
   re-admits it and the refusal test is the one assertion that turns red. resolver-3's
   first form -- fall back to the first event_participants row -- was a no-op against a
   fixture with no such rows, and was restated as inventing a participant id before it
   was recorded: a mutation that cannot fail is not a control.)

$ read-only governed production measurement (zfzdnfwdarxucxtaojxm, one SELECT, no write)
  governed_cohort                          1
  cohort_validated                         1
  cohort_settlement_rows                   0
  cohort_distribution_outbox_rows          0
  points_all_game_ml_rows                280
  points_all_game_ml_rows_with_side        0
  game_moneyline_win_rows                  0
  (measured 2026-09-11; the query and its columns are unchanged by this commit)
```

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm test`: exit 0
- [ ] `pnpm verify`: NOT RUN on the workstation by design -- `verify` ends at
      `test:live-db`, where `ci:assert-staging` refuses any target that is not staging
      `xskgrzbteyqdufktjrjx`. The CI `verify` job on PR 1567 is the authoritative run.
- [x] `pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1889 --base origin/main --head 9e3554df42a99c90d41b0c153adfd018beeeb3d2`:
      PASS, 17 files, rule `ingestor-provider` matched and satisfied

## Runtime Verification

This lane is admitted under the route B deferral: the manifest carries
`t1_live_db_precondition: "deferred_to_ci"`, so the live-DB evidence is obtained in CI
rather than on the contained workstation, and closeout check `G6` refuses to close without
both `verify` and `Writable DB proof (staging only)` green on the merge SHA. The deferral
moves where the evidence is obtained and changes nothing about whether it is obtained.

That evidence exists at the execution anchor of this bundle, and it includes the journey
itself running against the staging database rather than only in memory. Run
`34713309743` attempt 1, job `103605894101`, at head
`9e3554df42a99c90d41b0c153adfd018beeeb3d2` -- run conclusion **success**, with `verify`
(job `103606950029`) green in the same run. Every number below was read out of that job log,
not written from recollection:

```
job "Writable DB proof (staging only)" -- all 17 steps success, 2026-09-12T19:09:07Z -> 2026-09-12T19:16:57Z
  [assert-staging] OK: target is the approved staging project   (x3, before any test)
  seed-staging  [seed-staging] retained by design: settlement_records, picks, submissions ; [seed-staging] reset distribution_receipts: 1 row(s) deleted ; [seed-staging] reset distribution_outbox: 12 row(s) deleted ; [seed-staging] reset system_runs: 4 row(s) deleted ; [seed-staging] sports: 9 synthetic row(s) upserted ; [seed-staging] cappers: 1 synthetic row(s) upserted ; [seed-staging] market_families: 6 synthetic row(s) upserted ; [seed-staging] selection_types: 3 synthetic row(s) upserted ; [seed-staging] market_types: 133 synthetic row(s) upserted
  migration head 20260901150000_utv2_1811_rate_limit_buckets.sql
  pnpm test:db            -> apps/api/src/database-smoke.test.ts  7/7 pass, 0 fail, 0 skipped
  pnpm test:t1-proof:live -> 20 suites, 20 TAP blocks summed    125/125 pass, 0 fail, 0 skipped
  receipt .out/ci-db-proof-receipt.json
    sha256 43dc5dcdbea7d007ddfd28aabf857b044d38a45eb3844bc63b745b166eb96729
    artifact utv2-1630-db-proof-receipt-34713309743-1 (id 10304071606, 1459 bytes)
  CI_FIXTURE_RUN_ID utv2-1630-34713309743-1
```

**The twentieth suite is this lane's**, `scripts/ops/track-only/sgo-journey-staging.t1-proof.test.ts`,
wired by the one-line `package.json` entry, and it contributed 6 of the assertions above:

```
    ok 1 - the fixture is namespaced and identifiable, so no row it writes can be mistaken for real data
    ok 2 - the real resolver wrote real rows to staging, read back from the database
    ok 3 - the real grading pass settled the pick, and the settlement persists in staging
    ok 4 - Track Only stays validated and creates no delivery, asserted against the real tables
    ok 5 - the real statistics compute from the persisted settlement
    ok 6 - an incomplete result is refused rather than guessed, against staging
# pass 6   # fail 0   # skipped 0
staging project ref  xskgrzbteyqdufktjrjx
CI_FIXTURE_RUN_ID    utv2-1630-34713309743-1
log sha256           8fe2619d3e0a8ff075fb64964727d93e47798dd31f1b547164b45c8ec2a6aaa1
```

**Every run cited by earlier versions of this section is withdrawn as evidence for this
artifact**, and stays withdrawn: `34651506561` (head `7dd4ccb69`), `34690701925`
(`bdc03146e`), `34700925304` attempt 2 (`c4f22cc31`) and `34702693121` (`8c57fc3f4`)
each compiled a source tree that still contained the operator-attestation route. A receipt
for a superseded source tree is not weaker evidence for this bundle -- it is evidence for a
different artifact. The staging journey has now passed on four independent runs across four
heads with four disjoint fixture namespaces, and only the run above is bound here.

The binding claim is stated in its source-tree form and verified at the current head:

```
git diff --name-only 9e3554df42a99c90d41b0c153adfd018beeeb3d2 HEAD \
  -- 'apps/**' 'packages/**' 'scripts/**' 'supabase/**' '.github/**' 'package.json'  ->  (empty)
```

So the run cited above compiled a source tree byte-identical to the execution anchor's, and
so will any later head that changes only docs. The staging DB proof job serialises through a
concurrency group and a new push cancels the run in progress, which is why this citation was
written only after the run concluded.

**Zero skips is enforced, not observed.** When `CI_FIXTURE_RUN_ID` is present the suite sets
`mustRun` and refuses to skip: a missing credential or an unapproved target fails the tests
rather than quietly reporting them skipped. Verified in both directions locally -- with no
staging target the suite reports 6 skipped / 0 fail; with `CI_FIXTURE_RUN_ID` set against a
bad target it reports 0 skipped / 6 fail.

**The first staging run failed, and the explanation this section gave for it was wrong.**
Run `34700508935` attempt 1 was 4 pass / 2 fail. Failure 5 was a plain assertion bug
(`record.wins` vs `record.win`). Failure 6 was an isolation hole, and the text that stood here
said it exposed that `chooseEventForPick` "never cross-checks the participants". PM's review
called that too broad, and measurement agrees: `resolvePickEvent` in
`apps/api/src/grading-service.ts` DOES filter candidate events by the pick's participant
(`eventParticipants.listByParticipant`) before `chooseEventForPick` orders by name and
start-time proximity. Grading resolved nothing wrongly. The actual mechanism was upstream:
`computeSubmissionIdempotencyKey` in `apps/api/src/submission-service.ts` hashes
`source | market | selection | line | odds | eventName` and **not** metadata, so the two
fixtures -- differing only in participant ids and provider event id -- hashed to one key, and
`processSubmission` handed the half-scored run the fully-scored run's existing pick. There was
no second pick; the settlement the test read was that pick's genuine settlement. Read-only
staging SQL confirms it: run `34700508935-1` holds exactly one pick (`fd6423fe`), whose
`teamId` is the main fixture's AWAY participant and whose settlement is against the main
event. Namespacing the event name fixed it because the name is a key input -- namespacing the
id alone was not isolation -- and the doc-comment on `fixtureEventName` and the test's own
comment now say exactly this.

**A separate limitation, kept visible rather than closed by fixture naming.** When a pick
carries no explicit event id, `resolvePickEvent` chooses among its participant-linked events
by name match and then by start-time proximity, so with two participant-linked events on
adjacent dates and an ambiguous name it selects the *nearest* rather than an explicit
canonical event. Namespacing the fixture name is isolation for this suite, not a production
resolution repair. It is listed below as a production-acceptance item.

**What remains unproven, kept separate by interface rather than blurred together:**

- **Production** -- nothing in this lane ran against production. No production row was
  written, and no production claim is made. The only production reads are the governed
  read-only SELECT under EVIDENCE.
- **Production** -- ambiguous-event resolution, above. Whether the nearest participant-linked
  event is always the intended one for real submissions is a production-acceptance check.
- **Production** -- real SGO ingestion. The resolver is exercised with a recorded provider
  payload through an injected transport; the provider was never contacted, SGO remains
  parked, and no ingestion cycle ran.
- **Browser** -- no browser interface is exercised by this suite. The Smart Form e2e suite
  asserts the persisted pick in memory and its CI gate defaults off; browser authentication
  and the Smart Form HTTP/controller path are evidenced only there.
- **Scale** -- this proves one Track Only moneyline through the journey against staging. It
  is not a repeatability claim, and not a statistics claim over a real cohort.

No containment setting was changed. SGO remains parked, member delivery remains off, no
operator write route ships, and the suite writes only namespaced fixture rows to staging.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1567
Approved PR head: pending merge
Execution SHA: 9e3554df42a99c90d41b0c153adfd018beeeb3d2
