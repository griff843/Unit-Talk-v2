# WORK-2026110309 diff summary

Append a JSON scope suffix containing the resolved submitter and distribution mode to the existing hash inputs when either is present. Preserve all six original fields and exact legacy hashes when neither scope field exists. Mirror canonical attribution after the existing submittedBy pin. No historical fallback, data rewrite, migration or controller change.

Add seven issue regressions and a CI-only staging suite; register the suite in package.json and the writable-test classification. scripts/ci/db-writer-inventory.ts requires no change because classification registration is sufficient (static inventory gate verifies this).

Open blockers: controller guard fixture requires PM SCOPE_OVERRIDE; exact-head writable staging CI and pnpm verify are pending. No new any cast, removed test or out-of-scope implementation file. Four proof files are authorized by orchestrator ruling-2. R-level historical artifacts are mechanical policy references only.
