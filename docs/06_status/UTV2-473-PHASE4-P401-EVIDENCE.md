# UTV2-473 — Phase 4 P4-01 Evidence Bundle

**Status:** COMPLETE
**Date:** 2026-04-09
**Verified by:** Claude Code orchestrator + live Supabase DB (feownrheeefbcsehtsiw)

---

## Delivery Summary

| Issue | Title | Merge commit | PR |
|-------|-------|-------------|-----|
| UTV2-473 | Ranked candidate selection service — P4-01 | `4189f9d` | #212 |

---

## Exit Criteria — All Checks PASS

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Ranked count > 0 | **PASS** | 301 ranked |
| 2 | Errors = 0 | **PASS** | errors=0 |
| 3 | min(selection_rank) = 1 | **PASS** | min=1 |
| 4 | max(selection_rank) = count(*) | **PASS** | max=301, count=301 |
| 5 | Contiguous sequence | **PASS** | contiguous=true |
| 6 | pick_id violations = 0 | **PASS** | 0 violations |
| 7 | shadow_mode violations = 0 | **PASS** | 0 violations |
| 8 | SUPPRESS tier ordering correct | **PASS** | 0 violations |

---

## Live DB State (verified 2026-04-09T19:48:19Z)

```
ranked:                  301   ← 100% of qualified+scored candidates
reset:                   301   ← full table reset before run
skipped:                 0     ← no stale markets
errors:                  0
durationMs:              14478

min(selection_rank):     1
max(selection_rank):     301   ← contiguous 1..301
pick_id_violations:      0     ← boundary enforced
shadow_mode_violations:  0     ← boundary enforced
```

### Board Tier Distribution

| Tier | Count |
|------|-------|
| SUPPRESS | 156 |
| B | 79 |
| A | 27 |
| C | 24 |
| A+ | 15 |

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

A+ candidates correctly occupy the top ranks. SUPPRESS correctly occupies the bottom. Ordering contract is live.

---

## Architecture Delivered

```
pick_candidates (status=qualified, model_score IS NOT NULL)
  → RankedCandidateSelectionService
    → resetSelectionRanks()          — full reset before every run
    → findByIds(universeIds)         — filter stale markets
    → sort: score DESC → tier_priority DESC → created_at ASC
    → updateSelectionRankBatch()     — contiguous selection_rank + is_board_candidate=true
      → Phase 4 P4-02: scarcity gating + syndicate_board construction
```

**Schema additions (migration 202604090007):**
- `pick_candidates.selection_rank INTEGER NULL`
- `pick_candidates.is_board_candidate BOOLEAN NOT NULL DEFAULT false`
- Index: `idx_pick_candidates_board_rank`

**Hard boundaries — all enforced:**
- `pick_id` — never set by ranking service
- `shadow_mode` — hardcoded true, no override path
- `picks` table — no import of picks repo or submission service
- Scarcity/board-cap — not implemented (P4-02)

---

## Phase 4 P4-02 Gate Status

**OPEN** — all P4-01 exit criteria met.

P4-02 first dependency: `syndicate_board` table migration, `BoardConstructionService`, scarcity rules (SUPPRESS floor, board cap 20, sport cap 6, market dedup 3).
