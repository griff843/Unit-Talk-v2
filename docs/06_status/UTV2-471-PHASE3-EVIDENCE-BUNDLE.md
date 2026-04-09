# UTV2-471 — Phase 3 Evidence Bundle

**Status:** COMPLETE
**Date:** 2026-04-09
**Verified by:** Claude Code orchestrator + live Supabase DB (feownrheeefbcsehtsiw)

---

## Phase 3 Delivery Summary

| Issue | Title | Merge commit | PR |
|-------|-------|-------------|-----|
| UTV2-469 | Wire SGO alias/market-type resolution into materializer | `11c747c` | #209 |
| UTV2-472 | Wire participant FK resolution + backfill 196-player alias gap | `6f6a2e0` | #210 |
| UTV2-470 | Wire model runner into live candidate scoring | `d82c554` | #211 |
| UTV2-471 | Phase 3 runtime proof | this doc | — |

---

## Exit Criteria — All Checks PASS

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Qualified candidates ≥ 50 | **PASS** | 301 qualified (was 1 pre-Phase 3) |
| 2 | `model_score` written on qualified rows | **PASS** | 301/301 scored (100%) |
| 3 | `model_tier` written on all scored rows | **PASS** | 0 rows with score but no tier |
| 4 | `pick_id` = NULL on all rows | **PASS** | 0 violations |
| 5 | `shadow_mode` = TRUE on all rows | **PASS** | 0 violations |
| 6 | `model_score` range valid | **PASS** | min=0.45, max=0.88, avg=0.55 |
| 7 | Participant alias resolution | **PASS** | 1150/1150 active players resolved (100%) |
| 8 | Market type resolution | **PASS** | 233/470 recent universe rows have `market_type_id` |

---

## Live DB State (verified 2026-04-09T17:58)

```sql
qualified:            301
qualified_scored:     301   ← 100% coverage
pick_id_violations:   0     ← boundary enforced
shadow_mode_violations: 0   ← boundary enforced
score_without_tier:   0     ← tier always set when score set

model_score range:    [0.45, 0.88]
model_score avg:      0.5519
```

### Model Tier Distribution (qualified candidates)

| Tier | Count | % |
|------|-------|---|
| SUPPRESS | 156 | 52% |
| B | 79 | 26% |
| A | 27 | 9% |
| C | 24 | 8% |
| A+ | 15 | 5% |

SUPPRESS majority is expected at Phase 3 baseline: no sharp consensus data, no movement signal, `uncertainty=0.2`. Higher tiers (A/A+) represent candidates with `fair_over_prob` or `fair_under_prob` clearly above breakeven.

---

## Phase 3 Architecture

```
provider_offers (SGO ingestor)
  → market_universe (materializer — participant + alias resolution live)
    → pick_candidates (board scan — status=qualified/rejected)
      → CandidateScoringService (model_score/model_tier/model_confidence written)
        → Phase 4: top-N selection, scarcity gating, picks creation
```

**Phase 3 scoring model (baseline):**
- `p_market_devig = fair_over_prob` or `fair_under_prob` (higher side)
- `model_score = computeModelBlend(p_market_devig, p_market_devig, 0, 0).p_final_v2`
- `model_tier = initialBandAssignment(edge, uncertainty=0.2, liquidityTier='unknown').band`
- `model_confidence = 0.8` (1 − baseline_uncertainty)
- No sharp consensus, no movement signal — Phase 4 refinement

---

## Hard Boundaries — All Enforced

- `pick_candidates.pick_id` — never set by scoring service (no setter path)
- `pick_candidates.shadow_mode` — hardcoded true, no override
- `pick_candidates.model_score/model_tier/model_confidence` — only written by `CandidateScoringService`; board scan and materializer never touch these fields
- `picks` table — scoring service has no import of picks repo or submission service
- Phase 4 (top-N selection, scarcity, picks creation) — not started

---

## Phase 4 Gate Status

**OPEN** — all Phase 3 exit criteria met.

Phase 4 first dependency: ranked candidate selection (top-N from SUPPRESS-filtered pool) and governance gate before `picks` creation can begin.
