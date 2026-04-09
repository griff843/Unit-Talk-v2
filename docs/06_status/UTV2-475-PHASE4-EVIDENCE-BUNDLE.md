# UTV2-475 — Phase 4 Evidence Bundle

**Status:** COMPLETE
**Date:** 2026-04-09
**Verified by:** Claude Code orchestrator + live Supabase DB (feownrheeefbcsehtsiw)

---

## Phase 4 Delivery Summary

| Issue | Title | Merge commit | PR |
|-------|-------|-------------|-----|
| UTV2-473 | Ranked candidate selection service — P4-01 | `4189f9d` | #212 |
| UTV2-474 | Board construction service — P4-02 | `f1c3acc` | #213 |
| UTV2-475 | Phase 4 runtime proof | this doc | — |

---

## Exit Criteria — All 14 Checks PASS

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | `pick_candidates` has `selection_rank` column | **PASS** | field present on all rows |
| 2 | `pick_candidates` has `is_board_candidate` column | **PASS** | field present on all rows |
| 3 | Ranked pool populated (`is_board_candidate=true` rows > 0) | **PASS** | 301 board candidates |
| 4 | `selection_rank = 1` exists (exactly 1 row) | **PASS** | rank_1_count=1 |
| 5 | Rank sequence is contiguous (max = count) | **PASS** | max=301, count=301 |
| 6 | `syndicate_board` table exists | **PASS** | board run inserted successfully |
| 7 | At least one board run exists | **PASS** | 12 rows in latest run |
| 8 | Latest board run obeys size cap (≤ 20) | **PASS** | board_size=12 |
| 9 | Latest board run obeys sport cap (≤ 6 per sport) | **PASS** | max_per_sport=6 |
| 10 | Latest board run contains no SUPPRESS-tier candidates | **PASS** | suppress_on_board=0 |
| 11 | No writes to `picks` table from board construction path | **PASS** | errors=0, no picks import in service |
| 12 | `pick_id` remains NULL on all `pick_candidates` | **PASS** | 0 violations |
| 13 | `shadow_mode` remains TRUE on all `pick_candidates` | **PASS** | 0 violations |
| 14 | No governance / approval logic in P4-01 or P4-02 | **PASS** | code review verified — no picks repo, no submission service import |

---

## Live DB State (verified 2026-04-09T19:59:33Z)

```
Ranked candidates:        301   ← all qualified+scored
min(selection_rank):      1
max(selection_rank):      301   ← contiguous 1..301
pick_id violations:       0     ← boundary enforced
shadow_mode violations:   0     ← boundary enforced

Board construction run:
  boardSize:              12
  boardRunId:             9e494126-7c45-4522-ae6a-35b2cf1dd3ad
  skippedSuppress:        156   ← SUPPRESS floor working
  skippedBoardCap:        0     ← cap not hit (12 < 20)
  skippedSportCap:        116   ← sport diversity enforced
  skippedMarketDup:       17    ← market dedup enforced
  errors:                 0
  durationMs:             470
```

### Board Composition (latest run)

| Tier | Count |
|------|-------|
| A+ | 3 |
| A | 4 |
| B | 5 |

**Sport distribution:** MLB=6, NBA=6 (sport cap=6 exactly reached for both)

**Top 5 board slots:**

| Rank | Score | Tier | Sport | Market |
|------|-------|------|-------|--------|
| 1 | 0.8800 | A+ | MLB | player_batting_triples_ou |
| 2 | 0.8778 | A+ | MLB | player_batting_triples_ou |
| 3 | 0.8766 | A+ | MLB | player_batting_triples_ou |
| 4 | 0.8224 | A | MLB | player_batting_home_runs_ou |
| 5 | 0.8187 | A | MLB | player_batting_home_runs_ou |

---

## Phase 4 Architecture (delivered)

```
provider_offers (SGO ingestor)
  → market_universe (materializer — participant + alias resolution)
    → pick_candidates (board scan — status=qualified/rejected)
      → CandidateScoringService (model_score/model_tier/model_confidence)
        → RankedCandidateSelectionService (selection_rank/is_board_candidate)
          → BoardConstructionService
              - Tier floor: SUPPRESS excluded
              - Sport cap: max 6 per sport_key
              - Market dedup: max 3 per market_type_id
              - Board cap: max 20 total
            → syndicate_board (board_rank/board_tier/model_score snapshot)
              → Phase 5: governance queue, approval, pick creation
```

**Schema additions (Phase 4):**
- `pick_candidates.selection_rank INTEGER NULL` (migration 202604090007)
- `pick_candidates.is_board_candidate BOOLEAN NOT NULL DEFAULT false` (migration 202604090007)
- `syndicate_board` table (migration 202604090008)

**Hard boundaries — all enforced at Phase 4:**
- `pick_candidates.pick_id` — never set
- `pick_candidates.shadow_mode` — always true
- `picks` table — no writes from any Phase 4 service
- Governance / approval — not implemented (Phase 5)
- `system-pick-scanner` — remains a parallel path, unaffected

---

## Phase 5 Gate Status

**OPEN** — all 14 Phase 4 exit criteria met. PM acceptance required before Phase 5 work begins.

Phase 5 first dependency: governance queue / approval flow — candidates on the board must pass a governance gate before `picks` rows are created.
