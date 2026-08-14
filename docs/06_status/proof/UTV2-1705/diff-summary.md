# UTV2-1705 Diff Summary

MERGE_SHA: aa5cac276b57914ecc0bca31df00fd2b2aba0caa

Verified implementation SHA: `aa5cac276b57914ecc0bca31df00fd2b2aba0caa`

- `ops:lane-link-pr` now accepts any canonical lane executor and can derive the issue ID from the lane branch.
- A guarded `--github-event` mode permits PR-open automation to bind a manifest when the lane's ephemeral preflight token is unavailable on the GitHub runner, while still validating every durable manifest field.
- `.github/workflows/lane-pr-binding.yml` runs on PR `opened` and `reopened`, binds the PR URL, and commits the lifecycle-owned manifest mutation back to the lane branch.
- Regression coverage preserves same-URL idempotency, different-URL fail-closed behavior, Claude-lane support, event-mode token handling, workflow wiring, and merge-closeout handoff without manual metadata repair.

No runtime, database, domain, delivery, or product behavior changed.
