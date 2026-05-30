# Diff Summary — UTV2-1132 INIT-4.1.1 ExecutionIntent Entity

## Files changed (9)

### New files
- `supabase/migrations/20260530001_utv2_1132_execution_intents.sql` — DB migration: execution_intents table, immutability triggers, indexes
- `db/migrations-rollback/20260530001_utv2_1132_execution_intents.down.sql` — Rollback: DROP TABLE execution_intents CASCADE
- `packages/domain/src/models/execution-intent.ts` — Domain type: ExecutionIntent + factory + chain ops
- `packages/domain/src/models/execution-intent.test.ts` — 30 domain unit tests
- `apps/api/src/t1-proof-execution-intent.test.ts` — 7 live-DB proof tests

### Modified files
- `packages/domain/src/models/index.ts` — barrel export for execution-intent
- `packages/db/src/types.ts` — ExecutionIntentRow, ExecutionIntentType, ExecutionIntentStatus
- `packages/db/src/repositories.ts` — ExecutionIntentRepository interface + RepositoryBundle.executionIntents
- `packages/db/src/runtime-repositories.ts` — InMemoryExecutionIntentRepository + DatabaseExecutionIntentRepository

## Constitutional constraints
- No capital, treasury, or scaling surface
- Domain package remains pure (no I/O, no DB, no env)
- Program 1 certification topology untouched
