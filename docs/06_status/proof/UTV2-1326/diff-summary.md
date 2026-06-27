# Diff Summary — UTV2-1326 settle_pick_atomic timeout

**Lane:** UTV2-1326
**Tier:** T2 runtime
**Branch:** claude/utv2-1326-settle-pick-atomic-timeout
**Generated at:** 2026-06-27

---

## Scope

Runtime investigation + narrow fix. Inspects `settle_pick_atomic` Postgres RPC, identifies timeout root cause, implements application-layer retry in `DatabaseSettlementRepository`. No schema migration. No settlement behavior changes for non-timeout paths.

---

## Files Changed

### packages/db/src/runtime-repositories.ts (MODIFIED)

Two targeted changes to `DatabaseSettlementRepository`:

1. **`isStatementTimeoutError()` helper** (added above `DatabaseSubmissionRepository`):
   - Matches PostgreSQL error code `57014` or message containing "statement timeout"

2. **`settlePickAtomic()` retry** (lines 4296–4345):
   - Extracted RPC params to `const params` for reuse
   - Added single retry with 500ms backoff on `isStatementTimeoutError(error)`
   - All other error paths unchanged — business logic errors (INVALID_SETTLEMENT_TRANSITION etc.) throw immediately without retry

---

## Root Cause Summary

| Factor | Detail |
|---|---|
| Lock held | picks FOR UPDATE from step 2 through commit (5 writes) |
| Primary amplifier | audit_log write pressure (3 indexes + trigger) under peak load |
| Secondary amplifier | picks index contention (8 indexes) during batch grading settlement |
| Not the cause | Query shape, partition scans, missing indexes |
| Reproducible now? | No — 0 post-Phase7A settlements; system_runs cleanup cleared load |

---

## Fix Safety

| Property | Assessment |
|---|---|
| Atomic RPC rollback on timeout | YES — PostgreSQL 57014 = statement cancelled, transaction rolled back |
| Retry idempotency | YES — duplicate check at step 1 catches re-submission |
| Double-settlement risk | NONE — unique index on (pick_id, source WHERE corrects_id IS NULL) enforced |
| Schema change required | NO |
| Existing tests affected | NO — 113/113 unit + 7/7 test:db pass |

---

## Merge SHA Binding

**Merge SHA:** `a24e05f78c17ac2c08b5c590cd32052e7cd41b65`
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/1086
**Merged at:** 2026-06-27
