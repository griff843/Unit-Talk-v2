# UTV2-1694 diff summary

- Normalized required-check conclusions before deciding whether they pass, so GitHub's `SUCCESS`, `NEUTRAL`, and `SKIPPED` values cannot be emitted as blockers.
- Added `mergeable` and `mergeStateStatus` to the diagnostic output and reports actionable blockers for `BEHIND` and `DIRTY` PRs.
- Added regression coverage for upper- and lower-case passing results, an out-of-date head branch, merge conflicts, and a still-failing required check.

Only `scripts/ops/pr-block-diagnostic.ts` and `scripts/ops/pr-block-diagnostic.test.ts` changed outside this required proof bundle.
