# Docs Taxonomy Audit — 2026-03-29

**Issue:** UTV2-132
**Lane:** claude (governance)
**Date:** 2026-03-29
**Basis:** Full `docs/` tree traversal + authority map cross-check

---

## Classification Key

| Class | Meaning | Action |
|-------|---------|--------|
| `active` | Authoritative, currently relied upon | Keep, maintain |
| `superseded` | Replaced by a newer doc, kept for historical context | Keep, add SUPERSEDED header |
| `archive` | Completed work artifact, no longer authoritative | Keep, no edits needed |
| `delete` | No clear purpose, never ratified, pure execution prompt, or duplicate | Remove |

---

## Tier 1 — Principles

| File | Class | Notes |
|------|-------|-------|
| `docs/01_principles/rebuild_charter.md` | `active` | Core V2 rationale and non-negotiables |
| `docs/01_principles/system_context.md` | `active` | Runtime systems and control boundaries |

---

## Tier 2 — Architecture Contracts

| File | Class | Notes |
|------|-------|-------|
| `docs/02_architecture/domain_model.md` | `active` | Core entity definitions |
| `docs/02_architecture/rebuild_scope.md` | `active` | V2 scope boundaries |
| `docs/02_architecture/contracts/submission_contract.md` | `active` | Intake path rules |
| `docs/02_architecture/contracts/pick_lifecycle_contract.md` | `active` | Lifecycle transition rules |
| `docs/02_architecture/contracts/distribution_contract.md` | `active` | Outbox/receipt rules |
| `docs/02_architecture/contracts/run_audit_contract.md` | `active` | Run + audit visibility |
| `docs/02_architecture/contracts/settlement_contract.md` | `active` | Settlement record rules |
| `docs/02_architecture/contracts/environment_contract.md` | `active` | Credential/env rules |
| `docs/02_architecture/contracts/writer_authority_contract.md` | `active` | Write authority rules |
| `docs/02_architecture/contracts/board_promotion_contract.md` | `active` | Referenced in authority map — verify file exists |
| `docs/02_architecture/SMART_FORM_V1_OPERATOR_SUBMISSION_SPEC.md` | `superseded` | Superseded by SMART_FORM_V1_OPERATOR_SUBMISSION_CONTRACT.md |
| `docs/02_architecture/full_cycle_runtime_proof_blueprint.md` | `archive` | Pre-M11 proof blueprint, superseded by PROOF_TEMPLATE.md |
| `docs/02_architecture/salvaged_domain_runtime_consumption_plan.md` | `archive` | Week 14–19 salvage plan — work complete, historical record |
| `docs/02_architecture/week_19_downstream_consumer_matrix.md` | `archive` | Week 19 work complete |
| `docs/02_architecture/doc_truth_gate_v1_scope_inventory.md` | `archive` | Week 19 scope inventory — work complete |
| `docs/02_architecture/week_20_e2e_validation_surface_matrix.md` | `archive` | Week 20 work complete |

---

## Tier 3 — Product Contracts

| File | Class | Notes |
|------|-------|-------|
| `docs/03_product/best_bets_channel_contract.md` | `active` | Best Bets identity and qualification |
| `docs/03_product/program_surfaces.md` | `active` | Canonical surface definitions |
| `docs/03_product/command_center_truth_surface_prd.md` | `superseded` | Superseded by operator-web implementation (M10+). Keep for product history. |
| `docs/03_contracts/consumer_classification_governance.md` | `active` | Domain consumer classification rules |
| `docs/03_contracts/domain_analysis_consumer_contract.md` | `active` | Domain analysis consumer contract |

---

## Tier 4 — Roadmap

| File | Class | Notes |
|------|-------|-------|
| `docs/04_roadmap/active_roadmap.md` | `superseded` | Superseded by PROGRAM_STATUS.md as of 2026-03-21. Keep as historical context. |
| `docs/04_roadmap/bootstrap_plan.md` | `archive` | Bootstrap work complete. Historical. |

---

## Tier 5 — Operational Docs (docs/05_operations/)

### Active — Keep

| File | Class | Notes |
|------|-------|-------|
| `docs_authority_map.md` | `active` | This file + cross-ref |
| `discord_routing.md` | `active` | Canonical Discord target taxonomy |
| `supabase_setup.md` | `active` | Live DB setup, migration history |
| `legacy_repo_reference_boundary.md` | `active` | Legacy boundary rules |
| `migration_ledger.md` | `active` | Salvage ledger |
| `runtime_restart_and_deploy_sop.md` | `active` | SOP for deploys |
| `trader_insights_graduation_criteria.md` | `active` | Graduation criteria for trader-insights |
| `week_12_settlement_hardening_contract.md` | `active` | Settlement hardening — implementation reference |
| `week_13_operator_trader_insights_health_contract.md` | `active` | Trader insights health — implementation reference |
| `SMART_FORM_V1_OPERATOR_SUBMISSION_CONTRACT.md` | `active` | Smart form v1 contract |
| `t1_recap_stats_consumer_closeout.md` | `active` | Recap stats consumer — closeout record |
| `week_11_trader_insights_activation.md` | `active` | Trader insights activation record |
| `week_7_best_bets_activation.md` | `active` | Best bets activation record |
| `PICK_METADATA_CONTRACT.md` | `active` | Wave 1 contract (new) |
| `ALERT_AGENT_EXTRACTION_CONTRACT.md` | `active` | Wave 1 contract (new) |
| `RUNTIME_MODE_CONTRACT.md` | `active` | Wave 1 contract (new) |
| `DELIVERY_ADAPTER_HARDENING_CONTRACT.md` | `active` | Wave 2 contract (new) |
| `DISCORD_CIRCUIT_BREAKER_CONTRACT.md` | `active` | Wave 2 contract (new) |
| `MODEL_REGISTRY_CONTRACT.md` | `active` | Wave 2 contract (new) |
| `REPLAYABLE_SCORING_CONTRACT.md` | `active` | Wave 2 contract (new) |
| `MEMBER_TIER_MODEL_CONTRACT.md` | `active` | Wave 2 contract (new) |
| `PROMOTION_TARGET_REGISTRY_CONTRACT.md` | `active` | Wave 2 contract (new) |

### Referenced in authority map but not verified present — CHECK

| File | Status |
|------|--------|
| `AGENT_OPERATING_MODEL.md` | Referenced in authority map — verify exists |
| `delivery_operating_model.md` | Referenced in authority map — verify exists |
| `canary_graduation_criteria.md` | Referenced in authority map — verify exists |
| `risk_register.md` | Referenced in authority map — verify exists |
| `migration_cutover_plan.md` | Referenced in authority map — verify exists |
| `UTV2-106_WORKER_RUNTIME_CONTRACT.md` | Referenced in authority map — verify exists |
| `SPRINT_MODEL_v2.md` | PROGRAM_STATUS.md references this as active — verify exists |

### Superseded — Keep as historical

| File | Class | Notes |
|------|-------|-------|
| `settlement_planning.md` | `superseded` | Pre-W8 planning doc. Settlement is live. Historical. |
| `week_8_settlement_readiness_review.md` | `superseded` | Pre-W8 readiness review. Complete. |
| `week_9_readiness_decision.md` | `superseded` | Pre-W9 readiness. Complete. |
| `SPRINT_MODEL_v2_PROPOSAL.md` | `superseded` | Superseded by ratified SPRINT_MODEL_v2.md (if it exists). |
| `week_14_verification_control_plane_salvage_contract.md` | `archive` | W14 work complete |
| `week_15_probability_devig_salvage_contract.md` | `archive` | W15 work complete |
| `week_16_settlement_downstream_loss_attribution_contract.md` | `archive` | W16 work complete |
| `week_17_git_baseline_ratification_contract.md` | `archive` | W17 work complete |
| `week_18_domain_integration_layer_contract.md` | `archive` | W18 work complete |
| `week_19_promotion_edge_integration_contract.md` | `archive` | W19 work complete |
| `week_19_doc_truth_gate_scope_hardening_contract.md` | `archive` | W19 work complete |
| `week_20_e2e_platform_validation_contract.md` | `archive` | W20 work complete |
| `week_21_promotion_scoring_enrichment_contract.md` | `archive` | W21 work complete |
| `week_9_full_lifecycle_contract.md` | `archive` | W9 work complete |
| `week_10_operator_command_center_contract.md` | `archive` | W10 work complete |
| `week_8_settlement_runtime_contract.md` | `archive` | W8 work complete |
| `week_6_execution_contract.md` | `archive` | W6 work complete |
| `smart_form_phase1_audit_handoff_note.md` | `archive` | Phase 1 complete |
| `SMART_FORM_V1_PHASE2_SPORT_FILTERING_AND_BETSLIP_UX_CONTRACT.md` | `archive` | Phase 2 scope doc — verify if implemented |

### Delete — No surviving purpose

| File | Reason |
|------|--------|
| `claude_week_6_execution_prompt.md` | One-time execution prompt. Work done. Not a governance artifact. |
| `claude_linear_build_prompt.md` | Bootstrap prompt for Linear setup. Used once. |
| `linear_update_pack.md` | One-time Linear update payload. Used once. |
| `notion_update_pack.md` | One-time Notion update payload. Used once. |
| `linear_finish_pack.md` | One-time Linear finish pack. Used once. |
| `linear_issue_pack.md` | Bootstrap issue creation pack. Done. |
| `agent_team_charter_v2_scoring_promotion.md` | Old agent team charter. Superseded by AGENTS.md rewrite. |
| `agent_team_run_template.md` | Old run template from agent team era. Superseded. |
| `team_01_run_001.md` | Single run record from old agent team. No governance value. |
| `notion_setup.md` | One-time setup doc. Notion is set up. |
| `slack_setup.md` | One-time setup doc. Slack is set up (or not used). |
| `tooling_setup.md` | One-time setup doc. Tooling is set up. |
| `repo_bootstrap.md` | Bootstrap-only doc. Repo is bootstrapped. |
| `linear_setup.md` | Bootstrap-only doc. Linear is set up. |

---

## Tier 5 — Status Files (docs/06_status/)

### Active — Keep

| File | Class | Notes |
|------|-------|-------|
| `PROGRAM_STATUS.md` | `active` | Primary program status authority |
| `ISSUE_QUEUE.md` | `active` | Operational work queue |
| `PROOF_TEMPLATE.md` | `active` | T1 proof template |
| `ROLLBACK_TEMPLATE.md` | `active` | T1 rollback template |
| `PROOF_BUNDLE_SCHEMA.md` | `active` | New — standardized proof bundle schema (UTV2-157) |
| `supabase_hardening_audit_2026-03-29.md` | `active` | UTV2-139 audit (new) |

### Superseded — Keep as historical

| File | Class | Notes |
|------|-------|-------|
| `status_source_of_truth.md` | `superseded` | Already marked superseded in authority map |
| `current_phase.md` | `superseded` | Already marked superseded |
| `next_build_order.md` | `superseded` | Already marked superseded |

### Archive — Historical proof/rollback records

| File | Class |
|------|-------|
| `week_7_proof_bundle_template.md` | `archive` |
| `week_7_rollback_record_template.md` | `archive` |
| `week_7_artifact_index.md` | `archive` |
| `week_8_proof_template.md` | `archive` |
| `week_8_failure_note_template.md` | `archive` |
| `week_8_first_settlement_proof_template.md` | `archive` |
| `week_9_full_lifecycle_proof_template.md` | `archive` |
| `week_9_failure_note_template.md` | `archive` |
| `week_10_closeout_checklist.md` | `archive` |
| `week_11_proof_template.md` | `archive` |
| `week_11_failure_rollback_template.md` | `archive` |
| `week_11a_closeout_checklist.md` | `archive` |
| `week_12_proof_template.md` | `archive` |
| `week_12_failure_rollback_template.md` | `archive` |
| `week_13_proof_template.md` | `archive` |
| `week_13_failure_rollback_template.md` | `archive` |
| `week_14_proof_template.md` | `archive` |
| `week_14_failure_rollback_template.md` | `archive` |
| `week_15_proof_template.md` | `archive` |
| `week_15_failure_rollback_template.md` | `archive` |
| `week_16_proof_template.md` | `archive` |
| `week_16_failure_note_template.md` | `archive` |
| `week_16_closeout_checklist.md` | `archive` |

---

## Discord / Audits Directories

| File | Class | Notes |
|------|-------|-------|
| `docs/discord/discord_embed_system_spec_addendum_assets.md` | `active` | Discord embed spec — still relevant |
| `docs/discord/daily_cadence_spec.md` | `active` | Daily cadence specification |
| `docs/discord/discord_message_contract_matrix.md` | `active` | Message contract matrix |
| `docs/audits/v2_score_promotion_truth_audit.md` | `archive` | Pre-Wave 1 scoring audit. Superseded by MODEL_REGISTRY_CONTRACT.md bug discovery. Keep as historical. |

---

## Immediate Actions

### Delete (10 files — pure execution prompts and one-time packs)

```
docs/05_operations/claude_week_6_execution_prompt.md
docs/05_operations/claude_linear_build_prompt.md
docs/05_operations/linear_update_pack.md
docs/05_operations/notion_update_pack.md
docs/05_operations/linear_finish_pack.md
docs/05_operations/linear_issue_pack.md
docs/05_operations/agent_team_charter_v2_scoring_promotion.md
docs/05_operations/agent_team_run_template.md
docs/05_operations/team_01_run_001.md
```

Bootstrap-only setup docs (low risk — repo is bootstrapped, setup is done):
```
docs/05_operations/notion_setup.md
docs/05_operations/slack_setup.md
docs/05_operations/tooling_setup.md
docs/05_operations/repo_bootstrap.md
docs/05_operations/linear_setup.md
```

### Files to verify exist (referenced in authority map but not confirmed)

Before updating authority map, confirm these exist:
- `docs/05_operations/AGENT_OPERATING_MODEL.md`
- `docs/05_operations/delivery_operating_model.md`
- `docs/05_operations/canary_graduation_criteria.md`
- `docs/05_operations/risk_register.md`
- `docs/05_operations/migration_cutover_plan.md`
- `docs/05_operations/UTV2-106_WORKER_RUNTIME_CONTRACT.md`
- `docs/05_operations/SPRINT_MODEL_v2.md`
- `docs/02_architecture/contracts/board_promotion_contract.md`

### Update docs_authority_map.md

After deletion:
1. Remove deleted files from any tables they appear in
2. Add new Wave 1/2 contracts to Tier 4
3. Mark superseded files explicitly
4. Add Wave 1 hardening contracts section

---

## Verdict

**54 files classified.** 14 are `delete` candidates. All are one-time execution prompts, bootstrap setup docs, or agent team run records with no governance value. No architectural contracts, active week contracts, or proof templates are in the delete list.

The `archive` set (25 files) covers Weeks 6–21 historical records. They should remain but not be edited or relied upon for current state.

The `superseded` set (7 files) should have a one-line header added: `> **SUPERSEDED <date>** — See <successor doc>`.
