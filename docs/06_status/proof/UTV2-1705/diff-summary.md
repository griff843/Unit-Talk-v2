# UTV2-1705 Diff Summary

MERGE_SHA: 88e8791189280b0fec5536500da98d7cd2c7699c

Verified implementation SHA: `88e8791189280b0fec5536500da98d7cd2c7699c`

- `ops:lane-link-pr` now accepts any canonical lane executor and can derive the issue ID from the lane branch.
- A guarded `--github-event` mode permits PR-open automation to bind a manifest when the lane's ephemeral preflight token is unavailable on the GitHub runner, while still validating every durable manifest field.
- `.github/workflows/lane-pr-binding.yml` runs on PR `opened`, `reopened`, and `edited` through `pull_request_target`, executes only protected default-branch code with lifecycle scripts disabled, revalidates retargeted PRs, and retries branch races without force-pushing.
- Regression coverage preserves same-URL idempotency, different-URL fail-closed behavior, Claude-lane support, explicit base validation, isolated head-ref identity, default-branch workflow trust, branch-update retry, and merge-closeout handoff without manual metadata repair.
- `ops:lane-finalize` accepts positional issue IDs plus manifest PR fallback, refuses explicit PR disagreement, uses Linear's label-specific mutations, atomically serializes cross-lane merge-mutex acquisition and the resume journal, reclaims dead local journal ownership, and reruns reconciliation on every invocation.

No runtime, database, domain, delivery, or product behavior changed.
