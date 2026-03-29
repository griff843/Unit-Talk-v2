# Discord Delivery Circuit Breaker Contract

**Status:** RATIFIED 2026-03-29
**Lane:** claude (contract) — codex (implementation: UTV2-124)
**Authority:** Defines circuit breaker semantics for Discord delivery in `apps/worker`.
**Depends on:** DELIVERY_ADAPTER_HARDENING_CONTRACT.md (UTV2-148 must land first)

---

## Problem

If Discord is degraded or a channel is deleted, the worker retries delivery on every poll tick, burning through `attempt_count` until rows hit `dead_letter` (3 failures). With a 5-second poll interval and multiple targets, a single dead channel creates constant Discord API noise and fills the dead-letter queue rapidly.

There is no per-target pause mechanism — no way to detect "Discord delivery to this target is systemically broken" vs "this one row failed."

---

## Circuit Breaker Semantics

The circuit breaker is **in-process state only** (not DB-persisted at this tier). State resets on worker restart.

### States

| State | Meaning |
|-------|---------|
| `closed` | Normal — delivery proceeds |
| `open` | Paused — delivery to this target is skipped until cooldown expires |

No half-open state at this tier. The circuit transitions directly from open → closed after the cooldown window passes and a successful delivery occurs.

### Thresholds (defaults, all env-configurable)

| Parameter | Env Var | Default |
|-----------|---------|---------|
| Consecutive failures to open | `UNIT_TALK_WORKER_CIRCUIT_BREAKER_THRESHOLD` | `5` |
| Cooldown window (ms) | `UNIT_TALK_WORKER_CIRCUIT_BREAKER_COOLDOWN_MS` | `300000` (5 min) |

---

## Implementation Spec

### New file: `apps/worker/src/circuit-breaker.ts`

```typescript
export interface CircuitBreakerOptions {
  threshold?: number;        // consecutive failures to open (default: 5)
  cooldownMs?: number;       // ms before attempting again (default: 300_000)
}

export interface CircuitState {
  consecutiveFailures: number;
  openedAt: number | null;   // Date.now() when opened, null if closed
}

export class DeliveryCircuitBreaker {
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly state: Map<string, CircuitState> = new Map();

  constructor(options: CircuitBreakerOptions = {}) {
    this.threshold = options.threshold ?? 5;
    this.cooldownMs = options.cooldownMs ?? 300_000;
  }

  /** Returns true if delivery to this target should be skipped. */
  isOpen(target: string): boolean {
    const s = this.state.get(target);
    if (!s || s.openedAt === null) return false;
    // Still cooling down?
    if (Date.now() - s.openedAt < this.cooldownMs) return true;
    // Cooldown expired — auto-reset to allow a probe
    this.reset(target);
    return false;
  }

  /** Call after every delivery failure (retryable or terminal). */
  recordFailure(target: string): void {
    const s = this.state.get(target) ?? { consecutiveFailures: 0, openedAt: null };
    s.consecutiveFailures += 1;
    if (s.consecutiveFailures >= this.threshold && s.openedAt === null) {
      s.openedAt = Date.now();
      // Caller is responsible for logging the open event
    }
    this.state.set(target, s);
  }

  /** Call after every successful delivery. Resets the counter and closes the circuit. */
  recordSuccess(target: string): void {
    this.reset(target);
  }

  /** Returns the estimated resume time (epoch ms) for an open circuit, or null if closed. */
  resumeAt(target: string): number | null {
    const s = this.state.get(target);
    if (!s || s.openedAt === null) return null;
    return s.openedAt + this.cooldownMs;
  }

  /** Returns all currently open targets. */
  openTargets(): string[] {
    return [...this.state.entries()]
      .filter(([, s]) => s.openedAt !== null && Date.now() - s.openedAt < this.cooldownMs)
      .map(([target]) => target);
  }

  private reset(target: string): void {
    this.state.set(target, { consecutiveFailures: 0, openedAt: null });
  }
}
```

### Integration: `runWorkerCycles()` in `runner.ts`

Add `circuitBreaker?: DeliveryCircuitBreaker` to `WorkerRunnerOptions`. If absent, a default-configured instance is created.

```typescript
export interface WorkerRunnerOptions {
  repositories: RepositoryBundle;
  workerId: string;
  targets: string[];
  deliver: DeliveryAdapter;
  circuitBreaker?: DeliveryCircuitBreaker;   // ← add
  maxCycles?: number | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  pollIntervalMs?: number | undefined;
}
```

In the per-target loop inside `runWorkerCycles`:

```typescript
const cb = options.circuitBreaker ?? new DeliveryCircuitBreaker({
  threshold: readCircuitBreakerThreshold(),
  cooldownMs: readCircuitBreakerCooldownMs(),
});

for (const target of options.targets) {
  if (cb.isOpen(target)) {
    // Log skip — once per open event, not every tick (caller tracks this)
    results.push({ status: 'circuit-open', target, workerId: options.workerId });
    continue;
  }

  const result = await processNextDistributionWork(
    options.repositories, target, options.workerId, options.deliver,
  );

  if (result.status === 'failed') {
    cb.recordFailure(target);
    if (cb.isOpen(target)) {
      console.log(JSON.stringify({
        event: 'circuit.opened',
        target,
        workerId: options.workerId,
        resumeAt: new Date(cb.resumeAt(target)!).toISOString(),
      }));
    }
  } else if (result.status === 'sent') {
    cb.recordSuccess(target);
  }
  // 'idle' and 'skipped' do not affect the circuit state

  results.push(result);
}
```

### New result type

Add to `WorkerProcessResult` union in `distribution-worker.ts`:

```typescript
export interface WorkerProcessCircuitOpenResult {
  status: 'circuit-open';
  target: string;
  workerId: string;
}

export type WorkerProcessResult =
  | WorkerProcessIdleResult
  | WorkerProcessSuccessResult
  | WorkerProcessSkippedResult
  | WorkerProcessFailureResult
  | WorkerProcessCircuitOpenResult;   // ← add
```

### Operator Snapshot Health

In `apps/operator-web/src/server.ts`, the `workerRuntime` health signal should degrade to `'degraded'` when any circuit is open.

**However:** the operator-web is read-only and does not have access to the worker's in-process circuit breaker state. The bridge is a new optional field on the existing worker health log / `system_runs` details.

When the worker logs `circuit.opened`, it should also write a `system_runs` record with:
```typescript
{
  runType: 'worker.circuit-open',
  actor: workerId,
  details: { target, openedAt, resumeAt },
}
```

The operator-web snapshot builder checks for `system_runs` rows with `runType = 'worker.circuit-open'` and `status = 'running'` (meaning not yet resolved) to determine `degraded` health.

When the circuit closes (cooldown expires + first success), complete that `system_runs` row as `succeeded`.

**Alternative (simpler for T1 scope):** The Linear AC says "Operator snapshot `workerRuntime` health signal degrades to `degraded` when any circuit is open." If wiring through `system_runs` is too heavy for T1, the worker can expose `openTargets()` via a JSON log line that the operator reads from process stdout — but this requires operator-web to tail logs, which it does not currently do. **Use the `system_runs` bridge.**

---

## Env Var Reference

Add to `.env.example`:

```
UNIT_TALK_WORKER_CIRCUIT_BREAKER_THRESHOLD=5
UNIT_TALK_WORKER_CIRCUIT_BREAKER_COOLDOWN_MS=300000
```

---

## Acceptance Criteria (UTV2-124)

- [ ] `apps/worker/src/circuit-breaker.ts` — `DeliveryCircuitBreaker` class
- [ ] `WorkerRunnerOptions.circuitBreaker?: DeliveryCircuitBreaker` added
- [ ] `runWorkerCycles` skips delivery to open-circuit targets
- [ ] `recordFailure()` called on every `failed` result; `recordSuccess()` on every `sent` result
- [ ] Circuit opens after N consecutive failures; logs `circuit.opened` JSON with `resumeAt`
- [ ] Cooldown expiry auto-resets circuit (probe allowed after cooldown)
- [ ] `WorkerProcessCircuitOpenResult` added to result union
- [ ] `system_runs` row written when circuit opens; completed when circuit closes
- [ ] Operator snapshot `workerRuntime` shows `degraded` when any circuit-open `system_runs` row is unresolved
- [ ] `UNIT_TALK_WORKER_CIRCUIT_BREAKER_THRESHOLD` and `UNIT_TALK_WORKER_CIRCUIT_BREAKER_COOLDOWN_MS` env vars read at startup
- [ ] `pnpm verify` passes
- [ ] New test: 5 consecutive failures → circuit opens → next tick skips target
- [ ] New test: success after open+cooldown → circuit resets

---

## Out of Scope

- Half-open / probe state (future hardening)
- Persisting circuit state across worker restarts
- Per-channel vs per-target granularity (targets are the right unit at this tier)
- Alerting on circuit open (future — can be wired into AlertAgent once this is stable)

---

## Sequencing

This contract depends on DELIVERY_ADAPTER_HARDENING_CONTRACT.md (UTV2-148). The circuit breaker counts failures from `WorkerProcessResult.status === 'failed'`, which requires UTV2-148's typed `DeliveryOutcome` to be in place so that terminal failures are correctly routed.

Implement UTV2-148 first, then UTV2-124 on top.
