# PROOF: UTV2-1928

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row carries
> the verified implementation identity. `post-merge-lane-close.yml` rebinds merge
> authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-17T18:41:14.719Z
Issue: UTV2-1928
Tier: T3
Lane type: governance
Branch: claude/utv2-1928-plan-reconcile
PR URL: N/A
Head SHA: 797dadf886e67641ad69bf3901d94c670076694b
result: pass

## ASSERTIONS:

- [x] `docs/mission/plan.md` no longer asserts that `main` cannot produce a deployable
      build. `git show origin/main:packages/contracts/src/picks.ts | iconv -f UTF-8 -t UTF-8`
      exits 0, so the claim the previous edition opened with is false.
- [x] The deployed release recorded in §1 is the one GitHub reports: `Deploy` run
      `35212632008` at `40968bf807f0a078687ae7116c1518c8a5ba2263`, conclusion `success`.
- [x] The drift figure in §1 and §2 is re-measured, not carried forward:
      `git diff --name-only 40968bf80..origin/main` yields 8 files across 4 commits, none of
      them a container file and none a migration. The previous edition recorded 43 commits
      and 28 container files.
- [x] §3's "merged and awaiting deployment" table is restated as deployed, and Milestone 2
      conditions 4 and 5 move off "merged, undeployed" accordingly.
- [x] The condition-5 claim is mechanical, not narrative: `UNIT_TALK_COMMAND_CENTER_ENABLED`
      is `false` in repository variables, and both secrets `deploy.yml` requires when it is
      `true` (`UNIT_TALK_CC_API_KEY`, `COMMAND_CENTER_AUTH_TOKEN`) are present in
      `gh secret list`. No secret value was read.
- [x] §4 closes the two blockers that are demonstrably gone (the invalid UTF-8 byte, the
      undeployed container drift) and records that #1570 is CLOSED — `gh pr view 1570
      --json state` returns `CLOSED`, not `MERGED` — so the `P0 Protocol` `WORK-###` hole is
      open and unowned rather than pending a verdict.
- [x] §9's drift-monitor count is the measured one: `system_runs` reports 13,462 failed
      `governance.awaiting-approval-drift` runs, newest 2026-09-17T18:30:00Z.
- [x] The lesson "a merged repair is not a running repair" is inverted rather than deleted,
      because after this deploy the opposite claim is the one that would now be false.
- [x] No file outside the lane's declared `file_scope_lock` is touched:
      `.ops/sync/UTV2-1928.yml`, `docs/06_status/lanes/UTV2-1928.json`,
      `docs/06_status/proof/UTV2-1928/**`, `docs/mission/plan.md`.
- [x] `pnpm test`, `pnpm type-check` and `pnpm lint` all exit 0 on this head.

## EVIDENCE:

```
$ pnpm test
TEST_EXIT=0
ok lines:     5826
not ok lines: 0

$ pnpm type-check
TC_EXIT=0
> @unit-talk/v2@0.1.0 type-check
> pnpm exec tsc -b tsconfig.json

$ pnpm lint
LINT_EXIT=0
> @unit-talk/v2@0.1.0 lint
> eslint . --cache --cache-location .cache/eslint/

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 4
Rules matched: (none) — no R-level artifacts required for this diff

$ git show origin/main:packages/contracts/src/picks.ts | iconv -f UTF-8 -t UTF-8 > /dev/null
(exit 0 — the byte the previous plan edition named as the deploy blocker is gone)

$ gh run view 35212632008 --json headSha,conclusion,createdAt
40968bf807f0a078687ae7116c1518c8a5ba2263  success  2026-09-17T10:51Z

$ git diff --name-only 40968bf80..origin/main | wc -l
8
```

A note on the first `pnpm test` invocation, recorded because the failure was real output and
a later reader would otherwise find it in the session: run in a freshly created worktree
before `pnpm build`, it reported 116 failures, every one of them
`Cannot find module '../../../../../packages/config/dist/env.js'` in `apps/command-center`.
That is a missing build artifact in a new worktree, not a regression — `pnpm verify` builds
before it tests. After `pnpm build` (exit 0) the same command exits 0 with 5826 `ok` and 0
`not ok`, which is the run recorded above.

## Verification
- [x] `pnpm type-check`: exit 0
- [x] `pnpm test`: exit 0 — 5826 ok, 0 not ok
- [x] `pnpm lint`: exit 0
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: Verdict PASS, no R-level artifacts required
- [x] `pnpm verify`: its constituent gates (`lint`, `type-check`, `build`, `test`) were each run individually and each exited 0; `pnpm verify` itself cannot exit 0 locally because `ci:assert-staging` requires CI-only credentials. CI runs it on the PR head.

## Runtime Verification
This lane changes one Markdown document and ships no code, so it has no runtime surface of
its own. The runtime readings it records were taken read-only against production
`zfzdnfwdarxucxtaojxm` and the GitHub API, and are cited inline in ASSERTIONS above. Nothing
was written to production, no containment setting was read or changed, and no secret value
was read.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Approved PR head: pending merge
Execution SHA: 797dadf886e67641ad69bf3901d94c670076694b
