# Diff summary — UTV2-1820

Anchor: `7044e59b2698190e8f7c225e14ed2b7a52b35670`
MERGE_SHA: 565b578eaa8280e01ae164f3dc474fab2c629cd6

## scripts/ops/lane-maximizer.ts

- `LINEAR_CANDIDATE_QUERY` gains `inverseRelations { nodes { type issue { identifier } } }`, the only
  connection that names a genuine prerequisite.
- `LinearCandidateIssueNode` gains an optional `inverseRelations`. Optional on purpose: a server that
  omits it must be treated as unreadable, not as "no prerequisites".
- `isBlockingLinearRelationType` is replaced by `isPrerequisiteInverseRelation` and
  `isPrerequisiteOutgoingRelation`, so the direction is named rather than inferred from the call
  site. The outgoing predicate accepts only `blocked_by`, never `blocks`.
- New `LINEAR_UNREADABLE_RELATIONS_SENTINEL`. An absent connection, or a relation naming no issue,
  yields it as a prerequisite so the candidate stays `BLOCKED_DEP`.
- Complexity constants re-measured against the real query text and moved together:
  `MEASURED_COMPLEXITY_PER_NODE` 116.01 → 226.01, `NESTED_CONNECTIONS` 2 → 3,
  `PAGE_SIZE` 50 → 30. The node ceiling (10000) is unchanged and capacity does not move with the
  page size.

## scripts/ops/lane-maximizer.test.ts

- The Linear node fixture now returns `inverseRelations: { nodes: [] }`, matching what the real query
  asks for. An absent set is a different case with its own test.
- The relation-type test now asserts both predicates, including that `blocks` on the outgoing edge is
  NOT a prerequisite.
- 7 new regressions: outgoing-only is admitted; a real incoming prerequisite refuses; both edges at
  once counts only the incoming one; an absent set refuses; a relation with no identifier refuses;
  the sentinel resolves to `BLOCKED_DEP` rather than to done; and the shipped query text actually
  requests the inverse edge.

Every new control is paired with a mutation (N1–N4) that makes it fail on the condition it names.
Receipts in `verification.md`.
