# WORK-2026102807 diff summary

MERGE_SHA: pending merge

A corrected pick could show its original result in the unfiltered list while the filtered list and detail showed the correction. All results pages now resolve complete, page-scoped histories through the existing canonical identity reader and label corrected results.

- `queues.ts`: paginated, timed page-history read; exact-count and count-stability checks; effective settlement mapping; reject disagreement with active result filters.
- `PicksExplorerClient.tsx`: append `(corrected)` beside a result badge when the effective record corrects another record.
- `queues-count-relation.test.ts`: retain original assertions and add behavioral coverage for the unfiltered result, bounded reads, pending/manual-review states, incomplete/invalid histories and result changes. A targeted mutation demonstrates that the new unfiltered assertion detects removal of the fix.
- `operations-home.test.ts`: only add the fake network response for its new page-scoped history request; no existing assertion changes.

Only these four source/test files and this lane's proof directory were edited by the executor. No dependency, schema, authentication, settlement-policy, score-validation, delivery, cohort or write-path change is included.
