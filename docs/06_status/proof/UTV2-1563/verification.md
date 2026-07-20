# PROOF: UTV2-1563

MERGE_SHA: e1c3a937882dd204571081b8249bfd82273f1e59

The SHA above is this lane's pre-merge implementation commit
(`claude/utv2-1563-active-statuses-merged`), an ancestor of the eventual
PR merge commit -- per this repo's accepted proof-binding convention, a
commit cannot embed the hash of the merge commit it will later become
part of.

## Verification

## Summary

Adds `'merged'` to `scripts/ci/file-scope-guard.ts`'s `ACTIVE_STATUSES`
set, so a lane manifest correctly sitting at `status: 'merged'` (the
normal state between a PR merging and full `ops:lane-close` closure)
stays resolvable as the trusted scope for its branch.

## ASSERTIONS:

- [x] `ACTIVE_STATUSES` in `scripts/ci/file-scope-guard.ts` now includes
  `'merged'` alongside `started`/`in_progress`/`in_review`/`blocked`/`reopened`
- [x] A manifest at `status: 'merged'` is resolved as the PR's own trusted
  manifest (no "No active lane manifest found" error)
- [x] That manifest's `file_scope_lock` is still actively enforced at
  `status: 'merged'` -- an out-of-scope file still fails closed, proving
  the fix restores real enforcement, not just silences the missing-manifest
  error
- [x] `scripts/ops/shared.ts`'s separate `ACTIVE_LOCK_STATUSES` constant
  (concurrency checker, substrate-guard) is deliberately left unchanged --
  excluding `'merged'` there is correct (a merged lane should stop
  counting against the concurrency cap); this fix is narrowly scoped to
  `file-scope-guard.ts`'s own, separate constant
- [x] `pnpm verify` PASS

## EVIDENCE:

```text
$ npx tsx --test scripts/ci/file-scope-guard.test.ts
1..33
# tests 33
# suites 0
# pass 33
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 569.258453
```

```text
$ pnpm verify
[verify:parallel] all checks passed
```

## Tier

T2 -- single-file mechanical fix to CI tooling, no contract/domain/DB
surface touched.
