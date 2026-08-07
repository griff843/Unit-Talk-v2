# UTV2-1567 — Diff Summary

Issue: UTV2-1567
Tier: T2
Lane type: governance
Branch: `claude/utv2-1567-workflow-dispatch-sha-fix`

## Problem

`post-merge-lane-close.yml`'s "Bind proof artifacts to merge SHA" step set `MERGE_SHA: ${{ github.sha }}` unconditionally. That's correct for the `push` trigger (`github.sha` genuinely is the new merge commit there), but wrong for a `workflow_dispatch` manual replay: `github.sha` then resolves to whatever commit is checked out at dispatch time (today's `main` HEAD), not the historical merge SHA of the target issue's actual PR.

Discovered while reconciling ghost lane manifests (UTV2-1424/1446/1546/1563/1564/1565): four `workflow_dispatch` replay attempts against already-merged lanes all failed `stale_proof` (P3/C4) because proof got rebound to today's HEAD instead of each issue's real merge commit.

## Outcome: honest partial — the capability is NOT delivered

**PM decision 2026-08-04; residual capability tracked as UTV2-1673.** While this
PR sat open, `main` closed the same defect more conservatively (UTV2-1589,
PR #1308, merged 2026-07-25) by restricting the *only consumer* of this lane's
`resolve_sha` output to `github.event_name == 'push'`. This lane's
`workflow_dispatch` branch is therefore correct code that cannot be reached,
and `push` behavior is unchanged. Full rationale in `verification.md`'s SCOPE
LIMITATION section. Do not record UTV2-1567's acceptance criteria as met.

## Merge resolution (2026-08-07, PM-authorized)

True merge of `origin/main` into this branch (no rebase), per PM directive.
Exactly one conflict — `.github/workflows/post-merge-lane-close.yml`, this
PR's own file. Resolved by taking `main`'s content entire (preserving
UTV2-1586's `pr` dispatch input, UTV2-1589's push-only restriction and runtime
guard, and UTV2-1590's scope guard) and re-applying this lane's two deltas on
top: the `resolve_sha` step, and the bind step's `MERGE_SHA` source. All five
lane/proof/sync artifacts verified byte-identical across the merge.

## Fix

- `.github/workflows/post-merge-lane-close.yml`: new "Resolve merge SHA" step. For `workflow_dispatch`, resolves the real merge SHA via `gh pr view <manifest.pr_url> --json mergeCommit` instead of `github.sha`; falls back to `github.sha` if the lookup fails for any reason. For `push`, behavior is unchanged (`github.sha` is correct there). The "Bind proof artifacts" step now consumes `steps.resolve_sha.outputs.merge_sha` instead of `github.sha` directly.
- `scripts/ops/post-merge-lane-close-workflow.test.ts` (new): static assertions that the resolve step branches on `workflow_dispatch`, calls `gh pr view ... --json mergeCommit`, still uses `github.sha` for the non-dispatch branch, and that the bind step no longer references `github.sha` directly.

**Known deferred gap — the regression tests do not run in CI.** `pnpm test` composes explicit test lists, not globs; `scripts/ops/post-merge-lane-close-workflow.test.ts` is not in `test:ops`, so it is absent from `pnpm test`, `pnpm verify`, and the required `verify` check. It passes only when invoked directly (3/3). **Read that green run accordingly: nothing in CI enforces these assertions today.**

*The original note here blamed active locks held by UTV2-1550 and UTV2-1554. That explanation is stale and was re-checked on 2026-08-07: UTV2-1554 is `done`, and `scripts/ci/file-scope-guard.ts` (line ~33) explicitly holds that `"merged" alone, with no live continuation, must never count as active`, so UTV2-1550's `merged` manifest holds no lock either. Neither lane blocks this today.*

The real reason is structural and cannot be resolved inside this PR. `package.json` is absent from UTV2-1567's `file_scope_lock`, and `resolveTrustedManifests` locks a branch-introduced manifest's declared scope to **the first commit that added it** (`13032fa0`, the lane-start declaration) precisely so a later commit cannot widen its own scope to bless an out-of-scope edit. Adding `package.json` to the manifest now would be ignored by the guard and the edit would fail as scope bleed. Wiring therefore requires a **separate lane** whose declared scope includes `package.json` from lane-start — it is not a one-line follow-up that can be slipped into this branch.

Surfaced for PM disposition rather than worked around: this is the second consecutive finding in this lane where a check that appears to provide coverage does not (the other being the push-only guard test that passed under a widened gate until negative-controlled). Both are the same failure shape — **an artifact that looks like enforcement but never executes against the condition it names.**

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
