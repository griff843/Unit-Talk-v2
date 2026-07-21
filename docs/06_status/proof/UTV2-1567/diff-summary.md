# UTV2-1567 — Diff Summary

Issue: UTV2-1567
Tier: T2
Lane type: governance
Branch: `claude/utv2-1567-workflow-dispatch-sha-fix`

## Problem

`post-merge-lane-close.yml`'s "Bind proof artifacts to merge SHA" step set `MERGE_SHA: ${{ github.sha }}` unconditionally. That's correct for the `push` trigger (`github.sha` genuinely is the new merge commit there), but wrong for a `workflow_dispatch` manual replay: `github.sha` then resolves to whatever commit is checked out at dispatch time (today's `main` HEAD), not the historical merge SHA of the target issue's actual PR.

Discovered while reconciling ghost lane manifests (UTV2-1424/1446/1546/1563/1564/1565): four `workflow_dispatch` replay attempts against already-merged lanes all failed `stale_proof` (P3/C4) because proof got rebound to today's HEAD instead of each issue's real merge commit.

## Fix

- `.github/workflows/post-merge-lane-close.yml`: new "Resolve merge SHA" step. For `workflow_dispatch`, resolves the real merge SHA via `gh pr view <manifest.pr_url> --json mergeCommit` instead of `github.sha`; falls back to `github.sha` if the lookup fails for any reason. For `push`, behavior is unchanged (`github.sha` is correct there). The "Bind proof artifacts" step now consumes `steps.resolve_sha.outputs.merge_sha` instead of `github.sha` directly.
- `scripts/ops/post-merge-lane-close-workflow.test.ts` (new): static assertions that the resolve step branches on `workflow_dispatch`, calls `gh pr view ... --json mergeCommit`, still uses `github.sha` for the non-dispatch branch, and that the bind step no longer references `github.sha` directly.
- `package.json`: wires the new test into `test:ops`.

No runtime, domain, or DB code touched.
