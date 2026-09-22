# PROOF: UTV2-1949

MERGE_SHA: 47868a7e701b6bf294a37d152fdb5b883b2e4506

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row
> carries the verified implementation identity. `post-merge-lane-close.yml` rebinds
> merge authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-20T06:10:00.000Z
Issue: UTV2-1949
Tier: T2
Lane type: hygiene
Branch: claude/utv2-1949-tmp-workspace-leak
PR URL: N/A
Head SHA: 7e7f06b761c09eeb95b2ee26a9aaaf89b11aa0f1
result: pass

## ASSERTIONS:

- [x] The leak is measured, not inferred: 157 directories survived a run of the 18 affected suites before the repair, and 0 survive after it, with the same 312 tests passing both ways.
- [x] A failing test also releases its workspace — proven by a child process that throws after creating one.
- [x] The helper can only delete directories it created itself; it is not a `/tmp` sweeper.
- [x] **The defect class is enforced in CI.** Both suites are wired into `test:ops`, a full `pnpm test` executes them, and `executable-wiring` reports `verdict=PASS ... new=0`. In the previous revision this box was unchecked; it is checked now because the wiring landed, not because the standard moved.
- [x] **Cleanup is validated per allocation, not per file.** A cleanup elsewhere in the same file no longer absolves an allocation that has none — the defect the review raised as P2.
- [x] The out-of-scope remainder is recorded as an exact per-file count, and is a ratchet in both directions: a new leak in a listed file fails, and a stale count fails.
- [x] Five mutation controls prove each assertion above is load-bearing, including one that reinstates the rejected heuristic.
- [x] No production code, migration, workflow, containment setting or delivery path was touched. No test assertion or fixture was changed.

## EVIDENCE:

```
$ pnpm type-check
> pnpm exec tsc -b tsconfig.json
(no diagnostics; exit 0)

$ pnpm lint
> eslint . --cache --cache-location .cache/eslint/
(no findings; exit 0)

$ pnpm test
exit=0
grep -c "^not ok" over the full run log: 0
/tmp delta=65 and 72 on two runs (the residual comes from the 14 ledgered files)
ok 438  - every temp-directory allocation in a governed test can be released
ok 2667 - BEHAVIOUR: a child process that throws still releases its workspace
(both newly wired suites execute inside the aggregate run, not just standalone)

$ npx tsx --test scripts/ops/temp-workspace.test.ts
ok 1 - createTempWorkspace makes a real directory under the OS temp dir
ok 2 - releaseTempWorkspace removes the directory and its contents
ok 3 - releaseTempWorkspace refuses a path this module did not create
ok 4 - cleanupTempWorkspaces removes every tracked directory and is idempotent
ok 5 - BEHAVIOUR: a child process that throws still releases its workspace
# tests 5
# pass 5
# fail 0

$ npx tsx --test scripts/ci/temp-workspace-cleanup-guard.test.ts
ok 1 - every temp-directory allocation in a governed test can be released
ok 2 - REGRESSION: a cleanup elsewhere in the file does not absolve an untorn-down allocation
ok 3 - an allocation released in its own scope is clean
ok 4 - an allocation returned to a caller transfers ownership rather than leaking
ok 5 - an allocation assigned to an outer binding is released by a sibling hook
ok 6 - an allocation wrapped before binding is owned by the binding it flows into
ok 7 - an allocation passed inline into a consumer is unreleased
ok 8 - a directory from the governed helper is not a raw allocation at all
# tests 8
# pass 8
# fail 0

$ pnpm ops:automation-coverage-check
[automation-coverage] verdict=PASS fail=0 warn=1 classified=15
[executable-wiring] verdict=PASS required_roots=verify
[executable-wiring] tests total=533 required-reachable=369 unwired=119 (baselined=119 new=0)
[executable-wiring] capabilities total=168 wired=150 orphan=18 (baselined=18 new=0)

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 28
Rules matched: ingestor-provider

$ npx tsx scripts/lane-check.ts --lane hygiene --base origin/main --head HEAD
lane:check PASS lane=hygiene files=28
```

## Verification
- [x] `pnpm type-check`: pass — `tsc -b tsconfig.json`, no diagnostics
- [x] `pnpm lint`: pass — no findings
- [x] `pnpm test`: pass — exit 0, zero `not ok` lines
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS — `ingestor-provider` matched; its required artifacts are present.
- [x] `pnpm exec tsx scripts/lane-check.ts --lane hygiene --base origin/main --head HEAD`: `lane:check PASS lane=hygiene files=28`
- [x] `pnpm ops:automation-coverage-check`: `verdict=PASS fail=0`, `executable-wiring verdict=PASS ... tests new=0 capabilities new=0`
- [ ] `pnpm verify`: not runnable locally — `ci:assert-staging` cannot exit 0 outside CI, so branch `verify`
      is measured by CI on the PR head and is not claimed here. Its previously red step is the one this
      revision fixes: run `35480165032` on `7f6837ea9` failed at `verify:static` →
      `ops:automation-coverage-check` → `executable-wiring` with `WIRING_TEST_UNWIRED_NEW` on both new
      test files. That step now passes locally (row above). The authoritative result is CI's on this head.

## Runtime Verification

**The defect and the repair are both measured, on the same machine, against the same
18 suites.** The pre-repair checkout is the sibling UTV2-1948 worktree, which is based
on `main` and does not contain this change; the post-repair checkout is this lane.

```
=== PRE-REPAIR (checkout without the fix) ===
pass=312 notok=0 /tmp delta=157

=== POST-REPAIR (this lane) ===
pass=312 notok=0 /tmp delta=0
```

`delta` is the change in `ls -1 /tmp | wc -l` across the run. Identical test outcomes,
157 leaked directories eliminated.

Whole-suite context, measured the same way:

| Measurement | Value |
|---|---|
| `/tmp` inode usage at the start of this lane | 208,503 of 1,048,576 (20%) |
| Accumulated leaked directories found on this machine | 1,473 matching the known prefixes, ~12,000 entries in `/tmp` overall |
| Largest single contributor | `delegation-state-test-` — 1,956 directories from one test file |
| Full `pnpm test` `/tmp` delta after the repair | 65 and 72 on two runs — all of it from the 14 files in `KNOWN_REMAINDER` |

## Mutation control

Each control was mutated and the suite re-run unmodified.

```
--- BASELINE ---
# pass 8  # fail 0

--- MUTANT 1: analyser reverted to a file-wide scope (the rejected heuristic) ---
not ok 1 - every temp-directory allocation in a governed test can be released
not ok 2 - REGRESSION: a cleanup elsewhere in the file does not absolve an untorn-down allocation
# pass 6  # fail 2

--- MUTANT 2: escape analysis removed ---
not ok 1 - every temp-directory allocation in a governed test can be released
not ok 4 - an allocation returned to a caller transfers ownership rather than leaking
# pass 6  # fail 2

--- MUTANT 3: a new leak appears in an already-listed file (ledger 7 -> 6) ---
not ok 1 - every temp-directory allocation in a governed test can be released
# pass 7  # fail 1

--- MUTANT 4: stale ledger entry (repaired file left at 7 -> 8) ---
not ok 1 - every temp-directory allocation in a governed test can be released
# pass 7  # fail 1

--- MUTANT 5: exit hook removed from the helper (temp-workspace.test.ts) ---
not ok 5 - BEHAVIOUR: a child process that throws still releases its workspace
# pass 4  # fail 1

--- RESTORED ---
# pass 8  # fail 0
```

**Mutant 1 is the control for the reviewed defect, and it was strengthened after it
first ran weakly.** On its first run Mutant 1 failed only test 1 — via the ledger going
stale, not via the regression test that exists to pin the behaviour. The fixture used
two different variable names, so a file-wide scope could still tell the two allocations
apart. The fixture now gives both allocations the same name, which is precisely the case
a file-wide scan cannot discriminate, and Mutant 1 now fails test 2 directly. Recorded
rather than quietly adjusted: a control that fails for an incidental reason is not
evidence about the thing it names.

**A second control in this lane was vacuous and was repaired earlier.** The first version
of the ratchet evaluated remainder membership inside the loop that skipped files with no
`mkdtemp` call, so a fully repaired file could never trigger the staleness check it
existed to catch. Both facts are kept here because both versions would have shipped
looking green.

## The guard is wired, and that is what `verify` was red on

The previous revision of this bundle recorded an open gap: neither new suite executed
during `pnpm test`, because the root `test` script composes named scripts and `test:ops`
enumerates its files literally rather than globbing. A new test file is invisible to CI
until it is added to that list.

That gap was not cosmetic. `executable-wiring` runs inside `pnpm verify:static`, so the
unwired suites failed the **required** `verify` check with `WIRING_TEST_UNWIRED_NEW` —
run `35480165032` on head `7f6837ea9`.

The guard's other documented remedy was closed twice over, so wiring was the only path:
the ledger it names lives at `docs/05_operations/executable-wiring-baseline.json`, which
is outside `hygiene`'s `allowed_path_globs` and would be refused by Lane Authority, and
that ledger is already at its cap (`tests.max_entries = 119`, entries = 119). Baselining
would also have been the wrong fix — it records a guard as permanently unrun.

`package.json` is a singleton-only path and was left out of `file_scope_lock` at
lane-start to avoid serialising the lane. That was the wrong call and is why a scope
override was needed at all. It is now in scope under the PM override requested on the PR,
and the wiring is one appended line:

```
tsx --test ... scripts/ops/temp-workspace.test.ts scripts/ci/temp-workspace-cleanup-guard.test.ts
```

Measured after the change:

```
$ pnpm ops:automation-coverage-check
[automation-coverage] verdict=PASS fail=0 warn=1 classified=15
[executable-wiring] verdict=PASS required_roots=verify
[executable-wiring] tests ... unwired=119 (baselined=119 new=0)
[executable-wiring] capabilities total=168 wired=150 orphan=18 (baselined=18 new=0)

$ pnpm test
exit=0, zero `not ok`; both wired suites appear in the run output
```

The remaining `warn` is pre-existing and unrelated: `WIRING_GLOB_SHADOWED` on
`apps/qa-agent/src/**/*.test.ts`, where POSIX `sh` expands `**` as one segment.

## Scope boundary — the recorded remainder

Switching from a file-wide token test to per-allocation classification changed the
measured population, and it grew. The bundle records the new numbers rather than the
flattering ones:

| Measure | Old file-wide heuristic | Per-allocation |
|---|---|---|
| Files reported as leaking | 10 | **14** |
| Allocations reported as unreleased | not measurable | **28** |
| Allocations examined | not measurable | 248 across 370 test files |
| Classified `released` / `escapes` | not measurable | 189 / 31 |

The heuristic under-reported by four whole files, and could not see a leak at all in a
file that cleaned up anywhere else. `scripts/ops/execution-packet.test.ts` alone holds
seven unreleased allocations and was invisible to it.

All 14 are **outside** this lane's `file_scope_lock`, which cannot be widened after
lane-start, and each is recorded with its exact count in `KNOWN_REMAINDER`:

```
apps/command-center/src/app/api/governance/lanes/route.test.ts      1
scripts/audits/utv2-1397-evidence-flow-observation.test.ts          4
scripts/evidence-truthworthiness/run-scoring.test.ts                1
scripts/lane-contract.test.ts                                       2
scripts/model-registry/run-registry-report.test.ts                  1
scripts/ops/execution-packet.test.ts                                7
scripts/ops/fix-sync-yml.test.ts                                    1
scripts/ops/lane-close.test.ts                                      2
scripts/ops/readiness-refresh.test.ts                               1
scripts/ops/t2-proof-bundle.test.ts                                 2
scripts/ops/verify-semaphore.test.ts                                1
scripts/ops/workflow-hardening.test.ts                              3
scripts/provenance/run-provenance-report.test.ts                    1
scripts/source-ledger/run-source-ledger-report.test.ts              1
```

Every file this lane repaired reports **zero** raw allocations under the stricter
analysis, which is independent confirmation that the 44 migrated call sites are correct
per allocation and not merely per file.

`packages/verification` and `packages/config` also leak (~1,600 directories between
`verification-run-store-`, `verification-query-` and `validate-env-test-`) and are
outside the `hygiene` lane contract's allowed paths entirely. Neither set is claimed as
repaired anywhere in this bundle.

### Known limits of the analysis

Stated so the guard is not read as stronger than it is. It is syntactic, so it cannot
follow a directory handed to a helper that registers cleanup indirectly, and it treats
any allocation flowing into a released binding as released. Both choices err toward
*not* failing the build, which is the right direction for a required check and means the
28 is a floor, not a ceiling.

## Branch update against main (second time)

After PM approval at `357a19da4`, `main` moved again — this time because **PR #1622
itself merged** (`01a941df4`, 2026-09-20T06:00:58Z). That put this PR BEHIND, and with
`strict: true` on `main` a BEHIND PR cannot merge normally. Merging it anyway would have
been the `enforce_admins: false` exemption firing, not policy permitting it, so the
sanctioned `pnpm ops:merge-wrapper pr-update-branch` was used instead, producing merge
commit `7e7f06b76`.

The imported delta is entirely #1622's own merged content. `git diff 357a19da4
7e7f06b76 -- scripts/ package.json docs/06_status/proof/UTV2-1949/` is **empty**: nothing
this lane owns changed. The execution anchor moves to `7e7f06b76` because that merge
commit touches non-proof paths, and `evidence.json` declares it as
`sha_binding.verified_source_sha`.

`evidence.json` was added at this point because `Executor Result Validation` is a required
check and was absent. Without a schema-v2 `sha_binding` block the validator applies the
legacy contract, under which the `MERGE_SHA:` row itself must be a real commit — which is
unsatisfiable before the merge exists. Measured directly rather than guessed:

```
$ pnpm exec tsx scripts/ops/proof-schema.ts proof-identity --phase pre-merge \
    --verification docs/06_status/proof/UTV2-1949/verification.md
{"mode":"legacy-anchor","failures":[{"code":"merge_row_not_git_sha", ...}],"provenanceAnchorSha":null}

$ ... same command --evidence docs/06_status/proof/UTV2-1949/evidence.json
{"mode":"schema-v2","phase":"pre-merge","failures":[],"provenanceAnchorSha":"7e7f06b76..."}
```

## Branch resync

`origin/main` moved to `0876367a3` (a scheduled readiness-ledger refresh) while this PR
was open, which put the branch BEHIND and turned `Lane authority` red on files the lane
never touched — `docs/06_status/readiness/readiness-score.json`. The three-dot diff
`origin/main...HEAD` did not contain it; the two-dot diff did. That check is invoked
merge-base-to-merge-ref, so a BEHIND branch is blamed for whatever `main` merged since it
diverged.

Resynced with `pnpm ops:merge-wrapper git-merge-main`, producing merge commit
`07569a339`. The imported delta is exactly one file — the readiness ledger — and no lane
file, scope declaration or source file changed. Every receipt above was re-executed on the
merged head rather than carried forward, and the execution anchor moved to `07569a339`
because that merge commit touches a non-proof path.

## Merge SHA Binding

Merge SHA: 47868a7e701b6bf294a37d152fdb5b883b2e4506
PR: https://github.com/griff843/Unit-Talk-v2/pull/1623
Approved PR head: eb5379454c5825749c2e3a9c79b53d7780e62c19
Execution SHA: 7e7f06b761c09eeb95b2ee26a9aaaf89b11aa0f1
