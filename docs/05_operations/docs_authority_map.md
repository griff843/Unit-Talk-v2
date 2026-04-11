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
| Last Updated | 2026-04-09 (Phase 5 sync — Phases 2–4 closed, Phase 5 P5-01/P5-02 merged, evidence bundles added to Tier 5) |

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
| `docs/05_operations/AGENT_OPERATING_MODEL.md` | **Active** agent operating model — Linear-first, role boundaries, reporting rules | Program Owner |
| `docs/05_operations/codex_wave_execution_playbook.md` | Default Codex wave execution model — issue triage, lane ownership, stacked PR discipline, Linear update rules | Program Owner |
| `docs/05_operations/delivery_operating_model.md` | Cross-tool sync rules and lane ownership | Program Owner |
| `docs/05_operations/discord_routing.md` | Canonical Discord target taxonomy and routing rules | Platform |
| `docs/05_operations/canary_graduation_criteria.md` | Criteria for Best Bets activation | Platform |
| `docs/05_operations/trader_insights_graduation_criteria.md` | Criteria for Trader Insights activation | Platform |
| `docs/05_operations/legacy_repo_reference_boundary.md` | Legacy repo usage boundary and non-authority rule | Program Owner |
| `docs/05_operations/migration_ledger.md` | Repo-native ledger of deliberate legacy salvage into V2 | Program Owner |
| `docs/05_operations/risk_register.md` | Open risks and mitigation state | Program Owner |
| `docs/05_operations/runtime_restart_and_deploy_sop.md` | Deploy and restart SOP | Platform |
| `docs/05_operations/docs_authority_map.md` | This file — updated 2026-04-05 (full architecture audit) | Program Owner |
| `docs/05_operations/UTV2-106_WORKER_RUNTIME_CONTRACT.md` | Worker runtime ownership and operator proof expectations | Architecture |
| `docs/05_operations/SPRINT_MODEL_v2.md` | Risk-tiered sprint model (T1/T2/T3) | Program Owner |
| `docs/05_operations/QUEUE_ORCHESTRATION_DESIGN.md` | Queue/orchestration system design — ratified 2026-03-26 | Claude |
| `docs/05_operations/PRODUCTION_READINESS_CANARY_PLAN.md` | **Active** — production readiness canary: live grading verification, delivery health, evidence bundle | UTV2-25 |
| `docs/05_operations/ROLLOUT_CONTROLS_CONTRACT.md` | Per-target rollout %, sport filters, deterministic sampling for gradual activation | UTV2-154 |
| `docs/05_operations/SIMULATION_MODE_CONTRACT.md` | System-wide simulation delivery mode for pre-activation validation | UTV2-156 |
| `docs/05_operations/LOGGING_INFRASTRUCTURE.md` | Loki + Grafana centralized logging — docs-only, not yet deployed | UTV2-153 |
| `docs/05_operations/DEPLOYMENT_TELEMETRY_CONTRACT.md` | Metrics endpoint, deploy gate script, staging env config — docs-only, not yet deployed | UTV2-137 |
| `docs/05_operations/BOARD_CAP_POLICY.md` | Board cap enforcement — `perSport: 3` active; see UTV2-284 for PM policy decision | Platform |
| `docs/05_operations/PROVIDER_KNOWLEDGE_BASE.md` | **Active** — SGO grading truth, odds format, CLV methodology, Pinnacle preference | Platform |
| `docs/05_operations/PROVIDER_DATA_DECISION_RECORD.md` | Historical record of SGO vs Odds API provider decisions | Platform |
| `docs/05_operations/lane-manager.md` | **Active** — lane registry and Codex lane management reference | Program Owner |
| `docs/05_operations/migration_cutover_plan.md` | V1→V2 cutover plan — completed, kept for reference | historical |

### Wave 1 Hardening Contracts (ratified 2026-03-29, shipped)

| File | Purpose | Issue |
|---|---|---|
| `docs/05_operations/PICK_METADATA_CONTRACT.md` | Typed `PickMetadata` interface replacing untyped blob | UTV2-122 |
| `docs/05_operations/ALERT_AGENT_EXTRACTION_CONTRACT.md` | Extract alert agent from API process | UTV2-125 |
| `docs/05_operations/RUNTIME_MODE_CONTRACT.md` | Fail-closed startup mode + `getRuntimeMode()` | UTV2-147 |

### Wave 2 Hardening Contracts (ratified 2026-03-29, shipped)

| File | Purpose | Issue |
|---|---|---|
| `docs/05_operations/DELIVERY_ADAPTER_HARDENING_CONTRACT.md` | Typed `DeliveryResult`, retry classification | UTV2-148 |
| `docs/05_operations/DISCORD_CIRCUIT_BREAKER_CONTRACT.md` | Per-target circuit breaker for worker | UTV2-124 |
| `docs/05_operations/MODEL_REGISTRY_CONTRACT.md` | Named scoring profiles + score weights — shipped, `model_registry` table live | UTV2-136 |
| `docs/05_operations/REPLAYABLE_SCORING_CONTRACT.md` | Deterministic promotion replay from stored snapshot | UTV2-145 |
| `docs/05_operations/MEMBER_TIER_MODEL_CONTRACT.md` | `member_tiers` table + Discord role sync | UTV2-149 |
| `docs/05_operations/PROMOTION_TARGET_REGISTRY_CONTRACT.md` | Runtime target enable/disable registry | UTV2-129 |

### Smart Form Contracts (ratified 2026-04-01+, active)

| File | Purpose | Issue |
|---|---|---|
| `docs/05_operations/T1_SMART_FORM_V1_CONTRACT.md` | **Primary** — Smart Form V1 canonical contract | UTV2-303 |
| `docs/05_operations/T1_SMART_FORM_LIVE_OFFER_UX_CONTRACT.md` | Live offer browse UX contract — SGO event/offer surfacing | UTV2-389 |
| `docs/05_operations/SMART_FORM_V1_OPERATOR_SUBMISSION_CONTRACT.md` | Operator submission flow — field contracts, validation rules | UTV2-303 |
| `docs/05_operations/SMART_FORM_V1_PHASE2_SPORT_FILTERING_AND_BETSLIP_UX_CONTRACT.md` | Phase 2 sport filtering and betslip UX — shipped in CS-M5 | CS-M5 |
| `docs/05_operations/SMART_FORM_SPORTSBOOK_CONSTRAINT_CONTRACT.md` | Sportsbook browse-first constraint — active as of UTV2-390 | UTV2-390 |

### Intelligence and Modeling Contracts (ratified 2026-03-31+)

| File | Purpose | Issue |
|---|---|---|
| `docs/05_operations/T1_CLV_CLOSING_LINE_WIRING_CONTRACT.md` | CLV computation, closing line wiring, Pinnacle preference | UTV2-386 |
| `docs/05_operations/T2_CLV_SETTLEMENT_WIRING_CONTRACT.md` | CLV settlement integration contract | active |
| `docs/05_operations/T2_MARKET_KEY_NORMALIZATION_CONTRACT.md` | Market key normalization rules | active |
| `docs/05_operations/T1_CANONICAL_BETTING_TAXONOMY_CONTRACT.md` | Canonical betting taxonomy — market_types, stat_types, combo_stat_types | UTV2-388 |
| `docs/05_operations/T1_CANONICAL_MIGRATION_AND_COMPATIBILITY_CONTRACT.md` | Participant/player migration compatibility rules — **OPEN DEBT** | see §C audit |
| `docs/05_operations/REPLAYABLE_SCORING_CONTRACT.md` | Deterministic promotion replay | UTV2-145 |
| `docs/05_operations/MP_M8_SYNDICATE_MODEL_GOVERNANCE_CONTRACT.md` | Sports Modeling Program — Phase 8 syndicate governance | Phase 7+ |

### Alert and Hedge Contracts (ratified 2026-04-04)

| File | Purpose | Issue |
|---|---|---|
| `docs/05_operations/T1_ALERTAGENT_LINE_MOVEMENT_CONTRACT.md` | AlertAgent line movement detection contract | UTV2-125 |
| `docs/05_operations/T1_ALERT_COMMANDS_CONTRACT.md` | Alert command surface contract | active |
| `docs/05_operations/T2_HEDGE_DETECTION_CONTRACT.md` | Hedge/middle/arbitrage detection contract | active |
| `docs/05_operations/GP_M2_ALERT_AGENT_SUBMISSION_CONTRACT.md` | Alert agent submission flow | UTV2-125 |

### Provider and Ingestion Contracts

| File | Purpose | Issue |
|---|---|---|
| `docs/05_operations/T1_PROVIDER_INGESTION_CONTRACT.md` | SGO feed ingest canonical contract | active |
| `docs/05_operations/T1_FEED_ENTITY_RESOLUTION_CONTRACT.md` | Entity resolution — provider name → canonical player/team | active |
| `docs/05_operations/T2_SGO_RESULTS_INGEST_CONTRACT.md` | SGO results ingest for automated grading | UTV2-385 |
| `docs/05_operations/T1_AUTOMATED_GRADING_CONTRACT.md` | Automated grading from game_results | UTV2-384 |
| `docs/05_operations/T2_OPERATOR_ENTITY_INGEST_HEALTH_CONTRACT.md` | Entity resolution health monitoring | active |

### Governance and Operator Contracts

| File | Purpose | Issue |
|---|---|---|
| `docs/05_operations/T1_CANONICAL_OPERATOR_REVIEW_QUEUE_CONTRACT.md` | Operator review queue — `pick_reviews` + approval_status gate | active |
| `docs/05_operations/T1_CAPPER_ONBOARDING_CONTRACT.md` | Capper onboarding flow | active |
| `docs/05_operations/T1_CAPPER_TIER_SYSTEM_CONTRACT.md` | Capper tier system | active |
| `docs/05_operations/KELLY_POLICY.md` | Kelly criterion stake sizing policy | active |
| `docs/05_operations/RECAP_CONTRACT.md` | Recap generation and delivery contract | active |
| `docs/05_operations/T1_DISCORDRECAPS_ACTIVATION_CONTRACT.md` | Discord recaps activation contract | active |
| `docs/05_operations/T1_EXCLUSIVE_INSIGHTS_ACTIVATION_CONTRACT.md` | Exclusive insights deferred activation contract | deferred |
| `docs/05_operations/T1_REFERENCE_DATA_SEEDING_AND_RECONCILIATION_POLICY.md` | Reference data seeding and reconciliation | active |
| `docs/05_operations/t1_recap_stats_consumer_closeout.md` | Recap stats consumer closeout proof | historical |
| `docs/05_operations/SUPABASE_CONNECTION_STRATEGY.md` | Supabase connection strategy | Platform |
| `docs/05_operations/supabase_setup.md` | Supabase setup runbook | Platform |
| `docs/05_operations/EVENT_IDENTITY_CONTRACT.md` | Event identity resolution contract | active |
| `docs/05_operations/SYSTEM_PICK_CONTRACT.md` | System-generated pick contract | active |
| `docs/05_operations/MEMBER_TIER_MODEL_CONTRACT.md` | Member tier model — `member_tiers` table + Discord role sync | UTV2-149 |
| `docs/05_operations/T2_TRIAL_MANAGEMENT_COMMANDS_CONTRACT.md` | Trial management command surface | active |
| `docs/05_operations/T2_DISCORD_LEADERBOARD_CONTRACT.md` | Discord leaderboard contract | active |
| `docs/05_operations/T2_DISCORD_STATS_CONTRACT.md` | Discord stats command contract | active |
| `docs/05_operations/T2_SMART_FORM_CONFIDENCE_CONTRACT.md` | Smart Form confidence field contract | active |
| `docs/05_operations/PS_M1_COMMERCIAL_FOUNDATION_CONTRACT.md` | Commercial foundation contract | active |
| `docs/05_operations/FASTIFY_EVALUATION.md` | Fastify evaluation — decision made (stayed with node:http) | historical |

## Tier 5 - Current Status

| File | Purpose | Authority Within Tier |
|---|---|---|
| `docs/06_status/PROGRAM_STATUS.md` | Canonical active program status — milestone, capabilities, risks | **Primary — high-level** |
| `docs/06_status/ISSUE_QUEUE.md` | **DEPRECATED 2026-03-31** — historical work queue record; Linear is the live execution queue | Historical only |
| `docs/06_status/PROOF_BUNDLE_SCHEMA.md` | Proof bundle schema definition | Closeout reference |
| `docs/06_status/PROOF_TEMPLATE.md` | Reusable T1 independent verification template | Closeout template |
| `docs/06_status/ROLLBACK_TEMPLATE.md` | Reusable T1 rollback template | Rollback template |
| `docs/06_status/production_readiness_checklist.md` | Production readiness gate checklist | Active reference |
| `docs/06_status/UTV2-464-PHASE2-EVIDENCE-BUNDLE.md` | Phase 2 (Syndicate Machine Foundation) evidence — closed | Historical |
| `docs/06_status/UTV2-471-PHASE3-EVIDENCE-BUNDLE.md` | Phase 3 (Model Scoring) evidence — closed | Historical |
| `docs/06_status/UTV2-473-PHASE4-P401-EVIDENCE.md` | Phase 4 P4-01 (ranked selection) intermediate proof | Historical |
| `docs/06_status/UTV2-475-PHASE4-EVIDENCE-BUNDLE.md` | Phase 4 (Board Construction) evidence — closed | Historical |
| `docs/06_status/INCIDENTS/README.md` | Incident log index — append-only record of live-system, live-DB, schema-drift, and governance-control incidents; authority placement in Tier 5 as operational history | Operational history |

> Note: All `week_*` proof/rollback/closeout templates (Weeks 7–16), completed UTV2-5x proof artifacts, and dated audit snapshots were deleted 2026-04-05. They served no future reference value.

## Schema Debt Register (2026-04-05)

Active schema debts to track alongside Linear issues:

| Debt | Description | Risk | Linear |
|------|-------------|------|--------|
| Dual participant system | `participants`+`participant_memberships` (old) coexist with `leagues`+`teams`+`players`+`player_team_assignments` (new). `picks.participant_id` still FKs to old system. | High | UTV2-398 — T1, needs explicit PM approval |
| `picks` missing FK columns | ~~No `capper_id`, `sport_id`, `market_type_id` FK columns on picks.~~ **RESOLVED** — PR #153 (UTV2-395) adds all three nullable FKs + `derivePickForeignKeyCandidates()`. `player_id` deferred to UTV2-398. | Low | UTV2-395 merged |
| `sport_market_types` redundant | ~~Superseded by `sport_market_type_availability`. Deprecate after consumer migration.~~ **RESOLVED** — PR #155 (UTV2-397) drops table, migrates getCatalog() consumer. | Closed | UTV2-397 merged |
| No `picks_current_state` view | ~~Every consumer surface builds ad-hoc join across picks+promotion+settlement+reviews.~~ **RESOLVED** — PR #154 (UTV2-396) creates view with LATERAL JOINs; pick-search updated. | Closed | UTV2-396 merged |
| `alert-agent` cross-app import | `apps/alert-agent` imports from `apps/api/src/` — violation of no-cross-app rule. | Medium | T2 |

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
