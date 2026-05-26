# UTV2-1168 Diff Summary

Issue: UTV2-1168 - Auto-close merged lanes after PR merge
Branch: codex/utv2-1168-auto-close-merged-lanes
Head: 208cbeb7e1c5a61a4a3d27d136de34d4078a3065

## Summary

UTV2-1168 routes post-merge lane closeout through the same authoritative closeout command used by operators.

## Evidence

- `.github/workflows/post-merge-lane-close.yml`
  - Runs `pnpm ops:lane-close "$ISSUE_ID" --repair-merged --explain` after resolving the merged lane issue ID.
  - Commits the manifest and per-issue sync file changes produced by lane-close instead of hand-editing manifest status.
  - Posts a PR comment and fails the workflow when lane-close blocks closeout.
- `scripts/ops/lane-close.test.ts`
  - Verifies the post-merge workflow delegates to `ops:lane-close --repair-merged`.
  - Verifies the workflow no longer calls `ops:truth-check` directly or mutates `manifest.status = 'done'` itself.

## Verification

- `tsx --test scripts/ops/lane-close.test.ts`
- `pnpm ops:merge-risk`
- `pnpm type-check`
- `pnpm test` (covered by `pnpm verify`)
- `pnpm verify`
