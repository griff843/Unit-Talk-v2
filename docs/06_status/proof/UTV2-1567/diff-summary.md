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

**Known deferred gap:** the new test is not yet wired into `test:ops` in `package.json`. That line is genuinely locked by two other active lanes (UTV2-1550, UTV2-1554) that also append to it, and UTV2-1550 cannot currently reach `done` (a separate, unrelated CI-evaluation limitation). Wiring it in is a one-line follow-up once one of those lanes clears; the test still runs directly today (`npx tsx --test scripts/ops/post-merge-lane-close-workflow.test.ts`, 2/2 pass) but is not part of the aggregate `pnpm test`/`pnpm verify` run.

No runtime, domain, or DB code touched.

## PM verdict fixes (2026-07-21, this revision)

- Populated `docs/06_status/lanes/UTV2-1567.json`'s `pr_url` (previously null), which was blocking the post-merge auto-close repair path from binding proof or closing the lane.
- Added a real `pnpm test:db` run to `verification.md` to satisfy Proof Auditor Gate's blanket requirement (applies to every touched proof directory regardless of tier).
- Removed the `package.json` edit (see deferred-gap note above) rather than force a cross-lane conflict with UTV2-1550/UTV2-1554's own locks on that same line.
