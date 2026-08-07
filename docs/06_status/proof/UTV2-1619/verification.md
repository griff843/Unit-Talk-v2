# PROOF: UTV2-1619 — close eligibility preflight

MERGE_SHA: f541fe51b1e781729385b9212ecd9a6d8a135cd1

ASSERTIONS:
- [x] A lane fails before merge if it would otherwise require a repair PR after merge.
- [x] The preflight reuses the close gate's own P11–P14 evaluator; it is not a second copy.
- [x] Conditions unknowable before a merge exists are reported as such, never as pass.
- [x] Unknowable findings never block.
- [x] Non-lane PRs and PRs with no manifest are skipped.
- [x] Workflow concurrency is PR-scoped, so it cannot strand cancelled check-runs.
- [x] Not registered as a required context; that remains a governance decision.
- [x] No production, runtime, migration, or delivery path is touched.

EVIDENCE:

## Verification

### Historical replay — the acceptance criterion

The preflight was run against **UTV2-1649's real packet at its merge SHA `a561e00c`**,
extracted from git history before its repair PR existed:

```
ELIGIBLE: false

CEP-E4/P13  verification log must reference pnpm verify
CEP-E4/P14  verification log must reference scripts/ci/r-level-check.ts
CEP-E5      proof artifacts cannot be SHA-bound after merge (no MERGE_SHA anchor):
            docs/06_status/proof/UTV2-1649/diff-summary.md
CEP-E6      model-routing sidecar must carry a boolean override_used; without it
            proof-generate fails closed with sidecar_manifest_routing_mismatch
CEP-C1      ops:lane-close would fail after merge on: P13, P14, E5, E6
```

Those are exactly the defects that produced repair PR #1383, identified from the PR head
alone — no merge SHA, no CI results. `CEP-E6` is the one that mattered most: it was the
fatal `sidecar_manifest_routing_mismatch` and surfaced only when post-merge closeout ran.

### `pnpm build` then `pnpm test`

```
BUILD=0
blocks reporting a nonzero '# fail': 0
aggregate pass=4548 fail=0
TEST_EXIT=0
```

4535 baseline plus the 13 tests added here.

**Method correction applied here.** Earlier verification in this milestone ran `pnpm test`
without `pnpm build` first. That is not how CI runs it — `verify:static` is
`… && build && test && …` — and on this lane the un-built worktree failed fast in
`test:apps` with `Cannot find module 'packages/config/dist/env.js'`, stopping the chain at
1311 and never reaching `test:ops`. Building first is required for the aggregate to mean
what it appears to mean.

### `pnpm lint`

```
LINT=0
```

### Workflow validation

```
YAML OK, jobs: ['preflight']
triggers: ['pull_request']
concurrency: close-eligibility-preflight-${{ pull_request.number }}, cancel-in-progress
.nvmrc present (node 22)
```

### R-level check (`scripts/ci/r-level-check.ts`)

```
Verdict: PASS
Rules matched: (none) — no R-level artifacts required for this diff
```

### `pnpm verify`

`pnpm verify` was not run on this workstation; `build`, `test` and `lint` were run
individually and are recorded above. CI runs `pnpm verify` on this PR's head and that run
is authoritative.

### Coverage statement

Per capability 20, `scripts/` is not covered by `pnpm type-check` — the root tsconfig
declares 15 project references and 0 files, all `packages/` or `apps/`. Evidence for
`truth-check-lib.ts` is **`pnpm test` (runtime, via tsx) plus lint**. No static type
coverage is claimed.

## Design

**Shared, not duplicated.** The evidence checks call `evaluateT2ProofEvidence`, the close
gate's own P11–P14 implementation. Re-deriving those rules would recreate the
duplicated-authority drift class already recorded as capabilities 11, 15 and 19, and
tracked for the completion gate as its own issue.

**Unknowable is a distinct verdict.** Before a merge exists there is no merge SHA, so
reachability, CI on the merge commit, and the receipt cannot be evaluated. They are reported
`not_knowable_pre_merge`. `CEP-10` asserts they never block **and** are never reported as
pass — a preflight that marks an unseeable condition green asserts something it cannot see,
which is the failure this issue exists to eliminate. `CEP-L2` is unknowable for the same
reason: whether an automatic Done path exists outside this repository is not determinable
from lane data.

**Scope discipline.** Tests extend `truth-check-lib.test.ts`, already wired into
`test:ops`, so no `package.json` change was needed — that file is inside another active
lane's declared `file_scope_lock` and this lane does not override it.

**Concurrency.** The workflow's group is keyed to the PR number. Cancelling across PRs is
what stranded `cancelled` check-runs under required context names during an earlier
diagnosis; a new workflow should not reproduce that.

## Not claimed

This is **not** a required context. Registering it is a branch-protection change and a
governance decision. As shipped it runs and fails visibly; it does not yet block a merge.
