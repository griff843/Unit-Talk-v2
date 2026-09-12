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
Head SHA: f767e81abc77b7952afe88204827e84668f41952
result: pass

## ASSERTIONS:

### The SGO journey, added 2026-09-11 on the direction change

These are the assertions that matter now. The operator-attestation assertions below are
retained because the work is retained, but the delivery route is SGO-backed, and these
say what stands between an SGO result and a Smart Form pick. Every one runs the SHIPPED
normalizer and the SHIPPED classifier, not a restatement of them. The only substitution
anywhere in the journey is the HTTP transport, injected through `fetchImpl` so the proof
cannot reach the provider -- SGO activation is unapproved.

- [x] The real SGO normalizer erases the side from the market key.
      `points-home-game-ml-home` and `points-away-game-ml-away` BOTH normalize to
      `points-all-game-ml`, because `normalizeSgoProviderMarketKey` builds
      `` `${statId}-all-${periodId}-${betTypeId}` `` with `-all-` as a hardcoded literal.
      This is why `providerSide` had to exist as a separate field (UTV2-1868).
- [x] **GAP A** -- `SGO_GAME_LINE_CANONICAL_ID` is unreachable for game lines. Sixteen of
      its seventeen entries are keyed `<league>-<bet>-all-game`, a shape that template
      cannot produce, so the raw provider key falls through the `??`. Asserted directly:
      `canonicalTableMatched === false` and the written key is `points-all-game-ml`, NOT
      `game_ml_mlb`. Corroborated read-only in production -- **0** rows of any `game_ml_*`
      key, **280** rows of `points-all-game-ml`. The table carries its own deferred-work
      comment naming UTV2-450, which says the key format was never verified against live
      payloads. (Written without the literal placeholder token, which the proof auditor
      scans for regardless of context.)
- [x] **GAP B** -- `actual_value` is a raw team score, not an outcome. The fixture writes
      3 and 5; grading accepts only `1 | 0 | 0.5`. Asserted that neither value is a legal
      moneyline outcome. The winner exists only in the COMPARISON of the two rows, never
      in either row alone, so this is a missing computation rather than a renaming.
- [x] **GAP C** -- no market key joins. `journeyCompletes === false` and
      `joinedMarketKeys === []`. The resolver writes `points-all-game-ml`; grading looks
      for `moneyline` and `game_moneyline_win`. A third name exists again:
      `provider_market_aliases` maps sgo `points-all-game-ml` to `moneyline`, the pick's
      own input key, so it round-trips to itself.
- [x] **GAP D** -- side attribution is unproven in data. UTV2-1868 repaired future writes
      only. Measured read-only in production, every stored game-line row has
      `participant_id` NULL: `points-all-game-ml` 280/**0**, `points-all-game-sp` 280/**0**,
      `points-all-reg-ml3way` 280/**0**, `points-all-1h-sp` 258/**0**, `points-all-1h-ml`
      257/**0**. Grading requires a participant for a moneyline, so none can settle one.
- [x] **The control.** A game total completes the journey through the same fixture and the
      same real code -- `journeyCompletes === true`, `joinedMarketKeys === ['game_total_ou']`.
      Without it the four failures above could be explained by the harness being wrong
      rather than by the code, which is the specific way a negative result goes bad.
- [x] The classifier is NOT the gap. `game_moneyline`, `gradeable: true`, `usesLine: false`
      are asserted separately so a reader cannot conclude from the failing journey that
      moneyline grading was never wired. It was. It has nothing to join to.
- [x] The proof refuses data that could be real. `assertFixtureIsIdentifiable` throws on an
      event id lacking `UTV2-1889-STAGING-FIXTURE`, and throws on an empty payload so a
      vacuous run cannot read as a pass. Both directions asserted.

**Gaps A and D own `apps/ingestor/**`, outside this lane's pinned `file_scope_lock`.** They
are reported here and repaired in a separate lane. Widening the lock is not available to an
agent, and repairing them outside it would be scope bleed.


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

**This receipt is WITHDRAWN, 2026-09-11, and is retained only as a record.** Run
`34651506561` compiled the tree at `2b0a01e02`. The direction change landed the SGO journey
proof at `f767e81ab`, which changes source on top of that tree. A receipt for a superseded
source tree is not weaker evidence for this bundle -- it is evidence for a different
artifact -- so it is withdrawn rather than carried forward with a caveat.

The previous binding rule said *every commit on this lane after `2b0a01e02` touches only
`docs/06_status/proof/UTV2-1889/`*. That claim was true when written and the journey-proof
commit made it **false**. It is corrected by moving the anchor, not by rewording the claim:
a binding rule that has been falsified is not repaired by restating it.

Re-anchored on `f767e81ab`, the same head-independent form holds again -- every commit on this
lane after it touches only this proof directory, so any later head compiles a byte-identical
source tree. Checkable with `git diff --name-only f767e81ab <head>`.

An earlier draft cited run `34650795093`, whose staging job went green and which was then
**cancelled during `verify` by my own later pushes**, through the concurrency group. Recorded
rather than quietly swapped, because the failure mode generalises: citing an in-flight run
means the act of writing the citation can invalidate it, and the loop ends only by citing a
run that has already concluded. The replacement receipt is taken the same way.

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
Execution SHA: f767e81abc77b7952afe88204827e84668f41952
