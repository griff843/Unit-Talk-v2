# Distribution Contract

## Metadata

| Field | Value |
|---|---|
| Owner | Architecture |
| Status | Ratified |
| Ratified | 2026-02-01 |
| Last Updated | 2026-03-29 — depth pass UTV2-160 |

---

## Purpose

This contract defines how picks move from the API into Discord delivery: the outbox model, claim/drain semantics, idempotency, delivery receipt requirements, failure classification, retry behavior, and authority boundaries.

---

## Outbox Model

Distribution is initiated from an outbox boundary. The API writes a `distribution_outbox` row when a pick is ready to be delivered. The worker polls the outbox, claims rows, and delivers.

**No service may deliver a pick to Discord without a `distribution_outbox` row.** Direct delivery without outbox enrollment is a governance violation.

### Outbox row lifecycle

```
pending → processing → sent
                    ↘ failed → (retry) → ... → dead_letter
```

| Status | Meaning |
|---|---|
| `pending` | Enqueued by API; not yet claimed |
| `processing` | Claimed by worker for delivery; `claimed_at` and `claimed_by` are set |
| `sent` | Successfully delivered; `distribution_receipts` row exists |
| `failed` | Delivery attempt failed; eligible for retry |
| `dead_letter` | Exhausted retries (`attempt_count >= 3`); requires operator review before any replay |

---

## Claim/Release Semantics

The worker acquires exclusive claim on a `pending` row before delivery:

- `claimed_at` = server timestamp set on claim
- `claimed_by` = worker run ID or idempotency key

A `processing` row older than 5 minutes is considered stale. The stale-claim reaper (UTV2-119) resets stale `processing` rows to `pending` to unblock delivery. This handles worker crashes mid-delivery.

**A row must never be left permanently in `processing`.** If the worker crashes without completing delivery, the reaper is the recovery mechanism — not a manual reset.

---

## Idempotency

Discord operations must be idempotent.

**Outbox idempotency:** `distribution_outbox.idempotency_key` has a unique partial index on `WHERE status IN ('pending', 'processing')`. A new row with the same key cannot be inserted while a prior row for that key is pending or in-flight.

**Important:** Once a row moves to `sent`, `failed`, or `dead_letter`, the partial index no longer protects against a new row with the same key. A replay or re-queue after `sent` would insert successfully and attempt a second delivery. **Always check for a `distribution_receipts` row before any replay operation.**

**Receipt idempotency:** `distribution_receipts.idempotency_key` has its own unique partial index to prevent duplicate receipt writes if the worker retries after partial write failure.

---

## Delivery Receipts

A delivery receipt is the proof of delivery. It is written by the worker after successful Discord delivery.

Required receipt fields:
- `outbox_id` — FK to the outbox row
- `channel` — Discord channel ID the message was posted to
- `idempotency_key` — matches the outbox row key
- `pick_id` — the pick that was delivered (denormalized for query efficiency)

**`picks.status = 'posted'` is not proof of delivery.** Proof requires a `distribution_receipts` row. A pick with `status = 'posted'` but no receipt is in a partial delivery state and must be investigated.

---

## Failure Classification

Delivery failures are classified at the adapter layer (UTV2-148):

| Class | HTTP codes | Behavior |
|---|---|---|
| `terminal-failure` | 4xx except 429 | Immediately sets outbox row to `failed`; does not consume `attempt_count`; operator must investigate |
| `retryable-failure` | 429, 5xx, network error | Increments `attempt_count`; row returns to `pending` for next retry cycle |

A terminal failure from Discord (e.g., channel deleted, bot lacks permissions) will not self-heal via retry. It must be resolved operationally.

---

## Retry and Dead-Letter

- Max retries: 3 (`attempt_count >= 3` → `dead_letter`)
- Dead-letter rows are never automatically retried
- Dead-letter rows must be reviewed by an operator before any replay
- Before replay: check `distribution_receipts` — if a receipt exists, the message was delivered. Do not replay.

---

## Circuit Breaker

The worker maintains a per-target in-process circuit breaker (UTV2-124):

- After `UNIT_TALK_WORKER_CIRCUIT_BREAKER_THRESHOLD` consecutive failures (default: 5), delivery to that target is paused for `UNIT_TALK_WORKER_CIRCUIT_BREAKER_COOLDOWN_MS` (default: 5 minutes)
- Circuit open → `workerRuntime` health signal degrades to `degraded` in the operator snapshot
- Successful delivery resets the failure counter for that target
- Circuit state is in-process only (not persisted); worker restart resets all circuits

---

## Live Delivery Targets

| Target | Channel ID | Status |
|---|---|---|
| `discord:canary` | `1296531122234327100` | Live — permanent control lane |
| `discord:best-bets` | `1288613037539852329` | Live |
| `discord:trader-insights` | `1356613995175481405` | Live |
| `discord:recaps` | `1300411261854547968` | Live |
| `discord:exclusive-insights` | `1288613114815840466` | Blocked — activation contract required |
| `discord:game-threads` | — | Blocked — thread routing not implemented |
| `discord:strategy-room` | — | Blocked — DM routing not implemented |

Delivering to a blocked target is a governance violation. Blocked targets are filtered at the distribution service enqueue step. The target registry (`@unit-talk/contracts`) is the runtime enforcement surface.

---

## Authority Boundaries

- **Only `apps/api` enqueues outbox rows.** No other service, script, or tool may insert into `distribution_outbox`.
- **Only `apps/worker` writes `distribution_receipts`.** API may not write receipts.
- **Pick status transition to `posted` requires a receipt.** The worker updates `picks.status` and writes `pick_lifecycle` only after recording the receipt.

---

## Failure Behavior Summary

| Failure mode | Behavior |
|---|---|
| Supabase unavailable | Worker pauses; row stays `pending` |
| Discord returns 4xx (not 429) | Terminal failure; row → `failed`; no retry |
| Discord returns 429/5xx | Retryable failure; row returns to `pending` |
| Worker crashes mid-delivery | Stale claim reaper resets row to `pending` after 5 min |
| 3 failures exhausted | Row → `dead_letter`; manual operator review required |
| Receipt write fails after delivery | Idempotency key prevents duplicate receipt; outbox resets to `pending`; delivery re-attempted (Discord may receive duplicate — check receipt before replay) |

---

## Audit and Verification

For a legitimately delivered pick, all of the following must be true:

| Signal | Expected |
|---|---|
| `distribution_outbox.status` | `sent` |
| `distribution_receipts` row | present |
| `pick_lifecycle` row with `to_state = 'posted'` | present |
| `picks.status` | `posted` |
| `audit_log` entry for `distribution.sent` | present |

Missing any layer while others are present is a partial delivery state. Use `scripts/pipeline-health.ts` for live pipeline diagnosis.
