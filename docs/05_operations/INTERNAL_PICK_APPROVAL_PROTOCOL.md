# Internal Pick Approval Protocol

**Version:** 1.0  
**Status:** Active  
**Milestone:** M4 — Internal Evidence-Flow Proof  
**Governing issue:** UTV2-1340  
**Public delivery:** PROHIBITED until Phase 9 gate

---

## Purpose

This protocol defines the non-public internal process by which a pick advances from the `awaiting_approval` lifecycle state to a live delivery attempt. It applies exclusively to the internal evidence-flow path and explicitly prohibits any public (Discord, external webhook, API consumer) delivery until Phase 9 governing conditions are met.

---

## Scope

This protocol governs:
- Pick selection criteria for internal evidence-flow testing
- Evidence capture requirements at each gate
- Approval authority and audit trail
- Delivery isolation guarantee

This protocol does NOT govern:
- Production public delivery (gated by Phase 9)
- P3/P4/P5 picks (not certified)
- CLV or ROI certification (not in scope)
- External consumer access

---

## Pick Selection Rules

A pick is eligible for internal evidence-flow testing when ALL of the following hold:

| # | Rule | Source |
|---|------|--------|
| S1 | `lifecycle_state = 'awaiting_approval'` | `picks.lifecycle_state` |
| S2 | `source_type IN ('human', 'curated')` | `picks.source_type` — no autonomous sources |
| S3 | `governance_brake_state IS NULL OR governance_brake_state = 'cleared'` | `pick_governance.brake_state` |
| S4 | `promotion_score IS NOT NULL AND promotion_score >= 0.65` | `picks.promotion_score` (model-driven, post-UTV2-1327) |
| S5 | No active PM hold on the pick or its event | `pick_governance` + `pm_overrides` |
| S6 | Event start time > NOW() + 30 minutes | Pre-event only — no live-game picks |
| S7 | Pick has been in `awaiting_approval` for < 4 hours | Staleness gate |

**Anti-criteria (automatic exclusion):**
- Any pick with `source_type = 'autonomous'` regardless of score
- Picks flagged `is_test = true`
- Picks from events with `event_status IN ('final', 'cancelled', 'postponed')`
- Picks with `delivery_channel != 'internal'` (wrong channel classification)

---

## Evidence Capture Requirements

At each gate, the following must be captured and persisted before advancing:

### Gate 1 — Selection evidence
```
{
  "gate": "selection",
  "pick_id": "<uuid>",
  "captured_at": "<ISO-8601>",
  "lifecycle_state_at_capture": "awaiting_approval",
  "promotion_score": <float>,
  "source_type": "<string>",
  "event_id": "<uuid>",
  "event_start_time": "<ISO-8601>",
  "selection_rules_passed": ["S1", "S2", "S3", "S4", "S5", "S6", "S7"],
  "approver": "pm_manual | ops_auto",
  "session_id": "<string>"
}
```

### Gate 2 — Approval evidence
```
{
  "gate": "approval",
  "pick_id": "<uuid>",
  "approved_at": "<ISO-8601>",
  "approver_id": "<string>",
  "approval_channel": "linear_label | session_command",
  "delivery_channel": "internal",
  "public_delivery_prohibited": true,
  "evidence_bundle_path": "docs/06_status/proof/internal/<pick_id>.json"
}
```

### Gate 3 — Delivery attempt evidence
```
{
  "gate": "delivery_attempt",
  "pick_id": "<uuid>",
  "outbox_row_id": "<uuid>",
  "delivery_channel": "internal",
  "attempt_at": "<ISO-8601>",
  "outcome": "delivered | failed | governance_hold",
  "destination": "internal_only",
  "external_delivery": false
}
```

All gate evidence records are persisted to the `pick_audit_log` table with `event_type = 'internal_evidence_gate_<N>'`.

---

## Approval Authority

| Approver | Authority level | Mechanism |
|----------|----------------|-----------|
| PM (Griff) | Full approval for any eligible pick | Linear label `internal-approved` on pick issue, or session command |
| Orchestrator (Claude) | Auto-approval for picks meeting S1–S7 AND no PM hold | `ops:internal-pick-approve` command (future) |

**PM veto:** PM hold supersedes orchestrator auto-approval unconditionally. A PM hold is set via:
- Linear label `pm-hold` on the pick issue, OR
- Row in `pm_overrides` table with `override_type = 'hold'`

---

## Delivery Isolation Guarantee

Internal evidence-flow picks MUST be isolated from public delivery paths. This is enforced at three layers:

1. **Outbox routing:** Internal picks receive `delivery_channel = 'internal'` in the outbox row. The delivery adapter MUST NOT route `internal` channel rows to Discord, webhooks, or any external consumer.

2. **Governance brake:** Phase 7A `awaiting_approval` brake remains active. No autonomous pick advancement past `awaiting_approval` without explicit PM or orchestrator gate passage.

3. **Proof bundle:** Each internal evidence-flow run produces a `docs/06_status/proof/internal/<timestamp>/` bundle. The bundle must confirm `external_delivery: false` for every attempt.

---

## Audit Trail

All events in this protocol emit to `pick_audit_log` with:
- `event_type`: one of `internal_selection`, `internal_approval`, `internal_delivery_attempt`, `internal_delivery_outcome`
- `actor`: `pm_manual` | `orchestrator_auto`
- `evidence_json`: the gate capture payload above
- `session_id`: session identifier for forensics

---

## Terminal Criteria (M4 gate)

M4 (Internal Evidence-Flow Proof milestone) is complete when:

1. At least one pick satisfying S1–S7 completes the full Gate 1 → Gate 2 → Gate 3 flow
2. Gate 3 evidence confirms `external_delivery: false`
3. Proof bundle produced at `docs/06_status/proof/internal/`
4. PM review of evidence bundle without objection
5. UTV2-1339 terminal PASS criteria confirmed

Until M4 is satisfied, this protocol exists as spec only — no live evidence-flow attempts.

---

## Standing Guardrails (PM-permanent)

Per PM standing guardrails (session: 2026-06-27):
- No public Discord enablement
- No P3 certification
- No live backfill
- No DB mutation/DDL without separate PM gate
- CLV/ROI/edge claims prohibited until Phase 9
