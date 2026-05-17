# UTV2-936 Diff Summary

**Branch:** claude/utv2-936-automated-recovery
**HEAD SHA:** 4535b4e73f50ac2915d70cce28727ae52f74b391
**Base:** main

## Files Changed (10)

| File | Change |
|------|--------|
| `apps/worker/src/automated-recovery.ts` | NEW — automated recovery module |
| `apps/worker/src/runner.ts` | Modified — integrate sweep into cycle loop |
| `apps/worker/src/index.ts` | Modified — startup warning + dashboard indicator |
| `apps/worker/src/worker-automated-recovery.test.ts` | NEW — 24 unit tests |
| `apps/worker/src/t1-proof-automated-recovery.test.ts` | NEW — 6 live-DB proof tests |
| `apps/worker/src/worker-runtime.test.ts` | Modified — add new interface methods to FakeOutboxRepository |
| `packages/db/src/repositories.ts` | Modified — add `listForAutoRecovery` + `resetForAutoRecovery` to OutboxRepository |
| `packages/db/src/runtime-repositories.ts` | Modified — InMemory + Database implementations |
| `.lane/lanes/runtime.yml` | Modified — add `docs/06_status/proof/**` to allowed paths |
| `docs/06_status/lanes/UTV2-936.json` | Modified — scope lock and proof paths |

## Scope

- Worker delivery path only — no changes to API, ingestor, or other apps
- No schema migrations
- No contracts changes
- No behavioral changes to delivery logic — recovery is a separate, opt-in sweep

## Safety Properties

- Default disabled (`AUTOMATED_RECOVERY_ENABLED` defaults to false)
- Denylist-first eligibility: FK violations, lifecycle invariants, settlement mismatches, unknown errors → never recovered
- Attempt ceiling: rows with `attempt_count >= 3` not returned by query
- Conditional update idempotency: `resetForAutoRecovery` uses `.eq('status', expectedStatus)` — no double-recovery
- Kill-switch: `isEnabled()` checked before each row, not just at sweep start
- Full audit: every recovery writes `distribution.auto_recovered` with actor=system, correlation ID, original error, outcome