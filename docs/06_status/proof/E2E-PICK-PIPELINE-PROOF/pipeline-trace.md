# E2E Pipeline Trace — Phase 1 Current-State Report

**Date:** 2026-06-29  
**Issue:** UTV2-1359

---

## Pick Creation Paths

| Path | Status | Initial State | Governance Brake | Public Delivery |
|------|--------|---------------|------------------|-----------------|
| smart-form | LIVE | `validated` | ❌ bypassed | YES (Discord) |
| board-construction | LIVE | `validated` | ❌ bypassed | YES (Discord) |
| model-driven | LIVE | `awaiting_approval` | ✅ applied | NO (until approved) |
| system-pick-scanner | LIVE | `awaiting_approval` | ✅ applied | NO (until approved) |
| alert-agent | LIVE | `awaiting_approval` | ✅ applied | NO (until approved) |
| replay/backfill | TEST ONLY | varies | N/A | N/A |

---

## Delivery Lifecycle FSM

```
draft → [validated, voided]
validated → [queued, awaiting_approval, voided]
awaiting_approval → [queued, voided]
queued → [posted, voided]
posted → [settled, voided]
settled → [] (terminal)
voided → [] (terminal)
```

Evidence plane: picks in `awaiting_approval` can be graded/settled without
lifecycle transition. `settlement_records.evidence_ref = 'game-result:<id>'`
and `payload.evidencePlane = true` identify these records.

---

## Shortest Safe E2E Path for No-Public-Delivery Proof

**Evidence Plane (Criterion 12 compliant)**:

```
SGO ingest → provider_offers/game_results/events populated
    ↓
system-pick-scanner polls provider_offers (is_opening=true)
    ↓
candidate pipeline: market_universe → board_scan → candidate scoring
    ↓
processSubmission (source='system-pick-scanner')
    ↓
createCanonicalPickFromSubmission → picks row, pick_lifecycle row (validated)
    ↓
evaluateAllPoliciesEagerAndPersist → pick_promotion_history rows
    ↓
governance brake: validated → awaiting_approval (6s transition)
    ↓
grading cron: fetchAllByLifecycleState('awaiting_approval')
    ↓
findFirstGradeResult → game_results match
    ↓
recordEvidenceSettlement → settlement_records row (evidencePlane=true)
    ↓
computeCLVOutcome → clv_raw, clv_percent, beats_closing_line
    ↓
audit_log: settlement.evidence_graded (ROI in payload)
```

**Full Governance Path (PM gate required for criterion 4)**:

```
... (same as above through awaiting_approval)
    ↓
PM/operator: POST /api/picks/:id/review { decision: 'approve', target: 'discord:canary' }
    ↓
awaiting_approval → queued (review-pick-controller)
    ↓
distribution worker: queued → posted (discord:canary delivery)
    ↓
grading cron: fetchAllByLifecycleState('posted')
    ↓
recordGradedSettlement → settlement_records row + picks.status = 'settled'
    ↓
CLV + ROI as above
```

---

## Pipeline Stage Implementations

| Stage | File | Status |
|-------|------|--------|
| Ingest | `apps/ingestor/src/ingestor-runner.ts` | LIVE (running today) |
| Candidate scoring | `apps/api/src/candidate-scoring-service.ts` | LIVE |
| Promotion | `apps/api/src/promotion-service.ts` | LIVE (3 policies) |
| Governance brake | `apps/api/src/controllers/submit-pick-controller.ts:59-100` | LIVE (Phase 7A) |
| Review/approval | `apps/api/src/controllers/review-pick-controller.ts` | LIVE |
| Grading | `apps/api/src/grading-service.ts` | LIVE (posted + awaiting_approval) |
| Evidence settlement | `apps/api/src/settlement-service.ts:recordEvidenceSettlement` | LIVE (UTV2-1253) |
| CLV | `apps/api/src/clv-service.ts` | LIVE |
| ROI | `payload.flat_bet_roi` in `audit_log` + `profitLossUnits` in `settlement_records.payload` | LIVE |

---

## Known Non-Blockers (Previously Listed as Blockers)

- **pick_audit_events absent**: Not a real table. The system uses `audit_log` with
  `entity_type='pick'` / `entity_type='pick_promotion_history'` / etc.
  Fully queryable.
- **settlement_records created_at index**: EXISTS (`settlement_records_pick_created_idx`)
- **approved state absent**: `approval_status='approved'` IS a column on `picks`.
  The delivery lifecycle and approval status are orthogonal dimensions.
- **smart-form bypasses governance**: Correct by design. Smart-form picks skip
  governance and auto-enqueue. This is the operator-controlled fast path.
- **M3 grading staleness**: Done (UTV2-1358 shipped in Wave 6).
- **capper attribution**: LIVE since UTV2-658 (JWT-based).
