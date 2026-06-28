# UTV2-1343 — M3 Grading Investigation

**Issue:** UTV2-1343 — M3 grading investigation  
**Lane:** claude/utv2-1343-m3-grading-investigation  
**Date:** 2026-06-27  
**Investigator:** Claude (orchestrator)

---

## Summary

Grading run failure rate spiked to 34.8% today (32/92 runs, `status = 'failed'`) versus 1.46% historical baseline. All failed runs show `{failed: 1, picksGraded: 0}` in `system_runs.details`. Root cause requires server-side logs (Hetzner) to confirm definitively, but two structural issues were identified during the investigation.

**Verdict:** Root cause partially diagnosed. Structural fix recommended as follow-up lane.

---

## Evidence Collected

### Grading heartbeat (M3 Criterion 1)

All 69 `grading.cron.heartbeat` runs in the last 7 days: **`succeeded`**.  
No heartbeat failures. The scheduler is firing correctly.

### Run failure rate (M3 Criterion 2)

| Metric | Value |
|--------|-------|
| Total `grading.run` entries in last 24h | 92 |
| `status = 'succeeded'` | 60 (65.2%) |
| `status = 'failed'` | 32 (34.8%) |
| Historical baseline failure rate | 1.46% |
| Deviation | +33.3 percentage points |

This **exceeds the M3 PASS threshold of ≤ 5%**.

### Failed run pattern

All 32 failed runs have identical `details` shape: `{failed: 1, picksGraded: 0}`.

- `failed: 1` = exactly one pick threw an uncaught exception per run
- `picksGraded: 0` = zero picks were graded successfully in those runs
- Run duration: 200–400ms (fast failure — not a DB timeout)

### Pick inventory (grading-eligible states)

| Status | Count |
|--------|-------|
| `awaiting_approval` | 7,864 |
| `posted` | 3,196 |
| `settled` | 7,288 |

The grader (`runGradingPass()`) fetches `posted` and `awaiting_approval` picks. Total eligible pool: ~11,060.

### Audit log

Only 1 `settlement.evidence_graded` event in last 24h (Shohei Ohtani batting strikeouts pick → win). No `grading_error` or `settlement.error` actions logged for failed runs.

---

## Root Cause Analysis

### Finding 1 — Logging gap (confirmed structural issue)

`grading-service.ts` line 364–370:

```typescript
details: { picksGraded: gradedCount, failed: errorCount }
```

When a pick throws an exception in the catch block (line 343–351), the error message is:
- Logged to `options.logger?.error?.()` → emitted to Hetzner process stdout
- Pushed to the local `details[]` array with `{pickId, outcome: 'error', reason: message}`
- **NOT persisted to `system_runs.details`** — only the count is stored

This means root cause investigation from Supabase alone is impossible. The actual error text is only available in Hetzner server logs, which are not accessible via the DB query path.

### Finding 2 — CLV snapshot constraint violation (observed, separate issue)

10 `closing_for_clv_snapshot_write_failed` events in last 24h, all with the same error:

```
Failed to insert pick_offer_snapshot: new row for relation "pick_offer_snapshots"
violates check constraint "pick_offer_snapshots_devig_mode_check"
```

**This is handled gracefully**: the audit_log shows `settlement.evidence_graded` succeeding on the same pick after the snapshot failure. The constraint error is caught within the CLV path, logged to `audit_log`, and does not propagate to the grading outer catch block.

**However:** the constraint itself (`pick_offer_snapshots_devig_mode_check`) is being violated, which means some picks have a `devig_mode` value that fails the check. This needs a follow-up investigation but is NOT causing the `{failed:1}` grading run failures.

### Finding 3 — Exception source unknown without server logs

The `{failed:1, picksGraded:0}` pattern means one pick throws an exception per failed run. The exception could originate from:

1. `atomicClaimForTransition` during `posted` pick settlement (DB conflict, race condition)
2. `recordEvidenceSettlement` during `awaiting_approval` pick grading (non-CLV path exception)
3. A missing game result or participant data causing a throw rather than a skip

The 200–400ms run duration rules out statement timeouts. A fast exception (missing lookup, validation failure, or transient DB error) is more likely.

**Without the actual error message from Hetzner logs, the specific exception cannot be determined from DB state alone.**

---

## Data Access Gap

The grading service currently emits error messages to `options.logger?.error?.()` but does not persist them to `system_runs.details`. The fix is to add `errorDetails` to the stored details object:

```typescript
// Proposed change to grading-service.ts (follow-up lane):
details: {
  picksGraded: gradedCount,
  failed: errorCount,
  ...(errorCount > 0 && {
    errorDetails: details
      .filter(d => d.outcome === 'error')
      .map(d => ({ pickId: d.pickId, error: d.reason }))
  })
}
```

This change would make the root cause visible in the next failed run, without modifying grading behavior.

---

## Conclusions

| Question | Answer |
|----------|--------|
| Is the grading heartbeat active? | YES — 69/69 cron.heartbeat succeeded |
| Is the run failure rate within M3 PASS threshold (≤5%)? | NO — 34.8% today |
| Is there a follow-up lane for the failure investigation? | YES — this lane (UTV2-1343) |
| Is the root cause confirmed? | PARTIAL — logging gap identified; actual exception unknown without Hetzner logs |
| Is the CLV snapshot issue causing grading failures? | NO — it is handled separately |

**M3 verdict: PARTIAL** — Criteria 1 (heartbeat) is met. Criteria 2, 3, 4 are not met until either (a) the failure rate returns to baseline spontaneously and is attributed, or (b) the logging fix is deployed and the root cause is confirmed from the next failure.

---

## Recommended Follow-up

1. **Logging fix lane** — Add `errorDetails` to `system_runs.details` in `grading-service.ts`. Small code change, safe to do in a T3 lane. After deploy, the next failed grading run will reveal the actual exception.

2. **CLV constraint fix** — Investigate `pick_offer_snapshots_devig_mode_check` to understand which `devig_mode` values are invalid. The constraint is firing on `awaiting_approval` picks going through `recordEvidenceSettlement`.

3. **After logging fix deploys** — Re-query `system_runs` for `status = 'failed'` entries and read `details.errorDetails` to identify the specific pick and exception.
