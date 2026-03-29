# T1 Docs Program — Follow-On Queue

**Issue:** UTV2-159 (umbrella)
**Date:** 2026-03-29
**Lane:** claude (governance)

This file documents the sequenced follow-on work after the initial T1 docs pass (UTV2-159). The initial pass completed the product-tier rebuild and authority alignment. What remains is a second pass focused on architecture contract depth, surface parity, and doc lifecycle hardening.

---

## What Was Done in UTV2-159 (Initial Pass)

- Wrote `TRADER_INSIGHTS_CHANNEL_CONTRACT.md` — Trader Insights product identity
- Wrote `DISCORD_RECAPS_CHANNEL_CONTRACT.md` — Recaps channel identity and delivery rules
- Wrote `PLATFORM_SURFACES_AUTHORITY.md` — Full platform surface registry replacing 6-line stub
- Wrote `DISCORD_COMMAND_CATALOG.md` — Authoritative live command registry
- Bannered 8 stale/draft docs in `docs/03_product/` and `docs/02_architecture/`
- Updated `docs_authority_map.md` — registered new product docs, classified all unregistered directories (`docs/discord/`, `docs/ai_context/`, `docs/03_contracts/`)
- Fixed `tier_system_design_spec.md` banner references (stale audit links removed)

---

## Follow-On Queue (Sequenced)

### Priority 1 — Architecture Contract Depth Pass

The architecture contracts in `docs/02_architecture/contracts/` are accurate but principle-only. They define rules but lack runtime specificity (which service owns each rule, which table enforces it, where tests verify it).

**Candidates for depth pass:**

| Contract | Gap |
|----------|-----|
| `submission_contract.md` | Add: which service writes each field, domain analysis enrichment path, fail-open rules |
| `distribution_contract.md` | Add: dead-letter threshold, receipt idempotency rules, worker-to-channel routing map |
| `settlement_contract.md` | Add: correction chain rules, manual review path, feed settlement block |
| `pick_lifecycle_contract.md` | Add: allowed state machine diagram, who calls each transition, lifecycle service location |
| `run_audit_contract.md` | Add: system_runs shape, audit_log entity_id vs entity_ref disambiguation |
| `board_promotion_contract.md` | Add: current policy versions and thresholds, how domain analysis informs scoring |

**Estimated effort:** 1 Claude sprint per contract. Can batch 2–3 per sprint.

---

### Priority 2 — Exclusive Insights Channel Contract

`discord:exclusive-insights` has a T1 activation contract (`T1_EXCLUSIVE_INSIGHTS_ACTIVATION_CONTRACT.md`) but no product-identity contract parallel to `best_bets_channel_contract.md` or `TRADER_INSIGHTS_CHANNEL_CONTRACT.md`.

Once the channel is activated (UTV2-87), write:
- `docs/03_product/EXCLUSIVE_INSIGHTS_CHANNEL_CONTRACT.md`

Do not write this before activation. The activation contract covers what is needed for implementation. The product identity contract should follow once the channel is live and the product behavior is confirmed.

---

### Priority 3 — Role Access Authority Doc

`ROLE_ACCESS_MATRIX.md` is a "Draft v1" design spec. The `member_tiers` table and Discord role sync are now ratified (UTV2-149). Once that implementation is live:

Write:
- `docs/03_product/MEMBER_ROLE_ACCESS_AUTHORITY.md`

This should be a Tier 3 product contract that describes the actual enforced role access model (not a design spec). It should reflect:
- DB-backed tier states (from `member_tiers`)
- Which Discord channels each tier can access
- Trial expiry behavior
- Role sync mechanism

**Prerequisite:** UTV2-149 implementation merged and verified.

---

### Priority 4 — Docs/ai_context Lifecycle

The `docs/ai_context/` directory contains stale truth packs and handoff docs that no longer serve any governance purpose. They were classified as `archive` or `superseded` in the authority map (UTV2-159). The follow-on action is:

1. Create `docs/ai_context/README.md` with a one-line explanation: "This directory contains historical AI context packs and handoff docs. None of these are authoritative. See `docs/05_operations/docs_authority_map.md` for current authority references."
2. Optionally delete `v2_truth_pack/` entirely — all files superseded. Low risk.

**Effort:** 30 minutes. Low priority.

---

### Priority 5 — System Snapshot Refresh

`docs/06_status/system_snapshot.md` is explicitly listed as stale in `PROGRAM_STATUS.md` (last accurate 2026-03-21). It contains specific runtime evidence (IDs, receipts, proof bundles) that was accurate at Week 21 close.

Options:
1. Refresh with current-state evidence (requires a live proof run)
2. Add a prominent stale banner and reference PROGRAM_STATUS.md
3. Archive it and rely solely on PROGRAM_STATUS.md

**Recommended:** Add stale banner (option 2). Full refresh requires a proof run, which should be its own sprint. Do not block this queue item on that.

---

### Priority 6 — PROGRAM_STATUS.md `Key Capabilities` Freshness Pass

The `Key Capabilities` section in `PROGRAM_STATUS.md` reflects M13 state (last verified 2026-03-28). As Wave 2 Codex items complete (UTV2-148, UTV2-124, UTV2-126, etc.), capabilities need to be updated.

This is an ongoing maintenance responsibility, not a one-time task. Each T1/T2 sprint close should include a capabilities update.

**Action:** Confirm this is part of the T1/T2 sprint close checklist in `SPRINT_MODEL_v2.md`.

---

## Items Deliberately Excluded from Follow-On Queue

The following items were assessed and excluded:

| Item | Reason excluded |
|------|-----------------|
| `docs/discord/daily_cadence_spec.md` depth pass | Content is still directionally correct — not a priority |
| `docs/04_roadmap/` files | Superseded. No follow-on work needed. |
| Old week contracts (Weeks 6–21) | Archive status is correct. No changes needed. |
| Legacy `docs/ai_context/HANDOFF_FOR_CHATGPT.md` | Archive. No follow-on. |
| `tier_system_design_spec.md` full rewrite | Not yet implementable — scoring rebuild not started. Rewrite when ready. |

---

## Queue Summary

| Priority | Item | Prerequisite | Effort |
|----------|------|-------------|--------|
| 1 | Architecture contract depth pass (6 contracts) | None | 2–3 Claude sprints |
| 2 | Exclusive Insights channel contract | UTV2-87 activation complete | 1 Claude sprint |
| 3 | Member role access authority doc | UTV2-149 implementation live | 1 Claude sprint |
| 4 | ai_context README + optional deletion | None | 30 min |
| 5 | system_snapshot.md stale banner | None | 15 min |
| 6 | PROGRAM_STATUS.md capabilities freshness | Each T1/T2 sprint close | Ongoing |
