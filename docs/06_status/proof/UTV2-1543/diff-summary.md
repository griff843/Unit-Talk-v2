# UTV2-1543 Diff Summary

Issue: UTV2-1543
Tier: T1
Lane type: governance
Branch: `claude/utv2-1543-bind-t1-pm-verdicts-to-exact-head-sha`

## Changes (post-rebase onto main containing UTV2-1554)

`scripts/ops/merge-gate-verdict.cjs`, `scripts/ops/merge-gate-verdict.test.ts`,
`eslint.config.mjs`, `package.json`, and `docs/05_operations/schemas/pm-verdict-v1.md`
are **no longer part of this PR's diff**. UTV2-1554 landed the final,
canonical version of all five on `main` first (a narrow bootstrap PR that does
not touch `merge-gate.yml`), specifically so this PR never needs to introduce
them itself. Rebasing this branch onto that main resolved the resulting
add/add conflicts by taking main's copies unchanged — main's
`merge-gate-verdict.cjs`/`.test.ts` are a strict superset of what this PR
originally carried (they additionally include the UTV2-1554 trust-boundary
fix: authorization filtering happens before latest-verdict selection, not
after).

This PR's remaining diff:

- `.github/workflows/merge-gate.yml` — T1's PM-verdict validation delegates to
  the trusted, already-on-main `scripts/ops/merge-gate-verdict.cjs`'s
  `validateT1Verdicts`, which requires the latest **authorized** `APPROVED`
  verdict's `PR:` and `Head SHA:` fields to match the live PR number and
  current head SHA exactly. Stale, missing, malformed, mismatched,
  bot-authored, or unauthorized-author verdicts fail closed.
  `CHANGES_REQUIRED` verdicts and the existing bounce-limit behavior
  (authorized-only, per UTV2-1554) are unchanged by this PR. The PR-head
  bootstrap-fetch fallback step this PR originally needed (to recover
  `merge-gate-verdict.cjs` from the PR's own head SHA on its first
  introduction, since base never had the file yet) has been **removed
  entirely** — main always has the trusted file now, so there is no
  first-introduction case left to special-case, and the checkout step
  remains pinned to `pull_request.base.sha` (never the PR's own head) for
  `pull_request`/`pull_request_review` events.
- `scripts/ops/workflow-hardening.test.ts` — asserts merge-gate.yml resolves
  T1 verdict validation via the tested module (not a duplicated inline
  implementation), that a verdict bound to a different head SHA fails closed,
  and (replacing the now-obsolete bootstrap-recovery test) a new regression
  assertion that the gate job's steps never fetch, checkout, or execute any
  content keyed on `pull_request.head.sha`, and that no PR-head
  bootstrap-recovery step exists in the job at all.

## Explicitly not changed

- T2 pm-verdict/executor-result/PR-review validation paths.
- Bounce-limit semantics (still trips per UTV2-1554's authorized-only count).
- Any branch-protection or repository ruleset setting.
- `scripts/ops/merge-gate-verdict.cjs`/`.test.ts`, `eslint.config.mjs`,
  `package.json`, `docs/05_operations/schemas/pm-verdict-v1.md` — all
  supplied unchanged from trusted main via UTV2-1554, not touched by this PR.
