# UTV2-1079 — Diff Summary

## Summary

### .github/workflows/reconcile-stale-lanes.yml (new)
Scheduled workflow (every 6 hours + workflow_dispatch) that runs `pnpm ops:reconcile --apply` and commits any stale manifest mutations directly to main.

- No-op commit if nothing changed (uses `git diff --cached --quiet` guard)
- Correct permissions: `contents: write`
- Follows the same pattern as other workflows in the repo
