# Diff summary: UTV2-1370

| File | Change |
|---|---|
| `supabase/migrations/20260928131714_utv2_1370_warehouse_retention.sql` | Adds append-only plan/execution/recovery receipts, exact FK-contract protection, bounded plan/execute/recover functions, and three phase-specific NOLOGIN roles. |
| `db/migrations-rollback/20260928131714_utv2_1370_warehouse_retention.down.sql` | Refuses rollback while receipts exist, restores the exact immutability trigger bodies, removes DB-local capability, and leaves cluster roles inert. |
| `scripts/warehouse/retention.ts` | Adds reader-verified plan/execute/recover CLI with phase-specific DSN guards and no broad production credential fallback. |
| `scripts/warehouse/retention.test.ts` | Proves allowlisting, credential separation, reader-only evidence verification, and fail-closed corruption/missing-object behavior. |
| `scripts/warehouse/retention-workflow.test.ts` | Proves the complete bounded 1 → 0 → 1 lifecycle in isolated schemas/roles plus protected-reference and operational-truth invariants. |
| `apps/api/src/t1-proof-warehouse-retention.test.ts` | Canonical T1 proof entrypoint for the retention lifecycle. |
| `.github/workflows/migration-reversibility-gate.yml` | Runs the bounded lifecycle proof in ephemeral PostgreSQL for this migration. |
| `package.json` | Wires retention tests and CLI into existing commands. |

## SHA Binding

Merge SHA: pending merge  
PR: https://github.com/griff843/Unit-Talk-v2/pull/1678  
Execution SHA: ee373ec786a24c460412361dce2708f4e69ce597
