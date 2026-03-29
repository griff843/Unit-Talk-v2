# T1 Proof Template — UTV2-124 Discord Circuit Breaker

> Fill in all UNVERIFIED/TODO fields before submitting for T1 close.
> Contract: `docs/05_operations/DISCORD_CIRCUIT_BREAKER_CONTRACT.md`
> Depends on: UTV2-148 (delivery adapter hardening) — must be merged first.

---

## Sprint / Change

```
Sprint:    SPRINT-UTV2-124-CIRCUIT-BREAKER
Tier:      T1
Date:      [fill]
Objective: Per-target in-process circuit breaker for Discord delivery — pause
           delivery to a broken target after N consecutive failures, resume
           after cooldown window expires.
Contract:  docs/05_operations/DISCORD_CIRCUIT_BREAKER_CONTRACT.md
```

## Scope

```
Files expected:
  apps/worker/src/circuit-breaker.ts         (new)
  apps/worker/src/runner.ts                  (modified — WorkerRunnerOptions + per-target loop)
  apps/worker/src/distribution-worker.ts     (modified — WorkerProcessCircuitOpenResult union)
  apps/operator-web/src/server.ts            (modified — workerRuntime degraded on open circuit)
  .env.example                               (modified — two new env vars)

Schema change:       NO
Routing change:      NO
Settlement change:   NO
T1 triggers:         RUNTIME behavior — circuit state bridges to system_runs table;
                     operator health signal changes
```

## Step 0 — Prerequisites

| Gate | Status | Notes |
|------|--------|-------|
| Contract exists | PASS | `docs/05_operations/DISCORD_CIRCUIT_BREAKER_CONTRACT.md` |
| UTV2-148 merged | [PASS/FAIL] | Required blocker — delivery adapter must type failures first |
| `pnpm verify` | [PASS/FAIL] | Run and record |
| Rollback plan | PASS | `docs/06_status/UTV2-124_rollback_template.md` |

## Step 1 — Verification Performed

| Check | Result | Notes |
|-------|--------|-------|
| `pnpm env:check` | [PASS/FAIL] | |
| `pnpm lint` | [PASS/FAIL] | N errors |
| `pnpm type-check` | [PASS/FAIL] | |
| `pnpm build` | [PASS/FAIL] | |
| `pnpm test` | [N/N PASS] | |
| Test delta | [before] → [after] | +N |
| `pnpm test:db` | NOT RUN | No schema migration |
| Runtime flow | NOT RUN | Circuit breaker is in-process state; no pick lifecycle change |
| DB evidence | PARTIAL | `system_runs` rows for circuit open/close events |
| Operator surface | [CHECKED/NOT CHECKED] | `workerRuntime` health signal |

## Step 2 — Code Review Checks

Verify each acceptance criterion is met:

- [ ] `DeliveryCircuitBreaker` class in `apps/worker/src/circuit-breaker.ts`
  - [ ] `isOpen(target)` — returns true if open and cooldown not expired; auto-resets on expiry
  - [ ] `recordFailure(target)` — increments counter; opens at threshold
  - [ ] `recordSuccess(target)` — resets counter and closes circuit
  - [ ] `resumeAt(target)` — returns epoch ms or null
  - [ ] `openTargets()` — lists all currently open targets
- [ ] `WorkerRunnerOptions.circuitBreaker?: DeliveryCircuitBreaker` added
- [ ] `runWorkerCycles` skips open-circuit targets; logs `circuit.opened` JSON with `resumeAt`
- [ ] `recordFailure()` called on every `failed` result; `recordSuccess()` on every `sent` result
- [ ] `WorkerProcessCircuitOpenResult` added to result union
- [ ] `system_runs` row written when circuit opens (`runType: 'worker.circuit-open'`, status `running`)
- [ ] `system_runs` row completed when circuit closes (status `succeeded`)
- [ ] Operator snapshot `workerRuntime` → `degraded` when any `worker.circuit-open` system_runs row unresolved
- [ ] `UNIT_TALK_WORKER_CIRCUIT_BREAKER_THRESHOLD` env var read at startup
- [ ] `UNIT_TALK_WORKER_CIRCUIT_BREAKER_COOLDOWN_MS` env var read at startup

## Step 3 — Evidence

```
Repo / code:
  Commit: [fill — git rev-parse HEAD after merge]
  PR: [fill]
  pnpm verify: [PASS/FAIL] exit [0/N]
  Tests: [before] → [after] (+N)

DB (system_runs):
  circuit.opened row: id=[fill], runType=worker.circuit-open, target=[fill], status=running
  circuit.closed row: id=[fill], status=succeeded (after cooldown + success)
  [OR: NOT RUN if circuit was not triggered in test environment]

Operator surface:
  workerRuntime.health: [healthy/degraded/down] when circuit closed
  workerRuntime.health: degraded when circuit open system_runs row exists
  [CHECKED/NOT CHECKED]
```

## Step 4 — New Tests Required

Confirm these tests exist and pass:

| Test | File | Result |
|------|------|--------|
| 5 consecutive failures → circuit opens → next tick skips target | `worker-runtime.test.ts` | [PASS/FAIL] |
| Success after open+cooldown → circuit resets | `worker-runtime.test.ts` | [PASS/FAIL] |
| `isOpen()` returns false after cooldown expires (time mock) | `circuit-breaker.test.ts` | [PASS/FAIL] |
| `terminal-failure` counts toward circuit (from UTV2-148) | `worker-runtime.test.ts` | [PASS/FAIL] |

## Step 5 — Risks / Exceptions

| # | Description | Severity | Status |
|---|-------------|----------|--------|
| 1 | Circuit state resets on worker restart — a broken target will retry after restart | Low | Accepted by design |
| 2 | `system_runs` bridge requires operator-web to query `worker.circuit-open` rows — coupling between worker and operator health | Low | Accepted — defined in contract |
| 3 | If UTV2-148 is not merged, `terminal-failure` classification is absent and circuit may under-count failures | High | Blocker — verify UTV2-148 merged before proof |

## Step 6 — Rollback

See `docs/06_status/UTV2-124_rollback_template.md`.

**Invalidation conditions:**
- Test count drops below pre-UTV2-124 baseline
- Worker logs show circuit opening on healthy targets (false positive — threshold too low)
- Operator snapshot `workerRuntime` stuck in `degraded` after circuit should have closed
- `system_runs` rows for `worker.circuit-open` not being completed after successful delivery

---

## Verdict

```
[ ] READY FOR T1 CLOSE
[ ] READY WITH EXCEPTIONS — list exceptions:
[ ] NOT READY — blockers:
```

**Next action:** [fill]
