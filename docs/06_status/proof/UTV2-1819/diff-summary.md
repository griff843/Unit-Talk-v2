# PROOF: UTV2-1819 — diff summary

MERGE_SHA: 194df996f09cc90d0600100939c619eba2990a5a

`lane-maximizer: bound the candidate page size to Linear's query-complexity budget`

Two files changed, both under `scripts/ops/`. No runtime, domain, DB, delivery, workflow-authority
or concurrency-config file is touched, and no ranking or admission policy is changed.

## `scripts/ops/lane-maximizer.ts`

- `LINEAR_CANDIDATE_PAGE_SIZE` 100 → 50, with a comment naming the real binding constraint (the
  complexity budget, not the 250-row limit) and the outage it caused.
- Added `LINEAR_CANDIDATE_COMPLEXITY_BUDGET` (10000), `LINEAR_CANDIDATE_MEASURED_COMPLEXITY_PER_NODE`
  (116.01, from a live measurement) and `LINEAR_CANDIDATE_NESTED_CONNECTIONS` (2).
- Extracted the inline candidate query to an exported `LINEAR_CANDIDATE_QUERY` so the regression
  inspects the real query text. The query itself is byte-identical — only its location moved.

## `scripts/ops/lane-maximizer.test.ts`

- `fakeLinearDeps` now records `limitsSent` (the `first:` actually put on the wire), alongside the
  existing `cursorsSent` and `candidateQueries`.
- Three new specs: AC2 (page size under budget, with margin), AC4 (nested-connection count still
  matches the measurement), AC3 (the bounded size reaches the wire and does not cap discovery).

75 pre-existing specs are unchanged and still pass. Total 78.
