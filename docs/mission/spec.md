# Mission Spec — required outcomes and canonical contract index

This file states what the mission must produce and points at the contracts that already hold
authority for each area. It is an **index plus outcome statement**, not a specification.

Nothing here overrides a canonical doc. If this file and a canonical doc disagree, **the canonical
doc wins and this file is stale** — fix the index, never the contract.

Rule: do not write a new contract when one exists. Extend the canonical one.

---

## Required outcomes

The mission is complete when all four hold at once:

1. **The production-readiness contract passes on its own terms.**
   `docs/05_operations/T1_PRODUCTION_READINESS_CONTRACT.md` passes using the live evidence it
   requires, across every dimension it defines, at the thresholds it sets. This document introduces
   no threshold of its own and no alternate scoring.

2. **Milestone 1 has actually been performed**, by Griff, end to end, against the deployed system —
   not simulated, not asserted from tests. The seven steps are enumerated in `intent.md`.

3. **The system is operationally usable as the intended product** — a capper can submit, the
   pipeline grades and settles, an operator can observe it through the intended surface, and
   delivery behaves as the delivery contracts specify.

4. **The safety boundaries still hold**, demonstrably: reserved actions still require Griff,
   production containment is still fail-closed unless a milestone authorized otherwise, and the
   direct-`main` prohibition has not been bypassed.

An individual PR merging, a ticket closing, CI turning green, or a subtask completing satisfies
none of these.

---

## Readiness authority

| Question | Canonical doc |
|---|---|
| Is Unit Talk production-ready? | `docs/05_operations/T1_PRODUCTION_READINESS_CONTRACT.md` |
| Elite / syndicate-tier thresholds (**not** production readiness) | `docs/05_operations/SYNDICATE_PROOF_STANDARD.md`, `T1_SYNDICATE_READINESS_CONTRACT.md` |
| Canary mechanics for the readiness rollout | `docs/05_operations/PRODUCTION_READINESS_CANARY_PLAN.md` |
| Launch gate definition | `docs/05_operations/LAUNCH_GATE_DEFINITION.md` |

No competing readiness threshold may be introduced anywhere else.

## Milestone 1 — Smart Form "Track Only" pilot

| Concern | Canonical doc |
|---|---|
| Smart Form v1 behavior | `docs/05_operations/T1_SMART_FORM_V1_CONTRACT.md` |
| Operator submission semantics | `docs/05_operations/SMART_FORM_V1_OPERATOR_SUBMISSION_CONTRACT.md` |
| Capper / provider identity | `docs/05_operations/SMART_FORM_PROVIDER_IDENTITY_REQUIREMENTS.md`, `T1_CAPPER_ONBOARDING_CONTRACT.md` |
| Sportsbook constraints | `docs/05_operations/SMART_FORM_SPORTSBOOK_CONSTRAINT_CONTRACT.md` |
| Live offer UX | `docs/05_operations/T1_SMART_FORM_LIVE_OFFER_UX_CONTRACT.md` |
| Internal pick approval | `docs/05_operations/INTERNAL_PICK_APPROVAL_PROTOCOL.md` |
| Delivery must not fire (Track Only) | `docs/05_operations/DELIVERY_KILL_SWITCH.md`, `delivery_operating_model.md` |
| Runtime mode / containment semantics | `docs/05_operations/RUNTIME_MODE_CONTRACT.md`, `SIMULATION_MODE_CONTRACT.md` |

## Domain and pipeline

| Concern | Canonical doc |
|---|---|
| Canonical pick shape and metadata | `docs/05_operations/PICK_METADATA_CONTRACT.md`, `SYSTEM_PICK_CONTRACT.md` |
| Betting taxonomy | `docs/05_operations/T1_CANONICAL_BETTING_TAXONOMY_CONTRACT.md` |
| Score provenance | `docs/05_operations/SCORE_PROVENANCE_STANDARD.md` |
| Grading / settlement | `docs/05_operations/T1_AUTOMATED_GRADING_CONTRACT.md`, `T2_CLV_SETTLEMENT_WIRING_CONTRACT.md` |
| CLV / closing line | `docs/05_operations/T1_CLV_CLOSING_LINE_WIRING_CONTRACT.md` |
| Delivery / outbox | `docs/05_operations/DELIVERY_ADAPTER_HARDENING_CONTRACT.md`, `DISCORD_CIRCUIT_BREAKER_CONTRACT.md` |
| Provider ingestion | `docs/05_operations/T1_PROVIDER_INGESTION_CONTRACT.md`, `PROVIDER_AUTHORITY_LOCK.md` |
| Reference data | `docs/05_operations/T1_REFERENCE_DATA_SEEDING_AND_RECONCILIATION_POLICY.md` |

## Architecture and data

| Concern | Canonical doc |
|---|---|
| Architecture reference | `docs/CODEBASE_GUIDE.md` |
| DB architecture | `docs/05_operations/DB_ARCHITECTURE_SPEC.md` |
| Migration workflow | `docs/05_operations/DB_MIGRATION_WORKFLOW.md` |
| Postgres roles / privileges | `docs/05_operations/POSTGRES_ROLE_MODEL.md` |
| Live schema types | `packages/db/src/database.types.ts` (generated — `pnpm supabase:types`) |

## Execution and governance — in force

These are **current authority**, not history. Work proceeds through them unless and until PM
ratifies a replacement.

| Concern | Canonical doc |
|---|---|
| Execution truth model and truth hierarchy | `docs/05_operations/EXECUTION_TRUTH_MODEL.md` |
| Lane manifest schema and lifecycle | `docs/05_operations/LANE_MANIFEST_SPEC.md` |
| Done-gate (`ops:truth-check`) | `docs/05_operations/TRUTH_CHECK_SPEC.md` |
| Closeout truth | `docs/05_operations/CLOSEOUT_TRUTH_POLICY.md` |
| Three-lane workflow | `docs/05_operations/WORKFLOW_SPEC.md` |
| Delegation policy (tiers, reshaping) | `docs/05_operations/DELEGATION_POLICY.md` |
| Operating model | `docs/05_operations/OPERATING_MODEL_SONNET5.md` |
| Evidence bundle template | `docs/05_operations/EVIDENCE_BUNDLE_TEMPLATE.md` |
| R-level evidence rule | `docs/05_operations/R1_R5_OPERATING_RULE.md`, `r1-r5-rules.json` |
| Lane concurrency limits | `docs/governance/LANE_CONCURRENCY_POLICY.md` |
| Master execution map | `docs/05_operations/EXECUTION_MAP.md` |
| Modeling sequence | `docs/05_operations/MODELING_SEQUENCE.md` |
| Docs authority map | `docs/05_operations/docs_authority_map.md` |

## Safety boundaries

| Boundary | Canonical doc |
|---|---|
| Merge authority (mechanical) | `.github/workflows/merge-gate.yml` |
| Direct-`main` bypass prohibition | `docs/05_operations/DIRECT_MAIN_BYPASS_POLICY.md` |
| Standing guardrails | `docs/05_operations/STANDING_GUARDRAILS.md` |
| Break-glass | `docs/05_operations/BREAK_GLASS_PROTOCOL.md` |
| Required CI checks | `docs/05_operations/REQUIRED_CI_CHECKS.md` |
| Incident response | `docs/05_operations/INCIDENT_RUNBOOK.md`, `SUPABASE_WRITE_PATH_INCIDENT_RUNBOOK.md` |

## Program state

| Concern | Doc |
|---|---|
| Program status | `docs/06_status/PROGRAM_STATUS.md` |
| Known debt | `docs/06_status/KNOWN_DEBT.md` |
| Current execution plan | `docs/mission/plan.md` |
