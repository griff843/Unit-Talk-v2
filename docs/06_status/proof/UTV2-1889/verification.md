# PROOF: UTV2-1889

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-11T21:36:27.051Z
Issue: UTV2-1889
Tier: T1
Lane type: runtime
Branch: claude/utv2-1889-operator-attested-results
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1567
Head SHA: b22617cae7e23e485813437173e8df2c35b2abbc
result: pass

## ASSERTIONS:

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
`results-resolver.test.ts` and `ingestor.test.ts`. A lock cannot be widened by an agent, so a
single `scope-override/v1` is requested on PR 1567 naming exactly those three paths together
with the change they carry. The repairs are not split across lanes because each one alone
leaves the journey broken: the market key without the outcome writes a raw score under a
graded key, and the outcome without the attribution writes an unattributable one.


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
- [x] Admitting `operator` to the trusted provider set is a widening, not a loosening:
      the required ingestion source is keyed BY PROVIDER, so an `operator` event cannot
      claim `ingestor.cycle`. Mutation `grading-4` substitutes a flat two-value allow-list
      and test 76 fails. `sgo`'s required source is unchanged and an unknown provider has
      no entry and fails closed.
- [x] The operator journey composes. `createTrackOnlyOperatorMoneylineFixture` submits
      through the real `processSubmission` with Griff's exact pick shape and asserts that
      nothing grades before a result exists, then that it settles as a win, the pick stays
      `validated`, and `outbox.listByPickId(pickId).length === 0`.
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
- [x] The writer and the reader cannot drift apart. The dedicated market key and the
      operator provenance pair are declared independently in the attest CLI and in the
      grading pass; each side's own test pinned only its own literal, so a *coherent*
      rename on one side alone was invisible. A cross-file assertion now compares them.
      Mutations `couple-1` and `couple-2` each rename one side and test 32 fails.
- [x] The operator CLI's `--help` cannot drift from the flags the parser reads. Mutation
      `help-1` renames `--evidence` throughout `USAGE` and test 39 fails.
- [x] No member delivery is created and no path to one is added. Containment is untouched:
      no `SYNDICATE_MACHINE_MODE` change, no delivery target released, no migration, no
      secret, no production write.

## EVIDENCE:

```
$ pnpm type-check
  exit 0

$ pnpm lint
  exit 0

$ pnpm exec tsx --test scripts/ops/track-only-report.test.ts
  # tests 50
  # pass 50
  # fail 0
  # skipped 0
  (40 at f767e81ab, plus the ten integrated SGO journey tests; the nine gap-proving
   tests that stood at f767e81ab are replaced by journey tests that complete)

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
  (test 76 pinned the sixteen unreachable aliases gap A removed; it now asserts the two
   reachable keys AND that three removed keys are undefined)

$ pnpm test:ops
  # tests 3121
  # pass 3121
  # fail 0
  21 suites, 64.6s

$ pnpm exec tsx --test apps/api/src/grading-service.test.ts
  # tests 82
  # pass 82
  # fail 0
  # skipped 0

$ pnpm test
  exit 0
  (captured through `tail`, so the aggregate per-suite totals scrolled past; the
   authoritative aggregate is the CI `verify` job on PR 1567. The chained package
   scripts are &&-joined, so exit 0 is a statement about every one of them.)

$ pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1889 --base origin/main --head b22617cae
  Verdict: PASS
  Changed files: 16
  Rules matched: (none) - no R-level artifacts required for this diff

$ mutation battery -- 17 mutations, each applied at a single anchor, suite run, file restored
  stats-1     1 failing  not ok 19 - an unrecognised result is excluded, NOT folded into pending
  stats-2     4 failing  not ok 15 - an empty cohort reports null ROI, never 0
  stats-3     2 failing  not ok 20 - the settlement's own stake wins over the pick's
  stats-4     4 failing  not ok 10 - a -110 winner returns the right profit, not the stake
  adapter-1   1 failing  not ok 24 - the adapter preserves an in-progress settlement row as a row
  adapter-2   1 failing  not ok 25 - the adapter carries the settlement's own stake through to the price
  grading-1   9 failing  not ok 70 - runGradingPass settles a moneyline from an operator-attested win flag
  grading-2   2 failing  not ok 73 - a score of 1 under the wrong market key is refused, not read as a win
  grading-3   8 failing  not ok 70 - runGradingPass settles a moneyline from an operator-attested win flag
  grading-4   1 failing  not ok 76 - provenance is keyed by provider: neither class may borrow the other's source
  grading-5   1 failing  not ok 71 - an operator-attested loss and push settle as loss and push
  help-1      1 failing  not ok 39 - the --help text names every flag the parser actually reads
  couple-1    1 failing  not ok 32 - the writer and the reader agree on the market key and the provenance pair
  couple-2    1 failing  not ok 32 - the writer and the reader agree on the market key and the provenance pair
  resolver-1  1 failing  not ok 7  - a half-scored event writes nothing -- the outcome is never inferred from one side
  resolver-2  2 failing  not ok 5  - a moneyline writes an outcome per side, attributed to the team
  resolver-3  1 failing  not ok 8  - an unresolvable side writes nothing and is never guessed
  working tree clean after every restore
  (resolver-1 and resolver-3 are each a guess where the shipped code refuses; both turn
   a test red, which is what makes "never guessed" a control rather than a claim)

$ read-only governed production measurement (zfzdnfwdarxucxtaojxm, one SELECT, no write)
  governed_cohort                          1
  cohort_validated                         1
  cohort_settlement_rows                   0
  cohort_distribution_outbox_rows          0
  points_all_game_ml_rows                280
  points_all_game_ml_rows_with_side        0
  game_moneyline_win_rows                  0
```

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm test`: exit 0
- [ ] `pnpm verify`: NOT RUN on the workstation by design -- `verify` ends at
      `test:live-db`, where `ci:assert-staging` refuses any target that is not staging
      `xskgrzbteyqdufktjrjx`. The CI `verify` job on PR 1567 is the authoritative run.
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS, 16 files,
      no rules matched

## Runtime Verification

This lane is admitted under the route B deferral: the manifest carries
`t1_live_db_precondition: "deferred_to_ci"`, so the live-DB evidence is obtained in CI
rather than on the contained workstation, and closeout check `G6` refuses to close without
both `verify` and `Writable DB proof (staging only)` green on the merge SHA. The deferral
moves where the evidence is obtained and changes nothing about whether it is obtained.

That evidence now exists. Run `34651506561`, job `103435276859`, at head `7dd4ccb69` --
run conclusion **success**, with `verify` green in the same run:

```
job "Writable DB proof (staging only)" -- all 16 steps success
  [assert-staging] OK: target is the approved staging project   (x3, before any test)
  pnpm test:db            -> apps/api/src/database-smoke.test.ts  7/7 pass, 0 fail, 0 skipped
  pnpm test:t1-proof:live -> 19 suites                         119/119 pass, 0 fail, 0 skipped
  aggregate across both credentialed steps                     126 assertions, 0 fail, 0 skipped
  receipt .out/ci-db-proof-receipt.json
    sha256 3fb82300deb8a1fb04188cee9465f17581cfb8d10512b5b171fdc941a669159e
    artifact utv2-1630-db-proof-receipt-34651506561-1 (id 10284626309)
```

**This receipt is WITHDRAWN, and stays withdrawn after the 2026-09-12 repair.** Run
`34651506561` compiled the tree at `2b0a01e02`. Two later commits change source on top of
that tree -- the SGO journey proof at `f767e81ab`, and the gap A/B/D repair at
`b22617cae`. A receipt for a superseded
source tree is not weaker evidence for this bundle -- it is evidence for a different
artifact -- so it is withdrawn rather than carried forward with a caveat.

The previous binding rule said *every commit on this lane after `2b0a01e02` touches only
`docs/06_status/proof/UTV2-1889/`*. That claim was true when written and the journey-proof
commit made it **false**. It is corrected by moving the anchor, not by rewording the claim:
a binding rule that has been falsified is not repaired by restating it.

The same correction was needed a second time, for the same reason: `f767e81ab` was this
field's anchor for one day, and the repair commit changed source on top of it. Re-anchored on
`b22617cae`, the head-independent form holds again -- every commit on this lane after it
touches only this proof directory, so any later head compiles a byte-identical source tree.
Checkable with `git diff --name-only b22617cae <head>`.

An earlier draft cited run `34650795093`, whose staging job went green and which was then
**cancelled during `verify` by my own later pushes**, through the concurrency group. Recorded
rather than quietly swapped, because the failure mode generalises: citing an in-flight run
means the act of writing the citation can invalidate it, and the loop ends only by citing a
run that has already concluded. The replacement receipt is taken the same way.

The coverage gap is stated rather than papered over, it is recorded OPEN in `evidence.json`,
and the integrated journey added at `b22617cae` does not narrow it. That journey is a
genuine integration claim -- real normalizer, real resolver, real submission, real grading,
real stats, composed end to end -- and it is still not a live-database claim. This lane adds no `t1-proof` suite, so no live assertion exercises the
moneyline branch, the market-key guard, the provenance check or the aggregate against real
PostgREST. That is the honest position rather than a shortfall: none of the three paths
makes a new database call or a new query shape -- grading reads `game_results` through the
repository method it already used, and the aggregate is a pure function over rows the
report already fetched with `select: '*'`. What would genuinely need live proof is a
result actually written under `game_moneyline_win`, and there are **zero** such rows in
production. Writing one is an operator action under `DB_ENVIRONMENT_OPERATOR_POLICY.md`
that this lane deliberately does not perform; seeding one to claim live coverage would
prove the seed, not the journey.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1567
Approved PR head: pending merge
Execution SHA: b22617cae7e23e485813437173e8df2c35b2abbc
