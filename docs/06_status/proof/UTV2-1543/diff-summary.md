# UTV2-1543 Diff Summary (continuation PR)

Issue: UTV2-1543
Tier: T1
Lane type: governance
Branch: `claude/utv2-1543-continuation`

## Why this PR exists

PR #1246 carries a fully reviewed and PM-approved implementation of this
issue -- exact-head `PM_VERDICT: APPROVED` was posted against head
`33d1bba3cd1843bce5807f48b8d0a146ce26e156` -- but Merge Gate's bounce-limit
check trips unconditionally once three authorized `CHANGES_REQUIRED`
verdicts exist in a PR's comment history, regardless of a later `APPROVED`
verdict on the same or a later head. PR #1246 accumulated three authorized
`CHANGES_REQUIRED` verdicts during iteration (2026-07-17T14:52, 16:35, and
2026-07-18T00:19), so it is now permanently frozen by that cap and moved to
PM Triage. This defect in the bounce-cap mechanism itself is tracked
separately as UTV2-1559 (durable fix pending); this PR is the documented,
PM-authorized manual continuation used to drain UTV2-1543 in the meantime,
per PM's explicit 2026-07-19 triage disposition.

PR #1246 is preserved unchanged as the audit record of that review --
nothing in its history is deleted or edited. This PR is closed as superseded
only after this continuation exists and is confirmed.

## Changes

This PR carries the exact, unmodified implementation from PR #1246's
approved head (`33d1bba3cd1843bce5807f48b8d0a146ce26e156`):

- `.github/workflows/merge-gate.yml` -- byte-identical copy (`git checkout
  33d1bba3 -- .github/workflows/merge-gate.yml`). T1 PM-verdict validation
  delegates to the trusted, already-on-main `scripts/ops/merge-gate-verdict.cjs`.
  No PR-head bootstrap-fetch fallback (removed in the approved head; main
  has carried the trusted helper since UTV2-1554).
- `scripts/ops/workflow-hardening.test.ts` -- byte-identical copy. Includes
  the regression assertion that the gate job never fetches or executes
  content keyed on `pull_request.head.sha`, and that no PR-head
  bootstrap-recovery step exists.

Everything else in this PR (`.ops/sync/UTV2-1543.yml`, the lane manifest,
and this proof bundle) is control-plane bookkeeping for the continuation
itself -- no substantive code changes beyond what PR #1246's approved head
already contained.

## Explicitly not changed

- No code diff versus PR #1246's approved head `33d1bba3`.
- T2 pm-verdict/executor-result/PR-review validation paths.
- Bounce-limit semantics (unchanged; the durable fix is UTV2-1559).
- Any branch-protection or repository ruleset setting.
- `scripts/ops/merge-gate-verdict.cjs`/`.test.ts`, `eslint.config.mjs`,
  `package.json`, `docs/05_operations/schemas/pm-verdict-v1.md` -- supplied
  unchanged from trusted main via UTV2-1554, not touched by this PR either.
