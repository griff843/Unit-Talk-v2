# Unit Talk V2 — Canonical Document Index

> **SUPERSEDED 2026-03-31.** This file is a historical snapshot. The authoritative document index is `docs/05_operations/docs_authority_map.md`. Do not use this file for current-state decisions.

> Generated: 2026-03-24.
> Lists every authority document, its role, and whether it is actively maintained.

---

## Tier 1 — Program Authority (always current)

| File | Role | Updated when |
|------|------|-------------|
| `docs/06_status/PROGRAM_STATUS.md` | **Canonical active program status.** Wins on conflict with all other docs. Sprint log, gate status, live routing, open risks. | Every sprint close |
| `docs/06_status/system_snapshot.md` | Runtime evidence record. Specific IDs, receipts, proof chains, weekly verification closeouts. | When runtime state changes (T1/T2) |
| `docs/05_operations/SPRINT_MODEL_v2.md` | Operating model. Defines T1/T2/T3 tiers, governance requirements per tier, sync cadence. | When operating model changes |
| `docs/05_operations/docs_authority_map.md` | Authority tier map for all docs in this repo. | When doc structure changes |

---

## Tier 2 — Active Policy (governs current behavior)

| File | Role | Status |
|------|------|--------|
| `docs/discord/pick_promotion_interim_policy.md` | Promotion policy — defines pick lanes, Smart Form lane, EV/edge display rule, ratified decisions. Active until superseded by permanent policy. | **INTERIM — ACTIVE** |
| `docs/discord/discord_embed_system_spec.md` | Discord embed format, field specs, EV/edge display preconditions. | Active |
| `docs/discord/discord_message_contract_matrix.md` | Message type × channel matrix. | Active |
| `docs/discord/daily_cadence_spec.md` | Daily delivery cadence spec. | Active |
| `docs/discord/discord_embed_system_spec_addendum_assets.md` | Asset addendum for embed spec. | Active |

---

## Tier 3 — Implementation Contracts (per-sprint)

Sprint contracts live in `docs/05_operations/`. Most recent active contracts:

| File | Sprint | Tier |
|------|--------|------|
| (No active contract — between sprints as of 2026-03-24) | — | — |

Recent closed contracts (for historical reference):
- `week_13_operator_trader_insights_health_contract.md` — T2 — CLOSED
- `week_12_settlement_hardening_contract.md` — T1 — CLOSED
- `week_11_trader_insights_activation.md` — T1 — CLOSED

---

## Tier 4 — Audit Records

| File | Role |
|------|------|
| `docs/audits/v2_score_promotion_truth_audit.md` | Code-grounded basis for promotion policy. Traces every scoring constant, gate, and fallback to actual source code. |

---

## Tier 5 — Operational Guides

| File | Role |
|------|------|
| `docs/05_operations/discord_routing.md` | Canonical V2 target taxonomy, channel IDs, delivery modes, architectural gaps |
| `docs/05_operations/supabase_setup.md` | Table ownership, migration list, type generation path, schema decisions |
| `docs/05_operations/delivery_operating_model.md` | Worker delivery operating model |
| `docs/05_operations/canary_graduation_criteria.md` | Canary → best-bets graduation criteria |
| `docs/05_operations/trader_insights_graduation_criteria.md` | Trader-insights graduation criteria |
| `docs/05_operations/runtime_restart_and_deploy_sop.md` | Runtime restart and deploy SOP |

---

## Tier 6 — Proof Templates (reusable, not per-sprint)

| File | Role |
|------|------|
| `docs/06_status/PROOF_TEMPLATE.md` | Reusable T1 sprint proof template |
| `docs/06_status/ROLLBACK_TEMPLATE.md` | Reusable T1 sprint rollback template |

---

## Tier 7 — AI Context (this folder)

| File | Role |
|------|------|
| `docs/ai_context/v2_truth_pack/CURRENT_SYSTEM_TRUTH.md` | Platform overview, state, flow summary |
| `docs/ai_context/v2_truth_pack/REPO_MAP.md` | File and directory layout, key exports |
| `docs/ai_context/v2_truth_pack/PICK_LIFECYCLE_TRUTH.md` | Lifecycle states, transitions, DB schema facts |
| `docs/ai_context/v2_truth_pack/DISCORD_STATE_TRUTH.md` | Channel state, routing gates, embed specs |
| `docs/ai_context/v2_truth_pack/LAUNCH_BLOCKERS.md` | Open risks, blocked channels, next milestone |
| `docs/ai_context/v2_truth_pack/CANONICAL_DOC_INDEX.md` | This file |
| `docs/ai_context/v2_truth_pack/HANDOFF_FOR_CHATGPT.md` | Condensed handoff for cold-session AI assistants |

---

## Superseded / Historical (do not maintain)

| File | Superseded by |
|------|--------------|
| `docs/06_status/status_source_of_truth.md` | `PROGRAM_STATUS.md` |
| `docs/06_status/current_phase.md` | `PROGRAM_STATUS.md` |
| `docs/06_status/next_build_order.md` | `PROGRAM_STATUS.md` |
| `docs/05_operations/week_*_contract.md` (Weeks 6–12) | Historical record — do not update |
| `docs/06_status/week_*_proof_template.md` (Weeks 7–16) | Historical record — do not update |
| `docs/05_operations/SPRINT_MODEL_v2_PROPOSAL.md` | `SPRINT_MODEL_v2.md` (proposal adopted) |

---

## Authority Rule (from CLAUDE.md)

> **Runtime leads docs.**
> - docs define intent
> - runtime enforces truth
> - tests prove runtime truth
> - docs update only to match enforced reality

If something exists only in docs: say `docs-only`.
If something exists only in config: say `config-only`.
If something exists only in tests: say `test-only`.

`docs/06_status/PROGRAM_STATUS.md` wins on conflict with all other documents.
