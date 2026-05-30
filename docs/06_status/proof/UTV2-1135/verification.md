---
issue: UTV2-1135
title: INIT-4.2.1 — updatePayload Surface Removal
tier: T2
---

## Verification

### pnpm verify

```
VERIFY_EXIT:0
```

All stages passed: sync-check, system-alignment, automation-coverage, env:check,
lint, type-check, build, test (113 pass / 0 fail), verify:commands.

### R-level check

```
Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```

### Caller audit

`grep -r "updatePayload" apps/ packages/` — zero results outside the removed
repository methods. No test mocks, no service calls, no controller references.

### No migration needed

`settlement_records` schema is unchanged. The `corrects_id` correction model
already exists in `supabase/migrations/202603200002_v2_schema_hardening.sql:155-168`.
