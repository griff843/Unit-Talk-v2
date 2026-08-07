# PROOF: UTV2-1649 — Linear truth sweep

MERGE_SHA: a561e00c3991c3701b4cd863a21ec4389194ee74

ASSERTIONS:
- [x] All 59 issues from UTV2-1590 through UTV2-1648 were read from Linear with relations.
- [x] All 36 initial project issues and the post-reconciliation 63-issue membership were read mechanically.
- [x] Current-main lane manifests and GitHub PR state were cross-checked.
- [x] Merged-but-unclosed issues remain nonterminal.
- [x] Active blockers remain and completed blockers were removed.
- [x] Production-dependent ambiguity was not converted into Done.
- [x] No prohibited mutation occurred and P0 was not declared complete.

EVIDENCE:

## Verification

Re-executed on 2026-08-04 at branch head `c273ab0d5f5a0f7a63c4b1b9b865841b19286f77`
in worktree `.out/worktrees/codex__utv2-1649-linear-truth-sweep`. The earlier governed
preflight at `64ac40ab0593f67fe848fa61d8a006f09d6e6a8e` is superseded by the transcripts
below, which are bound to the current head.

### `pnpm type-check`

```
> @unit-talk/v2@0.1.0 type-check /home/griff843/code/Unit-Talk-v2/.out/worktrees/codex__utv2-1649-linear-truth-sweep
> pnpm exec tsc -b tsconfig.json

TC_EXIT=0
```

No diagnostics emitted; `tsc -b` exited 0 across all project references.

### `pnpm test`

The suite is a chain of 13 sub-suites (`test:apps`, `test:verification`,
`test:domain-probability`, `test:domain-features`, `test:domain-signals`,
`test:domain-hedge`, `test:domain-shadow`, `test:domain-analytics`,
`test:domain-portfolio`, `test:qa-agent`, `test:ut-cli`, `test:ops`,
`test:t1-proof:local`), emitting 97 node:test TAP summary blocks in total.

Aggregate across all 97 blocks:

```
# pass 4473
# fail 0
# skipped 0
# todo 0
TEST_EXIT=0
```

Tail of the final block, verbatim:

```
1..19
# tests 19
# suites 0
# pass 19
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 595.728266
TEST_EXIT=0
```

Zero TAP summaries in the run reported a nonzero `# fail` count
(`grep -cE '^# fail [1-9]'` → `0`).

### R-level check (`scripts/ci/r-level-check.ts`)

```
Verdict: PASS
Changed files: 8
Rules matched: (none) — no R-level artifacts required for this diff
RLEVEL_EXIT=0
```

This lane is documentation-only, so no R1–R5 rule triggers and no additional
artifacts are required. The same `scripts/ci/r-level-check.ts` gate ran in CI as
the R-Level Compliance Check and also passed.

### `pnpm verify`

`pnpm verify` was not run on this workstation — the three commands above were
run individually. It was run by CI on the merged head, which is the authoritative
execution:

```
check_run: verify
head_sha:  46a9e3106e9812de13461926a21880c667385ec1
status:    completed
conclusion: success
duration:  3m29s
url: https://github.com/griff843/Unit-Talk-v2/actions/runs/30971004986/job/92196228180
```

That head is the commit merged as a561e00c3991c3701b4cd863a21ec4389194ee74, and
`verify` is one of the four required contexts the merge gate confirmed green on
it (G4 evidence records the same run id, 92196228180).

### Scope of this run

`pnpm test:db` was not executed. This lane is T2 and documentation-only; it
performs no database access, and production is parked. No live-DB proof is
claimed and none is required at this tier.

See `audit.md` for the complete correction ledger and ambiguity packet, and `evidence.json` for machine-readable counts and guardrails.
