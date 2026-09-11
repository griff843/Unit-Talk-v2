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
Head SHA: 2b0a01e02a6a4c887496e79eb66622cc2b38f7ef
result: pass

## ASSERTIONS:

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
  # tests 40
  # pass 40
  # fail 0
  # skipped 0

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

$ pnpm exec tsx scripts/ci/r-level-check.ts --issue UTV2-1889 --base origin/main --head 470168554
  Verdict: PASS
  Changed files: 10
  Rules matched: (none) - no R-level artifacts required for this diff

$ mutation battery -- 14 mutations, each applied at a single anchor, suite run, file restored
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
  working tree clean after every restore

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
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS, 10 files,
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

An earlier draft of this section cited run `34650795093` instead. That run's staging job
went green and produced a valid receipt, and the run was then **cancelled during `verify`
by my own later pushes to this branch**, through the concurrency group. The lesson is
recorded rather than the citation quietly swapped: citing an in-flight run means the act of
writing the citation can invalidate it, and the loop ends only by citing a run that has
already concluded. `34651506561` had.

The receipt binds the bound head's source tree rather than a preceding one, and the claim
is written so it cannot go stale as further proof commits move the head. Every commit on
this lane after `2b0a01e02` -- which is `verified_source_sha` -- touches only
`docs/06_status/proof/UTV2-1889/`. So for any later head on this lane,
`git diff --name-only 2b0a01e02 <head>` returns proof-directory files and nothing else,
and the tree this job compiled is byte-identical to the tree at the bound head. A proof
bundle can never carry a receipt for its own commit, because writing the receipt moves the
head; what it can carry is one whose only distance from the bound head is this directory.

The coverage gap is stated rather than papered over, and it is recorded OPEN in
`evidence.json`. This lane adds no `t1-proof` suite, so no live assertion exercises the
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
Execution SHA: 2b0a01e02a6a4c887496e79eb66622cc2b38f7ef
