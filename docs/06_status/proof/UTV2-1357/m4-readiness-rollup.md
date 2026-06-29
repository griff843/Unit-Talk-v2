# UTV2-1357 — M4 Readiness Rollup: GO/NO-GO Verdict

**Issue:** UTV2-1357 — M4 readiness rollup for UTV2-1332  
**Epoch:** 2026-06-28+ (M4 epoch start per PIPELINE_FINALIZATION_TERMINAL_CRITERIA.md)  
**Assessed:** 2026-06-29T05:30:00Z  
**Assessor:** Claude (orchestrator)  
**Evidence source:** Live DB queries (Supabase project zfzdnfwdarxucxtaojxm), lane manifests, file system inspection  

---

## Verdict: NO-GO

M4 cannot be declared PASS. Two of six acceptance criteria are not met. Details below.

---

## Criteria Assessment

### Criterion 1 — Protocol adopted
**Status: MET**

`docs/05_operations/INTERNAL_PICK_APPROVAL_PROTOCOL.md` exists, is merged (UTV2-1340, SHA `4a39db2f`), and is active. File confirmed present in the repository.

### Criterion 2 — Terminal criteria accepted
**Status: MET**

`docs/05_operations/PIPELINE_FINALIZATION_TERMINAL_CRITERIA.md` exists, was merged by UTV2-1339, and defines M1–M5 criteria. File confirmed present in the repository.

### Criterion 3 — M3 PARTIAL gap resolved
**Status: PARTIALLY MET — ambiguous**

UTV2-1343 lane manifest status is `done` (closed_at: 2026-06-28T08:41:46.825Z). The investigation produced a verdict: root cause is a structural logging gap (error details not persisted to `system_runs.details`), making the actual exception unreachable from DB alone. The investigation is closed with attribution.

However:
- M3 grading failure rate remains **33.7%** as of 2026-06-29 (33 failed / 98 total in last 24h), well above the ≤5% threshold.
- The UTV2-1343 verdict recommends a follow-up fix lane; no fix has been deployed.
- The attribution is partial: the structural issue is documented but the specific exception is unknown without Hetzner server logs.

The criterion says "investigation is closed with a verdict (fix deployed or attributed)." The investigation is closed with an attribution verdict, so this is technically met — but M3 itself remains PARTIAL with elevated failure rate.

### Criterion 4 — M3 lane closed
**Status: MET**

UTV2-1331 lane manifest status is `done` (closed_at: 2026-06-28T01:08:26.351Z, truth_check verdict: pass). Confirmed.

### Criterion 5 — End-to-end flow proven
**Status: NOT MET — hard blocker**

No `awaiting_approval → approved` transition exists in the live system. Evidence:

- `pick_audit_events` table does not exist in the live schema. The audit table is `audit_log`.
- `pick_lifecycle` table shows distinct `to_state` values: `awaiting_approval, posted, queued, settled, validated, voided`. The `approved` state has never been used.
- 0 picks in `pick_lifecycle` show `to_state = 'approved'`.
- 0 internal evidence-flow gate events (`internal_selection`, `internal_approval`, `internal_evidence_gate_*`) in `audit_log`.

The end-to-end internal pick approval flow has not been exercised in the live system. Per INTERNAL_PICK_APPROVAL_PROTOCOL.md §Terminal Criteria: "Until M4 is satisfied, this protocol exists as spec only — no live evidence-flow attempts."

This criterion requires at least one pick traversing the complete `awaiting_approval → approved` path with a recorded audit row. That has not happened.

### Criterion 6 — Governance brake confirmed
**Status: PARTIALLY MET — code confirmed, live M4-epoch observation absent**

The governance brake is confirmed in code:
- `apps/api/src/candidate-pick-scanner.ts`: enforces `validated → awaiting_approval` for non-human sources (braked sources must never auto-distribute).
- `apps/api/src/controllers/submit-pick-controller.ts`: brake applied on pick submission.
- `apps/api/src/distribution-service.ts`: `GOVERNANCE_BRAKE_SOURCES` defined.
- Phase 7A proof (UTV2-494) previously confirmed brake behavior for autonomous sources.

Live observation as of 2026-06-29: picks flow `validated → awaiting_approval` via `promoter`, then to `queued` via `operator_override`. The brake is active and firing. However, no explicit live observation confirming autonomous sources specifically cannot bypass the brake has been recorded in the M4 epoch (2026-06-28+).

The code path is proven; a live observation against an autonomous source pick in the M4 epoch is absent but not strictly required by the criterion's wording ("A test or live observation confirms..."). The Phase 7A proof constitutes a prior live observation. This criterion is arguably met by code + prior proof.

Upgraded assessment: **MARGINAL — code proven, Phase 7A proof stands, no regression.**

---

## Summary Table

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Protocol adopted (INTERNAL_PICK_APPROVAL_PROTOCOL.md) | MET |
| 2 | Terminal criteria accepted (this document merged) | MET |
| 3 | M3 PARTIAL gap resolved (UTV2-1343 investigation closed) | PARTIALLY MET |
| 4 | M3 lane closed (UTV2-1331 manifest = done) | MET |
| 5 | End-to-end flow proven (awaiting_approval → approved in live DB) | NOT MET |
| 6 | Governance brake confirmed (autonomous sources cannot bypass) | MARGINAL |

---

## Blocking Criteria for PASS

**Hard blockers (must be resolved before M4 PASS):**

1. **Criterion 5** — The `awaiting_approval → approved` lifecycle transition must be exercised at least once in the live system. This requires:
   - The `approved` lifecycle state to be implemented (currently absent from the system — all picks advancing past `awaiting_approval` go to `queued` via `operator_override`, not `approved`).
   - Or the M4 criterion to be reinterpreted: if `awaiting_approval → queued via operator_override` constitutes approval, that is happening today (multiple picks per hour). But per the protocol, `approved` is a named state distinct from `queued`.
   - A follow-up lane must either (a) implement the `approved` → `qualified`/`queued` state, or (b) PM must adjudicate whether `operator_override` to `queued` satisfies the intent of criterion 5.

**Soft blockers (should be addressed):**

2. **Criterion 3 / M3 failure rate** — Grading run failure rate at 33.7%, requires either a code fix or definitive attribution. The UTV2-1343 recommended follow-up fix lane has not been opened.

---

## Recommended Next Steps

1. **PM adjudication required** on criterion 5: Does `awaiting_approval → queued (via operator_override)` satisfy the M4 end-to-end flow, or must a dedicated `approved` state be implemented?

2. If PM accepts `operator_override` path as satisfying criterion 5: M4 can be upgraded to PARTIAL (all code-level criteria met; live evidence of the flow exists via operator_override transitions observed today).

3. If `approved` state is required: open a follow-up lane to implement the `approved` lifecycle state and the `ops:internal-pick-approve` command referenced in the protocol.

4. Open the grading logging fix lane (recommended by UTV2-1343) to resolve the M3 failure rate and satisfy criterion 3 definitively.

---

## M4 Verdict History

| Date | Verdict | Source |
|------|---------|--------|
| 2026-06-28 | BLOCKED | PIPELINE_FINALIZATION_TERMINAL_CRITERIA.md (UTV2-1339) |
| 2026-06-29 | PARTIAL (NO-GO) | This rollup (UTV2-1357) |
