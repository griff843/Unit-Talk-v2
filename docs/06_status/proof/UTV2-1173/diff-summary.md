# UTV2-1173 Diff Summary

Issue: UTV2-1173 - Align PR review packet scope rules with lane metadata
Branch: codex/utv2-1173-pr-review-packet-lane-metadata
Head: f91d4a800a26e019a5d57caf3605d8edf7ce1235
Merge: 96ef8c24d07f2a9b118f4e20b072e9f63ed8a60f

## Summary

The PR review packet scope model now allows same-issue generated lane metadata and declared proof artifacts without allowing unrelated files or wrong-issue metadata. Test wiring detection also recognizes repo-wide `tsx --test` discovery.

## Evidence

- `scripts/ops/pr-review-packet.ts`
  - Treats same-issue lane metadata as implicit allowed scope for `.ops/sync/<issue>.yml` and `docs/06_status/lanes/<issue>.json`.
  - Treats manifest `expected_proof_paths` as allowed review packet scope.
  - Keeps wrong-issue metadata and unrelated files under the existing out-of-scope failure path.
  - Recognizes repo-wide `tsx --test` scripts as discovery coverage for newly added test files.
- `scripts/ops/pr-review-packet.test.ts`
  - Covers same-issue metadata pass behavior.
  - Covers wrong-issue metadata scope failure behavior.
  - Covers declared proof artifact pass behavior.
  - Covers repo-wide `tsx --test` discovery.
  - Covers a PR #866 style metadata-only scope packet regression.

## Verification

No Tier C paths were changed. The implementation is limited to the PR review packet generator and its regression tests.

Post-merge closeout proof is bound to merge SHA `96ef8c24d07f2a9b118f4e20b072e9f63ed8a60f`.
