# T1 Evidence Bundle — UTV2-936 Automated Recovery Workflows

**Issue:** UTV2-936
**Tier:** T1
**Branch:** claude/utv2-936-automated-recovery
**Bundle generated:** 2026-05-17
**Branch HEAD SHA (at proof run):** 4535b4e73f50ac2915d70cce28727ae52f74b391

---

## 1. Summary

Automated recovery workflows for the worker delivery pipeline, guarded by 6 PM-specified safety constraints:

- **`apps/worker/src/automated-recovery.ts`** — Core module: fail-closed flag, denylist-first eligibility classifier, durable conditional update, full audit emission
- **`apps/worker/src/runner.ts`** — Runner integration: sweep runs each cycle before delivery loop; startup warning logged when enabled
- **`packages/db/src/repositories.ts`** + **`runtime-repositories.ts`** — `listForAutoRecovery` (DB-filtered query) + `resetForAutoRecovery` (conditional update, returns null on race)
- **`apps/worker/src/worker-automated-recovery.test.ts`** — 24 unit tests covering eligibility, denylist, allowlist, no-op, recovery, audit, duplicate prevention, kill-switch
- **`apps/worker/src/t1-proof-automated-recovery.test.ts`** — 6 live-DB proof tests against real Supabase

**Total: 75 assertions (6 live-DB + 24 unit + 41 existing worker-runtime + 5 smoke), 0 failures.**

---

## 2. PM Constraint Compliance

| Constraint | Implementation |
|-----------|----------------|
| Fail-closed by default | `AUTOMATED_RECOVERY_ENABLED` env var, defaults false; startup warning when enabled; `autoRecoveryEnabled` in runtime summary |
| Idempotent | `resetForAutoRecovery` uses conditional `.eq('status', expectedStatus)` — returns null if row already recovered; `attempt_count` ceiling prevents infinite loops |
| Full auditability | `actor='system.automated-recovery'`, `action='distribution.auto_recovered'`, `correlationId`, `recoveryReason`, `originalFailureReason`, `replayTarget`, `recoveredAt`, `recoveryOutcome`, `attemptCountBefore`, `previousStatus` |
| Explicit denylist | FK violations, lifecycle invariants, unique constraints, schema drift, check constraints, unknown errors — all blocked before allowlist check |
| Kill-switch test-proven | `isEnabled()` callback checked before each row iteration; disabled mid-sweep halts immediately; test: "kill-switch: mid-run disable leaves subsequent rows unprocessed" |
| Scope discipline | Only `failed`/`dead_letter` rows with transient `last_error` under attempt ceiling; 6 PM-specified allowlist patterns only |

---

## 3. Live-DB Proof Output

```
UNIT_TALK_APP_ENV=local npx tsx --test apps/worker/src/t1-proof-automated-recovery.test.ts

✔ [live-db] recovery disabled: sweep is no-op (3.0505ms)
✔ [live-db] eligible transient error row reset to pending with audit (955.3782ms)
✔ [live-db] denylist: FK violation row not eligible for recovery (665.7936ms)
✔ [live-db] listForAutoRecovery respects attempt ceiling (114.5982ms)
✔ [live-db] idempotency: audit written exactly once per recovery (597.3341ms)
✔ [live-db] kill-switch: disabled recovery is always a no-op (0.2262ms)
ℹ tests 6
ℹ pass 6
ℹ fail 0
ℹ duration_ms 2978.1851
```

---

## 4. Static Test Suite

```
apps/worker/src/worker-automated-recovery.test.ts: 24 pass, 0 fail
apps/worker/src/worker-runtime.test.ts:            41 pass, 0 fail
```

---

## 5. Invariants Verified

### 5.1 Fail-Closed Default
- `AUTOMATED_RECOVERY_ENABLED` unset → `isRecoveryEnabled()` returns false → sweep returns `{ recovered:0, skipped:0 }`
- Startup warning logged when enabled; `autoRecoveryEnabled` visible in runtime summary JSON

### 5.2 Denylist-First Eligibility
Blocked patterns (checked before allowlist, case-insensitive):
- `schema drift`, `foreign key`, `fk violation`, `lifecycle invariant`, `invalidtransitionerror`, `invalid transition`, `settlement mismatch`, `proof failure`, `business rule`, `check constraint`, `unique constraint`, `duplicate key`, `violates`

Allowed patterns (transient infrastructure only):
- `fetch failed`, `TypeError: fetch`, `ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`, `502`, `503`, `504`, `521`, `429`, `Bad gateway`, `Service Unavailable`, `Web server is down`, `<!DOCTYPE`

Unknown errors that match neither list: NOT recoverable.

### 5.3 Idempotency
- `resetForAutoRecovery(id, expectedStatus)` uses conditional update: `.eq('status', expectedStatus)` — returns `null` if row was already recovered
- `attempt_count >= MAX_AUTO_RECOVERY_ATTEMPTS (3)`: row not returned by `listForAutoRecovery`
- Live-DB test: second sweep on recovered row produces exactly 1 audit record total

### 5.4 Kill-Switch
- `isEnabled()` callback checked at sweep start AND before each row
- Live-DB: disabled recovery always returns `{ recovered:0 }`
- Unit test: mid-run disable leaves subsequent rows in their original state

### 5.5 Audit Completeness
Every recovery emits an audit row with:
- `actor: 'system.automated-recovery'`
- `action: 'distribution.auto_recovered'`
- `entityType: 'distribution_outbox'`
- `entityId: outboxId`
- `entityRef: pickId`
- `payload.correlationId`, `recoveryReason`, `originalFailureReason`, `replayTarget`, `recoveredAt`, `recoveryOutcome`, `attemptCountBefore`, `previousStatus`

---

## 6. Scope

**Files changed:**
- `apps/worker/src/automated-recovery.ts` (new)
- `apps/worker/src/runner.ts` (modified — sweep integration)
- `apps/worker/src/index.ts` (modified — startup warning + dashboard indicator)
- `apps/worker/src/worker-automated-recovery.test.ts` (new — 24 tests)
- `apps/worker/src/t1-proof-automated-recovery.test.ts` (new — 6 live-DB tests)
- `apps/worker/src/worker-runtime.test.ts` (modified — new interface methods)
- `packages/db/src/repositories.ts` (new interface methods)
- `packages/db/src/runtime-repositories.ts` (InMemory + Database implementations)
- `.lane/lanes/runtime.yml` (allowed proof paths)
- `docs/06_status/lanes/UTV2-936.json` (manifest)

**No schema migrations. No delivery logic changes. No Tier C contracts changes.**

---

## 7. R-Level Compliance

```
Verdict: PASS
Changed files: 13
Rules matched: lifecycle-fsm
Advisory (PM-gated) artifacts missing:
  - r4-fault-report [PM-gated]
```

R4 fault report is PM-gated advisory (not required for merge).

---

## 8. Supabase Project

Project ref: `zfzdnfwdarxucxtaojxm`
Test fixtures: prefixed `utv2-936-*` — NOT deleted per T1 proof policy.