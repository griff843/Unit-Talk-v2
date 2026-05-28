## Summary

UTV2-1107 adds a Postgres `BEFORE UPDATE` trigger on `public.picks` that enforces the canonical pick lifecycle FSM graph for **all** DB roles, closing the gap where service-role direct `UPDATE picks SET status = ...` bypassed the TypeScript lifecycle guards in `packages/db/src/lifecycle.ts`.

**Branch HEAD SHA:** 676f96eb85e586b91e282271dddd23b802fb7c63
**Merge SHA:** 0887296bf3b05cbf27393d7685add5371b69f6f1
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/901

## Files Changed

- `supabase/migrations/20260528001_utv2_1107_picks_fsm_trigger.sql`: Creates `picks_fsm_transition_guard()` PLPGSQL function and `picks_fsm_guard` BEFORE UPDATE trigger. Encodes the complete FSM transition graph (`draft→validated/voided`, `validated→queued/awaiting_approval/voided`, `awaiting_approval→queued/voided`, `queued→posted/voided`, `posted→settled/voided`, `settled→[]`, `voided→[]`). Raises `SQLSTATE P0001 / FSM_PICK_TRANSITION_REJECTED` on any illegal transition attempt. SECURITY DEFINER; idempotent (DROP TRIGGER IF EXISTS before CREATE).
- `db/migrations-rollback/20260528001_utv2_1107_picks_fsm_trigger.down.sql`: Rollback script drops the trigger and function.
- `apps/api/src/t1-proof-utv2-1107-picks-fsm-trigger.test.ts`: T1 live-DB proof test verifying 13 FSM assertions against real Supabase (valid transitions, invalid skip-transitions, terminal state enforcement, void path).

## Root Cause Closed

Gap #9 (INIT-2.3.4): `transition_pick_lifecycle` RPC only guards the `from_state` race via `WHERE status = p_from_state`. A service-role `UPDATE picks SET status = 'settled' WHERE id = ...` with no WHERE status guard could jump from `draft` to `settled` skipping all intermediate states. The trigger now catches this at the storage layer regardless of caller role.

## Proof Result

pnpm test:db — PASS (7/7): database-smoke + T1 FSM assertions all green on live Supabase.
