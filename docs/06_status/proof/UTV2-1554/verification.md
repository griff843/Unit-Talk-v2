# PROOF: UTV2-1554

MERGE_SHA: c16054ba2a1806b733c033c773479abd99b76c74

## Verification

## Summary

Stage 1 of a two-stage governed bootstrap for the T1 Merge Gate self-referential
gap discovered live while draining PR #1246/UTV2-1543: Merge Gate's checkout is
pinned to the PR base SHA for privilege-boundary reasons, but
`scripts/ops/merge-gate-verdict.cjs` was the file that PR itself introduced, so
base SHA never had it and `require()` threw `MODULE_NOT_FOUND` on every
evaluation of that PR, forever, since Merge Gate is a hard-required check that
can never re-evaluate against a later main.

This lane lands the final `merge-gate-verdict.cjs` implementation, its full
unit test suite, and lint/test:ops wiring on `main` -- **without touching
`.github/workflows/merge-gate.yml` at all**. Once merged, every future PR's
base SHA already contains the file, closing the bootstrap gap structurally
rather than by fetching PR-controlled content into a privileged job.

## ASSERTIONS:

- [x] `scripts/ops/merge-gate-verdict.cjs` is the final, reviewed implementation (ported byte-for-byte from the UTV2-1543 lane's already-verified content)
- [x] `scripts/ops/merge-gate-verdict.test.ts` (20 tests) is wired into `test:ops`
- [x] `eslint.config.mjs` carries the `**/*.cjs` override needed for this repo's first `.cjs` source file
- [x] `docs/05_operations/schemas/pm-verdict-v1.md` updated with the PR/Head-SHA freshness fields the helper validates
- [x] `.github/workflows/merge-gate.yml` is NOT part of this diff -- no privileged workflow behavior changes in this lane
- [x] No PR-head code is fetched or executed by this lane's own CI evaluation
- [x] pnpm verify PASS (full local run, exit code 0)
- [x] pnpm test:db PASS (7/7, live Supabase)
- [x] r-level-check PASS, no artifacts required for this diff
- [x] PM's 2026-07-18T20:07:51Z CHANGES_REQUIRED trust-boundary repair applied: authorization filtering now happens before latest-verdict selection, not after; unauthorized/bot comments can no longer block a valid owner APPROVED or supersede a valid owner CHANGES_REQUIRED, in either direction; fail-closed preserved when no authorized verdict exists

## EVIDENCE:

```text
$ pnpm exec tsx --test scripts/ops/merge-gate-verdict.test.ts
1..20
# tests 20
# pass 20
# fail 0
# cancelled 0
# skipped 0
```

```text
$ pnpm verify
(exit 0 -- full static gate, live DB smoke 7/7, live T1 proof suite)
```

```text
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 10
Rules matched: (none) — no R-level artifacts required for this diff
```

## PM CHANGES_REQUIRED repair (this head)

The prior head (`562e148958a2bbe5b910b5a82c20ae8a42166637`) received PM_VERDICT: CHANGES_REQUIRED at 2026-07-18T20:07:51Z:

> Filter comments to authorized verdict authors before choosing the controlling latest verdict. An unauthorized outsider or bot comment must not override or block a valid authorized owner verdict. Add regression tests for both directions... Preserve fail-closed behavior when no valid authorized verdict exists.

`validateT1Verdicts` in `scripts/ops/merge-gate-verdict.cjs` now filters `verdicts` to `ctx.authorizedReviewers` (excluding bot userType) *before* picking the latest one, instead of authorizing only after selection. Concretely:

- Owner `APPROVED` followed by a later unauthorized/bot `CHANGES_REQUIRED` (same PR/head): the unauthorized comment is filtered out entirely; the owner `APPROVED` remains controlling; `errors` is empty.
- Owner `CHANGES_REQUIRED` followed by a later unauthorized/bot `APPROVED`: same filtering; the owner `CHANGES_REQUIRED` remains controlling; merge stays blocked.
- If every parsed verdict is unauthorized, the function still fails closed with the same generic "T1 requires a valid pm-verdict/v1 comment" message (plus the specific bot/non-CODEOWNERS diagnostic for the raw latest comment, preserving prior single-comment messaging).
- The bounce-limit count (`changesRequested`) is now computed over the authorized subset only, so an outsider cannot force a false bounce-limit trip by spamming fake `CHANGES_REQUIRED` comments.

Four new tests cover all four cases above; all 16 pre-existing tests are unaffected (they all use the single authorized `griff843` reviewer already in `REVIEWERS`).

## Stage 2 (separate follow-up, not in this PR)

Once this lane merges, PR #1246/UTV2-1543 will be rebased onto the resulting
main, its PR-head bootstrap fetch fallback removed entirely, and a regression
assertion added proving Merge Gate never fetches or executes content from
`github.event.pull_request.head.sha`. That work is out of scope for this
narrow bootstrap PR by design -- keeping the trusted-helper landing and the
Merge Gate consumption change in separate, independently reviewable PRs.

## Owner boundary

T1 governance-critical bootstrap. Must merge under the existing human-approved
T1 rules; it cannot use the authority it is preparing to create. Requires the
`t1-approved` label and a valid Griff-authored `pm-verdict/v1` APPROVED comment
bound to the reviewed head. This proof supplies neither.
