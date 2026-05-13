---
result: pass
---

# Runtime Verification — UTV2-921

**Issue:** UT-P0-008 Enforce Audit Immutability
**Branch:** codex/utv2-921-audit-immutability
**Verified by:** Claude (orchestrator) — 2026-05-13

---

## Runtime Checks

- [x] `lint-migrations: 105 migration files — no findings`: PASS
  - Command: `node scripts/lint-migrations.mjs`
  - Output: `[lint-migrations] 105 migration file(s) checked — no findings.`
  - All four patched migrations and the new corrective migration pass A1
- [x] `lintMigrationContent blocks DELETE FROM audit_log`: PASS
  - Test: `scripts/ops/workflow-hardening.test.ts`
  - `DELETE FROM public.audit_log` → A1 finding with file + statement context
- [x] `lintMigrationContent blocks UPDATE audit_log`: PASS
  - Test: `scripts/ops/workflow-hardening.test.ts`
  - `UPDATE audit_log SET action = action;` → A1 finding
- [x] `lintMigrationContent blocks TRUNCATE TABLE public.audit_log`: PASS
  - Test: `scripts/ops/workflow-hardening.test.ts`
  - `TRUNCATE TABLE public.audit_log;` → A1 finding; D3 suppressed by check guard
- [x] `lintMigrationContent allows audit_log INSERTs and trigger DDL`: PASS
  - Test: `scripts/ops/workflow-hardening.test.ts`
  - `INSERT INTO public.audit_log ...` → zero findings
  - `CREATE TRIGGER ... BEFORE UPDATE OR DELETE ON public.audit_log ...` → zero findings
- [x] `pnpm test:db`: PASS
  - 2/2 tests against live Supabase
  - `database repository bundle persists a submission and settlement`: PASS
  - `UTV2-883: no duplicate participants for the same external_id and sport`: PASS
- [x] `pnpm verify` (full pipeline): PASS
  - 113 tests, 0 failures, 0 cancelled

## Evidence

```
node scripts/lint-migrations.mjs
[lint-migrations] 105 migration file(s) checked — no findings.

pnpm exec tsx --test scripts/ops/workflow-hardening.test.ts
✔ migration linter flags destructive audit_log statements with file and statement context
✔ migration linter allows audit_log inserts and immutability triggers

pnpm test:db
✔ database repository bundle persists a submission and settlement (42939.9688ms)
✔ UTV2-883: no duplicate participants for the same external_id and sport (480.121ms)
tests 2 | pass 2 | fail 0

pnpm verify
tests 113 | pass 113 | fail 0
```

*Runbook: docs/05_operations/P0_PROTOCOL_SPEC.md*
