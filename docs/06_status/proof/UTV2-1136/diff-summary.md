---
issue: UTV2-1136
title: INIT-4.2.2 — settlement_records Immutability Trigger
tier: T1
merge_sha: d95a7838a718b0f8efedead66f59480f079472ac
pr: "939"
---

## Diff Summary

### Files changed (4)

1. `supabase/migrations/20260530002_utv2_1136_settlement_records_immutability_trigger.sql` — NEW
   - `CREATE OR REPLACE FUNCTION settlement_records_immutable()` — BEFORE UPDATE OR DELETE trigger function
   - `CREATE TRIGGER trg_settlement_records_immutable` on `public.settlement_records`
   - Raises `SETTLEMENT_RECORD_IMMUTABLE` (ERRCODE P0001) on any UPDATE or DELETE

2. `apps/api/src/t1-proof-utv2-1136-settlement-records-immutability.test.ts` — NEW
   - 4 T1 live-DB assertions: INSERT pass, UPDATE reject, DELETE reject, correction INSERT pass

3. `package.json` — MODIFIED
   - `test:t1-proof`: added `tsx --test apps/api/src/t1-proof-utv2-1136-settlement-records-immutability.test.ts`

4. `.ops/sync/UTV2-1136.yml` — NEW
   - Lane sync metadata

### Scope

Narrow DB trigger lane. No application logic changed. No schema column added or
removed. `repositories.ts` was in file scope lock but required no modification —
the trigger enforces immutability at DB layer; the `record()` INSERT path is
unaffected.

### T1 Trigger

- `supabase/migrations/` file created ✓

### Rollback

```sql
DROP TRIGGER IF EXISTS trg_settlement_records_immutable ON public.settlement_records;
DROP FUNCTION IF EXISTS settlement_records_immutable();
```
