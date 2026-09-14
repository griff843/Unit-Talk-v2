# PROOF: UTV2-1903

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Issue: UTV2-1903
Tier: T1
Lane type: runtime
Branch: claude/utv2-1903-spread-grading-family
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1580
Head SHA: e24fef1907bb3966f4563883117bfba84e989b4f
result: pass

## What this lane repairs

A spread pick could not be graded at all. `classifyMarketFamilyForGrading('spread')` returned
`family: 'unsupported'`, so every spread submitted through the Smart Form was skipped by name
before any result row was consulted.

This is not a missing table entry. A spread is not an over/under: `inferSelectionSide('Chiefs -2.5')`
returns `null`, so the generic over/under branch the grading loop falls through to cannot express a
spread even once the family is admitted — it would skip on `selection_side_unknown` instead. The
family needed its own outcome derivation.

Measured against production (read-only), **2 of the 4 picks in the governed cohort are spreads**:
`29da425a` *Broncos +3* (line `+3.00`) and `04174f12` *Chiefs -2.5* (line `-2.50`), both
`status = validated`, both `capper_id = griff843`. Their persisted line sign is exactly the
convention this repair assumes — signed from the selected participant's perspective — so the cover
margin is `actual_value + line`, and an exactly-zero cover is a push rather than a win. That is why
the outcome is three branches and not two.

## ASSERTIONS:

- [x] `classifyMarketFamilyForGrading` returns `family: 'game_spread'`, `usesLine: true`,
      `participantRequirement: 'required'`, `participantType: 'team'` for both `spread` and
      `game_spread`.
- [x] The grading loop derives a spread outcome from an attested **signed margin** for the resolved
      participant, not from a raw score and not from an inferred over/under side.
- [x] A result row whose `market_key` is anything other than `game_spread_margin` is **skipped by
      name** (`spread_result_market_key_unsupported`), never interpreted.
- [x] `coverMargin > 0` is a win, `< 0` a loss, and exactly `0` a push.
- [x] Markets this lane does not admit still classify `unsupported`; the suite cannot go green by
      admitting everything.
- [x] Zero production writes. Containment, Track Only and member delivery unchanged.
- [ ] **Not claimed:** that a spread can settle today. There are **0** `game_spread_margin` rows in
      production. The results supply (layer 3) is unchanged by this lane and is reserved.
- [ ] **Not claimed:** a staging-database proof of the new acceptance path. See the coverage gap
      below — it is stated, bounded, and assigned to the lane that will supply the rows.

## EVIDENCE:

```
$ pnpm exec tsx --test apps/api/src/grading-service.test.ts
# tests 92
# pass 92
# fail 0
# skipped 0
(exit 0)

$ pnpm type-check
(exit 0)

$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 5
Rules matched: (none) — no R-level artifacts required for this diff
(exit 0)

$ pnpm verify
NOT RUN on the workstation, by design. `verify` ends at `test:live-db`, and
`ci:assert-staging` refuses when the host resolves to the containment placeholder.
`verify` is exercised by the CI job of the same name on this head; the run and job
identifiers are carried in evidence.json under sha_binding.ci_sentinels.
```

Governed read-only production measurement, `zfzdnfwdarxucxtaojxm`, SELECT only, 2026-09-14:

```
game_results WHERE market_key = 'game_spread_margin'                        -> 0
game_results WHERE market_key = 'game_moneyline_win'                        -> 0
game_results WHERE market_key LIKE '%-sp'                                   -> 1849
game_results WHERE market_key LIKE '%-sp' AND participant_id IS NULL        -> 1849
game_results (total)                                                        -> 135249
```

**This is what makes the market-key guard load-bearing rather than defensive.** There are 1,849
`%-sp` rows in production and every one of them carries `participant_id NULL` — an unattributed raw
score with no side attached. The candidate lookup can reach them. Grading a spread off one would
invent a side that was never attested. Refusing any key but `game_spread_margin` *by name* is what
prevents that.

## Verification
- [x] `pnpm exec tsx --test apps/api/src/grading-service.test.ts`: 92 tests, 92 pass, 0 fail, exit 0
- [x] `pnpm type-check`: exit 0
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS, 5 changed files, no rules matched
- [ ] `pnpm verify`: not runnable on the workstation under containment — run in CI on this head
- [ ] `pnpm test`: not run in full on the workstation for this lane; the changed surface is covered by
      the 92-test grading suite above, and the full suite runs inside the CI `verify` job on this head

## Runtime Verification

Route B: this lane's `t1_live_db_precondition` is `deferred_to_ci`, so the live-DB obligation is
discharged by the `Writable DB proof (staging only)` job on this head rather than from a contained
workstation. That job runs the existing `test:t1-proof:live` battery against staging
`xskgrzbteyqdufktjrjx`, pinned by `assert-staging-target`; production credentials are absent from
the workflow. **Measured receipts on this head** (`e24fef1907bb3966f4563883117bfba84e989b4f`), CI run
`34900653897`, attempt 1:

| Context | Job | Conclusion |
|---|---|---|
| `Writable DB proof (staging only)` | `104165850166` | success |
| `verify` | `104170396191` | success |

`verify` `needs: staging-db-proof` and consumes its same-run receipt artifact, so the two cannot
disagree about which run they are attesting to. Both G6 contexts are therefore green on the same
run and the same head — which is also the execution anchor.

Read back from staging `xskgrzbteyqdufktjrjx` with read-only `SELECT`s after the job concluded,
rather than taken from the job exit code:

```
game_results WHERE market_key = 'game_spread_margin'   -> 0
game_results WHERE market_key LIKE '%-sp'              -> 0
game_results (total)                                   -> 148
picks WHERE market = 'spread'                          -> 610
```

**610 staging spread picks move from `unsupported` to `game_spread` under this change**, and none of
them can settle, because staging has zero `game_spread_margin` rows too. The classification change
is what puts them in the grading population at all; the results supply is what would let them
leave it.

### Coverage gap — OPEN, and stated rather than papered over

**No staging test exercises `game_spread_margin`.** The new behaviour is proven statically (92/92)
and is *not* proven against a real database. Three measured reasons it could not be closed inside
this lane:

1. `file_scope_lock` is pinned at lane-start and admits exactly two paths —
   `apps/api/src/grading-service.ts` and `apps/api/src/grading-service.test.ts`. A new proof test
   file is not declarable here, and an agent cannot widen the lock.
2. Wiring any new test file into the `test:t1-proof:live` battery requires editing root
   `package.json`, also outside this lock.
3. There are **zero** `game_spread_margin` rows in production and none in staging, so there is no
   existing row to grade against. A staging proof would have to seed its own — exactly the shape of
   test this lock forbids.

**Why this is not a reason to hold the lane.** The refusal side of the change — the market-key
guard — is the side that can cause harm, and it is the side that fails closed: an unrecognised key
skips by name. The acceptance side cannot fire in any environment today, because no
`game_spread_margin` row exists anywhere. The gap is therefore a gap in proving a path that is
currently unreachable, not a gap in proving a path that is running.

**Disposition:** recorded as a dependency for the follow-on lane that supplies `game_spread_margin`
results. That lane owns the staging proof, because it is the lane that creates the row the proof
needs.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1580
Approved PR head: pending merge
Execution SHA: e24fef1907bb3966f4563883117bfba84e989b4f
