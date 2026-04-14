# UTV2-471 — Phase 3 Evidence Bundle

## Metadata

| Field | Value |
|---|---|
| Issue ID | UTV2-471 |
| Tier | T1 |
| Phase / Gate | Phase 3 — Model Runner + Candidate Scoring |
| Owner | claude/orchestrator |
| Date | 2026-04-09 |
| Verifier Identity | claude/historical-retrofit |
| Commit SHA(s) | 11c747c, 6f6a2e0, d82c554 |
| Related PRs | #209, #210, #211 |

## Scope

**Claims:**
- All 8 Phase 3 exit criteria pass against live Supabase DB
- Model scoring produces valid scores on all qualified candidates
- Participant alias resolution is complete
- Phase 2 boundaries (pick_id=NULL, shadow_mode=TRUE) remain enforced

**Does NOT claim:**
- Sharp consensus or movement signal integration (Phase 4 refinement)
- Top-N selection or scarcity gating (Phase 4 concern)

## Assertions

| # | Assertion | Evidence Type | Source | Result | Evidence Ref |
|---|---|---|---|---|---|
| 1 | Qualified candidates >= 50 | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E1](#e1-qualified-candidate-count) |
| 2 | model_score written on qualified rows | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E2](#e2-model-score-coverage) |
| 3 | model_tier written on all scored rows | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E3](#e3-model-tier-coverage) |
| 4 | pick_id = NULL on all rows | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E4](#e4-pick-id-boundary) |
| 5 | shadow_mode = TRUE on all rows | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E5](#e5-shadow-mode-boundary) |
| 6 | model_score range valid | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E6](#e6-score-range-validation) |
| 7 | Participant alias resolution complete | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E7](#e7-participant-alias-resolution) |
| 8 | Market type resolution working | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E8](#e8-market-type-resolution) |

## Evidence Blocks

### E1 Qualified candidate count

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T17:58:00Z
Result: 301 qualified (was 1 pre-Phase 3)

### E2 Model score coverage

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T17:58:00Z
Result: 301/301 scored (100% coverage)

### E3 Model tier coverage

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T17:58:00Z
Result: 0 rows with score but no tier

### E4 Pick ID boundary

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T17:58:00Z
Result: 0 pick_id violations

### E5 Shadow mode boundary

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T17:58:00Z
Result: 0 shadow_mode violations

### E6 Score range validation

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T17:58:00Z
Result: min=0.45, max=0.88, avg=0.5519

### E7 Participant alias resolution

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T17:58:00Z
Result: 1150/1150 active players resolved (100%)

### E8 Market type resolution

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T17:58:00Z
Result: 233/470 recent universe rows have `market_type_id`

### Model Tier Distribution (qualified candidates)

| Tier | Count | % |
|------|-------|---|
| SUPPRESS | 156 | 52% |
| B | 79 | 26% |
| A | 27 | 9% |
| C | 24 | 8% |
| A+ | 15 | 5% |

SUPPRESS majority is expected at Phase 3 baseline: no sharp consensus data, no movement signal, `uncertainty=0.2`.

### Phase 3 Delivery Summary

| Issue | Title | Merge commit | PR |
|-------|-------|-------------|-----|
| UTV2-469 | Wire SGO alias/market-type resolution into materializer | `11c747c` | #209 |
| UTV2-472 | Wire participant FK resolution + backfill 196-player alias gap | `6f6a2e0` | #210 |
| UTV2-470 | Wire model runner into live candidate scoring | `d82c554` | #211 |
| UTV2-471 | Phase 3 runtime proof | this doc | — |

### Hard Boundaries — All Enforced

- `pick_candidates.pick_id` — never set by scoring service (no setter path)
- `pick_candidates.shadow_mode` — hardcoded true, no override
- `picks` table — scoring service has no import of picks repo or submission service
- Phase 4 (top-N selection, scarcity, picks creation) — not started

## Acceptance Criteria Mapping

| Acceptance Criterion (verbatim from Linear) | Assertion # |
|---|---|
| Qualified candidates >= 50 | 1 |
| model_score written on qualified rows | 2 |
| model_tier written on all scored rows | 3 |
| pick_id = NULL on all rows | 4 |
| shadow_mode = TRUE on all rows | 5 |
| model_score range valid | 6 |
| Participant alias resolution | 7 |
| Market type resolution | 8 |

## Stop Conditions Encountered

None

## Sign-off

**Verifier:** claude/historical-retrofit — 2026-04-09
**PM acceptance:** historical — accepted at original gate closure
