# UTV2-1705 Diff Summary

MERGE_SHA: 54412f88145385d8362362ea81977445263b543d

Verified implementation SHA: `54412f88145385d8362362ea81977445263b543d`

- `ops:lane-link-pr` now accepts any canonical lane executor and can derive the issue ID from the lane branch.
- A guarded `--github-event` mode permits PR-open automation to bind a manifest when the lane's ephemeral preflight token is unavailable on the GitHub runner, while still validating every durable manifest field.
- `.github/workflows/lane-pr-binding.yml` runs on PR `opened` and `reopened` through `pull_request_target`, executes only base-SHA code with lifecycle scripts disabled, validates the PR base, and retries branch races without force-pushing.
- Regression coverage preserves same-URL idempotency, different-URL fail-closed behavior, Claude-lane support, explicit base validation, trusted workflow wiring, branch-update retry, and merge-closeout handoff without manual metadata repair.
- `ops:lane-finalize` accepts positional issue IDs plus manifest PR fallback, refreshes and verifies the Linear tier label consumed by truth-check, serializes the resume journal under the merge mutex, reclaims dead local journal ownership, and reruns reconciliation on every invocation.

No runtime, database, domain, delivery, or product behavior changed.
