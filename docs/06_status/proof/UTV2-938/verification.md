UTV2-938 Formal Invariant Verification — Live-DB Proof Log

## Verification

This markdown file preserves the lane verification evidence in a gate-visible proof artifact.

==========================================================
Date: 2026-05-17
Branch: claude/utv2-938-formal-invariant-verification
Branch HEAD SHA: 3619711eee89fcba7a8bdc6026f0295924e90c22
Supabase project: zfzdnfwdarxucxtaojxm
Executor: Claude (claude-sonnet-4-6)

--- LIVE-DB PROOF (8 tests) ---

Command: UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-lifecycle-invariants.test.ts

✔ [live-db] settled rejects all outbound transitions (1720.2379ms)
✔ [live-db] voided rejects all outbound transitions (1026.4756ms)
✔ [live-db] draft cannot skip to queued (280.4096ms)
✔ [live-db] validated cannot jump to posted (must queue first) (470.1868ms)
✔ [live-db] awaiting_approval cannot bypass queued (669.2455ms)
✔ [live-db] happy path draft->validated->queued->posted->settled (932.8975ms)
✔ [live-db] governance brake path validated->awaiting_approval->queued->posted (936.8577ms)
✔ [live-db] any state can be voided (748.1237ms)
tests: 8 | pass: 8 | fail: 0 | duration: 7254ms

--- STATIC SUITE ---

packages/db/src/lifecycle-exhaustive.test.ts:   68 pass, 0 fail
packages/db/src/settlement-invariants.test.ts:  12 pass, 0 fail

--- VERDICT ---

PASS — all 88 assertions green against real Supabase.
