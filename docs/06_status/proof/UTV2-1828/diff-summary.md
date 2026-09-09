# DIFF SUMMARY: UTV2-1828 — rebind diff-summary.md on the closeout path

MERGE_SHA: pending merge

Issue: UTV2-1828
PR: https://github.com/griff843/Unit-Talk-v2/pull/1490
Execution SHA: 066d65ed4699b71e5018d8a828c3ac755522cf7f

## Why anything changed

UTV2-1826 merged as `ef27ab62c90d8fb9bd6ee6d7688c836411a0753b` (PR #1486) and could not be
closed. Measured on that lane:

```
pnpm ops:truth-check UTV2-1826  ->  fail (39 checks, 2 failures)
                                    P3 and C4, both naming
                                    docs/06_status/proof/UTV2-1826/diff-summary.md
```

`ops:truth-check` P3 ("proof files missing merge SHA reference") and C4 ("proof artifacts
missing required SHA binding") scan the whole proof directory. Both rebinders on the
closeout path covered exactly two files.

## Files changed

- `scripts/ops/lane-close.ts` — `activeStaticReattestationCandidate` now resolves an
  optional `diffSummaryPath`; both branches of `rebindRepairedLaneProof` offer that file to
  the rebinder; the attested branch reads the result back and refuses rather than reporting
  a partial rebind as a complete one.
- `scripts/ops/lane-close.test.ts` — three new regressions, plus five existing
  assertions updated for the extra outcome the tolerant path now reports.

## Not changed

- `scripts/ops/proof-generate.ts` (`rebindMergeSha`) carries the same two-file list and is
  inside UTV2-1825's active file scope lock (PR #1485, open). The list is extended from the
  `lane-close.ts` call site instead.
- `scripts/ops/proof-rebind.ts` (`CANONICAL_PROOF_ARTIFACTS`) is unchanged: its strict
  planner requires a `## Merge SHA Binding` section that a canonically generated
  `diff-summary.md` does not have.
