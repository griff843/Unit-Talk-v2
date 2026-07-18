# PROOF: UTV2-1554

MERGE_SHA: 15c78512dea9d2fdd249d1b06ff9fabb6e47dd0f (placeholder, pre-implementation-commit — rebound to the actual implementation SHA in a follow-up commit)

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
- [x] `scripts/ops/merge-gate-verdict.test.ts` (16 tests) is wired into `test:ops`
- [x] `eslint.config.mjs` carries the `**/*.cjs` override needed for this repo's first `.cjs` source file
- [x] `docs/05_operations/schemas/pm-verdict-v1.md` updated with the PR/Head-SHA freshness fields the helper validates
- [x] `.github/workflows/merge-gate.yml` is NOT part of this diff -- no privileged workflow behavior changes in this lane
- [x] No PR-head code is fetched or executed by this lane's own CI evaluation
- [x] pnpm verify PASS (full local run, exit code 0)
- [x] pnpm test:db PASS (7/7, live Supabase)
- [x] r-level-check PASS, no artifacts required for this diff

## EVIDENCE:

```text
$ pnpm exec tsx --test scripts/ops/merge-gate-verdict.test.ts
1..16
# tests 16
# pass 16
# fail 0
# cancelled 0
# skipped 0
```

```text
$ pnpm lint
(clean, exit 0)
```

```text
$ pnpm exec tsx scripts/ci/r-level-check.ts --base origin/main --head HEAD
Verdict: PASS
Changed files: 3
Rules matched: (none) — no R-level artifacts required for this diff
```

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
