# PROOF: UTV2-1576

| Field | Value |
| --- | --- |
| Issue | UTV2-1576 |
| Tier | T1 |
| Branch | codex/utv2-1576-governance-capacity-recovery |
| Commit SHA(s) | `8b87de522c5c381d0877346f3c3bf5ad969c6b09` (branch head, pre-merge) |

MERGE_SHA: 8b87de522c5c381d0877346f3c3bf5ad969c6b09

(This is the branch head SHA, used here to satisfy proof/merge-SHA binding
without a circular self-reference. The real merge SHA is additionally
recorded post-merge by the standard `ops:proof-generate --merge-sha`
closeout step, which rewrites the "Commit SHA(s)" row above and the
"MERGE_SHA" line to the true merge SHA.)

## Verification

## Summary

Resolves the post-merge closeout persistence contradiction proven by PR #1296
workflow run 30002061214: `guardRepairAgainstMainCheckout()` (built for
UTV2-1542, a real prior incident where an operator committed repaired lane
state directly to `main` from a shared checkout) blocks any checkout literally
standing on the `main` branch from persisting `--repair-merged`'s tracked-file
changes. `actions/checkout@v4` on a `push` trigger leaves `post-merge-lane-close.yml`
standing on a real local branch named `main`, not a detached HEAD -- so the one
workflow this guard exists to let operate safely on `main` was itself always
blocked by it. Every governance lane merged since this guard shipped stayed at
its pre-merge manifest status, which in turn deadlocked `ops:lane-start`
admission for new governance lanes (including this lane's own admission,
authorized as a one-time PM exception -- see `docs/06_status/lanes/UTV2-1576.json`'s
`admission_exception` block).

This PR both fixes that root cause and uses the fix's own reconciliation path
to close the three lanes it left stale (see `docs/06_status/proof/UTV2-1560/`,
`UTV2-1573/`, `UTV2-1575/`). It intentionally does not touch UTV2-1571 (left
active for the post-merge replay described below) or UTV2-1574 (its own
unrelated R1/R2 proof gap, reverted to exact `main` content, no fabricated
proof).

## Fix

- `isTrustedPostMergeAutomation()` in `scripts/ops/lane-close.ts`: true only
  when the explicit `--post-merge-trusted` CLI flag is passed AND
  `GITHUB_ACTIONS=='true'` AND `GITHUB_REPOSITORY=='griff843/Unit-Talk-v2'` AND
  `GITHUB_REF=='refs/heads/main'` AND `GITHUB_WORKFLOW_REF` matches
  `.github/workflows/post-merge-lane-close.yml@refs/heads/main`. Matching on
  `GITHUB_WORKFLOW_REF` (the exact workflow *file*) rather than `GITHUB_WORKFLOW`
  (the human-readable, copyable `name:` field) is what makes the identity check
  meaningful. Never keyed on actor identity.
- `guardRepairAgainstMainCheckout()` accepts a pre-evaluated `trustedPostMerge`
  boolean and returns `null` (no block) only when it is `true`; every existing
  call site that omits it behaves identically to before this change (verified
  by the 69 pre-existing tests, unchanged and still passing).
- `post-merge-lane-close.yml`'s "Run lane closeout" step now passes
  `--post-merge-trusted`.
- New "Fail closed on unexpected tracked changes" workflow step: before
  staging anything, asserts via `git status --porcelain` that only the closing
  issue's own manifest, proof directory, and per-issue sync file are dirty;
  aborts without committing otherwise.
- Recursive-trigger guard (`github.actor != 'github-actions[bot]'`) is
  pre-existing and unmodified -- verified still present, not something this
  lane needed to add.

## Reconciliation

- UTV2-1560 (PR #1256, merge SHA `e2e3fa14`), UTV2-1573 (PR #1295, merge SHA
  `0fbb3e80`), UTV2-1575 (PR #1299, merge SHA `df6ec745`) -- all bound to their
  authoritative GitHub merge commits (`gh pr view --json mergeCommit`),
  status `done`, truth_check_history from real `ops:lane-close --repair-merged`
  + `ops:lane-close` runs.
- UTV2-1573's runtime proof required fresh structured live-DB queries and
  row-counts (R1/R2) -- captured via direct Supabase query, included in its
  `evidence.json`.
- Leases for UTV2-1573 and UTV2-1575 released via `pnpm ops:lease release`;
  UTV2-1560's lease was already released by an unrelated prior event. The
  global merge-mutex was released via `pnpm ops:merge-lock release`. All three
  lanes' now-empty worktrees were removed. None of this is tracked/committed
  state -- `.ops/leases/` and `.ops/merge-lock.json` are gitignored.

## ASSERTIONS:

- [x] `--post-merge-trusted` alone (no matching GitHub Actions context) does not bypass the guard
- [x] The matching context alone (no `--post-merge-trusted` flag) does not bypass the guard
- [x] A different workflow file on `main` with the flag does not bypass the guard
- [x] The trusted workflow on a non-`main` ref does not bypass the guard
- [x] A forked/renamed repository presenting an otherwise-identical context does not bypass the guard
- [x] A local checkout with no GitHub Actions env at all does not bypass the guard, even with the flag
- [x] All 69 pre-existing `lane-close.test.ts` tests pass unchanged -- no regression to UTV2-1542's default-blocked behavior
- [x] UTV2-1571 is not touched by this diff and remains the sole active governance lane
- [x] UTV2-1574 is not touched by this diff -- byte-for-byte identical to `origin/main`
- [x] No branch protection, other workflow file, or product/runtime code touched
- [x] `pnpm verify` PASS (full local run, including live `pnpm test:db` and `pnpm test:t1-proof:live`)
- [x] `r-level-check` PASS, no artifacts required for this diff

## EVIDENCE:

```text
$ pnpm exec tsx --test scripts/ops/lane-close.test.ts
...
1..80
# tests 80
# pass 80
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

```text
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Rules matched: (none) — no R-level artifacts required for this diff
```

```text
$ pnpm test:db
TAP version 13
...
1..7
# tests 7
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 103328.0211
```

```text
$ pnpm verify
...
(zero "not ok" lines, zero "# fail" values above 0, across the entire run
including verify:static and test:live-db)
```
