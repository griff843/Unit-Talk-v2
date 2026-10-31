# PROOF: WORK-2026103010

MERGE_SHA: pending merge

Issue: WORK-2026103010
Tier: T1
Lane type: governance
result: local_static_pass_staging_deferred

## ASSERTIONS:

- [x] Paths left over after a single-valued `--files` are refused, naming them (`assertSingleIssueArgs refuses paths left over after a single-valued --files`).
- [x] A comma-joined `--files` value is refused (`assertSingleIssueArgs refuses a comma-joined --files value`).
- [x] One issue positional with a repeated `--files` is accepted and keeps every path (`assertSingleIssueArgs accepts one positional and a repeated --files`).
- [x] An absent `--files` is left to lane-start's existing missing-argument check (`assertSingleIssueArgs leaves an absent --files to the existing checks`).
- [x] Both CLIs refuse the malformed input with exit 1 and no side effects (CLI runs below).

## EVIDENCE:

Mutation checks. Each rule in `scripts/ops/cli-args-guard.ts` was disabled alone (its `if` condition replaced with `false`), then `npx tsx --test --test-name-pattern=assertSingleIssueArgs scripts/ops/lane-start.test.ts` was run, then the file was restored from a copy:

```text
M1 positional rule off: # pass 3 # fail 1
M2 comma rule off: # pass 3 # fail 1
```

After restoring, `cmp` against the copy matched and `git hash-object scripts/ops/cli-args-guard.ts` = `git rev-parse 3adab5372:scripts/ops/cli-args-guard.ts` = `3ca69d9758b22df7a018448eb98a45faf1ad8252`.

Real CLI runs against an unused issue ID:

```text
$ npx tsx scripts/ops/lane-start.ts WORK-2099010101 --tier T3 --branch claude/x --lane-type governance --files a.ts b.ts
ls_exit=1
  "code": "lane_start_failed",
  "message": "Unexpected argument(s): b.ts. Each flag takes one value; repeat --files once per path (--files a --files b).",

$ npx tsx scripts/ops/preflight.ts WORK-2099010101 --tier T3 --branch claude/x --files a.ts,b.ts
pf_exit=1
| ARGS | FAIL | --files takes one path per flag, got comma-joined a.ts,b.ts. Repeat --files once per path (--files a --files b). |
```

Afterwards, no `docs/06_status/lanes/WORK-2099010101.json`, no `.ops/sync/WORK-2099010101.yml`, no worktree and no lease for that ID existed.

## Verification

Run on `3adab53724f885bd0dcea946bc2caec4e5686619` (the measurements were taken on the working tree immediately before this commit, whose content is identical; `git status --short` was empty afterwards):

- [x] `pnpm exec tsx --test scripts/ops/lane-start.test.ts`: `# tests 78`, `# pass 78`, `# fail 0`, `# skipped 0`.
- [x] `pnpm test`: exit 0, after `pnpm build` (exit 0). Summed node:test totals across all files: `# tests 7740`, `# pass 7727`, `# fail 0`, `# skipped 13`.
- [x] `pnpm type-check`: exit 0.
- [x] `npx eslint scripts/ops/cli-args-guard.ts scripts/ops/lane-start.ts scripts/ops/preflight.ts scripts/ops/lane-start.test.ts`: exit 0. Repo-wide `pnpm lint` runs in CI.
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: `Verdict: PASS`, no rules matched.
- [x] `pnpm ops:preflight WORK-2026103010 --tier T1 ... --refresh` (one `--files` flag per path): `VERDICT: PASS (42 checks)`. PT1 was BLOCKED_BY_CONTAINMENT, admitted under the ratified route B in `docs/governance/PT1_CONTAINMENT_ADMISSION_DECISION.md`. The first admission attempt failed PL6 on overlap with the open UTV2-1977 lane (`scripts/ops/shared.ts`); the scope was moved to a new module rather than touching that file.
- [ ] `pnpm verify` in CI on the PR head: pending. CI `verify` is the verification of record.
- [ ] `pnpm test:db`: deferred to the protected `staging-ci` environment inside the required `verify` check. This lane has no DB surface.

Runtime: these are operator CLIs with no deployed surface. The CLI runs above are the runtime evidence.

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1814
Execution SHA: 3adab53724f885bd0dcea946bc2caec4e5686619
