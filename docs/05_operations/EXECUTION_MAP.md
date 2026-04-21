# Unit Talk V2 — Master Execution Map

**Status:** Ratified  
**Authority:** UTV2-637 — supersedes any lighter narrative elsewhere  
**Effective:** 2026-04-21

---

## Program truth

| Readiness claim | Requires |
|---|---|
| Production readiness | Readiness program through M4 |
| Elite / syndicate readiness | Readiness program M5 + elite-core modeling (phases 1–6) |
| Human-like modeling | Elite-core complete + human-like-core layer (phases 1–7) |

See `docs/05_operations/MODELING_SEQUENCE.md` for the strict modeling execution order.

---

## Non-negotiable sequencing rules

- **No elite claim** before UTV2-590 (production PASS/FAIL gate) passes.
- **No human-like claim** before UTV2-633–UTV2-636 materially pass.
- **No syndicate PASS** before UTV2-595 (final elite PASS/FAIL bundle) passes.

---

## Lane rules

| Lane | Owns |
|---|---|
| **Codex** | Implementation, runtime, model mechanics, data flows, analytics, enforcement, tests, live truth surfaces |
| **Claude** | Governance contracts, acceptance framing, review packets, closeout narrative, PM-grade policy standards, final readiness verdict framing |
| **Shared** | Claude defines the operating standard first or alongside implementation — never after |

---

## Phase 1: Runtime truth first

*Gate: all services off local-process dependency before Phase 2 begins.*

| Issue | Title | Lane |
|---|---|---|
| UTV2-572 | Worker runtime recovery | Codex |
| UTV2-574 | Truthful verify/deploy gate | Codex |
| UTV2-596 | Concrete lint gate fix | Codex |
| UTV2-597 | Regenerate Supabase types if stale | Codex |
| UTV2-599 | API supervision | Codex |
| UTV2-600 | Ingestion staleness alerting | Codex |
| UTV2-601 | Containerization | Codex |
| UTV2-609 | Distributed scheduling / timer safety | Codex |
| UTV2-602 | Durable hosting + CI deploy | Codex |
| UTV2-603 | Centralized observability | Codex |
| — | Validate status framing and closeout truth; block premature readiness claims | Claude |

---

## Phase 2: Canonical and grading truth

*Gate: closing-line coverage non-trivial, auto-grading live, canonical identity enforced.*

| Issue | Title | Lane |
|---|---|---|
| UTV2-617 | Correct active SGO key precedence | Codex |
| UTV2-616 | Fix closing-line timeout on provider_offers scale | Codex |
| UTV2-576 | Prove live closing-line truth | Codex |
| UTV2-614 | Restore auto-grading linkage (participant/event resolution) | Codex |
| UTV2-615 | Expand canonical market normalization coverage | Codex |
| UTV2-577 | Enforce canonical Smart Form identity | Codex |
| UTV2-618 | Expose CLV skip/failure visibility | Codex |
| UTV2-619 | Fix cross-sport data contamination | Codex |
| UTV2-578 | Fail-closed writer authority | Codex |
| UTV2-598 | Clear stranded awaiting_approval debris | Codex |
| UTV2-604 | Add RLS defense-in-depth | Codex |
| UTV2-575 | Docs/runtime/status reconciliation once technical truth is stable | Claude |

---

## Phase 3: Governed machine and model inventory honest

*Gate: model champion inventory live, scoring profiles explicit, governed pipeline stage-proved.*

| Issue | Title | Lane |
|---|---|---|
| UTV2-579 | Stage-proof checks for the governed machine | Codex |
| UTV2-622 | Model inventory and sport × market-family gap map | Shared |
| UTV2-623 | Model-owned scoring profiles by slice | Codex |
| UTV2-624 | Challenger pipeline wiring | Shared |
| UTV2-625 | Feature-completeness enforcement | Shared |
| UTV2-580 | Score provenance coverage and thresholds | Codex |
| — | Co-own standards for UTV2-622, UTV2-624, UTV2-625 | Claude |

---

## Phase 4: Measurement and self-correction

*Gate: per-slice calibration running, review/demotion pressure wired, learning ledger live.*

| Issue | Title | Lane |
|---|---|---|
| UTV2-626 | Per-slice calibration measurement | Codex |
| UTV2-627 | Automatic review / demotion pressure | Codex |
| UTV2-628 | Execution-quality feedback into trust | Codex |
| UTV2-629 | Closed-loop learning ledger | Codex |
| UTV2-581 | Settlement / CLV / correction proof volume | Codex |
| — | Validate weekly/monthly review expectations against live outputs | Claude |

---

## Phase 5: Production proof

*Gate: UTV2-590 PASS/FAIL gate passes. No production claim without it.*

| Issue | Title | Lane |
|---|---|---|
| UTV2-586 | Runtime burn-in | Codex |
| UTV2-606 | Staged autonomous pipeline enablement | Codex |
| UTV2-587 | End-to-end governed pipeline proof | Codex |
| UTV2-588 | Smart Form/API convergence proof | Codex |
| UTV2-589 | Analytics validation | Codex |
| UTV2-590 | Production PASS/FAIL gate | Codex |
| — | Enforce fail-closed closeout; block narrative-based PASS claims | Claude |

---

## Phase 6: Portfolio intelligence (required for elite claim)

| Issue | Title | Lane |
|---|---|---|
| UTV2-630 | Portfolio correlation/concentration intelligence | Codex |
| UTV2-631 | Bankroll-aware sizing and risk-adjusted ranking | Shared |
| UTV2-632 | Live monthly portfolio review packet | Codex |
| — | Co-own bankroll/risk policy; operator packet standards explicit | Claude |

---

## Phase 7: Human-like modeling layer

*Gate: UTV2-633–636 materially pass before human-like claim.*

| Issue | Title | Lane |
|---|---|---|
| UTV2-633 | Matchup-context reasoning | Codex |
| UTV2-634 | Injury / lineup / availability reasoning | Codex |
| UTV2-636 | Contrarian disagreement tracking and review | Codex |
| UTV2-635 | Narrative-grade model explanations | Shared |
| — | Co-own explanation standards and operator-facing quality bar | Claude |

---

## Phase 8: Final elite / syndicate proof

*Gate: UTV2-595 PASS/FAIL bundle passes. No syndicate claim without it.*

| Issue | Title | Lane |
|---|---|---|
| UTV2-591 | Threshold definition support data surfaces | Shared |
| UTV2-592 | Score quality proof | Codex |
| UTV2-593 | Routing/operator quality proof | Codex |
| UTV2-594 | Post-production live sample review evidence | Codex |
| UTV2-595 | Final elite PASS/FAIL evidence bundle | Codex |
| — | Co-own UTV2-591 threshold ratification + UTV2-595 final verdict language | Claude |

---

## Canonical references

- Modeling sequence: `docs/05_operations/MODELING_SEQUENCE.md`
- Workflow spec: `docs/05_operations/WORKFLOW_SPEC.md`
- Truth check: `docs/05_operations/TRUTH_CHECK_SPEC.md`
- Delegation policy: `docs/05_operations/DELEGATION_POLICY.md`
