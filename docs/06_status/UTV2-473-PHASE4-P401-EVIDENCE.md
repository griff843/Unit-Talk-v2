# UTV2-473 — Phase 4 P4-01 Evidence Bundle

## Metadata

| Field | Value |
|---|---|
| Issue ID | UTV2-473 |
| Tier | T1 |
| Phase / Gate | Phase 4 P4-01 — Ranked Candidate Selection |
| Owner | claude/orchestrator |
| Date | 2026-04-09 |
| Verifier Identity | claude/historical-retrofit |
| Commit SHA(s) | 4189f9d |
| Related PRs | #212 |

## Scope

**Claims:**
- All 8 P4-01 exit criteria pass against live Supabase DB
- Ranked selection produces contiguous 1..N sequence
- SUPPRESS tier ordering is correct
- Phase 2/3 boundaries (pick_id=NULL, shadow_mode=TRUE) remain enforced

**Does NOT claim:**
- Scarcity gating or board construction (P4-02 concern)
- Governance queue or approval (Phase 5 concern)

## Assertions

| # | Assertion | Evidence Type | Source | Result | Evidence Ref |
|---|---|---|---|---|---|
| 1 | Ranked count > 0 | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E1](#e1-ranked-count) |
| 2 | Errors = 0 | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E2](#e2-zero-errors) |
| 3 | min(selection_rank) = 1 | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E3](#e3-min-rank) |
| 4 | max(selection_rank) = count(*) | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E4](#e4-max-rank-equals-count) |
| 5 | Contiguous sequence | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E5](#e5-contiguous-sequence) |
| 6 | pick_id violations = 0 | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E6](#e6-pick-id-boundary) |
| 7 | shadow_mode violations = 0 | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E7](#e7-shadow-mode-boundary) |
| 8 | SUPPRESS tier ordering correct | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E8](#e8-suppress-tier-ordering) |

## Evidence Blocks

### E1 Ranked count

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T19:48:19Z
Result: 301 ranked (100% of qualified+scored candidates)

### E2 Zero errors

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T19:48:19Z
Result: errors=0

### E3 Min rank

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T19:48:19Z
Result: min(selection_rank)=1

### E4 Max rank equals count

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T19:48:19Z
Result: max=301, count=301

### E5 Contiguous sequence

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T19:48:19Z
Result: contiguous=true (1..301 with no gaps)

### E6 Pick ID boundary

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T19:48:19Z
Result: 0 pick_id violations

### E7 Shadow mode boundary

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T19:48:19Z
Result: 0 shadow_mode violations

### E8 SUPPRESS tier ordering

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T19:48:19Z
Result: 0 violations — SUPPRESS tier candidates correctly occupy bottom ranks

### Rank Ordering Sample

**Top 5 (highest ranked):**

| Rank | Score | Tier |
|------|-------|------|
| 1 | 0.8800 | A+ |
| 2 | 0.8778 | A+ |
| 3 | 0.8766 | A+ |
| 4 | 0.8702 | A+ |
| 5 | 0.8681 | A+ |

**Bottom 5 (lowest ranked):**

| Rank | Score | Tier |
|------|-------|------|
| 297 | 0.4500 | SUPPRESS |
| 298 | 0.4500 | SUPPRESS |
| 299 | 0.4500 | SUPPRESS |
| 300 | 0.4500 | SUPPRESS |
| 301 | 0.4500 | SUPPRESS |

### Architecture Delivered

```
pick_candidates (status=qualified, model_score IS NOT NULL)
  -> RankedCandidateSelectionService
    -> resetSelectionRanks()
    -> findByIds(universeIds)
    -> sort: score DESC -> tier_priority DESC -> created_at ASC
    -> updateSelectionRankBatch()
      -> Phase 4 P4-02: scarcity gating + syndicate_board construction
```

Schema additions (migration 202604090007):
- `pick_candidates.selection_rank INTEGER NULL`
- `pick_candidates.is_board_candidate BOOLEAN NOT NULL DEFAULT false`
- Index: `idx_pick_candidates_board_rank`

## Acceptance Criteria Mapping

| Acceptance Criterion (verbatim from Linear) | Assertion # |
|---|---|
| Ranked count > 0 | 1 |
| Errors = 0 | 2 |
| min(selection_rank) = 1 | 3 |
| max(selection_rank) = count(*) | 4 |
| Contiguous sequence | 5 |
| pick_id violations = 0 | 6 |
| shadow_mode violations = 0 | 7 |
| SUPPRESS tier ordering correct | 8 |

## Stop Conditions Encountered

None

## Sign-off

**Verifier:** claude/historical-retrofit — 2026-04-09
**PM acceptance:** historical — accepted at original gate closure
