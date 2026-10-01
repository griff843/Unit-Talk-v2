# Diff summary: UTV2-1961

| File | Change |
|---|---|
| .github/workflows/production-post-migration-verify.yml | Manual main-only read-only production verifier and immutable artifact |
| docs/05_operations/DB_ENVIRONMENT_OPERATOR_POLICY.md | Distinguish staging writable proof and production read-only verification |
| docs/05_operations/DB_MIGRATION_WORKFLOW.md | Require production receipt and separate parity before migration close |
| docs/05_operations/db-writer-classification.json | Classify merged verifier as production read-only entrypoint |
| docs/05_operations/REQUIRED_SECRETS.md | PM-required bounded correction: management token dependency, production URL identity and environment-bound warehouse_reader DSN |

Verifier implementation, package integration and tests landed in #1698.
All four files match reviewed companion ca628341519f363b9ee80660064f2604b3b5e76a.
The inventory-only repair does not change their implementation. Original scope lock
is unchanged; an external exact-head scope override is required for the added doc.

## SHA Binding

Merge SHA: pending merge
PR: pending
