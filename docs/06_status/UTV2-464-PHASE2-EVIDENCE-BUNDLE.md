# UTV2-464 — Phase 2 Evidence Bundle

**Status:** COMPLETE — Phase 3 gate OPEN pending PM acceptance
**Date:** 2026-04-09
**Verified by:** Claude Code orchestrator + live Supabase DB (feownrheeefbcsehtsiw)
**Contract authority:** `docs/02_architecture/PHASE2_SCHEMA_CONTRACT.md §8`

---

## Verification Run

```
Script: scripts/utv2-464-proof.ts
Run at: 2026-04-09T15:48:07.651Z
DB: feownrheeefbcsehtsiw (Supabase project)
```

---

## §8 Exit Criteria — All Checks PASS

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | `market_universe` contains >0 rows | **PASS** | 330 rows materialized (1000 provider_offers → 330 unique markets) |
| 2 | `pick_candidates` contains >0 rows | **PASS** | 330 candidate rows written (scanned=330) |
| 3 | `pick_candidates.pick_id` = NULL on all rows | **PASS** | `SELECT count(*) FROM pick_candidates WHERE pick_id IS NOT NULL` = 0 |
| 4 | `pick_candidates.model_score` = NULL on all rows | **PASS** | `SELECT count(*) FROM pick_candidates WHERE model_score IS NOT NULL` = 0 |
| 5 | `pick_candidates.shadow_mode` = TRUE on all rows | **PASS** | `SELECT count(*) FROM pick_candidates WHERE shadow_mode = false` = 0 |
| 6 | Materializer idempotency | **PASS** | Second run: upserted=330 (same as first run — no new rows created) |
| 7 | Feature gate enforced | **PASS** | `SYNDICATE_MACHINE_ENABLED=false` → scanned=0, zero rows written |
| 8 | No pick lifecycle contamination | **PASS** | Board scan has no imports of submission-service, picks repo, or POST /api/submissions |

---

## Live DB State (verified 2026-04-09T15:48)

```sql
market_universe_rows:    330
pick_candidate_rows:     330
pick_id_violation:       0   ← boundary enforced
model_score_violation:   0   ← boundary enforced
shadow_mode_violation:   0   ← boundary enforced
qualified_count:         0   ← see note below
rejected_count:          330
```

### Rejection Analysis (informational — not a Phase 2 failure)

All 330 candidates rejected with `unsupported_market_family` + `invalid_odds_structure`. Root cause:
- `market_universe.market_type_id` is NULL on all rows — the current SGO `provider_offers` market keys do not resolve through `provider_market_aliases` to a `market_type_id`
- `current_over_odds` / `current_under_odds` NULL on all rows — odds not available in materialized data

This is **correct Phase 2 behavior**. The coarse filters are working as specified in contract §5.5. The board scan correctly routes unresolvable markets to `rejected` status. When the market alias mapping table is populated for active SGO markets, candidates will flow through to `qualified`.

This is a **data quality gap**, not a code boundary violation. Resolution is a Phase 3 concern.

---

## Phase 2 Delivery Summary

All Phase 2 issues merged to main:

| Issue | Title | Merge commit | PR |
|-------|-------|-------------|-----|
| UTV2-458 | Phase 2 schema contract | `3ce8ec4` | docs |
| UTV2-459 | `market_universe` migration | PR #204 | merged |
| UTV2-459b | `market_universe` NULLS NOT DISTINCT constraint | PR #206 | merged |
| UTV2-460 | `pick_candidates` migration | PR #205 | merged |
| UTV2-461 | Market universe materializer | PR #206 | merged |
| UTV2-462 | Line movement detector | PR #207 | merged |
| UTV2-463 | Board scan service | PR #208 `1b3cc21` | merged |
| UTV2-464 | Phase 2 proof/evidence bundle | `ed160f9`+ | this doc |

**DB hygiene also completed (this session):**
- Migration 202604090004: 14 missing FK indexes — applied + committed
- Migration 202604090005: BRIN index + autovacuum tuning sync — applied + committed

---

## Hard Boundaries — All Enforced in Code

- `pick_candidates.pick_id` — never set by `BoardScanService` (no setter path exists)
- `pick_candidates.model_score/model_tier/model_confidence` — never set (no setter path exists)
- `pick_candidates.shadow_mode` — hardcoded `true` default, no override
- `system-pick-scanner` — parallel path unchanged, does not touch `market_universe` or `pick_candidates`
- Materializer → `market_universe` only, no picks writes
- Board scan → `pick_candidates` only, no picks writes

---

## Phase 3 Gate Status

**OPEN** — all Phase 2 exit criteria met. Awaiting PM acceptance to begin Phase 3 model runner wiring.

Phase 3 first dependency: market alias resolution must be complete (provider_market_aliases populated for active SGO market keys) before model runner can produce qualified candidates.
