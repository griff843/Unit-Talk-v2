# Incident — `INC-2026-07-17-utv2-1550-stale-required-check-identity`

## Header

| Field | Value |
|---|---|
| Incident ID | `INC-2026-07-17-utv2-1550-stale-required-check-identity` |
| Title | Governed PRs stayed merge-blocked after all required checks passed — stale `pull_request`-triggered check-run identity |
| Severity | High governance-control risk / no production impact |
| Status | Root-caused and permanent fix implemented (UTV2-1550) |
| Affected PRs | #1227 (UTV2-1433), #1229 (UTV2-1460), #1235 (UTV2-1549) |
| Detected | 2026-07-16, during routine merge of a batch of owner-approved PRs |
| Root-caused | 2026-07-17 |

## Summary

Three independently clean, owner-approved PRs — each with all 4 required
status-check contexts (`verify`, `Executor Result Validation`, `Merge Gate`,
`P0 Protocol`) reporting `success` on their current head, per both the REST
Checks API and GraphQL `statusCheckRollup` — remained stuck at
`mergeable_state: blocked` for hours. An extensive investigation ruled out
every branch-protection and repository-setting explanation (no rulesets, no
required reviews, no signature requirement, no admin enforcement, no
merge-method restriction, adequate token scope, adequate workflow
permissions). The PM directly re-ran the **original, `pull_request`-triggered**
`Executor Result Validation` workflow run's failed jobs (not a new comment,
not a new push) on each of the three PRs; all three immediately became
merge-eligible, and #1227 auto-merged normally within moments.

## Root cause

`.github/workflows/executor-result-validator.yml` triggers on both
`pull_request` (`opened`/`synchronize`/`reopened`) and `issue_comment`
(posting/editing a comment containing `EXECUTOR_RESULT:`), and both trigger
paths create/update a check run under the **same name**,
`Executor Result Validation` — the literal context name required by branch
protection.

A normal lane-repair cycle looks like:

1. A `pull_request: synchronize` event fires on `git push` (e.g. a rebase, or
   a fix commit). At that moment the *existing* executor-result comment (if
   any) still names the *previous* head SHA. The workflow re-evaluates it,
   finds a `HEAD SHA mismatch` (or CI not yet complete for the new SHA), and
   creates a **failing** run under the required name, tied to the new head.
2. Once CI finishes, a corrected `EXECUTOR_RESULT` comment is posted.
   `issue_comment` fires, creates a **new, separate** run under the same
   required name, and it succeeds.

Both runs report the identical context (`Executor Result Validation`) for the
identical SHA. Per GitHub's own required-status-check documentation the
*latest* run for a context should govern merge eligibility — but empirically,
across all three affected PRs, GitHub's merge-eligibility computation kept
treating the original `pull_request`-triggered failure as the effective
blocker even after the later `issue_comment`-triggered success. Re-running
the *original* run's failed jobs (which updates that same run in place,
rather than creating a new one) was what actually cleared the block on every
affected PR. This is treated as an empirically-confirmed GitHub behavior for
this repository's configuration, not merely a theory — it was directly
reproduced and directly resolved three times.

## Why the investigation took as long as it did

The failure mode looks identical to a genuine repository-policy block
(`mergeable_state: blocked`, generic "the base branch policy prohibits the
merge" CLI message, no further detail from either REST or GraphQL). Every
branch-protection-level hypothesis was individually plausible and had to be
ruled out with direct evidence — including one (`requiresApprovingReviews:
true` independent of `requiredApprovingReviewCount: 0`) that was real,
unintended configuration drift and worth fixing on its own merits, but was
**not** the actual cause of this specific incident (confirmed by testing:
removing it did not clear the block). Root cause was only found once a human
had reason to re-run the *specific original run* rather than trigger a new
one — an action only available through the GitHub web UI's "Re-run failed
jobs" on a specific run, not discoverable via the REST/GraphQL surfaces used
during the investigation.

## Permanent fix (UTV2-1550)

`pull_request`-triggered evaluation now **never** creates the required
`Executor Result Validation` context. It uses a distinct, always-non-required
name, `Executor Result Preflight`, so a push can never leave a stale failure
sitting under the required identity. Only `issue_comment` (posting/editing an
`EXECUTOR_RESULT` comment) and a new `workflow_dispatch` manual-recovery path
ever create the required context — giving exactly one authoritative required
identity per PR head, with no ambiguity for GitHub's merge computation to
resolve.

The check-name mapping is a small, pure, unit-tested function
(`resolveCheckName` in `scripts/ops/executor-result-validate.ts`, tested in
`scripts/ops/executor-result-validate.test.ts`) that the workflow looks up
via a CLI entrypoint rather than duplicating inline — so the workflow can
never drift from the tested definition. Field-level comment validation
(issue ID format, lane, branch match, PR match, head-SHA match, proof-path
requirement) was also extracted into the same tested module.

## Temporary recovery procedure (superseded once this fix is live on a PR)

If a PR shows all required checks green but remains `mergeable_state:
blocked` on a branch that predates this fix: open the PR's original
`pull_request`-triggered `Executor Result Validation` run in the Actions UI
and use **"Re-run failed jobs"** on that specific run — not a new comment or
push, which creates a separate run under the same pre-fix ambiguity. This
procedure becomes unnecessary once a PR's branch includes this fix, since
`pull_request` events no longer touch the required context at all.

## Follow-up: privilege-boundary hardening (Codex P1, same lane)

Codex review flagged that the "Resolve check name" step ran
`pnpm exec tsx scripts/ops/executor-result-validate.ts resolve-check-name`
against whatever `actions/checkout` pulled down — which defaults to the PR's
own head/merge ref on `pull_request` events, in a job holding `checks: write`.
A PR could have modified that script so the preflight resolved to the
required `Executor Result Validation` name instead of the non-required
preflight name, recreating this same bug's dynamics before any review could
stop it, or run other injected logic under that permission.

Fix: pin the Checkout step's `ref` to
`github.event.pull_request.base.sha` on `pull_request` events — immutable,
reachable from `main`, never PR-supplied. `issue_comment` and
`workflow_dispatch` keep the default `github.sha`, which already resolves to
the base repo's default-branch HEAD for those trigger types. The later
"Validate executor result" `github-script` step was already safe: its script
content lives directly in the trusted workflow YAML (which GitHub always
sources from the base branch for `pull_request` triggers, never the PR's own
copy), and it reads all PR state through the REST API rather than a local
checkout.

Adversarial regression test added to `workflow-hardening.test.ts` asserting
the exact pinned-ref expression, so this cannot silently regress.

**One-time bootstrap note:** this PR's own `pull_request`-triggered
`Executor Result Preflight` run fails after this fix, because the pinned
base-ref checkout doesn't yet contain `scripts/ops/executor-result-validate.ts`
on `main` (it's introduced by this same PR). This is expected and harmless —
`Executor Result Preflight` is not a required context, and the required
`Executor Result Validation` context only ever comes from `issue_comment`/
`workflow_dispatch`, which for non-`pull_request` events already run
`main`'s workflow definition regardless of ref-pinning. Once this PR merges,
`main` has the script and every subsequent PR's `pull_request`-triggered
preflight resolves it correctly from the (now-populated) base ref.

## Recurrence prevention

- Permanent fix ships in this same lane (UTV2-1550), gated as T1 per the
  merge-authority/repository-enforcement sensitivity of the change.
- Regression tests cover: missing result, valid result, a corrected result
  superseding a stale/defective one, and that a `pull_request`-triggered
  re-evaluation (the exact head-change scenario that caused this incident)
  always resolves to the non-required check name regardless of its findings.
- No repository ruleset, required-review, or admin-enforcement change was
  made as part of the actual fix (the `requiresApprovingReviews` deletion
  was applied and kept as a legitimate independent correction, since it
  matched no documented governance intent, but it is not the fix for this
  incident and is called out separately here to avoid conflating the two).
