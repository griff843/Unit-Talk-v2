# T1 Evidence Bundle — UTV2-938 Formal Invariant Verification

**Issue:** UTV2-938  
**Tier:** T1  
**Branch:** claude/utv2-938-formal-invariant-verification  
**Bundle generated:** 2026-05-17  
**Branch HEAD SHA (at proof run):** 3619711eee89fcba7a8bdc6026f0295924e90c22

---

## 1. Summary

Exhaustive lifecycle FSM invariant verification across DB, domain, and API layers:

- **`packages/db/src/lifecycle-exhaustive.test.ts`** — 68 tests covering all 49 (from, to) state pairs from the contracts matrix. Allowed transitions succeed; forbidden transitions throw `InvalidTransitionError` with correct `fromState`/`toState` properties. Also tests `atomicClaim` returns `claimed:false` for terminal→any.
- **`packages/db/src/settlement-invariants.test.ts`** — 12 tests for `assertSettlementCorrectionReference` guard: self-reference rejection, non-existent reference rejection, idempotency, and `InMemorySettlementRepository` correction path.
- **`apps/api/src/t1-proof-lifecycle-invariants.test.ts`** — 8 live-DB proof tests against real Supabase, verifying terminal states, skip-transitions, DB/TS matrix parity, and governance brake path.

**Total: 88 tests, 0 failures.**

---

## 2. Live-DB Proof Output

```
UNIT_TALK_APP_ENV=local npx tsx --test apps/api/src/t1-proof-lifecycle-invariants.test.ts

✔ [live-db] settled rejects all outbound transitions (1720.2379ms)
✔ [live-db] voided rejects all outbound transitions (1026.4756ms)
✔ [live-db] draft cannot skip to queued (280.4096ms)
✔ [live-db] validated cannot jump to posted (must queue first) (470.1868ms)
✔ [live-db] awaiting_approval cannot bypass queued (669.2455ms)
✔ [live-db] happy path draft->validated->queued->posted->settled (932.8975ms)
✔ [live-db] governance brake path validated->awaiting_approval->queued->posted (936.8577ms)
✔ [live-db] any state can be voided (748.1237ms)
ℹ tests 8
ℹ pass 8
ℹ fail 0
ℹ duration_ms 7254.0932
```

---

## 3. Static Test Suite

```
packages/db/src/lifecycle-exhaustive.test.ts: 68 pass, 0 fail
packages/db/src/settlement-invariants.test.ts: 12 pass, 0 fail
```

---

## 4. Invariants Verified

### 4.1 Terminal State Rejection (DB layer)
- `settled → *` (all 7 states): throws `InvalidTransitionError` for every attempted outbound transition
- `voided → *` (all 7 states): throws `InvalidTransitionError` for every attempted outbound transition

### 4.2 Skip-Transition Rejection (DB layer)
- `draft → queued`: rejected; `InvalidTransitionError.fromState='draft', toState='queued'`
- `validated → posted`: rejected; `InvalidTransitionError.fromState='validated', toState='posted'`
- `awaiting_approval → posted`: rejected; `InvalidTransitionError.fromState='awaiting_approval', toState='posted'`

### 4.3 DB/TS Matrix Parity — Allowed Transitions
All 11 allowed transitions from `pickLifecycleTransitions` succeed end-to-end:
- `draft → validated`, `draft → voided`
- `validated → queued`, `validated → awaiting_approval`, `validated → voided`
- `awaiting_approval → queued`, `awaiting_approval → voided`
- `queued → posted`, `queued → voided`
- `posted → settled`, `posted → voided`

### 4.4 Governance Brake Path
- `draft → validated → awaiting_approval → queued → posted`: all transitions succeed with correct `lifecycleState` returned

### 4.5 FSM Contract Parity
- `pickLifecycleTransitions` in `@unit-talk/contracts` is the single source of truth
- `getAllowedLifecycleTransitions()` in `@unit-talk/db/lifecycle.ts` delegates to it
- Exhaustive test enumerates all 49 (from, to) pairs from the contracts matrix

---

## 5. Scope

**Files changed:**
- `packages/db/src/lifecycle-exhaustive.test.ts` (new — 68 tests)
- `packages/db/src/settlement-invariants.test.ts` (new — 12 tests)
- `apps/api/src/t1-proof-lifecycle-invariants.test.ts` (new — 8 live-DB tests)
- `package.json` (test suite wiring)
- `docs/06_status/lanes/UTV2-938.json` (lane manifest)
- `.ops/sync/UTV2-938.yml` (per-issue sync)
- `docs/06_status/proof/UTV2-938/` (this bundle)

**No schema migrations. No behavioral changes to lifecycle FSM. Tests only.**

---

## 6. R-Level Compliance

No R-level artifacts required for this issue (pure test additions, no production code changes).

---

## 7. Supabase Project

Project ref: `zfzdnfwdarxucxtaojxm`  
Test fixtures: prefixed `utv2-938-*` — NOT deleted per T1 proof policy.
