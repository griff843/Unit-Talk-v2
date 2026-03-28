# Docs Authority Map

This file maps governance documents to purpose, owner, authority tier, and conflict rules.

When documents conflict:
1. higher tier wins over lower tier
2. within the same tier, the more specific document wins

## Metadata

| Field | Value |
|---|---|
| Owner | Program Owner |
| Status | Ratified |
| Ratified | 2026-03-20 |
| Last Updated | 2026-03-21 |

## Tier 1 - Principles

| File | Purpose | Owner |
|---|---|---|
| `docs/01_principles/rebuild_charter.md` | Why V2 exists and non-negotiable constraints | Program Owner |
| `docs/01_principles/system_context.md` | Runtime systems and control boundaries | Program Owner |

## Tier 2 - Architecture Contracts

| File | Purpose | Owner |
|---|---|---|
| `docs/02_architecture/domain_model.md` | Core entities and flows | Architecture |
| `docs/02_architecture/rebuild_scope.md` | What is in and out of V2 scope | Architecture |
| `docs/02_architecture/contracts/submission_contract.md` | Intake path ownership rules | Architecture |
| `docs/02_architecture/contracts/pick_lifecycle_contract.md` | Lifecycle transition rules | Architecture |
| `docs/02_architecture/contracts/distribution_contract.md` | Distribution and receipt rules | Architecture |
| `docs/02_architecture/contracts/run_audit_contract.md` | Run and audit visibility rules | Architecture |
| `docs/02_architecture/contracts/settlement_contract.md` | Settlement record rules | Architecture |
| `docs/02_architecture/contracts/environment_contract.md` | Environment and credential rules | Platform |
| `docs/02_architecture/contracts/writer_authority_contract.md` | Write authority rules | Architecture |
| `docs/02_architecture/contracts/board_promotion_contract.md` | Promotion evaluation rules for execution boards | Architecture / Product |

## Tier 3 - Product Contracts

| File | Purpose | Owner |
|---|---|---|
| `docs/03_product/best_bets_channel_contract.md` | Best Bets identity and qualification rules | Product |
| `docs/03_product/program_surfaces.md` | Canonical surface definitions | Product |

## Tier 4 - Operational Docs

| File | Purpose | Owner |
|---|---|---|
| `docs/04_roadmap/active_roadmap.md` | Current sequencing and weekly exit criteria | Program Owner |
| `docs/04_roadmap/bootstrap_plan.md` | Initial bootstrap reference | Program Owner |
| `docs/05_operations/week_6_execution_contract.md` | Week 6 required deliverables and blockers | Program Owner |
| `docs/05_operations/week_7_best_bets_activation.md` | Week 7 controlled activation procedure and rollback rules | Program Owner |
| `docs/05_operations/AGENT_OPERATING_MODEL.md` | **Active** agent operating model — Linear-first, role boundaries, reporting rules | Program Owner |
| `docs/05_operations/delivery_operating_model.md` | Cross-tool sync rules and lane ownership | Program Owner |
| `docs/05_operations/discord_routing.md` | Canonical Discord target taxonomy and routing rules | Platform |
| `docs/05_operations/canary_graduation_criteria.md` | Criteria for Best Bets activation | Platform |
| `docs/05_operations/settlement_planning.md` | Settlement target week, slices, and first proof definition | Architecture |
| `docs/05_operations/week_8_settlement_readiness_review.md` | Week 8 entry-readiness review only | Architecture |
| `docs/05_operations/legacy_repo_reference_boundary.md` | Legacy repo usage boundary and non-authority rule | Program Owner |
| `docs/05_operations/migration_ledger.md` | Repo-native ledger of deliberate legacy salvage into V2 | Program Owner |
| `docs/05_operations/risk_register.md` | Open risks and mitigation state | Program Owner |
| `docs/05_operations/migration_cutover_plan.md` | V1 to V2 cutover plan | Platform |
| `docs/05_operations/docs_authority_map.md` | This file | Program Owner |
| `docs/05_operations/week_14_verification_control_plane_salvage_contract.md` | Week 14 selective salvage scope and close criteria | Architecture |
| `docs/05_operations/week_15_probability_devig_salvage_contract.md` | Week 15 probability/devig math salvage scope and close criteria | Architecture |
| `docs/05_operations/week_16_settlement_downstream_loss_attribution_contract.md` | Week 16 runtime integration and accepted foundation scope | Architecture |

## Tier 5 - Current Status

| File | Purpose | Authority Within Tier |
|---|---|---|
| `docs/06_status/PROGRAM_STATUS.md` | Canonical active program status — milestone, capabilities, risks | **Primary — high-level** |
| `docs/06_status/ISSUE_QUEUE.md` | Operational work queue — active/ready/blocked/done per lane | **Primary — work state** |
| `docs/06_status/system_snapshot.md` | Evidence record — specific IDs, receipts, historical proof | Evidence record (STALE as of 2026-03-21 for current state) |
| `docs/06_status/PROOF_TEMPLATE.md` | Reusable T1 independent verification template | Closeout template |
| `docs/06_status/ROLLBACK_TEMPLATE.md` | Reusable T1 rollback template | Rollback template |
| `docs/06_status/status_source_of_truth.md` | **SUPERSEDED 2026-03-21** — historical record through Week 21 | Historical only |
| `docs/06_status/current_phase.md` | **SUPERSEDED 2026-03-21** — historical record | Historical only |
| `docs/06_status/next_build_order.md` | **SUPERSEDED 2026-03-21** — historical record | Historical only |
| `docs/06_status/week_*` templates | Per-week proof/rollback/closeout templates (Weeks 7-16) | Historical only |

## Conflict Rules

1. Tier 5 never overrides Tier 2 or Tier 3.
2. Operational docs must not contradict principles, contracts, or product identity.
3. `docs/06_status/PROGRAM_STATUS.md` is authoritative for current milestone and capability state.
4. `docs/06_status/ISSUE_QUEUE.md` is authoritative for current work lane state.
5. Legacy repo references never override V2 docs; see `docs/05_operations/legacy_repo_reference_boundary.md`.

## Doc Lifecycle

| State | Meaning |
|---|---|
| Draft | Not yet ratified; not binding |
| Ratified | Authoritative; changes require owner approval |
| Deprecated | Superseded; kept for reference with successor link |
| Archived | No longer relevant; moved to archive |
