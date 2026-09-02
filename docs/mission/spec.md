# Mission Spec — canonical contract index

This is an **index**, not a specification. It points at the contracts that already hold authority.
Nothing here overrides a canonical doc. If this file and a canonical doc disagree, the canonical doc
wins and this file is stale — fix the index, never the contract.

Rule: do not write a new contract when one exists. Extend the canonical one.

---

## Readiness authority

| Question | Canonical doc |
|---|---|
| Is Unit Talk production-ready? | `docs/05_operations/T1_PRODUCTION_READINESS_CONTRACT.md` |
| Elite / syndicate-tier thresholds (NOT production readiness) | `docs/05_operations/SYNDICATE_PROOF_STANDARD.md`, `T1_SYNDICATE_READINESS_CONTRACT.md` |
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

## Safety boundaries that survive the operating-model change

| Boundary | Canonical doc |
|---|---|
| Reserved surfaces requiring Griff | `docs/05_operations/RESERVED_RISK_SURFACES.json` |
| Merge authority (mechanical) | `.github/workflows/merge-gate.yml` |
| Direct-main bypass prohibition | `docs/05_operations/DIRECT_MAIN_BYPASS_POLICY.md` |
| Standing guardrails | `docs/05_operations/STANDING_GUARDRAILS.md` |
| Break-glass | `docs/05_operations/BREAK_GLASS_PROTOCOL.md` |
| Required CI checks | `docs/05_operations/REQUIRED_CI_CHECKS.md` |
| Incident response | `docs/05_operations/INCIDENT_RUNBOOK.md`, `SUPABASE_WRITE_PATH_INCIDENT_RUNBOOK.md` |

## Deprecated as *execution authority* (retained as history)

These describe the prior primitive. They remain accurate history and several still hold real
mechanical value, but they no longer gate whether work may proceed:

- `LANE_MANIFEST_SPEC.md`, `TRUTH_CHECK_SPEC.md`, `CLOSEOUT_TRUTH_POLICY.md`
- `EXECUTION_TRUTH_MODEL.md` (its truth *hierarchy* stands; its lane lifecycle does not gate work)
- `WORKFLOW_SPEC.md`, `DELEGATION_POLICY.md`, `OPERATING_MODEL_SONNET5.md`
- `EVIDENCE_BUNDLE_TEMPLATE.md`, `R1_R5_OPERATING_RULE.md`

Evidence still matters. Evidence *ceremony* does not.
