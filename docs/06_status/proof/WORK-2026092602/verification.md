# PROOF: WORK-2026092602

MERGE_SHA: fc0634c5b2e3dd53c54cbdaaba35b79eb26fe837

> Pre-merge, the merge row carries the last non-proof commit. `post-merge-lane-close.yml` rebinds
> merge authority after GitHub supplies the merged-PR attestation.

Issue: WORK-2026092602
Tier: T2
Lane type: hygiene
Branch: claude/work-2026092602-staging-board-drain
Execution SHA: fc0634c5b2e3dd53c54cbdaaba35b79eb26fe837
Head SHA: fc0634c5b2e3dd53c54cbdaaba35b79eb26fe837
result: pass

## ASSERTIONS:

- [x] The drain selects only positively identified CI fixtures (four per-suite signatures), never a broad predicate.
- [x] A real operator pick carrying `distributionMode` is never selected (test 33; M3 and M4 turn it red).
- [x] A Track Only pick is never selected, even with a full fixture signature (test 34; M2 turns it red).
- [x] A row younger than the 2h margin is never selected, and a shorter margin is refused (tests 35-36; M1 turns 35 red).
- [x] Voiding is a status -> voided update through `transition_pick_lifecycle`, never a delete. `voided` is terminal, so it is not reversible through the app.
- [x] The drain runs only inside the staging-asserted CI seed step and logs the voided count.
- [x] The atomicity suite voids its own STEP 3 pick in `after()`; what the suite proves is unchanged.

## Verification

Measured on `fc0634c5b2e3dd53c54cbdaaba35b79eb26fe837` in the lane worktree.

```
$ pnpm exec tsx --test scripts/ci/staging-path-enforcement.test.ts
# tests 38  # pass 38  # fail 0
$ pnpm test:ops
# tests 3386  # pass 3386  # fail 0
$ pnpm exec tsx --test scripts/ci/required-db-smoke.test.ts
# tests 12  # pass 12  # fail 0
$ pnpm type-check            -> exit 0
$ pnpm exec eslint <4 files>  -> exit 0
$ pnpm verify:quick          -> exit 0
$ pnpm ci:db-client-boundary -> OK
$ npx tsx scripts/ci/db-writer-inventory.ts -> errors []
$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD -> PASS, no rules matched
```

Mutation battery (each alone, then restored; restore rerun 38/38):
M1 margin exclusion removed -> test 35 red; M2 Track Only exclusion removed -> test 34 red;
M3 1842 capperId clause removed -> test 33 red; M4 broad delivery-eligible predicate -> tests 33, 38 red.

Staging dry run (read-only SQL, no write): eligible older than 2h within 7d — atomicity 220,
UTV2-1022 110, UTV2-1251-reject 101, UTV2-1842 106, unmatched 0; Track Only excluded 524;
2 recent atomicity rows protected by the margin.

`pnpm verify` and `pnpm test:db` were not run locally: local.env targets production and
`ci:assert-staging` refuses it. The drain's runtime effect is proven by the CI job
"Writable DB proof (staging only)".
