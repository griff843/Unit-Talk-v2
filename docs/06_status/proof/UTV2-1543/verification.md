# PROOF: UTV2-1543 (continuation)

MERGE_SHA: 11d1b8cb9571ec4095ef65ccfd740db4d8914f5b

## Summary

PR #1246 carries a fully reviewed and PM-approved implementation of
UTV2-1543 -- exact-head `PM_VERDICT: APPROVED` was posted 2026-07-19T03:39:11Z
against head `33d1bba3cd1843bce5807f48b8d0a146ce26e156` -- but remains
permanently frozen: Merge Gate's bounce-limit check trips unconditionally
once three authorized `CHANGES_REQUIRED` verdicts exist in a PR's comment
history (posted 2026-07-17T14:52, 16:35, and 2026-07-18T00:19), regardless
of a later `APPROVED` verdict on the same head. PM moved #1246 to PM Triage
and authorized this continuation PR as the documented manual drain path,
per the 2026-07-19 PM disposition:

> Create a governed continuation PR: preserve #1246 unchanged as the audit
> record; do not delete/edit historical verdict comments; no admin merge or
> direct-main bypass; create a continuation branch/PR for UTV2-1543 carrying
> the exact same eight-file implementation; no substantive code changes;
> update only the lane/proof/PR bindings required for the new PR; link the
> continuation to #1246 and the PM-triage decision; close #1246 as
> superseded only after the continuation PR exists.

This PR carries `.github/workflows/merge-gate.yml` and
`scripts/ops/workflow-hardening.test.ts` byte-identical to PR #1246's
approved head (copied via `git checkout 33d1bba3 -- <paths>`). No
substantive code changes. The durable fix for the bounce-cap defect itself
is tracked separately as UTV2-1559.

## Owner boundary

T1 -- merge authority and repository enforcement configuration (this PR
touches `.github/workflows/merge-gate.yml` directly, a singleton/governance
path). The `PM_VERDICT: APPROVED` on PR #1246's head `33d1bba3` does **not**
carry forward automatically: this is a new PR with a new head, and per the
standing rule that a head change invalidates prior approval, it requires
its own fresh exact-head `pm-verdict/v1` APPROVED comment and `t1-approved`
label before merge.

## Verification

## ASSERTIONS:

- [x] `.github/workflows/merge-gate.yml` is byte-identical to PR #1246 approved head `33d1bba3cd1843bce5807f48b8d0a146ce26e156`
- [x] `scripts/ops/workflow-hardening.test.ts` is byte-identical to PR #1246 approved head `33d1bba3cd1843bce5807f48b8d0a146ce26e156`
- [x] No changes to `scripts/ops/merge-gate-verdict.cjs`/`.test.ts`, `eslint.config.mjs`, `package.json`, or `docs/05_operations/schemas/pm-verdict-v1.md` -- all supplied unchanged from trusted main via UTV2-1554
- [x] PR #1246 preserved unchanged: no historical verdict comments edited or deleted; #1246 to be closed as superseded only after this continuation is confirmed
- [x] No admin merge or direct-main bypass used to create or land this continuation
- [x] pnpm verify PASS (see EVIDENCE below)
- [x] r-level-check PASS (see EVIDENCE below)
- [x] pnpm test:db PASS (see EVIDENCE below)

## EVIDENCE:

```text
$ pnpm verify
(exit 0 -- full static gate + live DB smoke + live T1 proof suite)
```

```text
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Rules matched: (none) — no R-level artifacts required for this diff
```

```text
$ pnpm test:db
TAP version 13
1..7
# tests 7
# pass 7
# fail 0
# cancelled 0
# skipped 0
# duration_ms 97365.925125
```
