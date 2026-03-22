# Program Status

> Canonical active status authority for Unit Talk V2.
> Adopted 2026-03-21. Replaces `status_source_of_truth.md`, `current_phase.md`, and `next_build_order.md` for active maintenance.
> Operating model: `docs/05_operations/SPRINT_MODEL_v2.md`
> Runtime evidence: `docs/06_status/system_snapshot.md`

## Last Updated

2026-03-21

## Current State

| Field | Value |
|-------|-------|
| Platform | Unit Talk V2 — sports betting pick lifecycle platform |
| Tests | 531/531 passing |
| Gates | type-check, lint, build, test — all pass |
| Operating Model | Risk-tiered sprints (T1/T2/T3) — see `SPRINT_MODEL_v2.md` |

## Live Routing

| Target | Status | Detail |
|--------|--------|--------|
| `discord:canary` | **LIVE** | Permanent control lane. Never removed. |
| `discord:best-bets` | **LIVE** | Real channel `1288613037539852329`. |
| `discord:trader-insights` | **LIVE** | Real channel `1356613995175481405`. |
| `discord:exclusive-insights` | Blocked | Not implemented. |
| `discord:game-threads` | Blocked | Thread routing not implemented. |
| `discord:strategy-room` | Blocked | DM routing not implemented. |

## Sprint Log

| Sprint | Week | Tier | Status | Summary |
|--------|------|------|--------|---------|
| Promotion Scoring Enrichment | 21 | T3 | **CLOSED** | Domain-aware trust/readiness in promotion scoring. 531/531 tests. |
| E2E Platform Validation | 20 | T3 | **CLOSED** | All 9 runtime surfaces validated. Live canary proof. 515/515 tests. |
| Promotion Edge Integration | 19 | T3 | **CLOSED** | Domain analysis edge as Tier 2 fallback in promotion. 515/515 tests. |
| Domain Integration Layer | 18 | T2 | **CLOSED** | Submission-time domain analysis enrichment. 502/502 tests. |
| Git Baseline Ratification | 17 | T2 | **CLOSED** | First commit from audited post-salvage state. 491/491 tests. |
| Settlement Downstream + Domain Salvage | 16 | T1 | **CLOSED** | Runtime integration + Batch 1-5 salvage. 491/491 tests. |
| Probability/Devig Salvage | 15 | T2 | **CLOSED** | Pure math salvage. 128/128 tests. |
| Verification Control Plane Salvage | 14 | T2 | **CLOSED** | Scenario registry, run history, archive. 100/100 tests. |
| Operator Trader-Insights Health | 13 | T2 | **CLOSED** | Operator dashboard health sections. 87/87 tests. |
| Settlement Hardening | 12 | T1 | **CLOSED** | Manual review, correction chains, operator history. 83/83 tests. |
| Trader-Insights Activation | 11 | T1 | **CLOSED** | `discord:trader-insights` live. 72/72 tests. |
| Operator Command Center | 10 | T2 | **CLOSED** | Picks pipeline, channel health, operator snapshot. 62/62 tests. |
| Full Lifecycle Proof | 9 | T1 | **CLOSED** | Submission-to-settled proof. 23 fields verified. |
| Settlement Runtime | 8 | T1 | **CLOSED** | Settlement schema + write path. |
| Best Bets Activation | 7 | T1 | **CLOSED** | `discord:best-bets` live. |
| Runtime Promotion Gate | 6 | T1 | **CLOSED** | Promotion persistence + routing. |

## Next Milestone

**Smart Form V1 — Operator Submission Surface**

The next major work is designing and building the Smart Form V1 operator submission surface. This requires a T1 contract before implementation begins.

## Candidate Work Queue

| Item | Expected Tier | Rationale |
|------|---------------|-----------|
| Smart Form V1 design + contract | T1 | New user-facing surface |
| Offer Fetch service wrapper | T2 | New service, cross-package |
| DeviggingService integration | T2 | Multi-book consensus at submission |
| Risk Engine integration | T2 | Bankroll-aware sizing |
| Observation Hub permanent form | T2 | Architectural promotion |
| Promotion uniqueness/boardFit enrichment | T3 | Pure computation wiring |

## Do Not Start Without Planning

- `discord:game-threads` live routing
- `discord:strategy-room` live routing
- Broad multi-channel expansion beyond Best Bets
- Any new product surface

## Open Risks

| Risk | Severity | Status |
|------|----------|--------|
| Historical pre-fix outbox rows may add noise to operator incident triage | Low | Open |
| Recap/performance/accounting surfaces do not yet consume downstream truth | Low | Deferred — explicitly out of current scope |

## Key Capabilities

- Canonical submission intake live
- Lifecycle transitions enforced (single-writer discipline)
- Promotion persistence + routing gates live (3 channels)
- Settlement write path live (initial + correction chains + manual review)
- Downstream settlement truth computed (effective settlement + loss attribution)
- Operator-web read-only monitoring live
- Discord outbox, worker delivery, receipts, and audit logs live
- Domain analysis enrichment at submission time (implied probability, edge, Kelly)
- Promotion scoring consumes domain analysis for edge, trust, and readiness
- Verification control plane with scenarios, run history, and archive
- Pure computation foundation: probability, devig, calibration, features, models, signals, bands, scoring, outcomes, evaluation, edge-validation, rollups, system-health, risk, strategy

## Authority References

| Purpose | File |
|---------|------|
| Operating model | `docs/05_operations/SPRINT_MODEL_v2.md` |
| Runtime evidence | `docs/06_status/system_snapshot.md` |
| Proof template (T1) | `docs/06_status/PROOF_TEMPLATE.md` |
| Rollback template (T1) | `docs/06_status/ROLLBACK_TEMPLATE.md` |
| Sprint model proposal | `docs/05_operations/SPRINT_MODEL_v2_PROPOSAL.md` |

### Historical References (superseded — not actively maintained)

| File | Status |
|------|--------|
| `docs/06_status/status_source_of_truth.md` | Superseded by this file |
| `docs/06_status/current_phase.md` | Superseded by this file |
| `docs/06_status/next_build_order.md` | Superseded by this file |
| `docs/05_operations/week_*_contract.md` | Historical sprint records |
| `docs/06_status/week_*_proof_template.md` | Historical sprint templates |

## Update Rule

Update this file at every sprint close. For T3 sprints, only the sprint log table needs a new row.
