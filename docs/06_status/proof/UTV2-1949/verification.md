# PROOF: UTV2-1949

MERGE_SHA: pending merge

> Pre-merge the merge row is intentionally the placeholder; the Execution SHA row
> carries the verified implementation identity. `post-merge-lane-close.yml` rebinds
> merge authority only after GitHub supplies the merged-PR attestation.

Generated at: 2026-09-20T01:40:00.000Z
Issue: UTV2-1949
Tier: T2
Lane type: hygiene
Branch: claude/utv2-1949-tmp-workspace-leak
PR URL: N/A
Head SHA: 14d88b67d3bd74a54c18607d3c92466184c1d70b
result: pass (lane work) / BLOCKED (required `verify` red — see the `pnpm verify` row below)

## ASSERTIONS:

- [x] The leak is measured, not inferred: 157 directories survived a run of the 18 affected suites before the repair, and 0 survive after it, with the same 312 tests passing both ways.
- [x] A failing test also releases its workspace — proven by a child process that throws after creating one.
- [x] The helper can only delete directories it created itself; it is not a `/tmp` sweeper.
- [ ] **The defect class is NOT yet enforced in CI.** The guard exists and passes, but `pnpm test` enumerates test files explicitly in `package.json` → `test:ops`, and `package.json` is outside this lane's pinned `file_scope_lock`. Until it is wired, the guard runs only when invoked directly. See "Outstanding: the guard is not wired" below. This box is left unchecked rather than asserted.
- [x] The out-of-scope remainder is recorded as a shrink-only ratchet, not silently excluded.
- [x] Four mutation controls prove each assertion above is load-bearing.
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
ok 1 - every governed test file that creates a temp directory can also release it
# tests 1
# pass 1
# fail 0

$ npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 26
Rules matched: ingestor-provider

$ npx tsx scripts/lane-check.ts --lane hygiene --base origin/main --head HEAD
lane:check PASS lane=hygiene files=26
```

## Verification
- [x] `pnpm type-check`: pass — `tsc -b tsconfig.json`, no diagnostics
- [x] `pnpm lint`: pass — no findings
- [x] `pnpm test`: pass — exit 0, zero `not ok` lines
- [x] `npx tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`: PASS — `ingestor-provider` matched; its required artifacts are present.
- [ ] `pnpm verify`: **RED on the PR head, and not claimed.** `ci:assert-staging` cannot exit 0 outside CI,
      so branch `verify` is measured by CI. CI measured it on `7f6837ea9` (run `35480165032`) and it
      **failed**, at `verify:static` → `ops:automation-coverage-check` → `executable-wiring`:
      `WIRING_TEST_UNWIRED_NEW` on both new test files. This is the same unwired-guard gap recorded
      under "Outstanding" below, escalated from advisory to a required check. The lane is not
      mergeable until the requested `scope-override/v1` adds `package.json` to `file_scope_lock`.
      The baseline-ledger alternative the guard also offers is closed twice over:
      `docs/05_operations/executable-wiring-baseline.json` is outside `hygiene`'s allowed paths, and
      that ledger is already at its cap (`tests.max_entries = 119`, entries = 119).

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
| Full `pnpm test` `/tmp` delta after the repair | 65 — all of it from the 10 files in `KNOWN_REMAINDER` |

## Mutation control

Each control was mutated and the suite re-run unmodified.

```
--- MUTANT 1: exit hook removed from the helper ---
not ok 5 - BEHAVIOUR: a child process that throws still releases its workspace
# pass 4  # fail 1

--- MUTANT 2: one repaired file reverted to a raw mkdtemp ---
not ok 1 - every governed test file that creates a temp directory can also release it
    0: 'scripts/ops/update-record.test.ts'
# pass 0  # fail 1

--- MUTANT 3: a KNOWN_REMAINDER entry that no longer leaks ---
not ok 1 - every governed test file that creates a temp directory can also release it
    these files are listed in KNOWN_REMAINDER but no longer leak.
# pass 0  # fail 1

--- MUTANT 4: a new leak appears in a file not on the list ---
# pass 0  # fail 1

--- RESTORED ---
# tests 6  # pass 6  # fail 0
```

**Mutant 3 initially passed, and that was a real defect in this lane's own control.**
The first version of the ratchet evaluated `KNOWN_REMAINDER` membership inside the loop
that skips files with no `mkdtemp` call. A fully repaired file no longer matches that
pattern at all, so the check could never fire for the exact case it existed to catch —
a control that conveys no information. The guard now computes the leaking set over the
whole scanned population first and compares the list against it. Mutant 3 fails as it
should. This is recorded rather than quietly fixed because the vacuous version would
have shipped looking green.

## Outstanding: the guard is not wired into `pnpm test`

`scripts/ci/temp-workspace-cleanup-guard.test.ts` and `scripts/ops/temp-workspace.test.ts`
pass when run directly, but **neither executes during `pnpm test`**. The root `test`
script composes named scripts, and `test:ops` enumerates its 136 files literally rather
than globbing. A new test file is therefore invisible to CI until it is added to that
list.

`package.json` is not in this lane's `file_scope_lock`. It was deliberately left out at
lane-start because it is a singleton-only path, and `file_scope_lock` cannot be widened
afterwards. That was the wrong call: the wiring is what makes the guard load-bearing, and
without it this lane would ship a control that never runs — the exact failure mode the
mission lessons name.

The required change is two entries appended to `test:ops`:

```
tsx --test scripts/ops/temp-workspace.test.ts scripts/ci/temp-workspace-cleanup-guard.test.ts
```

The `Return review packet` check reports this correctly and independently:
`test_wiring FAIL — new test files missing package script wiring`. It is a non-required
check, so it does not block the merge; it is recorded here so the merge is not taken as
evidence that the gap closed.

Until that lands, the repair of the 44 call sites stands on its own measured evidence
above; only the *recurrence* guard is unenforced.

## Scope boundary — the recorded remainder

Ten test files leak and are **outside** this lane's `file_scope_lock`, which cannot be
widened after lane-start. They are listed in `KNOWN_REMAINDER` in the guard, are the
sole source of the residual 65-directory whole-suite delta, and account for roughly 15%
of the observed residue:

```
apps/command-center/src/app/api/governance/lanes/route.test.ts
scripts/audits/utv2-1397-evidence-flow-observation.test.ts
scripts/evidence-truthworthiness/run-scoring.test.ts
scripts/lane-contract.test.ts
scripts/model-registry/run-registry-report.test.ts
scripts/ops/fix-sync-yml.test.ts
scripts/ops/readiness-refresh.test.ts
scripts/ops/workflow-hardening.test.ts
scripts/provenance/run-provenance-report.test.ts
scripts/source-ledger/run-source-ledger-report.test.ts
```

`packages/verification` and `packages/config` also leak (~1,600 directories between
`verification-run-store-`, `verification-query-` and `validate-env-test-`) and are
outside the `hygiene` lane contract's allowed paths entirely. Neither set is claimed as
repaired anywhere in this bundle.

## Merge SHA Binding

Merge SHA: pending merge
PR: pending
Approved PR head: pending merge
Execution SHA: 14d88b67d3bd74a54c18607d3c92466184c1d70b
