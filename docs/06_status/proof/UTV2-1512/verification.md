# PROOF: UTV2-1512
MERGE_SHA: d60820bd

Lane: `claude/utv2-1512-supersede-status`
Tier: T2
Lane type: governance / status correction

## Summary

`docs/06_status/lanes/UTV2-1512.json` recorded a superseded lane under a non-terminal
`status: "blocked"`. This lane corrects that single lifecycle field through the sanctioned
transition. See `docs/06_status/proof/UTV2-1512/diff-summary.md` for the exact diff.

## Verification

ASSERTIONS:

- [x] The manifest `status` is `superseded`, a schema-valid non-success terminal status
      (`NON_SUCCESS_TERMINALS`, `scripts/ops/shared.ts:448`).
- [x] The change was applied by `pnpm exec tsx scripts/ops/lane-manifest.ts update UTV2-1512
      --status superseded`, not by hand-editing the manifest.
- [x] The lane was not parked, its historical scope was not narrowed, and no completion was
      invented — the `superseded` block, `closed_at`, and the unmerged PR #1173 record at
      `d57d1023` are unchanged.
- [x] `main` was not edited directly; the change lands through PR #1448.
- [x] `pnpm type-check` exits 0 on this branch.
- [x] `pnpm test` exits 0 on this branch: 4994 tests, 4994 pass, 0 fail, 0 skipped.
- [x] `scripts/ci/r-level-check.ts` returns `Verdict: PASS` with no required R-level artifacts
      for this diff.
- [x] The required CI `verify` check passed on the implementation head `d60820bd`.
- [x] `ops:merge-risk` no longer reports the `FILE_OVERLAP` block after the change.

## Runtime Verification

Not applicable by execution path: this lane changes one lifecycle field in a lane manifest
under `docs/06_status/lanes/**`. No source, test, migration, worker, delivery, or database
path is touched, so there is no runtime behaviour to exercise. No production mutation, DDL,
ingestion, or delivery action was taken.

EVIDENCE:

`pnpm type-check`:

```text
> @unit-talk/v2@0.1.0 type-check /home/griff843/code/Unit-Talk-v2/.out/worktrees/recover__utv2-1512-supersede
> pnpm exec tsc -b tsconfig.json

exit=0
```

`pnpm test`:

```text
> @unit-talk/v2@0.1.0 test
exit=0
not-ok lines: 0
tests 4994
pass 4994
fail 0
skipped 0
```

`pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD`:

```text
Verdict: PASS
Changed files: 1
Rules matched: (none) — no R-level artifacts required for this diff
```

`pnpm verify` — the full `pnpm verify` pipeline cannot exit 0 from a local worktree, because
its `ci:assert-staging` step refuses a `host=127.0.0.1` connection by design. The
authoritative receipt is therefore the required CI `verify` check, which passed on the
implementation head `d60820bd`:

```text
verify SUCCESS
https://github.com/griff843/Unit-Talk-v2/actions/runs/33004071142/job/98295404419
```

`ops:merge-risk`:

```text
before: {"hard_fail": 0, "block": 1, "warning": 14}   FILE_OVERLAP lanes: ["UTV2-1512","UTV2-1512"]
after:  {"hard_fail": 0, "block": 0, "warning": 12}
```

`ops:substrate-guard`:

```text
hard_fail: 0
```

## Known gaps

- `File scope lock` (not a required check) fails on this PR. The guard reads UTV2-1512's
  `file_scope_lock` from the base branch, where it lists 54 `apps/command-center/**` paths and
  neither the manifest itself nor its own `expected_proof_paths`. A superseded lane's frozen
  historical scope cannot be widened to cover its own correction without narrowing or
  rewriting that history, which this lane deliberately does not do.
