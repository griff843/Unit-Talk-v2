# PROOF: UTV2-1967

MERGE_SHA: pending merge

Bounded PM authority: PR #1678 comment 5958314005. No production state changes.

Issue: UTV2-1967
Tier: T1
result: focused/static checks PASS; canonical staging CI proof pending

## ASSERTIONS:

- [x] Historical missing-token recovery validates canonical original merged PR, reachable merge, exact original head, pristine immutable introduction and obligation; it creates no token or PASS.
- [x] Forged editable deferral, incomplete/missing/ambiguous/non-ancestral evidence, wrong repository/branch/head and active-lane use refuse before restoration.
- [x] Shallow original PR history is deepened before immutable evidence lookup and exact fetched head must match the attested historical head.
- [x] WORK text alone does not satisfy G5; canonical owned lane evidence must exist at the exact touching commit and cover every overlapping implementation path, and GitHub must independently attest the exact PR number/repository/branch/main base/merged state/head and touching merge SHA.
- [x] Both base and head repository identities must independently equal griff843/Unit-Talk-v2; fork, missing and null head repository mutations refuse.
- [x] Canonical trailing `/**` scopes cover nested files, while sibling-prefix paths, uncovered files, unsupported globs, traversal and malformed scopes refuse. Literal file ownership stays exact.
- [x] Existing already-merged legacy `dispatch-auto` remains compatible without creating a sentinel, token, PASS or deferral for an active/new lane.
- [x] A real depth-one clone with missing original evidence history deepens trusted main and original PR history before ancestry checks; forged/unavailable authority fails closed.
- [x] Real original UTV2-1370 admission and actual WORK-2026092901 follow-up pass the repaired logic without writing a manifest.
- [x] Original PR/merge/source remain bound; independently inspected immutable production verifier and parity artifacts genuinely PASS.

## EVIDENCE:

```text
focused lane-close/truth-check-lib/proof-schema/shared tests: exit 0, 596 passed / 0 failed / 0 skipped
targeted eslint: exit 0
pnpm type-check: exit 0
pnpm verify: running; completed result is required in the final exact-head executor packet
canonical staging-ci proof: pending actual CI (validated admission granted deferred_to_ci)
R-level: PASS, no matching rules
sanctioned update-branch: succeeded; implementation unchanged by resync
historical original-head Executor Result Validation: check 111001369799 PASS
production verifier: run 37036085802 job 110934527512 PASS
production parity: run 37036445782 job 110935763319 PASS
production mutation by reconciliation: none
```

## Verification

Focused suites ran directly with `pnpm exec tsx --test scripts/ops/lane-close.test.ts scripts/ops/truth-check-lib.test.ts scripts/ops/proof-schema.test.ts scripts/ops/shared.test.ts`. `pnpm verify` has been started, not skipped. Its final measured result and required live proof must be independently recorded in the exact-head executor packet before review. The protected staging-ci CI job remains live-DB authority; no production identity substitution or guard change is permitted. R-level passed against the refreshed committed implementation source. The original warehouse rehearsal passed with actual repository head identity and did not write any manifest.

## Merge SHA Binding

Merge SHA: pending merge
PR: #1710
Execution SHA: c689e1c6aff4947ee95bc0de4e6cf6d9ebcf410c
