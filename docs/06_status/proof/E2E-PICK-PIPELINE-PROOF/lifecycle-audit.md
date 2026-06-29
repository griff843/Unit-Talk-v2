# Lifecycle Audit — E2E Proof Picks

**Date:** 2026-06-29

---

## Proof Pick A: Evidence Plane (No Public Delivery)

**Pick ID:** `a122bcca-602a-4e2f-8b0e-1853278e9043`  
**Source:** `system-pick-scanner`  
**Market:** `player_batting_total_bases_ou`  
**Selection:** `under`  
**Odds:** (from market_universe)  
**Event ID:** `28d77119-34b6-46dc-b534-72302ad9ac5c`  
**Market Universe ID:** `c17630c2-03af-4298-ac5a-9503c5f4ccdc`  
**Scored Candidate ID:** `45cf776d-b2f7-4f79-9dd5-17ce98fe832a`

### Lifecycle Events

| from_state | to_state | writer_role | reason | timestamp |
|------------|----------|-------------|--------|-----------|
| null | validated | submitter | validated submission materialized into canonical pick | 2026-06-29 11:10:18 UTC |
| validated | awaiting_approval | promoter | governance brake: non-human source system-pick-scanner | 2026-06-29 11:10:24 UTC |

### Audit Log (pick_id = a122bcca)

| entity_type | action | actor | timestamp |
|-------------|--------|-------|-----------|
| pick_promotion_history | promotion.suppressed | system | 2026-06-29 11:10:23 UTC |
| pick_promotion_history | promotion.suppressed | system | 2026-06-29 11:10:23 UTC |
| pick_promotion_history | promotion.suppressed | system | 2026-06-29 11:10:24 UTC |
| settlement_records | settlement.evidence_graded | grading-service | 2026-06-29 12:48:10 UTC |
| pick_offer_snapshot_write_failure | closing_for_clv_snapshot_write_failed | settlement-service | 2026-06-29 12:48:10 UTC |

### Promotion History (pick_promotion_history)

| target | status | score | reason |
|--------|--------|-------|--------|
| best-bets | not_eligible | 33.83 | outside posting window; Kelly=0; board cap reached; below confidence floor |
| exclusive-insights | not_eligible | 34.54 | outside posting window; Kelly=0; below confidence floor; edge 46.52 < 90.00; trust 55 < 88.00 |
| trader-insights | not_eligible | 35.07 | outside posting window; Kelly=0; below confidence floor; edge 46.52 < 85.00; trust 55 < 85.00 |

### Settlement Record

**Settlement ID:** `dba9306b-884f-4aa0-b72d-edf46d01d02d`  
**Result:** `loss`  
**Status:** `settled`  
**Evidence Ref:** `game-result:493c640d-aa2d-40f6-86d5-7678a5df3f83`  
**Actual Value:** `1`  
**Stake Units:** `1.00`  
**Settled At:** `2026-06-29 12:48:09 UTC`

**CLV:**
- clvRaw: 0.034949
- clvPercent: 3.4949
- closingLine: 0.5
- closingOdds: -141
- beatsClosingLine: true
- closingSnapshotAt: 2026-06-28T03:00:16.917Z
- closingSourceVerification: rank=1, isVerified=true, sourceType=market_universe_provenance

**ROI (from audit_log payload):**
- profitLossUnits: -1
- flat_bet_roi: { roi_pct: -100, total_profit: -110, total_wagered: 110 }
- lossAttribution: UNKNOWN (no feature snapshot available)

**Evidence plane confirmed:** `evidencePlane: true` in payload

---

## Proof Pick B: Governance → Promotion → Settlement (Historical)

**Pick ID:** `26e4adb9-a059-45db-8a32-ab96cda71ed8`  
**Source:** `system-pick-scanner`  
**Market:** `player_rebounds_ou`  
**Selection:** `over`  
**Odds:** -148  
**Created:** 2026-04-28 02:49:00 UTC

### Lifecycle Events

| from_state | to_state | writer_role | timestamp |
|------------|----------|-------------|-----------|
| null | validated | submitter | 2026-04-28 |
| validated | awaiting_approval | promoter | 2026-04-28 |
| awaiting_approval | queued | (operator review) | 2026-04-28 |
| queued | posted | poster | 2026-04-28 |
| posted | settled | settler | after game |

**promotion_status:** qualified  
**approval_status:** approved  
**Status:** settled  

This pick proves the governance brake → operator approval → promotion → settlement path works.

---

## System-Wide Settlement Stats (2026-06-29)

| Metric | Value |
|--------|-------|
| Evidence-graded settlements with CLV today | Multiple (a122bcca, d04c9989, 340dd9cb...) |
| Evidence settlements with profitLossUnits | 1,463 / 1,463 (100%) |
| Total game_results | 129,958 |
| Total picks settled | 7,985 |
