# Queue Readiness Semantics — Unit Talk V2

**Version:** 1.0  
**Authority:** PM-ratified (UTV2-1320)  
**Status:** ACTIVE  
**Last updated:** 2026-06-25

---

## Problem Statement

Raw queue counts are misleading for readiness decisions. A `dead_letter_count = 946` looks like 946 delivery failures, but as of 2026-06-25 every one of those 946 rows has `attempt_count = 0` — meaning they were never attempted, only governance-held. Similarly, `pending > 30min = 594` looks like 594 stuck rows, but all are Phase 7A governance holds.

This document encodes the canonical bucket taxonomy for interpreting queue state in readiness ledgers, CI gates, and any monitoring that reports on `distribution_outbox` and `dead_letter` tables.

**No queue mutation. No row edits. No backfill.** This is a classification and semantic document only.

---

## Canonical Queue Bucket Taxonomy

Every row in `distribution_outbox` (pending/processing) and `dead_letter` maps to exactly one of these buckets. Buckets are mutually exclusive and exhaustive.

### Bucket 1: Governance-Held

**Definition:** Row has `attempt_count = 0` and `status IN ('pending', 'processing', 'dead_letter')`. The outbox worker read the row, determined the pick is under a Phase 7A governance brake (`awaiting_approval` lifecycle state), and held delivery without attempting it. This is correct behavior — not a failure.

**Readiness impact:** NONE. Governance holds do not count as delivery failures, stuck rows, or operational blockers.

**Evidence marker in readiness ledger:** `bucket: "governance_hold"`, `attempt_count: 0`

**Current count (2026-06-25 baseline):**
- Pending >30min: 594 (351 `discord:canary`, 243 `discord:best-bets`) — all governance holds
- Dead-letter: 946 — all governance holds (`attempt_count = 0`)

---

### Bucket 2: Canary-Only

**Definition:** Row targets a delivery channel that is canary-scoped (channel type = `discord:canary` or equivalent). The row may have `attempt_count > 0` but is intentionally restricted to the canary target only. Delivery to public targets is blocked by channel scope, not by failure.

**Readiness impact:** NONE for launch-readiness assessment. Canary delivery is authorized and expected.

**Evidence marker:** `channel_type: "discord:canary"` or `channel_type: "discord:best-bets"`

---

### Bucket 3: Deferred

**Definition:** Row has been explicitly deferred by the system or PM directive. `attempt_count = 0` AND there is an explicit deferral record (e.g., a governance decision not to deliver this pick). Distinct from governance-hold in that deferral is intentional future-disposition rather than brake-enforcement.

**Readiness impact:** NONE. Deferred rows are a PM decision outcome.

**Evidence marker:** `status: 'deferred'` (if column exists) or governance record referencing the row.

---

### Bucket 4: Retryable

**Definition:** Row has `attempt_count > 0` AND `attempt_count < max_attempts` AND `status = 'pending'` (eligible for retry). The row has had delivery attempted but failed transiently, and the system has not exhausted retries. The circuit breaker has not tripped.

**Readiness impact:** LOW. Normal transient retry behavior. Only becomes a concern if count is growing unbounded or retries are chronically failing.

**Evidence marker:** `attempt_count BETWEEN 1 AND max_attempts - 1`, `status = 'pending'`

---

### Bucket 5: Stale-Unknown

**Definition:** Row has been in `processing` status for longer than the expected processing window (typically >5 minutes) with no disposition. This could indicate a stuck worker, a timeout that didn't properly DLQ the row, or an orphaned processing lock. Requires investigation but is NOT necessarily a delivery failure.

**Readiness impact:** MEDIUM. Stale-unknown rows should be investigated. They may self-resolve when the worker restarts or times out; they are not automatically failures.

**Evidence marker:** `status = 'processing'` AND `updated_at < NOW() - INTERVAL '5 minutes'`

---

### Bucket 6: True Delivery Failure

**Definition:** Row has `attempt_count >= max_attempts` AND `status = 'dead_letter'`. The outbox worker attempted delivery the maximum number of times and all attempts failed. The row was moved to dead-letter queue because of actual delivery failure, not governance holds.

**Readiness impact:** HIGH. True delivery failures are operational failures and should fail the `dead_letter_count` readiness dimension if count > 0.

**Evidence marker:** `attempt_count >= max_attempts` AND `status = 'dead_letter'`

**Current count (2026-06-25 baseline):** 0 — all 946 dead-letter rows are governance holds (Bucket 1)

---

## How to Read Readiness Evidence Using Buckets

When evaluating `worker_outbox_health` or `dead_letter_count` in `readiness-score.json`, the evidence field MUST classify rows by bucket, not just report raw counts.

### Correct evidence format

```
"evidence": "594 pending >30min — ALL bucket:governance_hold (attempt_count=0).
  True stuck rows (bucket:retryable + bucket:stale_unknown): 0.
  True delivery failures (bucket:true_failure): 0."
```

### Incorrect evidence format (raw counts only)

```
"evidence": "594 pending, 946 dead_letter"
```

The incorrect format is ambiguous and misleads readiness scoring.

---

## Dimension Pass/Fail Logic

| Dimension | PASS condition | FAIL condition |
|---|---|---|
| `worker_outbox_health` | Bucket 6 count = 0 AND Bucket 5 count ≤ threshold | Bucket 6 count > 0 OR Bucket 5 growing unbounded |
| `dead_letter_count` | Bucket 6 count = 0 | Bucket 6 count > 0 |

Bucket 1 (governance-hold), Bucket 2 (canary-only), Bucket 3 (deferred), and Bucket 4 (retryable within normal range) do NOT trigger FAIL on either dimension.

---

## Relationship to Phase 7A Governance Brake

Phase 7A introduced the `awaiting_approval` lifecycle state and the governance brake. When a pick is in `awaiting_approval`, the outbox worker holds delivery by setting `attempt_count = 0` — the pick is written to the outbox but never attempted. This is the expected behavior of the brake.

All 1,540 currently-held rows (594 pending + 946 dead-letter) are Phase 7A brake effects. None represent delivery infrastructure failures.

**Reference:** `docs/06_status/PHASE7R_RATIFICATION.md`, `docs/06_status/PHASE7E_EXECUTION_PLAN.md`

---

## What This Document Does Not Authorize

- No queue mutation (no UPDATE, DELETE, or INSERT on outbox rows)
- No manual row edits
- No backfill
- No reclassification of governance-hold rows as failures
- No change to `max_attempts` configuration
- No Discord delivery enablement

Classification changes the semantics of how we READ queue state. It does not change the queue state itself.

---

## Document Authority

This document is authoritative for queue state interpretation in readiness ledgers. It supplements:
- `docs/05_operations/LAUNCH_GATE_DEFINITION.md` (Tier B requires UTV2-1320 complete)
- `docs/06_status/readiness/readiness-score.json` (evidence fields must use bucket language)
- `docs/06_status/PHASE7R_RATIFICATION.md` (governance brake spec)
