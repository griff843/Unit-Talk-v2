# Diff summary: UTV2-1966

Bounded PM-authorized repair of failed production run 37007294364, job 110838466433.
Implementation source: b56870d86a69a54aad7796c9d075d3810debade5.

| File | Change |
|---|---|
| scripts/ci/production-post-migration-verify.ts | Explicit identity-validated libpq environment, inherited PG override removal, secure SSL, unchanged mandatory read-only SQL; strictly normalized numeric ledger cells. |
| scripts/ci/production-post-migration-verify.test.ts | Production pooler/child-boundary and Markdown ledger regressions; malformed/noncanonical DSN and malformed/mismatched ledger refusals. |
| .ops/sync/UTV2-1966.yml and docs/06_status/lanes/UTV2-1966.json | Canonical lane admission metadata. |
| docs/06_status/proof/UTV2-1966/* | Measured static proof and honest routing provenance. |

No workflow, migration, retention behavior, package integration, production role or privilege changes.
No production dispatch, DDL, data mutation, retention execution, recovery or deletion occurred during this repair.

## SHA Binding

Merge SHA: 2c4e754652830967bf006db6dff3f96f55c9f9a1
PR: pending
