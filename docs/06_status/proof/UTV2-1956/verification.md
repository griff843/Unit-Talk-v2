# PROOF: UTV2-1956

MERGE_SHA: pending merge

> Pre-merge, merge authority does not exist yet. `post-merge-lane-close.yml` binds the merge
> SHA after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-27T10:50:28Z
Issue: UTV2-1956
Tier: T2
Lane type: governance
Branch: claude/utv2-1956-preflight-tdz-repair
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1665
Head SHA: ff3198e161c8e8d027dc552c23d78a6a3735f44a
result: pass

## ASSERTIONS:

- [x] Every module-level binding in `scripts/ops/preflight.ts` is declared above its `main()` invocation. The new structural test in `scripts/ops/preflight.test.ts` is green on this commit and red on the shipped code (mutation below).
- [x] The real `ops:preflight` CLI no longer crashes for a `WORK-###` identity. There is no ReferenceError for WORK-2026092606.
- [x] With a Linear credential present, the preflight process for WORK-2026092606 made 0 tracker calls, counted per process by a `fetch` preload.
- [x] PL1–PL5 pass for WORK-2026092606. PL6 passes when its declared file scope is supplied, and skips when it is not (Codex's exact invocation passes no `--files`).
- [x] No check changed. The diff moves two constants and adds one test.

## EVIDENCE:

```
$ pnpm exec tsx --test scripts/ops/preflight.test.ts        # tests 58  pass 58  fail 0
$ pnpm test:ops                                             # pass 3483  fail 0 (summed across suites), exit 0
$ pnpm type-check                                           # exit 0
$ eslint scripts/ops/preflight.ts scripts/ops/preflight.test.ts   # exit 0
```

Mutation: shipped `preflight.ts` from `origin/main` with the new test file.

```
not ok 33 - preflight declares every module-level binding above its main() invocation
# pass 57
# fail 1
```

Real CLI, run from this branch with the Linear credential present, using Codex's arguments plus WORK-2026092606's declared file scope (`--files` for each of its 8 files):

```
$ pnpm -s ops:preflight WORK-2026092606 --tier T2 --branch codex/work-2026092606-cc-settlement-truth --files ... --json
preflight.ts process: fetch_total 0, tracker_calls 0
PE2 pass — Linear credential present
PG2 pass — working tree is clean
PE2 skip — repo-owned identity WORK-2026092606 has no tracker issue; tracker checks are optional and non-blocking. Declared --tier T2 satisfies the mechanical floor T3.
PL1 pass — repo-owned work order .ops/work/WORK-2026092606.md is committed at HEAD
PL2 pass — work order tier matches T2 (mechanical floor T3)
PL3 pass — repo-owned identity has no tracker state; lane ownership is checked by PL5
PL4 pass — .ops/work/WORK-2026092606.md states acceptance criteria
PL5 pass — no active manifest owns this issue
PL6 pass — candidate file scope does not overlap any active manifest
PX2 fail — branch discipline reads this lane's own commits (UTV2-1956) against the WORK-2026092606 title
```

PX2 fails only on this lane branch. The acceptance run is Codex's exact invocation from the root checkout on `main` after merge, where no lane commits are ahead.

Separately, two tracker requests were counted inside PX1's test run. Both come from the older `UTV2-1837 AC4 inversion` test, which deliberately runs a UTV2 identity with a fake token. That test is outside this lane and was left unchanged; it is recorded as a finding.

## Verification

Measured on `ff3198e161c8e8d027dc552c23d78a6a3735f44a`: the focused suite, `pnpm test:ops`, `pnpm type-check`, eslint, the mutation and the real CLI runs above. The required `verify` job re-runs `pnpm verify` (type-check, test) on the PR head.

scripts/ci/r-level-check.ts, on the exact lane diff (explicit SHAs, never `HEAD`):

```
$ pnpm exec tsx scripts/ci/r-level-check.ts --base 7c9181211 --head ff3198e161c8e8d027dc552c23d78a6a3735f44a
Verdict: PASS
Changed files: 6
Rules matched: (none) — no R-level artifacts required for this diff
```

## Merge SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1665
Execution SHA: ff3198e161c8e8d027dc552c23d78a6a3735f44a
