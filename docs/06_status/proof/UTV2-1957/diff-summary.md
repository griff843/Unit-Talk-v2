# Diff summary: UTV2-1957

UTV2-1957 adds a manually dispatched, production-bound verification workflow and a fail-closed read-only verifier for the already-applied UTV2-1370 migration. It does not apply DDL, create retention plans, execute retention, or delete data.

| File | Change |
| --- | --- |
| `.github/workflows/production-post-migration-verify.yml` | Runs the verifier only from trusted `main`, binds the production environment, uploads an immutable receipt, and keeps Live Schema Parity separate and mandatory. |
| `scripts/ci/production-post-migration-verify.ts` | Verifies production project/reader identity, exact migration-ledger alignment, read-only transaction state, direct/transitive role-membership absence, exact phase privilege boundaries, RLS, and valid `ORIGIN`/`ALWAYS` immutability triggers. |
| `scripts/ci/production-post-migration-verify.test.ts` | Provides the dedicated verifier regression suite, including membership-escalation mutation and trigger-state coverage. |
| `scripts/ci/workflow-production-credential-guard.test.ts` | Retains regression and mutation coverage for the production verifier and workflow boundary. |
| `package.json` | Exposes the dedicated test/runtime commands and wires the test command into static verification. |
| `docs/05_operations/DB_ENVIRONMENT_OPERATOR_POLICY.md` | Records the reader-only production verification policy. |
| `docs/05_operations/DB_MIGRATION_WORKFLOW.md` | Records the post-deploy verification and parity sequence. |
| `docs/05_operations/db-writer-classification.json` | Classifies the verifier as production read-only. |

The sanctioned refresh merged current `main` without conflicts. Its merge commit changed only current-main readiness/lane bookkeeping; it did not alter the verifier implementation.

## SHA Binding

Merge SHA: 80eb0f2d579d19f9c1de2db4d3196a266580be0a
PR: https://github.com/griff843/Unit-Talk-v2/pull/1698
Execution SHA: 7f8283390a6da09df812535edb6d208681311b2c
