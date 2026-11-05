# Diff summary: WORK-2026110309

Append a JSON scope suffix containing the resolved submitter and distribution mode to the existing hash inputs when either is present. Preserve all six original fields and exact legacy hashes when neither scope field exists. Mirror canonical attribution after the existing submittedBy pin. No historical fallback, data rewrite, migration or controller change.

Add seven issue regressions and a CI-only staging suite; register the suite in package.json and the writable-test classification. scripts/ci/db-writer-inventory.ts requires no change because classification registration is sufficient (static inventory gate verifies this).

The authorized controller test patch forces collisions explicitly and checks both guard mutation controls plus the human integrity guard. Production controller code stays unchanged. Historical keys are preserved and scoped historical retries create a new pick. No new any cast or removed test.

Open: exact-head staging CI, fresh Griff scope override and PM approval. Historical R-level artifacts are mechanical references only, not proof of this repair.

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1830
