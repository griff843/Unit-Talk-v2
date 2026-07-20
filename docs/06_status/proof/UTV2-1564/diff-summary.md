# UTV2-1564 — Diff Summary

Issue: UTV2-1564
Tier: T2
Lane type: hygiene
Branch: `claude/utv2-1564-repair-merged-noop-append`

## Root cause

`repairMergedLaneManifest()` in `scripts/ops/lane-close.ts` unconditionally
appended a fresh `truth_check_history` entry on every `--repair-merged`
call, regardless of whether the repair actually changed anything. Two
compounding causes:

1. The append itself was never gated on `changedFields.length` at all --
   it always ran after computing `status`/`commit_sha`/`pr_url` diffs.
2. Even the `changedFields` computation itself was unreliable: separately,
   `repairPreflightToken()` reports `changed: true` based on whether its
   internal `validatePreflightTokenPathValue(..., { requireExistingFile:
   true })` check *threw*, not on whether the persisted value actually
   differs. A manifest already resting at the `REPAIR_PREFLIGHT_TOKEN`
   sentinel (`'dispatch-auto'`, which by design never points at a real
   file and so never passes `requireExistingFile`) reports `changed: true`
   on every single call even though `next.preflight_token` ends up exactly
   where it started.

Combined, this meant a manifest that was already fully and correctly
repaired still appended a new `truth_check_history` entry on every
subsequent `--repair-merged` call -- including harmless no-op re-runs
triggered by `post-merge-lane-close.yml`'s CI auto-closer. Each such
append is itself a tracked-file change, which permanently tripped
`guardRepairAgainstMainCheckout`'s main-checkout safety block: once a
manifest was correctly repaired once, every future automated repair
attempt against it hit the same block forever, even though nothing
needed repairing.

## Fix

- `repairMergedLaneManifest()`: after computing `status`/`commit_sha`/
  `pr_url` diffs and comparing `preflight_token`'s *value* (not
  `repairPreflightToken`'s internal `changed` flag) before/after, if
  `changedFields` is empty, return early with a new `already_repaired`
  code/outcome -- the manifest unchanged, no `truth_check_history` append,
  no artifact written. Mirrors the existing `status === 'done'` ->
  `already_closed` early-return pattern already in this function.
- `guardRepairAgainstMainCheckout()` needed no changes: it already returns
  `null` (proceed, no block) whenever `repair.code !== 'repaired'` or
  `repair.changed_fields.length === 0` -- both conditions the new
  `already_repaired` result satisfies by construction.
- The CLI dispatch in `main()` also needed no changes: `already_repaired`
  isn't `'already_closed'` (so it doesn't short-circuit exit-0 there) and
  isn't blocked by the main-checkout guard, so it falls through to the
  normal closeout continuation (`writeManifest` -> `runTruthCheck` ->
  potential full closure to `done`) exactly like a real repair would.

## Files changed

- `scripts/ops/lane-close.ts`
- `scripts/ops/lane-close.test.ts`
- `docs/06_status/proof/UTV2-1564/diff-summary.md`, `verification.md`

## Tests added

- A manifest already reflecting the PR's authoritative state (same
  `pr_url`/`commit_sha`/`status`/`preflight_token`) is a true no-op:
  `code`/`outcome` are `already_repaired`, `changed_fields` is `[]`,
  `truth_check_history` is untouched, `artifact_path` is `null`, and
  `guardRepairAgainstMainCheckout` still returns `null` for it.
- A second `--repair-merged` call against a manifest the *first* call just
  repaired (simulating the CI auto-closer re-triggering) does not grow
  `truth_check_history` -- the exact scenario that permanently tripped the
  main-checkout guard before this fix.
