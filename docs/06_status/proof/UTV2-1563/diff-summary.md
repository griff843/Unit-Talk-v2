# UTV2-1563 — Diff Summary

Issue: UTV2-1563
Tier: T2
Lane type: hygiene
Branch: `claude/utv2-1563-active-statuses-merged`

## Root cause

`scripts/ci/file-scope-guard.ts`'s `ACTIVE_STATUSES` set excluded `'merged'`.
`resolveTrustedManifests()` resolves manifest *content* trustworthily
regardless of status, but `activeManifests()` (the actual consumer used by
`evaluateFileScopeGuard`) filters that trusted set down to
`ACTIVE_STATUSES` before resolving a PR's own manifest or checking for
cross-lane overlaps. A manifest correctly sitting at `status: 'merged'`
(the normal state between a PR merging and `ops:lane-close` completing
full closure, or after a deliberate reset from `'done'` back to `'merged'`
to allow a genuine repair re-run) fell out of this filter entirely --
its own `file_scope_lock` could no longer be resolved as the trusted
scope for that branch, and no `scope-override/v1` comment could
compensate either, since the override mechanism only ever selects among
manifests already in the active set.

Reproduced live during UTV2-1543 continuation work (2026-07-19/20): a
manifest reset from `done` back to `merged` briefly fell out of
file-scope-guard's trusted set until the close cycle completed.

## Fix

- `scripts/ci/file-scope-guard.ts`: added `'merged'` to `ACTIVE_STATUSES`.
- `scripts/ci/file-scope-guard.test.ts`: two new regression tests --
  (1) a manifest at `status: 'merged'` is still resolved as the trusted
  own-lane manifest (no "No active lane manifest found" error), and
  (2) that manifest's `file_scope_lock` is still actively enforced (an
  out-of-scope file still fails), proving the fix doesn't just silence the
  missing-manifest error but genuinely restores enforcement.

## Files changed

- `scripts/ci/file-scope-guard.ts`
- `scripts/ci/file-scope-guard.test.ts`
- `docs/06_status/proof/UTV2-1563/diff-summary.md`, `verification.md`

## Explicitly not changed

- `scripts/ops/shared.ts`'s separate `ACTIVE_LOCK_STATUSES` constant
  (used by the concurrency checker, substrate-guard, and other
  consumers) already excludes `'merged'` too, and that exclusion is
  actually *correct* for concurrency-cap purposes -- a merged lane should
  stop counting against the cap. That constant is out of this issue's
  scope; this fix is narrowly targeted at `file-scope-guard.ts`'s own,
  separate `ACTIVE_STATUSES` constant, which exists purely to resolve
  trusted scope, not to gate concurrency.
