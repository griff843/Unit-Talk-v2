# PROOF: UTV2-1564

MERGE_SHA: 16805967fe61db0a02418ca4be401e2422327ee4

The SHA above is this lane's pre-merge implementation commit
(`claude/utv2-1564-repair-merged-noop-append`), an ancestor of the
eventual PR merge commit -- per this repo's accepted proof-binding
convention, a commit cannot embed the hash of the merge commit it will
later become part of.

## Verification

## Summary

`repairMergedLaneManifest()` in `scripts/ops/lane-close.ts` now returns a
true no-op (`code`/`outcome`: `already_repaired`, no `truth_check_history`
append) when a `--repair-merged` call would not actually change
`status`/`commit_sha`/`pr_url`/`preflight_token`, instead of always
appending a fresh history entry regardless.

## ASSERTIONS:

- [x] `repairMergedLaneManifest()` returns `code: 'already_repaired'`,
  `outcome: 'already_repaired'`, unchanged `manifest`, `changed_fields: []`,
  and `artifact_path: null` when nothing would actually change
- [x] `preflight_token` is only counted as changed when its persisted
  *value* differs, not whenever `repairPreflightToken`'s internal
  validation throws (which it always does for a manifest already resting
  at the `dispatch-auto` sentinel)
- [x] A second `--repair-merged` call against a manifest the first call
  just repaired does not grow `truth_check_history`
- [x] `guardRepairAgainstMainCheckout()` still returns `null` (no block)
  for the new `already_repaired` result -- verified directly, not just
  inferred
- [x] The `status === 'done'` -> `already_closed` early-return path is
  untouched
- [x] `pnpm verify` PASS

## EVIDENCE:

```text
$ npx tsx --test scripts/ops/lane-close.test.ts
1..68
# tests 68
# suites 0
# pass 68
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 462.479372
```

```text
$ pnpm verify
[verify:parallel] all checks passed
```

## Tier

T2 -- single-file mechanical fix to ops tooling, no contract/domain/DB
surface touched.
