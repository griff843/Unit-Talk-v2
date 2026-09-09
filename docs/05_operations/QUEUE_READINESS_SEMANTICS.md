# Queue Readiness Semantics — Unit Talk V2

**Version:** 1.1  
**Authority:** PM-ratified (UTV2-1320); Bucket 6 corrected under UTV2-1875  
**Status:** ACTIVE  
**Last updated:** 2026-09-09

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

**Definition:** Row has `status = 'dead_letter'`, was **attempted** (`attempt_count > 0`), and its recorded reason is **not** a recognised governance disposition. Delivery was tried and it failed, and nothing explains the failure as a deliberate hold.

**Readiness impact:** HIGH. True delivery failures are operational failures and fail the `dead_letter_count` readiness dimension if count > 0.

**Evidence marker:** `status = 'dead_letter'` AND `attempt_count > 0` AND `classifyDeadLetter(last_error)` is `unrecognised` or `unclassified_null_reason` (`scripts/ops/outbox-triage.ts`, UTV2-1744).

**Current count (2026-09-09):** 0 — of 1,954 dead-letter rows, 1,950 carry a recognised governance reason and 4 were never attempted (Bucket 6a).

#### Corrected in v1.1 (UTV2-1875) — why the old definition was unimplementable, and the code diverged from it

v1.0 defined this bucket as `attempt_count >= max_attempts`. **`max_attempts` is not a column on `distribution_outbox`** — the columns are `attempt_count`, `claimed_at`, `claimed_by`, `created_at`, `id`, `idempotency_key`, `last_error`, `next_attempt_at`, `payload`, `pick_id`, `status`, `target`, `updated_at`. The marker could not be evaluated as written, so the readiness probe implemented `attempt_count > 0` instead, and the doc and the gate quietly disagreed.

That divergence had a measured cost. On 2026-09-09 the **blocking** `dead_letter_count` dimension was failing on exactly one row:

```
attempt_count  target          last_error                                              n
0              discord:canary  proof-pick-blocked: source 't1-proof' is not a live…  1613
1              discord:canary  proof-pick-blocked: source 't1-proof' is not a live…     1
```

The failing row is byte-identical in `target` and `last_error` to 1,613 rows the same probe classified as governance holds. It differed only in having consumed one attempt before the guard refused it. **A guard refusing a delivery is not a delivery failing.**

**Bucketing on the reason alone is wrong in the other direction**, which is why both signals are now load-bearing. Four dead-letter rows carry a NULL `last_error` and an `updated_at` identical to the microsecond — a bulk operator update that recorded no reason. A reason-only rule would newly count those as delivery failures, but their `attempt_count` is 0: nothing ever attempted them.

**The fail-closed direction is preserved.** An attempted row whose reason nothing recognises counts as a true failure. Unexplained is a failure until something classifies it, never the reverse.

---

### Bucket 6a: Unattempted, Unclassified

**Definition:** Row has `status = 'dead_letter'`, `attempt_count = 0`, and no recognised governance reason (including a NULL or empty `last_error`).

**Readiness impact:** LOW for delivery truth, but worth reporting. These rows were never attempted, so they cannot be delivery failures — but the absence of a recorded reason means nothing states *why* they are dead-lettered. They are counted and named separately rather than folded into Bucket 1, so a growing population of them is visible instead of being absorbed into "governance holds".

**Evidence marker:** `status = 'dead_letter'` AND `attempt_count = 0` AND `classifyDeadLetter(last_error)` is `unrecognised` or `unclassified_null_reason`

**Current count (2026-09-09):** 4 — all `discord:best-bets`, all sharing `updated_at = 2026-07-31 04:36:25.063811+00`

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

## Worker Liveness Signal (`worker.heartbeat`, not `distribution.process`)

`distribution.process` `system_runs` rows are written only when the worker actually claims and processes an outbox row. **Their absence is not a liveness signal** — a worker configured for a target with zero eligible rows correctly produces zero `distribution.process` rows every cycle, indefinitely. This is expected, correct idle behavior, not a hang.

The only reliable liveness signal is the `worker.heartbeat` `system_runs` row, written once per cycle in `apps/worker/src/runner.ts` regardless of whether any work was claimed. As of UTV2-1479, each heartbeat write is also mirrored to stdout (`console.log({event: 'worker.heartbeat', ...})`) so liveness is visible in `docker logs` without a live DB query — previously the write had no accompanying log line, making a fully healthy idle worker indistinguishable from a wedged one in host logs alone.

Before concluding a worker is wedged from `distribution.process` silence, check `worker.heartbeat` rows first — see UTV2-1479 classification for the incident this corrects (worker was healthy-idle due to a target-configuration gap, not DB-timeout-blocked as originally assumed during UTV2-1477).

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
