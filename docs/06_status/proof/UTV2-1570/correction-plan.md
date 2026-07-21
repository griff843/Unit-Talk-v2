# UTV2-1570 Correction Plan

**Status of this document: PLAN ONLY. Nothing in this file has been implemented.**
PR #1293 (head `fc9439ffe26669af84d7d914f86726076909c6ad` at time of writing) remains
**PARKED** per griff843's direct PR review on 2026-07-21T23:11:32Z. This plan exists
to scope the remaining work; it does not authorize or perform any of it.

## 1. Privileged workflow runs PR-controlled install scripts (security finding)

**Status: fixed in commit `fc9439ff`, already pushed.** Documenting the exact
mechanism per PM instruction, since the finding stands regardless of the fix
until PM independently confirms it.

**Exact vulnerability mechanism (as it existed before the fix):**

- Workflow: `.github/workflows/tier-c-authorization-gate.yml`, job `gate` ("Tier C
  Authorization Gate").
- The job's `permissions:` block grants `pull-requests: write`, `issues: write`,
  `checks: write` (plus `contents: read`) — i.e. an elevated `GITHUB_TOKEN`, not the
  read-only default a plain `pull_request` trigger would otherwise receive.
- The `Checkout` step used `actions/checkout@v4` with no `ref:` override, so on a
  `pull_request`-triggered run it defaulted to `github.sha` — the PR's own merge
  commit, containing the PR author's own `package.json` / `pnpm-lock.yaml`.
- The next step ran `pnpm install --frozen-lockfile` against that checkout.
  `pnpm install` executes package lifecycle scripts (`preinstall`/`install`/
  `postinstall`) from the root `package.json` and from any dependency's own
  `package.json`.
- A malicious PR could therefore add/modify a `postinstall` script, or point
  `pnpm-lock.yaml` at a malicious package version, and have that code execute
  inside the job — with live access to the elevated `GITHUB_TOKEN`
  (`checks: write`/`issues: write`/`pull-requests: write` scope) for the duration
  of the job, via the environment and/or the git credential helper
  `actions/checkout` configures by default. This is the same vulnerability class
  as the well-known `pull_request_target` "pwn request" pattern, recreated here on
  a plain `pull_request` trigger specifically because this workflow's own
  `permissions:` block elevates the token beyond the safe default.

**Fix applied:** pinned the `Checkout` step's `ref:` to
`github.event.pull_request.base.sha` (immutable, never PR-supplied) for
`pull_request`-triggered runs — `issue_comment`/`workflow_dispatch` keep the
default `github.sha`, which already resolves to trusted default-branch content for
those event types. `pnpm install` now always resolves dependencies from the
trusted base-branch lockfile; no PR-controlled lifecycle script can execute in
this job. This mirrors `.github/workflows/merge-gate.yml`'s own already-shipped
checkout-ref-pin fix for the identical vulnerability class. The bootstrap
fallback for this PR's own two new files (which don't exist on `origin/main` yet)
now fetches their *text content* (never executed as raw bytes) from the PR head
SHA via the GitHub Contents API, since the pinned checkout's working tree no
longer contains them.

**Confidence:** high — same pattern as an already-shipped, presumably
PM-reviewed fix elsewhere in this repo; YAML syntax validated; not independently
runtime-attack-tested against a live malicious PR (constructing one is not an
appropriate verification method). PM should independently confirm this is
sufficient before treating the finding as closed.

## 2. Approval-comment reruns do not reliably publish the required check to the PR head

**Status: NOT independently re-verified against a live PR since the round-1 fix.**

**Plan:**

1. Open a disposable throwaway PR (or reuse a closed test branch) that touches a
   Tier C path as a non-T1 lane, deliberately triggering a BLOCKED verdict from
   `tier-c-authorization-gate.yml`.
2. Post a well-formed `tier-c-approval/v1` comment from an authorized human,
   covering the touched path(s), bound to that PR's exact head SHA.
3. Confirm via `gh api repos/.../commits/<head-sha>/check-runs` that the
   "Tier C Authorization Gate" check run for that head SHA transitions to
   `completed`/`success` **without** any new commit/push — i.e. the
   `issue_comment`-triggered re-evaluation's `checks.create`+`checks.update` call
   (added in round 1) actually produces a check run branch protection recognizes
   against that head SHA.
4. If it does not, the likely remaining gap is that GitHub's required-status-check
   resolution for a given (context name, head SHA) pair may not always surface the
   *latest* of multiple check runs sharing that name+SHA as authoritative for
   merge-eligibility purposes (this needs live confirmation, not assumption) — in
   which case the fix would need to either (a) update the *same* check run object
   (reusing its `check_run_id` looked up via `checks.listForRef`) rather than
   creating a new one each evaluation, or (b) confirm empirically that GitHub does
   correctly supersede on a new check run and no further code change is needed.
5. Do not merge or promote this gate to a required branch-protection check until
   this is empirically confirmed.

This requires a live GitHub Actions run against a real PR; it cannot be verified
by local YAML/code review alone, which is why it was not claimed as fixed
alongside the round-1 change.

## 3. Errors after explicit check creation can leave the check stuck `in_progress`

**Status: fixed in commit `fc9439ff`, already pushed** (same commit as item 1).

The `collect` step's logic after `checks.create` (tier resolution, changed-files/
approval-comment collection via the GitHub API) is now wrapped in `try/catch`: any
error completes the check as `failure` with the error message in its `output`
before rethrowing, so the check always reaches a terminal state instead of
remaining `in_progress` indefinitely. This closes the specific gap Codex/PM
identified. It has not been exercised against a live induced failure (e.g. a
transient API 500) — only reviewed by inspection — so PM should treat this as
"logically sound, not runtime-proven" pending an actual failure-injection test if
one is desired before promoting this gate to required.

## 4. Singleton approval validator not wired into `lane-start.ts`

**Status: blocked, not started.** `scripts/ops/lane-start.ts` and
`scripts/ops/lane-start.test.ts` are both currently held by another active,
unrelated concurrent T1 lane's declared `file_scope_lock` (UTV2-1569's
Fable-pilot-routing lane, PR #1292, open as of this writing). Editing either file
in this PR would create a hard file-scope-lock conflict, mechanically enforced by
both `ops:lane-start`'s own concurrency check at lane-creation time and CI's
`file-scope-lock-check.yml` at PR-diff time.

**Plan (once UTV2-1569 clears — merges or is closed/abandoned):**

1. Update this lane's own `file_scope_lock` to add `scripts/ops/lane-start.ts` and
   `scripts/ops/lane-start.test.ts` (only possible for a genuinely new commit if
   done as part of a *fresh* lane-start declaration — recall CI's
   `file-scope-guard.ts` freezes `file_scope_lock` to the first commit that added
   a lane's manifest, so this cannot simply be added mid-PR; it likely needs a new
   commit that is itself the "first" to declare these paths, or a
   `scope-override/v1` PR comment from griff843 authorizing the addition for this
   exact head SHA).
2. In `scripts/ops/lane-start.ts`, locate the current check (around the line
   reading `flags.has('singleton-approved') || bools.has('singleton-approved')`)
   and replace it with:
   - Accept a new `--singleton-approval-ref <url>` flag.
   - If present, call `validateSingletonApprovalRef` (already implemented and
     tested in `scripts/ops/singleton-approval.ts`) with the issue ID, the
     lane's singleton paths, and a Linear API token from the environment.
   - On `ok: false`, fail closed with the returned `code` (already a stable,
     enumerated set — `singleton_approval_malformed_ref`,
     `singleton_approval_issue_mismatch`, etc.) via `emitJson`, matching the
     existing `singleton_path_conflict` failure shape.
   - If only the bare `--singleton-approved` flag is present (no `--singleton-
     approval-ref`), emit a deprecation warning to stderr and in the JSON result,
     but still fail closed with `singleton_approval_missing` — the bare flag must
     never be sufficient on its own, per the Linear issue's explicit requirement.
3. Add/update test cases in `scripts/ops/lane-start.test.ts` covering: valid ref
   passes, missing ref with bare flag warns-but-fails-closed, invalid ref fails
   with the correct code, and the existing non-singleton-path lane-start flow is
   unaffected.
4. Re-run `pnpm verify` + `pnpm test:db` and update this lane's T1 proof bundle
   accordingly.

This is the one piece of this issue's core ask (closing the singleton
self-authorization loophole end-to-end) that remains entirely unimplemented.

## 5. File Scope Lock and Live Schema Parity checks are red

**Status: both pre-existing, external to this lane; not fixable within this PR's
own scope or authority.**

- **File Scope Lock**: fails on this PR's `package.json` edit —
  `package.json locked by UTV2-1550 (claude/utv2-1550-executor-result-required-
  check-identity, package.json)`. UTV2-1550's manifest on `main` still lists
  `package.json` in its `file_scope_lock` despite that lane's implementation
  having fully merged (PR #1239); its status is `merged`, which the guard's
  `ACTIVE_STATUSES` set still treats as active for cross-lane conflict purposes.
  This is a known "ghost lane" gap, independently discovered here and already
  attempted (unsuccessfully — the fix PR itself failed its own File Scope Lock
  check) in a separate, already-closed PR (#1288,
  `claude/utv2-1550-scope-reconcile`). **Plan:** either merge a corrected
  scope-reconciliation fix for UTV2-1550's manifest to `main`, or have an
  operator decide how to unblock `package.json` edits generally (e.g. a
  documented exception, or fixing `ACTIVE_STATUSES` to exclude `merged` from
  cross-lane conflict checks specifically while still allowing it for
  continuation-PR resolution). Neither action is available to this lane.
- **Live Schema Parity**: fails with 80 schema-drift findings, all under
  `command_center_*` tables (missing indexes/triggers), unrelated to anything
  this PR touches (no `supabase/migrations/**` file is in this diff). This is a
  pre-existing, repo-wide live-schema-drift condition. **Plan:** track and
  resolve separately from this lane; not actionable here.

Both are confirmed **not** in the live-required branch-protection contexts list
(`verify`, `Executor Result Validation`, `Merge Gate`, `P0 Protocol` — confirmed
via `gh api repos/.../branches/main/protection` at authoring time), so they do
not mechanically block merge today, but they are real, correctly-red signals that
should not be dismissed.

## Summary: what actually blocks this PR from being complete

| # | Finding | Status | Blocking? |
|---|---|---|---|
| 1 | Privileged install-script RCE risk | Fixed (fc9439ff), not independently PM-confirmed | Security-critical; awaiting confirmation |
| 2 | Approval-comment rerun reliability | Not verified live | Open |
| 3 | Check stuck in_progress on error | Fixed (fc9439ff), not runtime-tested | Mostly closed |
| 4 | Singleton validator not wired into lane-start | Not started, blocked by concurrent lane | Open — core ask incomplete |
| 5 | File Scope Lock / Live Schema Parity red | Pre-existing, external | Non-blocking (not live-required), but unresolved |

Plus, structurally: **the parent design PR (#1289) is not yet approved.** This
child issue's own completion is gated on that design being correct and approved
first, per the Linear issue's own origin section. This plan does not address
#1289; that is entirely outside this lane's scope.

**This PR is not ready to merge and is not being presented as complete.**
