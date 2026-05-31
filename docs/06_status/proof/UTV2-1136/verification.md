---
issue: UTV2-1136
title: INIT-4.2.2 — settlement_records Immutability Trigger
tier: T1
merge_sha: d95a7838a718b0f8efedead66f59480f079472ac
---

## Verification

merge_sha: d95a7838a718b0f8efedead66f59480f079472ac

### pnpm verify

```
VERIFY_EXIT:0
```

All stages passed: sync-check, system-alignment, automation-coverage, env:check,
lint, pnpm type-check, pnpm build, pnpm test (113 pass / 0 fail), verify:commands.
Migration lint: 116 files checked — no findings.

### pnpm test:db

```
# tests 7 / pass 7 / fail 0
ok 1 - UTV2-879: distinct settlement source enforcement
ok 2 - UTV2-995: corrects_id references same pick
ok 3 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 4 - UTV2-996: correction chain is additive — original settlement row is not mutated
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
(7 total)
```

### T1 Live-DB Proof (apps/api/src/t1-proof-utv2-1136-settlement-records-immutability.test.ts)

Run against live Supabase (SUPABASE_SERVICE_ROLE_KEY present):

```
ok 1 - UTV2-1136: settlement INSERT succeeds (baseline)
ok 2 - UTV2-1136: UPDATE on settlement_records is rejected by immutability trigger
ok 3 - UTV2-1136: DELETE on settlement_records is rejected by immutability trigger
ok 4 - UTV2-1136: correction INSERT (with corrects_id) succeeds — append-only path intact

# tests 4 / pass 4 / fail 0
```

### R-level check

```
Verdict: PASS
Changed files: 6
Rules matched: (none) — no R-level artifacts required for this diff
```

### Trigger verification

Migration `20260530002_utv2_1136_settlement_records_immutability_trigger.sql` applied
to live Supabase project `zfzdnfwdarxucxtaojxm` via MCP `apply_migration` (returned
`{"success":true}`).

Trigger `trg_settlement_records_immutable` fires `BEFORE UPDATE OR DELETE` on
`public.settlement_records`. Function raises `SETTLEMENT_RECORD_IMMUTABLE` with
ERRCODE `P0001`. Correction INSERTs (new rows, `corrects_id` set) are unaffected
because INSERT does not fire the trigger.

### PM Approval

`t1-approved` label applied to PR #939 by PM (griff843) on 2026-05-31.
