# UTV2-1705 Diff Summary

MERGE_SHA: d7748d2ba0eaea94778b34e65cb96536a8aab8fc

Verified implementation SHA: `d7748d2ba0eaea94778b34e65cb96536a8aab8fc`

- `ops:lane-link-pr` now accepts any canonical lane executor and can derive the issue ID from the lane branch.
- A guarded `--github-event` mode permits PR-open automation to bind a manifest when the lane's ephemeral preflight token is unavailable on the GitHub runner, while still validating every durable manifest field.
- `.github/workflows/lane-pr-binding.yml` runs on PR `opened` and `reopened`, binds the PR URL, and commits the lifecycle-owned manifest mutation back to the lane branch.
- Regression coverage preserves same-URL idempotency, different-URL fail-closed behavior, Claude-lane support, event-mode token handling, workflow wiring, and merge-closeout handoff without manual metadata repair.
- `ops:lane-finalize` accepts positional issue IDs plus manifest PR fallback, applies and verifies the Linear tier label consumed by truth-check, infers already-recorded merge truth, and atomically journals successful steps for explicit/resumable partial closeout.

No runtime, database, domain, delivery, or product behavior changed.
