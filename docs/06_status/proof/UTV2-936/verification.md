UTV2-936 Automated Recovery Workflows — Live-DB Proof Log

## Verification

This markdown file preserves the lane verification evidence in a gate-visible proof artifact.

==========================================================
Date: 2026-05-17
Branch: claude/utv2-936-automated-recovery
Branch HEAD SHA: 4535b4e73f50ac2915d70cce28727ae52f74b391
Supabase project: zfzdnfwdarxucxtaojxm
Executor: Claude (claude-sonnet-4-6)

--- LIVE-DB PROOF (6 tests) ---

Command: UNIT_TALK_APP_ENV=local npx tsx --test apps/worker/src/t1-proof-automated-recovery.test.ts

✔ [live-db] recovery disabled: sweep is no-op (3.0505ms)
✔ [live-db] eligible transient error row reset to pending with audit (955.3782ms)
✔ [live-db] denylist: FK violation row not eligible for recovery (665.7936ms)
✔ [live-db] listForAutoRecovery respects attempt ceiling (114.5982ms)
✔ [live-db] idempotency: audit written exactly once per recovery (597.3341ms)
✔ [live-db] kill-switch: disabled recovery is always a no-op (0.2262ms)
tests: 6 | pass: 6 | fail: 0 | duration: 2978ms

--- STATIC SUITE ---

apps/worker/src/worker-automated-recovery.test.ts:  24 pass, 0 fail
apps/worker/src/worker-runtime.test.ts:             41 pass, 0 fail (type-compatibility maintained)

--- pnpm test:db ---

apps/api/src/database-smoke.test.ts: 5 pass, 0 fail

--- VERDICT ---

PASS — all 75 assertions green (6 live-DB + 24 unit + 41 existing + 5 smoke).