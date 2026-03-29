# Delivery Adapter Hardening Contract

**Status:** RATIFIED 2026-03-29
**Lane:** claude (contract) — codex (implementation: UTV2-148)
**Authority:** Defines the typed `DeliveryResult` contract and error classification rules for `apps/worker`.

---

## Problem

`DeliveryResult.status` is `string` — untyped. The Discord adapter throws on any non-2xx response, which forces the worker into the same catch/retry path for a deleted channel (unrecoverable) as for a rate-limit (recoverable). This wastes attempt_count on permanently broken targets and masks the difference between Discord outages and misconfigured channels.

Current state (`apps/worker/src/distribution-worker.ts:10-17`):
```typescript
export interface DeliveryResult {
  receiptType: string;
  status: string;           // ← untyped
  channel?: string;
  externalId?: string;
  idempotencyKey?: string;
  payload: Record<string, unknown>;
}
```

Current state (`delivery-adapters.ts:75-78`):
```typescript
if (!response.ok) {
  const errorText = await response.text();
  throw new Error(`Discord delivery failed: ${response.status} ${errorText}`);
  // ← throws for ALL failures — no classification
}
```

---

## Typed DeliveryResult

Replace the existing `DeliveryResult` interface in `apps/worker/src/distribution-worker.ts`:

```typescript
export type DeliveryOutcome = 'sent' | 'retryable-failure' | 'terminal-failure';

export interface DeliveryResult {
  receiptType: string;
  status: DeliveryOutcome;         // ← typed
  channel?: string | undefined;
  externalId?: string | undefined;
  idempotencyKey?: string | undefined;
  reason?: string | undefined;     // ← populated on failure
  payload: Record<string, unknown>;
}
```

**`DeliveryAdapter` type** (in `runner.ts`) remains `(outbox: OutboxRecord) => Promise<DeliveryResult>` — the signature does not change, only the return type tightens.

---

## Discord Error Classification

In `createDiscordDeliveryAdapter()` (`delivery-adapters.ts`), replace the current `throw` with typed result returns:

```typescript
if (!response.ok) {
  const errorText = await response.text();
  const isTerminal = response.status >= 400 && response.status < 500 && response.status !== 429;

  return {
    receiptType: 'discord.message',
    status: isTerminal ? 'terminal-failure' : 'retryable-failure',
    channel: `discord:${channelId}`,
    reason: `HTTP ${response.status}: ${errorText}`,
    payload: {
      adapter: 'discord',
      dryRun: false,
      target: outbox.target,
      outboxId: outbox.id,
      channelId,
      httpStatus: response.status,
    },
  };
}
```

Classification rules:

| HTTP Status | Class | Rationale |
|---|---|---|
| 4xx (except 429) | `terminal-failure` | Bad channel ID, missing permissions, unknown message type — not recoverable by retrying |
| 429 | `retryable-failure` | Rate limit — recoverable with backoff |
| 5xx | `retryable-failure` | Discord outage — transient |
| Network error (fetch throws) | `retryable-failure` | Connectivity — transient |

Network errors (`fetch` throws before a response is received) should be caught and returned as `retryable-failure`:

```typescript
try {
  const response = await fetchImpl(...);
  // classification logic above
} catch (networkError) {
  return {
    receiptType: 'discord.message',
    status: 'retryable-failure',
    channel: `discord:${channelId}`,
    reason: networkError instanceof Error ? networkError.message : 'network error',
    payload: { adapter: 'discord', dryRun: false, target: outbox.target, outboxId: outbox.id, channelId },
  };
}
```

---

## Worker Behavior Changes

In `processNextDistributionWork()` (`distribution-worker.ts`), the current catch block handled all failures the same way. With typed results, delivery no longer throws — the worker inspects `delivery.status` instead:

```typescript
const delivery = await deliver(claimed);

if (delivery.status === 'terminal-failure') {
  // Skip remaining attempts — mark as dead_letter immediately
  const failed = await repositories.outbox.markFailed(claimed.id, delivery.reason ?? 'terminal failure');
  const finalOutbox = await repositories.outbox.markDeadLetter(claimed.id, delivery.reason ?? 'terminal failure');
  // ... complete run as 'failed', write distribution.dead_lettered audit
  return { status: 'failed', target, workerId, outbox: finalOutbox, run: completedRun };
}

if (delivery.status === 'retryable-failure') {
  // Existing retry logic: markFailed, dead-letter only if attempt_count >= 3
  const failed = await repositories.outbox.markFailed(claimed.id, delivery.reason ?? 'retryable failure');
  const shouldDeadLetter = failed.attempt_count >= 3;
  // ... same as current catch block
  return { status: 'failed', target, workerId, outbox: finalOutbox, run: completedRun };
}

// delivery.status === 'sent' — existing success path unchanged
```

The existing `try/catch` in `processNextDistributionWork` should remain for unexpected throws (e.g., repository errors), but delivery adapter errors are now returned, not thrown.

---

## Dry-Run Mode

`dryRun` is already a constructor parameter in `createDiscordDeliveryAdapter()` (line 51). No change needed — the dry-run boundary is correct as-is.

---

## Acceptance Criteria (UTV2-148)

- [ ] `DeliveryOutcome` type exported from `distribution-worker.ts`
- [ ] `DeliveryResult.status` typed as `DeliveryOutcome` (not `string`)
- [ ] `DeliveryResult.reason?: string` field added
- [ ] Discord adapter returns typed results instead of throwing for HTTP errors
- [ ] Discord adapter classifies: 4xx (except 429) = `terminal-failure`; 429/5xx/network = `retryable-failure`
- [ ] Worker immediately dead-letters on `terminal-failure` (no attempt_count burn)
- [ ] Worker retries normally on `retryable-failure` (existing attempt_count logic preserved)
- [ ] `pnpm verify` passes
- [ ] New tests: `terminal-failure` (400) → immediate dead-letter; `retryable-failure` (429) → normal retry; `sent` → success path unchanged

---

## Out of Scope

- Circuit breaker (that is UTV2-124 — depends on this contract)
- Changing `attempt_count` limits
- Adding retry delays or backoff inside the adapter
- Any changes to stub adapter behavior

---

## Sequencing Note

UTV2-124 (circuit breaker) depends on this contract. Implement UTV2-148 first. The circuit breaker in UTV2-124 will use the per-target failure count and should count both `retryable-failure` and `terminal-failure` results toward the consecutive failure threshold.
