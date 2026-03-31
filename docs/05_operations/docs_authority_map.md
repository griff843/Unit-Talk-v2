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
| Last Updated | 2026-03-29 (UTV2-163 post-docs-phase closeout — member role access authority ratified) |

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
| `docs/03_product/PLATFORM_SURFACES_AUTHORITY.md` | **Primary** — authoritative platform surface registry (all live surfaces and Discord channels) | Product |
| `docs/03_product/MEMBER_ROLE_ACCESS_AUTHORITY.md` | **Primary** — authoritative member tier model, role access policy, trial lifecycle, capper/operator boundaries | Product |
| `docs/03_product/best_bets_channel_contract.md` | Best Bets identity and qualification rules | Product |
| `docs/03_product/TRADER_INSIGHTS_CHANNEL_CONTRACT.md` | Trader Insights identity, threshold, access, and routing rules | Product |
| `docs/03_product/DISCORD_RECAPS_CHANNEL_CONTRACT.md` | Discord Recaps channel identity and delivery rules | Product |
| `docs/03_product/DISCORD_COMMAND_CATALOG.md` | Authoritative registry of live Discord bot commands | Product |
| `docs/03_product/program_surfaces.md` | **SUPERSEDED 2026-03-29** — replaced by PLATFORM_SURFACES_AUTHORITY.md | historical |

### Product Docs — Classified (not in authority tier, informational only)

| File | Class | Notes |
|---|---|---|
| `docs/03_product/COMMAND_CENTER_LIFECYCLE_MINIMUM_SPEC.md` | `active` | Operator-web implementation spec — accurate as of M10+; Wave 4 intelligence layer shipped 2026-03-31 |
| `docs/03_product/DISCORD_BOT_FOUNDATION_SPEC.md` | `archive` | Status CLOSED 2026-03-26 — bot foundation is live |
| `docs/03_product/DISCORD_STATS_COMMAND_SPEC.md` | `archive` | Status updated to CLOSED — /stats command is live |
| `docs/03_product/command_center_truth_surface_prd.md` | `superseded` | Pre-M10 PRD — superseded by live operator-web |
| `docs/03_product/ROLE_ACCESS_MATRIX.md` | `superseded` | **SUPERSEDED 2026-03-29** — replaced by `MEMBER_ROLE_ACCESS_AUTHORITY.md`. Kept as historical reference only. |
| `docs/03_product/MEMBER_ROLE_ACCESS_READINESS_AUDIT.md` | `archive` | Gate log for UTV2-163 — all 8 gates PASS at `7993ec8`. Historical record of unblocking conditions. |
| `docs/03_product/ONBOARDING_ARCHITECTURE_SPEC.md` | `draft` | Design spec — not implemented in V2 |
| `docs/03_product/SERVER_INFORMATION_ARCHITECTURE_SPEC.md` | `draft` | Design spec — not implemented in V2 |
| `docs/03_product/ENTRY_PATH_INVITE_STRATEGY.md` | `draft` | Design spec — not implemented in V2 |
| `docs/03_product/MEDIA_ENRICHMENT_SUPPORT_PACK.md` | `active` | T2/T3 support pack — feed entity resolution metadata enrichment reference |

### Domain Consumer Contracts (docs/03_contracts/)

| File | Purpose | Owner |
|---|---|---|
| `docs/03_contracts/consumer_classification_governance.md` | Domain consumer classification rules | Architecture |
| `docs/03_contracts/domain_analysis_consumer_contract.md` | Domain analysis consumer contract | Architecture |

### Discord Surface Docs (docs/discord/)

| File | Class | Notes |
|---|---|---|
| `docs/discord/discord_embed_system_spec.md` | `active` | Discord embed formatting spec |
| `docs/discord/discord_embed_system_spec_addendum_assets.md` | `active` | Embed asset extension |
| `docs/discord/daily_cadence_spec.md` | `active` | Daily cadence specification |
| `docs/discord/discord_message_contract_matrix.md` | `active` | Message contract matrix |
| `docs/discord/pick_promotion_interim_policy.md` | `superseded` | Pre-Wave-1 interim policy — superseded by MODEL_REGISTRY_CONTRACT.md and live promotion policies |
| `docs/discord/specs/DISCORD_LAUNCH_SURFACE_MAP.md` | `archive` | Pre-launch surface planning — historical |
| `docs/discord/specs/ONBOARDING_CONTENT_ARCHITECTURE.md` | `draft` | Onboarding content design — not implemented |

### AI Context Docs (docs/ai_context/)

| File | Class | Notes |
|---|---|---|
| `docs/ai_context/v2_truth_pack/CURRENT_SYSTEM_TRUTH.md` | `superseded` | Replaced by `PROGRAM_STATUS.md` |
| `docs/ai_context/v2_truth_pack/CANONICAL_DOC_INDEX.md` | `superseded` | Replaced by this authority map |
| `docs/ai_context/v2_truth_pack/REPO_MAP.md` | `stale` | Repo structure snapshot — stale; defer to `PROGRAM_STATUS.md` + codebase |
| `docs/ai_context/v2_truth_pack/PICK_LIFECYCLE_TRUTH.md` | `archive` | Pre-Wave-1 lifecycle truth capture; superseded by `pick_lifecycle_contract.md` |
| `docs/ai_context/v2_truth_pack/DISCORD_STATE_TRUTH.md` | `archive` | Pre-Wave-1 Discord state capture; superseded by `discord_routing.md` |
| `docs/ai_context/v2_truth_pack/LAUNCH_BLOCKERS.md` | `archive` | Pre-launch blockers list — historical |
| `docs/ai_context/v2_truth_pack/HANDOFF_FOR_CHATGPT.md` | `archive` | One-time handoff doc — historical |
| `docs/ai_context/PROVIDER_INGESTION_DECISIONS.md` | `archive` | Pre-T1-ingestion decisions — work complete |
| `docs/ai_context/SGO_V2_AUDIT.md` | `archive` | Pre-ingestor audit — work complete |
| `docs/ai_context/V2_AI_SETUP_AUDIT.md` | `archive` | Setup-era audit — historical |

## Tier 4 - Operational Docs

| File | Purpose | Owner |
|---|---|---|
| `docs/04_roadmap/active_roadmap.md` | **SUPERSEDED 2026-03-21** — replaced by PROGRAM_STATUS.md | historical |
| `docs/04_roadmap/bootstrap_plan.md` | Initial bootstrap reference (archive) | historical |
| `docs/05_operations/AGENT_OPERATING_MODEL.md` | **Active** agent operating model — Linear-first, role boundaries, reporting rules | Program Owner |
| `docs/05_operations/codex_wave_execution_playbook.md` | Default Codex wave execution model — issue triage, lane ownership, stacked PR discipline, Linear update rules | Program Owner |
| `docs/05_operations/delivery_operating_model.md` | Cross-tool sync rules and lane ownership | Program Owner |
| `docs/05_operations/discord_routing.md` | Canonical Discord target taxonomy and routing rules | Platform |
| `docs/05_operations/canary_graduation_criteria.md` | Criteria for Best Bets activation | Platform |
| `docs/05_operations/trader_insights_graduation_criteria.md` | Criteria for Trader Insights activation | Platform |
| `docs/05_operations/legacy_repo_reference_boundary.md` | Legacy repo usage boundary and non-authority rule | Program Owner |
| `docs/05_operations/migration_ledger.md` | Repo-native ledger of deliberate legacy salvage into V2 | Program Owner |
| `docs/05_operations/risk_register.md` | Open risks and mitigation state | Program Owner |
| `docs/05_operations/migration_cutover_plan.md` | V1 to V2 cutover plan | Platform |
| `docs/05_operations/runtime_restart_and_deploy_sop.md` | Deploy and restart SOP | Platform |
| `docs/05_operations/docs_authority_map.md` | This file — updated 2026-03-29 (drift audit) | Program Owner |
| `docs/05_operations/UTV2-106_WORKER_RUNTIME_CONTRACT.md` | Worker runtime ownership and operator proof expectations | Architecture |
| `docs/05_operations/SPRINT_MODEL_v2.md` | Risk-tiered sprint model (T1/T2/T3) | Program Owner |
| `docs/05_operations/QUEUE_ORCHESTRATION_DESIGN.md` | Queue/orchestration system design — ratified 2026-03-26 | Claude |
| `docs/05_operations/agent_delegation_policy.md` | **SUPERSEDED 2026-03-28** — replaced by `AGENT_OPERATING_MODEL.md` | historical |
| `docs/05_operations/SPRINT_MODEL_v2_PROPOSAL.md` | **SUPERSEDED 2026-03-29** — pre-ratification draft; replaced by `SPRINT_MODEL_v2.md` | historical |

### Wave 1 Hardening Contracts (ratified 2026-03-29)

| File | Purpose | Issue |
|---|---|---|
| `docs/05_operations/PICK_METADATA_CONTRACT.md` | Typed `PickMetadata` interface replacing untyped blob | UTV2-122 |
| `docs/05_operations/ALERT_AGENT_EXTRACTION_CONTRACT.md` | Extract alert agent from API process | UTV2-125 |
| `docs/05_operations/RUNTIME_MODE_CONTRACT.md` | Fail-closed startup mode + `getRuntimeMode()` | UTV2-147 |

### Wave 2 Hardening Contracts (ratified 2026-03-29)

| File | Purpose | Issue |
|---|---|---|
| `docs/05_operations/DELIVERY_ADAPTER_HARDENING_CONTRACT.md` | Typed `DeliveryResult`, retry classification | UTV2-148 |
| `docs/05_operations/DISCORD_CIRCUIT_BREAKER_CONTRACT.md` | Per-target circuit breaker for worker | UTV2-124 |
| `docs/05_operations/MODEL_REGISTRY_CONTRACT.md` | Named scoring profiles + score weights bug fix | UTV2-136 |
| `docs/05_operations/REPLAYABLE_SCORING_CONTRACT.md` | Deterministic promotion replay from stored snapshot | UTV2-145 |
| `docs/05_operations/MEMBER_TIER_MODEL_CONTRACT.md` | `member_tiers` table + Discord role sync | UTV2-149 |
| `docs/05_operations/PROMOTION_TARGET_REGISTRY_CONTRACT.md` | Runtime target enable/disable registry | UTV2-129 |

## Tier 5 - Current Status

| File | Purpose | Authority Within Tier |
|---|---|---|
| `docs/06_status/PROGRAM_STATUS.md` | Canonical active program status — milestone, capabilities, risks | **Primary — high-level** |
| `docs/06_status/ISSUE_QUEUE.md` | **DEPRECATED 2026-03-31** — historical work queue record; Linear is the live execution queue | Historical only |
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
4. Linear is authoritative for current work lane state. `ISSUE_QUEUE.md` is a historical record only.
5. Legacy repo references never override V2 docs; see `docs/05_operations/legacy_repo_reference_boundary.md`.

## Doc Lifecycle

| State | Meaning |
|---|---|
| Draft | Not yet ratified; not binding |
| Ratified | Authoritative; changes require owner approval |
| Deprecated | Superseded; kept for reference with successor link |
| Archived | No longer relevant; moved to archive |
