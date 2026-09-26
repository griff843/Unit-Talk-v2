# PROOF: UTV2-1954

MERGE_SHA: pending merge

> Pre-merge, the merge row is intentionally left unbound. The Execution SHA row carries the
> verified implementation identity. `post-merge-lane-close.yml` rebinds merge authority only
> after GitHub supplies the merged-PR attestation.

Issue: UTV2-1954
Tier: T1
Lane type: runtime
Branch: claude/utv2-1954-replay-fidelity
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1654
Head SHA: 3885c4b4ce28f6bad2676ca6a1ecd63b28ea513a
result: pass

## ASSERTIONS:

- [x] Promotion snapshots persist `scoringContext {market, sport}`, taken by
      `promotionScoringContextForPick()` -- the same helper `calculateScore` reads -- on both
      writers: the eager all-policies path and the single-policy/override path.
- [x] `replayPromotion()` scores from the persisted scoring context, so the market-family
      multipliers, the family score cap and the unsupported-sport cap are applied on replay.
      The reported NBA player prop, persisted best-bets `suppressed` at 60.15, replays
      `suppressed` at 60.15, not `qualified` at 70.76.
- [x] `replayRecordedPromotion()` replays a `pick_promotion_history` payload with the policy
      the row saved (weights, `minimumScore`, `minimumEdge`, `minimumTrust`, `boardCaps`),
      never a caller-supplied or current policy, and reports score and status agreement.
- [x] A row that cannot be reproduced is reported `not-reproducible` with a named reason
      (`snapshot-missing`, `scoring-context-missing`, `policy-missing`,
      `recorded-score-missing`); it is never re-decided. Rows written before this change are
      `scoring-context-missing`.
- [x] UTV2-1902's human-capper board-suppression override is still persisted and replayed.
- [x] Each fix is mutation-proven: each of 3 mutations, applied alone, turns named tests red.
- [x] The live-DB proof (`t1-proof-utv2-1954-promotion-replay.test.ts`, wired into
      `test:t1-proof:live` and registered in `db-writer-classification.json`) runs in
      `Writable DB proof (staging only)` under `t1_live_db_precondition: deferred_to_ci`.
- [x] No containment surface is touched. Zero migrations, zero production writes.

### Scope of the fidelity guarantee

`replayPromotion(snapshot, policy)` still accepts a caller policy; that is its
counterfactual contract. Fidelity to the recorded decision is the job of
`replayRecordedPromotion()`, which reads the policy from the row. A caller that wants
"does this row reproduce?" must use the latter.

## EVIDENCE:

Measured on head `13b1ca56dfe500cc419ad00a7bf0001fa72b0903` in the lane worktree, and re-anchored to `3885c4b4ce28f6bad2676ca6a1ecd63b28ea513a`.
That commit changes only the live-DB proof file (see "Staging run 36212886508" below). No file
in `pnpm test`, the affected suites or the mutation battery changed (`git diff 13b1ca56d 309fd866a`
touches no implementation or unit-test file), so those figures carry forward. At `309fd866a`,
`pnpm type-check` and eslint on the live proof file were re-run (exit 0), as was the r-level
check below. The branch
is based on `origin/main` `af2f8e11ab4f813e4bc339b23bcd9ccf113f301a`; the implementation
commit is a cherry-pick of `9bec7cc13` onto the lane-start commit, with no conflicts.

```
$ pnpm exec tsx --test apps/api/src/promotion-edge-integration.test.ts
# tests 111
# pass  111
# fail  0

$ pnpm exec tsx --test packages/contracts/src/promotion.test.ts
# tests 32
# pass  32
# fail  0

$ pnpm exec tsx --test packages/domain/src/promotion-conviction.test.ts
# tests 5
# pass  5
# fail  0

$ pnpm test
tests 6915, pass 6915, fail 0 (zero 'not ok' TAP lines across the workspace)
exit 0

$ pnpm type-check
exit 0

$ pnpm exec eslint apps/api/src/promotion-edge-integration.test.ts \
    apps/api/src/promotion-service.ts \
    apps/api/src/t1-proof-utv2-1954-promotion-replay.test.ts \
    packages/contracts/src/promotion.ts packages/domain/src/promotion.ts
exit 0

$ npx tsx scripts/ci/r-level-check.ts --base af2f8e11ab4f813e4bc339b23bcd9ccf113f301a \
    --head 3885c4b4ce28f6bad2676ca6a1ecd63b28ea513a
Verdict: PASS
Changed files: 11
Rules matched: promotion-scoring
```

`r-level-check` is given explicit SHAs because it resolves refs in the root checkout, not
the lane worktree.

### R-level: what the PASS does and does not show

`promotion-scoring` requires R1-R3 with artifacts `r2-determinism` and `r3-shadow-report`.
The check reports both `found: true`, but the files it matched are
`artifacts/r2-determinism-utv2-845.json` and `artifacts/shadow-report-utv2-845.json`. They
belong to UTV2-845 and are not evidence about this diff. The producers were run on this
head:

- `tsx scripts/shadow-scoring-runner.ts --mode ci` exits with
  `SUPABASE_URL and SHADOW_PARITY_READ_ONLY_KEY are required`. That credential is absent and
  this lane does not handle secrets.
- `scripts/live-data-lab-runner.ts` does not exist on `main`.

This diff makes replay more deterministic, not less. It adds no randomness, clock or I/O to
scoring. `calculateScore` now reads market and sport through `promotionScoringContextForPick`,
which is the same expression it inlined before. The unchanged 111-test suite, which includes
the scoring golden paths, shows live scoring did not move. Nothing here claims an R2 or R3
artifact was produced.

### The mutation battery

Each mutation was applied to a single file, the suite
`apps/api/src/promotion-edge-integration.test.ts` run, and the file restored from a
pre-mutation copy (`cmp`-checked).

```
== M1 replayPromotion ignores the persisted scoring context (packages/domain/src/promotion.ts)
not ok 99 - UTV2-1954: the reported NBA prop, suppressed at 60.15, does not replay as qualified at 70.76
not ok 101 - UTV2-1954: replay uses the saved policy, not a caller-supplied one
not ok 104 - UTV2-1954: every eager-path row reproduces -- smart-form-nba-prop-qualified
not ok 105 - UTV2-1954: every eager-path row reproduces -- api-mlb-moneyline-suppressed
not ok 106 - UTV2-1954: every eager-path row reproduces -- api-nba-prop-raw-string
not ok 107 - UTV2-1954: every eager-path row reproduces -- discord-bot-nfl-spread
not ok 108 - UTV2-1954: every eager-path row reproduces -- alert-agent-team-total
not ok 109 - UTV2-1954: every eager-path row reproduces -- model-driven-unsupported-sport
not ok 111 - UTV2-1954: an operator override row reproduces too
# pass 102
# fail 9
== M2 replayRecordedPromotion scores with the current best-bets policy, not the saved one (packages/domain/src/promotion.ts)
not ok 101 - UTV2-1954: replay uses the saved policy, not a caller-supplied one
# pass 110
# fail 1
== M3 writers stop persisting scoringContext (apps/api/src/promotion-service.ts, both writers)
not ok 99 - UTV2-1954: the reported NBA prop, suppressed at 60.15, does not replay as qualified at 70.76
not ok 101 - UTV2-1954: replay uses the saved policy, not a caller-supplied one
not ok 102 - UTV2-1954: a replay that reaches a different score is reported as a disagreement
not ok 104 - UTV2-1954: every eager-path row reproduces -- smart-form-nba-prop-qualified
not ok 105 - UTV2-1954: every eager-path row reproduces -- api-mlb-moneyline-suppressed
not ok 106 - UTV2-1954: every eager-path row reproduces -- api-nba-prop-raw-string
not ok 107 - UTV2-1954: every eager-path row reproduces -- discord-bot-nfl-spread
not ok 108 - UTV2-1954: every eager-path row reproduces -- alert-agent-team-total
not ok 109 - UTV2-1954: every eager-path row reproduces -- model-driven-unsupported-sport
not ok 111 - UTV2-1954: an operator override row reproduces too
# pass 101
# fail 10
== restored
# pass 111
# fail 0
```

M2 is caught by exactly one test (101). The matrix rows cannot catch it, because in the
in-memory suite the saved policy equals the current one. Test 101 saves a policy whose
`minimumScore` differs and asserts the replay follows the saved value.

### Staging run 36212886508: why the live proof failed, and what changed

The first staging run (CI run 36212886508, job `Writable DB proof (staging only)`, head
`557fd22f7`) failed all three score-driven tests. Tests 1 and 2 expected best-bets
`suppressed` / `qualified` and got `not_eligible`. Test 3 failed on the score column.

- **`not_eligible` is a board-capacity gate, not the fix failing.** `evaluatePromotionEligibility`
  (`packages/domain/src/promotion.ts:326-335`) returns `not_eligible` when the target's board
  is at its caps (`perSlate` 15, `perSport` 10, `perGame` 2). `getPromotionBoardState`
  (`packages/db/src/runtime-repositories.ts:3612-3661`) counts qualified/promoted,
  non-settled, non-voided, non-Track-Only picks on that target from the last 7 days. Staging is
  shared, and `t1-proof-atomicity.test.ts:224-229` inserts a best-bets `qualified` pick with
  `metadata: {}` on every staging run and never removes it (261 CI runs since 2026-09-19).
  So the staging best-bets board sits above `perSlate`. It also matched the old fixture on
  `perGame`, because a pick with no `eventName` compares `undefined === undefined` against
  every other eventName-less pick (`runtime-repositories.ts:3654-3656`). An offline
  simulation reproduces this: the same fixtures through the real controller reach
  `suppressed` 60.15 / `qualified` on an empty board, and with 15 atomicity-shaped picks
  seeded the best-bets row is `not_eligible` with
  `["board cap for the slate has been reached"]`.
- **Test 3:** `pick_promotion_history.score` is `numeric(5,2)`
  (`supabase/migrations/00000000000000_baseline_live_schema.sql:2913`). The proof compared
  it to the full-precision replayed score within 1e-6, so 31.48 could never match.

`309fd866a` changes the live proof only:
1. Each fixture names a unique game (`eventName`), as a real pick and the in-memory fixture do.
2. The column is compared at the precision it stores. The exact comparison stays against
   `payload.score`.
3. Every status assertion reports the recorded suppression reasons and `boardStateAtDecision`.

No assertion on the recorded decision is relaxed. This lane does not clear the `perSlate`
saturation of the staging best-bets board; it removes no fixture rows it did not create.

### Staging run 36226933161: the live proof passes

The saturation was cleared by a separate lane, WORK-2026092602 (#1655, merged `e019642a8`),
which drains positively identified leaked CI fixtures off the staging board through
`transition_pick_lifecycle` in the staging-asserted seed step. On this lane's resynced head, CI
run 36226933161, job `Writable DB proof (staging only)`:

```
[seed-staging] best-bets board drain: 0 leaked fixture pick(s) voided (scanned=524, raced=0)
ok 1 - UTV2-1954 live-DB: the reported NBA prop replays suppressed at 60.15, not qualified at 70.76
ok 2 - UTV2-1954 live-DB: a qualifying canonical player prop replays qualified at its recorded score
ok 3 - UTV2-1954 live-DB: a game line and an unsupported sport replay at their recorded scores
ok 4 - UTV2-1954 live-DB: a persisted row stripped of its scoring context is not reproducible
```

Every other T1 live suite in that job also passed (`# fail 0` for each).

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm test`: exit 0, with 6915 tests, 6915 pass and 0 fail
- [ ] `pnpm verify`: not runnable locally (staging-target assertion). It is executed by the required `verify` check on this PR.
- [x] `npx tsx scripts/ci/r-level-check.ts --base af2f8e11a --head 309fd866a`: Verdict PASS

## Runtime Verification

The live-DB half of T1 runtime proof is deferred to CI under this lane's
`t1_live_db_precondition: deferred_to_ci`. It is supplied by the `Writable DB proof
(staging only)` job against staging `xskgrzbteyqdufktjrjx`, through `pnpm test:t1-proof:live`,
which now includes `apps/api/src/t1-proof-utv2-1954-promotion-replay.test.ts`. It is **not**
fabricated here: `runtime_proof.status` in `evidence.json` reads `PENDING_CI`, and is
populated at closeout by `autoHarvestCiDbProofIntoEvidence`.

The live proof submits real Track Only picks through the real controller and reads every
promotion history row back out of Postgres, so each payload has made the JSONB round trip.
It then replays each row with only what the row recorded. Its four tests:

1. The reported NBA prop replays `suppressed` at 60.15, not `qualified` at 70.76.
2. A qualifying canonical player prop replays `qualified` at its recorded score.
3. A game line and an unsupported sport replay at their recorded scores.
4. A persisted row stripped of its scoring context is `not-reproducible`.

Locally all four fail with `Failed to find pick by idempotency key: TypeError: fetch failed`.
The existing `t1-proof-utv2-1951-settlement-recap-provenance.test.ts` fails the same way on
this workstation. The failure is the containment `SUPABASE_URL`, not a defect.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1654
Approved PR head: pending merge
Execution SHA: 3885c4b4ce28f6bad2676ca6a1ecd63b28ea513a

### Re-anchor to `3885c4b4ce28f6bad2676ca6a1ecd63b28ea513a`

Branch refreshed from origin/main `1526f7e2d` after main advanced. The merge brings in only main's own
changes: `.ops/sync/WORK-2026092602.yml`, `.ops/sync/WORK-2026092603.yml`, `.ops/work/WORK-2026092603.md`, `apps/api/src/t1-proof-atomicity.test.ts`, `docs/06_status/lanes/WORK-2026092602.json`, `docs/06_status/lanes/WORK-2026092603.json`, `docs/06_status/proof/WORK-2026092602/diff-summary.md`, `docs/06_status/proof/WORK-2026092602/evidence.json`, `docs/06_status/proof/WORK-2026092602/verification.md`, `docs/06_status/readiness/readiness-score.json`, `scripts/ci/seed-staging-fixtures.ts`, `scripts/ci/staging-board-drain.ts`, `scripts/ci/staging-path-enforcement.test.ts`. Lane-scope files changed by the merge: 0. Superseded anchor, not
withdrawn: `309fd866a2bf1967d8e412629c0cc0ea649a1e13`. `verify` re-runs on the new head.

### Re-anchor to `3885c4b4ce28f6bad2676ca6a1ecd63b28ea513a`

Branch refreshed from origin/main `7771bd2d6` after main advanced. The merge brings in only main's own
changes: `.ops/sync/WORK-2026092604.yml`, `.ops/work/WORK-2026092604.md`, `docs/06_status/lanes/WORK-2026092602.json`, `docs/06_status/lanes/WORK-2026092604.json`, `docs/06_status/proof/WORK-2026092602/diff-summary.md`, `docs/06_status/proof/WORK-2026092602/evidence.json`, `docs/06_status/proof/WORK-2026092602/verification.md`. Lane-scope files changed by the merge: 0. Superseded anchor, not
withdrawn: `3e4967df29366ef408222bbf87a7b0c2be018616`. `verify` re-runs on the new head.

### Re-anchor to `3885c4b4ce28f6bad2676ca6a1ecd63b28ea513a`

Branch refreshed from origin/main `744ff2f6a` after main advanced. The merge brings in only main's own
changes: `docs/06_status/readiness/readiness-score.json`. Lane-scope files changed by the merge: 0. Superseded anchor, not
withdrawn: `262add2af229797ec8b8975549c98741142d81c6`. `verify` re-runs on the new head.
