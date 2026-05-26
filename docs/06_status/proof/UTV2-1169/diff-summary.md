# UTV2-1169 Diff Summary

Issue: UTV2-1169 - Add repair mode for already-merged lane closeout
Branch: codex/utv2-1169-repair-merged-lane-closeout
Head: 7ff856daa60ed91d8d92d82ce1d496c11555c102

## Summary

The lane closeout command now has a repair path for already-merged PR lanes. Repair mode validates the PR is merged through GitHub, replaces stale local merge SHAs with the authoritative merge commit, repairs missing preflight token state into an auditable safe value, and refuses to mutate unmerged PR lanes.

## Evidence

- `scripts/ops/lane-close.ts`
  - Adds `--repair-merged` handling before normal closeout SHA requirements.
  - Reads merged PR truth from `gh pr view --json url,state,mergedAt,mergeCommit`.
  - Refuses repair when the PR is missing, unmerged, or missing a merge SHA.
  - Records repair metadata under `.out/ops/lane-close-repair/<issue>.json`.
  - Preserves truth-check closeout after repair instead of bypassing lane-close authority.
- `scripts/ops/lane-close.test.ts`
  - Covers stale SHA replacement with authoritative GitHub merge SHA.
  - Covers missing preflight token repair and artifact emission.
  - Covers already-done idempotency.
  - Covers unmerged PR refusal without manifest mutation.

## Verification

No Tier C runtime, domain, database, worker, migration, or contract paths were changed. The implementation is limited to governance closeout tooling and focused regression tests.
