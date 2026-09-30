# Diff summary: UTV2-1957

UTV2-1957 adds a manually dispatched, production-bound verification workflow and a fail-closed read-only verifier for the already-applied UTV2-1370 migration. It does not apply DDL, create retention plans, execute retention, or delete data.

| File | Change |
| --- | --- |
| `.github/workflows/production-post-migration-verify.yml` | Runs the verifier only from trusted `main`, binds the production environment, uploads an immutable receipt, and keeps Live Schema Parity separate and mandatory. |
| `scripts/ci/production-post-migration-verify.ts` | Verifies production project/reader identity, exact migration-ledger alignment, read-only transaction state, phase privilege boundaries, RLS, and enabled immutability triggers. |
| `scripts/ci/workflow-production-credential-guard.test.ts` | Adds regression and mutation coverage for the production verifier and workflow boundary. |
| `docs/05_operations/DB_ENVIRONMENT_OPERATOR_POLICY.md` | Records the reader-only production verification policy. |
| `docs/05_operations/DB_MIGRATION_WORKFLOW.md` | Records the post-deploy verification and parity sequence. |
| `docs/05_operations/db-writer-classification.json` | Classifies the verifier as production read-only. |

The sanctioned refresh merged current `main` without conflicts. The two later lane commits only reverted and re-established UTV2-1957's PR-link bookkeeping so the repaired immutable-preflight recovery contract could mint a valid ephemeral token; no verifier implementation changed.

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1698
Execution SHA: 7c8d6acda30729d48934d97b5595350586d340fb
