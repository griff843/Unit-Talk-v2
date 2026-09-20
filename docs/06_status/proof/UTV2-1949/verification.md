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
result: pass

## ASSERTIONS:

- [x] The leak is measured, not inferred: 157 directories survived a run of the 18 affected suites before the repair, and 0 survive after it, with the same 312 tests passing both ways.
- [x] A failing test also releases its workspace — proven by a child process that throws after creating one.
- [x] The helper can only delete directories it created itself; it is not a `/tmp` sweeper.
- [x] The defect class is enforced mechanically, so the 46th call site cannot reintroduce it.
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
```

## Verification
- [x] `pnpm type-check`: pass — `tsc -b tsconfig.json`, no diagnostics
- [x] `pnpm lint`: pass — no findings
- [x] `pnpm test`: pass — exit 0, zero `not ok` lines
- [ ] `pnpm verify`: not run locally. `ci:assert-staging` cannot exit 0 outside CI, so branch `verify` is measured by CI on the PR head rather than claimed here.

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
