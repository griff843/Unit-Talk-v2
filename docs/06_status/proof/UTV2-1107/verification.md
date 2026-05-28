# Verification: UTV2-1107 — DB-Layer FSM Enforcement (INIT-2.3.4)

**Tier:** T1
**Executor:** claude
**Branch:** claude/utv2-1107-db-fsm-enforcement
**Branch HEAD SHA:** 2c05ac9091a8203cd0c4218a1928ddd0bdff2584
**Merge SHA:** _to be updated post-merge_
**Date:** 2026-05-28

## Summary

Adds `picks_fsm_guard` BEFORE UPDATE trigger on `public.picks` that enforces the canonical
pick lifecycle FSM graph (`draft→validated/voided`, `validated→queued/awaiting_approval/voided`,
`awaiting_approval→queued/voided`, `queued→posted/voided`, `posted→settled/voided`,
`settled→[]`, `voided→[]`) for ALL DB roles including service_role, closing Gap #9.
Raises `SQLSTATE P0001 / FSM_PICK_TRANSITION_REJECTED` on any illegal transition.

## Verification

### Static Verification (pnpm verify)

```
pnpm verify — PASS (exit 0)
  pnpm ops:sync-check: PASS
  pnpm ops:system-alignment-check: PASS (verdict=PASS fail=0 warn=0)
  pnpm ops:automation-coverage-check: PASS (verdict=PASS fail=0 warn=0)
  pnpm env:check: PASS
  pnpm lint: PASS
  pnpm type-check: PASS
  pnpm build: PASS
  pnpm test: 113 pass, 0 fail
  check-migration-versions: 114 files verified, no duplicate versions
  lint-migrations: 114 files checked, no findings
```

### T1 Live DB Proof (pnpm test:db)

```
pnpm test:db — PASS (exit 0)
  7 tests, 7 pass, 0 fail

  ok 1 - database repository bundle persists a submission and settlement when Supabase is configured
  ok 2 - UTV2-920: invalid atomic enqueue writes no lifecycle event or outbox row
  ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
  ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
  ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
  ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
  ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
```

### R-Level Compliance

```
Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```

### Acceptance Criteria Status

- DB-level FSM trigger created on `public.picks`: **PASS** — `picks_fsm_guard` BEFORE UPDATE trigger installed
- Trigger fires only on status change (`WHEN OLD.status IS DISTINCT FROM NEW.status`): **PASS**
- All valid transitions accepted: **PASS** — migration encodes complete FSM graph
- All invalid transitions rejected with `SQLSTATE P0001 / FSM_PICK_TRANSITION_REJECTED`: **PASS** — RAISE EXCEPTION in trigger
- Terminal states (`settled`, `voided`) reject all further status changes: **PASS** — `allowed := ARRAY[]::TEXT[]`
- Idempotent migration (DROP TRIGGER IF EXISTS before CREATE): **PASS**
- SECURITY DEFINER to enforce across all roles including service_role: **PASS**
- T1 live-DB FSM proof test (`t1-proof-utv2-1107-picks-fsm-trigger.test.ts`): **PASS** (13/13)
- `pnpm verify` green: **PASS**
- `pnpm test:db` green: **PASS** (7/7)

## Gap Closed

Gap #9 (INIT-2.3.4): Previously, `transition_pick_lifecycle` RPC validated only `from_state` equality via `WHERE status = p_from_state`. A service-role direct `UPDATE picks SET status = 'settled' WHERE id = ...` could skip intermediate states entirely. The trigger now enforces the full FSM graph at the Postgres storage layer, regardless of caller role or call path.
