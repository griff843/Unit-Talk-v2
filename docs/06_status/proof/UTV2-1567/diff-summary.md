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

## PM verdict fix (2026-07-21, this revision — bind-cycle)

Repeated PM verdicts (12:47/13:08/15:46) said the manifest's commit binding lagged "the current head" each time a new commit was pushed. This is structurally impossible to satisfy by writing a live head SHA into the manifest: a commit cannot embed its own hash, so any push that updates `commit_sha` to match itself immediately creates a new head the field no longer matches — an infinite regress.

Investigation of the actual mechanics (read directly, not assumed):
- `.github/workflows/return-review-packet.yml` never reads the manifest's `commit_sha`. It passes `--head "${{ github.event.pull_request.head.sha }}"` — the live PR head from the event payload — directly to `scripts/ops/pr-review-packet.ts`.
- `scripts/ops/pr-review-packet.ts`'s six checks (`scope`, `test_wiring`, `dropped_tests`, `sync_metadata`, `r_level`, `proof`) never reference `manifest.commit_sha` either.
- `docs/05_operations/LANE_MANIFEST_SPEC.md` §2/§4.2 documents `commit_sha` as **"populated at merge"** — i.e. it is not meant to track the live pre-merge head at all.
- Confirmed by convention: `docs/06_status/lanes/UTV2-1554.json` (status `in_review`, still open) carries a `commit_sha` that does not match its PR's live head either, with no CI effect.

Fix: set `commit_sha` back to `null` in this manifest (its pre-merge default per spec) instead of chasing a self-referencing value, and documented why in the manifest's own `notes` field. This is the terminal fix — no further push needs to "catch up" the field, because the field intentionally does not track the live head pre-merge.

The actual mechanical Return Review Packet failure is unrelated to head-binding: it is the pre-existing `test_wiring` check (`scripts/ops/post-merge-lane-close-workflow.test.ts` not wired into `package.json`'s `test:ops` script), which remains genuinely blocked by the active UTV2-1554 lock on that same `package.json` line (confirmed via `scripts/ci/file-scope-guard.ts`, which treats `in_review` manifests as still-active locks regardless of whether the underlying PR has since merged). Also confirmed via `gh api repos/griff843/Unit-Talk-v2/branches/main/protection`: the only branch-protection-required status checks are `verify`, `Executor Result Validation`, `Merge Gate`, and `P0 Protocol` — all green on this head. `Return Review Packet` and `Readiness Regression Gate` are advisory/non-blocking checks, not required checks.
