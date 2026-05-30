# SQL Review — UTV2-1132 INIT-4.1.1 ExecutionIntent Entity

## Migration: 20260530001_utv2_1132_execution_intents.sql

### Table: execution_intents

**Immutability:** BEFORE UPDATE and BEFORE DELETE triggers raise EXCEPTION — verified live.

**Append-only chain:** `predecessor_id UUID REFERENCES execution_intents(id) DEFERRABLE INITIALLY DEFERRED` — self-referential FK, null = root.

**Idempotency:** `UNIQUE INDEX uidx_execution_intents_idempotency_key ON (idempotency_key) WHERE idempotency_key IS NOT NULL` — partial unique index, verified live.

**No wall-clock nondeterminism:** `issued_at_ms BIGINT NOT NULL` — epoch ms from caller. `created_at` uses `timezone('utc', now())` for storage timestamp only.

**Constraints verified live (7/7 tests):**
- INSERT works ✅
- UPDATE rejected by trigger ✅
- DELETE rejected by trigger ✅
- Duplicate idempotency_key rejected ✅
- Predecessor chain persists ✅
- inputs_hash CHECK rejects non-hex ✅
- status CHECK rejects invalid values ✅

**No capital/treasury/scaling surface introduced.** No FK to picks table (cross-package boundary). Decision record link is logical (TEXT field), not FK-enforced.

## Down script: 20260530001_utv2_1132_execution_intents.down.sql

```sql
DROP TRIGGER IF EXISTS execution_intents_no_update ON public.execution_intents;
DROP TRIGGER IF EXISTS execution_intents_no_delete ON public.execution_intents;
DROP FUNCTION IF EXISTS public.execution_intents_immutable();
DROP TABLE IF EXISTS public.execution_intents CASCADE;
```

Idempotent (`IF EXISTS`). Safe for round-trip drill.
