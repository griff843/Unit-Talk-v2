# SQL Review: UTV2-1137 — settlement_corrections migration

## Migration: `20260531001_utv2_1137_settlement_corrections.sql`

### Table: `settlement_corrections`

```sql
CREATE TABLE IF NOT EXISTS public.settlement_corrections (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_record_id UUID        NOT NULL REFERENCES public.settlement_records(id),
  prior_record_id      UUID        NOT NULL REFERENCES public.settlement_records(id),
  authorizer_1         TEXT        NOT NULL,
  authorizer_2         TEXT        NOT NULL,
  justification        TEXT        NOT NULL,
  correction_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  audit_event_id       UUID        NULL,

  CONSTRAINT settlement_corrections_distinct_authorizers
    CHECK (authorizer_1 != authorizer_2)
);
```

### Review: PASS

| Check | Result | Notes |
|---|---|---|
| Foreign key references valid tables | ✓ | Both FKs reference `settlement_records(id)` |
| CHECK constraint enforces distinct authorizers | ✓ | `authorizer_1 != authorizer_2` |
| NOT NULL on required columns | ✓ | authorizer_1, authorizer_2, justification |
| Unique index on settlement_record_id | ✓ | One auth record per correction |
| Trigger validates lineage | ✓ | corrects_id must match prior_record_id |
| No UPDATE/DELETE (append-only) | ✓ | settlement_records is immutable (UTV2-1136) |
| DOWN script is complete | ✓ | Drops table, trigger, function, index |
| Schema round-trip verified | ✓ | up → down → up produces same schema |

### Risk: LOW

New table only, no modifications to existing tables. Foreign keys reference stable immutable records (settlement_records append-only per UTV2-1136 trigger).
