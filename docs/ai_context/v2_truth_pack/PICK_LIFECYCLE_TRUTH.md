# Unit Talk V2 — Pick Lifecycle Truth

> Generated: 2026-03-24. Grounded in `packages/db/src/lifecycle.ts`, `apps/api/src/submission-service.ts`, `apps/worker/src/distribution-worker.ts`, `apps/api/src/settlement-service.ts`.

---

## Lifecycle States

```
validated → queued → posted → settled
    ↓           ↓        ↓
  voided      voided   voided
```

| State | Meaning | Set by |
|-------|---------|--------|
| `validated` | Pick accepted from submission | `submission-service.ts` at submit time |
| `queued` | Enqueued to distribution outbox; worker has claimed | `distribution-worker.ts` after claiming outbox row |
| `posted` | Delivered to Discord | `distribution-worker.ts` after successful delivery |
| `settled` | Settlement recorded | `settlement-service.ts` |
| `voided` | Cancelled/revoked | Operator override or settlement voiding |

**Important:** `picks.status` is the column name in the database — NOT `lifecycle_state`, NOT `state`.

---

## Allowed Transitions (enforced by `transitionPickLifecycle()`)

```typescript
const allowedTransitions = {
  draft:     ['validated', 'voided'],
  validated: ['queued', 'voided'],
  queued:    ['posted', 'voided'],
  posted:    ['settled', 'voided'],
  settled:   [],    // terminal
  voided:    [],    // terminal
};
```

`draft` is defined but unused in V2 — all picks start at `validated`.

Any disallowed transition throws an error and is blocked.

---

## DB Tables Involved in Lifecycle

| Table | Purpose | Write rule |
|-------|---------|-----------|
| `submissions` | Raw intake record | Written once at submit |
| `submission_events` | Events per submission | Append-only |
| `picks` | Canonical pick record | Single-writer discipline |
| `pick_lifecycle` | Lifecycle transition log | Append-only, immutable |
| `pick_promotion_history` | One row per policy evaluation | Append-only |
| `distribution_outbox` | Delivery queue | Claimed/updated by worker |
| `distribution_receipts` | Delivery receipts | Written once per delivery |
| `settlement_records` | Settlement outcomes | Original rows never mutated; corrections add new rows |
| `audit_log` | Immutable event log | Append-only, trigger-enforced |

---

## Submission Flow (apps/api/src/submission-service.ts)

Four sequential steps with FK ordering:

```
Step 1: saveSubmission()
  → creates submissions row

Step 2 (parallel):
  saveSubmissionEvent()   → requires submissions row (FK)
  savePick()              → no FK dependency at this step

Step 3: saveLifecycleEvent()
  → creates pick_lifecycle row (FK: picks.id)
  → MUST follow Step 2 (pick must exist)

Step 4: evaluateAllPoliciesEagerAndPersist()
  → evaluates best-bets AND trader-insights simultaneously
  → routes to highest-priority qualified target
  → persists pick_promotion_history (winner + loser rows)
  → auto-enqueues to distribution_outbox if qualified
  → writes audit_log entries
```

---

## Distribution Worker Flow (apps/worker/src/distribution-worker.ts)

```
processNextDistributionWork():

1. outbox.claimNext(target, workerId)
   → atomic claim: pending → processing, set claimed_at/claimed_by
   → returns null if nothing to process (worker goes idle)

2. deliver(outboxRow)
   → calls Discord delivery adapter
   → returns DeliveryResult { success, messageId, error }

On SUCCESS:
3. outbox.markSent(outboxRow.id)
4. transitionPickLifecycle(pickId, 'queued')
   transitionPickLifecycle(pickId, 'posted')
5. receipts.recordReceipt(...)
6. runs.completeRun(runId, 'succeeded')
7. audit.log({ action: 'distribution.sent', entityId: outboxRow.id, entityRef: null })

On FAILURE:
3. outbox.markFailed(outboxRow.id)
4. runs.completeRun(runId, 'failed')
5. audit.log({ action: 'distribution.failed', entityId: outboxRow.id })
NOTE: no lifecycle transition on failure
```

---

## Settlement Flow (apps/api/src/settlement-service.ts)

Three named paths:

### Initial Settlement
```
POST /api/picks/:id/settle (source != 'feed')
  → guard: pick must be in 'posted' state (not validated, queued, or already settled)
  → recordInitialSettlement():
      writeSettlementRecord(status, result, source, evidence, ...)
      transitionPickLifecycle(pickId, 'settled')
      writeAuditLog({ action: 'settlement.recorded' })
  → computeSettlementDownstreamBundle(): effective result, correction depth, ROI, loss attribution
```

### Correction Chain
```
POST /api/picks/:id/settle (with correctsId provided)
  → recordSettlementCorrection():
      writeSettlementRecord({ corrects_id: originalId, ... })  ← new row; original NEVER mutated
      writeAuditLog({ action: 'settlement.recorded' })
  → original row is IMMUTABLE — no updates to corrects_id, result, or status on original
```

### Manual Review
```
POST /api/picks/:id/settle (status = 'manual_review')
  → recordManualReview():
      requires non-empty reviewReason
      writeSettlementRecord(status='manual_review', ...)
      writeAuditLog()
  → Resolved later via correction or new initial settlement
```

**Feed source blocked:** `source === 'feed'` throws 409 `AUTOMATED_SETTLEMENT_NOT_ALLOWED` before any DB writes. Automated settlement is not allowed.

**Settlement states:** `manual_review | settled | voided`
**Settlement results:** `win | loss | push | void`

---

## Audit Log Schema

```sql
audit_log {
  id          uuid
  action      text      -- e.g., 'promotion.qualified', 'distribution.sent', 'settlement.recorded'
  actor       text      -- who/what triggered it
  entity_id   uuid      -- FK to PRIMARY ENTITY (not the pick!)
                        --   promotion.qualified → pick_promotion_history.id
                        --   distribution.sent   → distribution_outbox.id
                        --   settlement.recorded → settlement_records.id
  entity_ref  text      -- pick_id as text (secondary reference)
  payload     jsonb
  created_at  timestamptz
}
```

**Common mistake:** Querying `audit_log?entity_id=eq.<pick_id>` returns nothing. You must query by `entity_id=eq.<promotion_history_id>` or `entity_id=eq.<outbox_id>` or `entity_id=eq.<settlement_id>`.

The audit log is immutable — a DB trigger (`reject_audit_log_mutation()`) blocks all UPDATE and DELETE operations.

---

## Promotion Decision Persistence

Two rows written per submission to `pick_promotion_history`:
1. **Winner row** — the qualifying policy (or highest-priority evaluated result)
   - Also updates `picks.promotion_target`, `picks.promotion_status`, `picks.promotion_score`, etc.
2. **Loser row** — inserted via `insertPromotionHistoryRow()` (history-only, no picks update)

This preserves full dual-policy audit trail even when only one target is assigned.

---

## Board State Query (caps enforcement)

`getPromotionBoardState()` in both `InMemoryPickRepository` and `DatabasePickRepository`:

```typescript
// Filter: active promotion inventory only
pick.promotion_target === target
  AND pick.promotion_status IN ('qualified', 'promoted')
  AND pick.status IN ('validated', 'queued', 'posted')   // settled/voided excluded
```

**Why `validated` is included:** V2 picks stay `validated` until the worker delivers them. Excluding `validated` would incorrectly allow multiple picks to qualify for the same game slot before any are actually delivered.

---

## Lifecycle Column Names (picks table)

| TypeScript field | DB column |
|-----------------|-----------|
| `lifecycleState` / `status` | `status` |
| `approvalStatus` | `approval_status` |
| `promotionStatus` | `promotion_status` |
| `promotionTarget` | `promotion_target` |
| `promotionScore` | `promotion_score` |
| `promotionDecidedAt` | `promotion_decided_at` |
| `promotionDecidedBy` | `promotion_decided_by` |
| `postedAt` | `posted_at` (denormalized cache — application-maintained) |
| `settledAt` | `settled_at` (denormalized cache — application-maintained) |
