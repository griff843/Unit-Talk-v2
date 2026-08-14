# UTV2-1705 Diff Summary

MERGE_SHA: 660a49075bcca7ef89b2613b05c01d2dabea72b0

Verified implementation SHA: `660a49075bcca7ef89b2613b05c01d2dabea72b0`

- `ops:lane-link-pr` now accepts any canonical lane executor and can derive the issue ID from the lane branch.
- A guarded `--github-event` mode permits PR-open automation to bind a manifest when the lane's ephemeral preflight token is unavailable on the GitHub runner, while still validating every durable manifest field.
- `.github/workflows/lane-pr-binding.yml` runs on PR `opened`, `reopened`, and `edited` through `pull_request_target`, executes only protected default-branch code with lifecycle scripts disabled, revalidates retargeted PRs, and retries branch races without force-pushing.
- Retargeting the exact bound PR away from the manifest base now clears `pr_url`, moves the lane to `blocked` with `pr-base-mismatch`, and prevents an explicit PR argument from reopening the wrong-base closeout path.
- Regression coverage preserves same-URL idempotency, different-URL fail-closed behavior, Claude-lane support, explicit base validation, isolated head-ref identity, default-branch workflow trust, branch-update retry, and merge-closeout handoff without manual metadata repair.
- `ops:lane-finalize` accepts positional issue IDs plus manifest PR fallback, refuses explicit PR disagreement, independently validates the current GitHub PR base and merged state from the canonical checkout, and cannot trust only branch-local invalidation state.
- Finalize journals now include the lane reopen generation, so a truth-check reopen starts a fresh closeout sequence instead of inheriting previously completed steps; Linear label mutation, cross-lane serialization, orphan recovery, and repeatable reconciliation remain intact.

No runtime, database, domain, delivery, or product behavior changed.
