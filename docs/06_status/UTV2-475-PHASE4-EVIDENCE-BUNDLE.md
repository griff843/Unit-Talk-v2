# UTV2-475 — Phase 4 Evidence Bundle

## Metadata

| Field | Value |
|---|---|
| Issue ID | UTV2-475 |
| Tier | T1 |
| Phase / Gate | Phase 4 — Ranked Selection + Board Construction |
| Owner | claude/orchestrator |
| Date | 2026-04-09 |
| Verifier Identity | claude/historical-retrofit |
| Commit SHA(s) | 4189f9d, f1c3acc |
| Related PRs | #212, #213 |

## Scope

**Claims:**
- All 14 Phase 4 exit criteria pass against live Supabase DB
- Ranked selection produces contiguous sequence
- Board construction obeys size cap, sport cap, SUPPRESS floor, and market dedup
- No writes to picks table from Phase 4 services

**Does NOT claim:**
- Governance queue or approval (Phase 5 concern)
- Pick creation from board candidates (Phase 5 concern)

## Assertions

| # | Assertion | Evidence Type | Source | Result | Evidence Ref |
|---|---|---|---|---|---|
| 1 | pick_candidates has selection_rank column | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E1](#e1-selection-rank-column) |
| 2 | pick_candidates has is_board_candidate column | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E2](#e2-is-board-candidate-column) |
| 3 | Ranked pool populated (is_board_candidate=true rows > 0) | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E3](#e3-ranked-pool-populated) |
| 4 | selection_rank = 1 exists (exactly 1 row) | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E4](#e4-rank-one-exists) |
| 5 | Rank sequence is contiguous (max = count) | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E5](#e5-contiguous-rank-sequence) |
| 6 | syndicate_board table exists | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E6](#e6-syndicate-board-exists) |
| 7 | At least one board run exists | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E7](#e7-board-run-exists) |
| 8 | Latest board run obeys size cap (<= 20) | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E8](#e8-board-size-cap) |
| 9 | Latest board run obeys sport cap (<= 6 per sport) | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E9](#e9-sport-cap) |
| 10 | Latest board run contains no SUPPRESS-tier candidates | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E10](#e10-suppress-floor) |
| 11 | No writes to picks table from board construction path | repo-truth | code review | PASS | [E11](#e11-no-picks-writes) |
| 12 | pick_id remains NULL on all pick_candidates | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E12](#e12-pick-id-boundary) |
| 13 | shadow_mode remains TRUE on all pick_candidates | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E13](#e13-shadow-mode-boundary) |
| 14 | No governance / approval logic in P4-01 or P4-02 | repo-truth | code review | PASS | [E14](#e14-no-governance-logic) |

## Evidence Blocks

### E1 Selection rank column

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T19:59:33Z
Result: field present on all rows

### E2 Is board candidate column

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T19:59:33Z
Result: field present on all rows

### E3 Ranked pool populated

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T19:59:33Z
Result: 301 board candidates

### E4 Rank one exists

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T19:59:33Z
Result: rank_1_count=1

### E5 Contiguous rank sequence

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T19:59:33Z
Result: max=301, count=301

### E6 Syndicate board exists

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T19:59:33Z
Result: board run inserted successfully

### E7 Board run exists

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T19:59:33Z
Result: 12 rows in latest run

### E8 Board size cap

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T19:59:33Z
Result: board_size=12 (cap is 20)

### E9 Sport cap

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T19:59:33Z
Result: max_per_sport=6 (cap is 6)

### E10 SUPPRESS floor

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T19:59:33Z
Result: suppress_on_board=0

### E11 No picks writes

**Repo-truth evidence**
Code review verified: no picks repo import, no submission service import in board construction path. errors=0 on run.

### E12 Pick ID boundary

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T19:59:33Z
Result: 0 pick_id violations

### E13 Shadow mode boundary

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T19:59:33Z
Result: 0 shadow_mode violations

### E14 No governance logic

**Repo-truth evidence**
Code review verified: no picks repo, no submission service import in P4-01 or P4-02 services.

### Board Composition (latest run)

| Tier | Count |
|------|-------|
| A+ | 3 |
| A | 4 |
| B | 5 |

Sport distribution: MLB=6, NBA=6 (sport cap=6 exactly reached for both)

Board construction run details:
```
boardSize:              12
boardRunId:             9e494126-7c45-4522-ae6a-35b2cf1dd3ad
skippedSuppress:        156
skippedBoardCap:        0
skippedSportCap:        116
skippedMarketDup:       17
errors:                 0
durationMs:             470
```

### Phase 4 Delivery Summary

| Issue | Title | Merge commit | PR |
|-------|-------|-------------|-----|
| UTV2-473 | Ranked candidate selection service — P4-01 | `4189f9d` | #212 |
| UTV2-474 | Board construction service — P4-02 | `f1c3acc` | #213 |
| UTV2-475 | Phase 4 runtime proof | this doc | — |

## Acceptance Criteria Mapping

| Acceptance Criterion (verbatim from Linear) | Assertion # |
|---|---|
| pick_candidates has selection_rank column | 1 |
| pick_candidates has is_board_candidate column | 2 |
| Ranked pool populated | 3 |
| selection_rank = 1 exists (exactly 1 row) | 4 |
| Rank sequence is contiguous | 5 |
| syndicate_board table exists | 6 |
| At least one board run exists | 7 |
| Latest board run obeys size cap | 8 |
| Latest board run obeys sport cap | 9 |
| No SUPPRESS-tier candidates on board | 10 |
| No writes to picks table | 11 |
| pick_id remains NULL | 12 |
| shadow_mode remains TRUE | 13 |
| No governance / approval logic | 14 |

## Stop Conditions Encountered

None

## Sign-off

**Verifier:** claude/historical-retrofit — 2026-04-09
**PM acceptance:** historical — accepted at original gate closure
