# Diff Summary — UTV2-1684

MERGE_SHA: 543271854f8beb548f094885153d060b49a19bce

## Summary

Implementation head `543271854f8beb548f094885153d060b49a19bce` closes the accepted review gaps in the post-merge lane-close workflow without changing lifecycle authority:

- the PR `mergeCommit` remains the authoritative resolved merge identity;
- push-trigger execution fails closed unless that identity equals `github.sha`;
- proof binding and persistence occur only for closeable lane flows;
- bound proof is persisted before downstream truth checks;
- persistence retries after concurrent advancement of `main`.

## Files Changed

- `.github/workflows/post-merge-lane-close.yml` — authoritative push identity assertion and closeable-only proof side effects.
- `scripts/ops/workflow-hardening.test.ts` — executable workflow-step behavioral coverage plus supplemental shape checks.
- `scripts/ops/lane-close.test.ts` — two obsolete assertions updated to the approved resolved-merge-SHA behavior.
- `.ops/sync/UTV2-1684.yml`, `docs/06_status/lanes/UTV2-1684.json`, and this proof directory — branch-local lane bookkeeping and merge-readiness evidence.

The behavioral seams live in `scripts/ops/workflow-hardening.test.ts`; the two directly conflicting legacy assertions remain updated in `scripts/ops/lane-close.test.ts`. Readmission declared both test files in the lane scope.
