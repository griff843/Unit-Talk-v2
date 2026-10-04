# Diff summary: UTV2-1370

| File | Change |
|---|---|
| `supabase/migrations/20260928131714_utv2_1370_warehouse_retention.sql` | Adds append-only plan/execution/recovery receipts, exact FK-contract protection, bounded plan/execute/recover functions, execution-bound manifest/object fingerprint checks before recovery inserts, and three phase-specific NOLOGIN roles. |
| `db/migrations-rollback/20260928131714_utv2_1370_warehouse_retention.down.sql` | Refuses rollback while receipts exist, restores the exact immutability trigger bodies, removes DB-local capability, and leaves cluster roles inert. |
| `scripts/warehouse/retention.ts` | Adds reader-verified plan/execute/recover CLI with phase-specific DSN guards and no broad production credential fallback. |
| `scripts/warehouse/retention.test.ts` | Proves allowlisting, credential separation, reader-only evidence verification, and fail-closed corruption/missing-object behavior. |
| `scripts/warehouse/retention-workflow.test.ts` | Proves the complete bounded 1 → 0 → 1 lifecycle in isolated schemas/roles, same-count changed-content recovery refusal, exact-fingerprint recovery, protected-reference behavior, and operational-truth invariants. |
| `apps/api/src/t1-proof-warehouse-retention.test.ts` | Canonical T1 proof entrypoint for the retention lifecycle. |
| `.github/workflows/migration-reversibility-gate.yml` | Runs the bounded lifecycle proof in ephemeral PostgreSQL and supplies read-only workflow-token access for fail-closed authoritative parity receipt validation. |
| `package.json` | Wires retention tests and CLI into existing commands. |

## SHA Binding

Merge SHA: 400c2962c5d51d2d2f7c5d4b228f5a891bd10930
PR: https://github.com/griff843/Unit-Talk-v2/pull/1678  
Execution SHA: fec795f7a0997180bb61d146eac0b0755147bf52
