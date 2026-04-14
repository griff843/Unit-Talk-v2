# UTV2-464 — Phase 2 Evidence Bundle

## Metadata

| Field | Value |
|---|---|
| Issue ID | UTV2-464 |
| Tier | T1 |
| Phase / Gate | Phase 2 — Board Scan + Market Universe |
| Owner | claude/orchestrator |
| Date | 2026-04-09 |
| Verifier Identity | claude/historical-retrofit |
| Commit SHA(s) | ed160f9, 1b3cc21 |
| Related PRs | #204, #205, #206, #207, #208 |

## Scope

**Claims:**
- All 8 Phase 2 §8 exit criteria pass against live Supabase DB
- Materializer idempotency holds on repeated runs
- Feature gate enforced when SYNDICATE_MACHINE_ENABLED=false
- No pick lifecycle contamination from Phase 2 services

**Does NOT claim:**
- Market alias resolution completeness (Phase 3 concern)
- Candidate qualification (all 330 rejected due to data quality gap, not code defect)

## Assertions

| # | Assertion | Evidence Type | Source | Result | Evidence Ref |
|---|---|---|---|---|---|
| 1 | `market_universe` contains >0 rows | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E1](#e1-market-universe-row-count) |
| 2 | `pick_candidates` contains >0 rows | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E2](#e2-pick-candidates-row-count) |
| 3 | `pick_candidates.pick_id` = NULL on all rows | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E3](#e3-pick-id-null-boundary) |
| 4 | `pick_candidates.model_score` = NULL on all rows | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E4](#e4-model-score-null-boundary) |
| 5 | `pick_candidates.shadow_mode` = TRUE on all rows | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E5](#e5-shadow-mode-boundary) |
| 6 | Materializer idempotency — second run produces same count | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E6](#e6-materializer-idempotency) |
| 7 | Feature gate enforced — SYNDICATE_MACHINE_ENABLED=false yields 0 rows | test | `scripts/utv2-464-proof.ts` | PASS | [E7](#e7-feature-gate-enforcement) |
| 8 | No pick lifecycle contamination — board scan has no picks imports | repo-truth | code review | PASS | [E8](#e8-no-lifecycle-contamination) |

## Evidence Blocks

### E1 Market universe row count

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T15:48:07Z
Script: `scripts/utv2-464-proof.ts`
Result: 330 rows materialized (1000 provider_offers to 330 unique markets)

### E2 Pick candidates row count

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T15:48:07Z
Script: `scripts/utv2-464-proof.ts`
Result: 330 candidate rows written (scanned=330)

### E3 Pick ID null boundary

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T15:48:07Z
Query:
```sql
SELECT count(*) FROM pick_candidates WHERE pick_id IS NOT NULL;
```
Result: 0

### E4 Model score null boundary

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T15:48:07Z
Query:
```sql
SELECT count(*) FROM pick_candidates WHERE model_score IS NOT NULL;
```
Result: 0

### E5 Shadow mode boundary

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T15:48:07Z
Query:
```sql
SELECT count(*) FROM pick_candidates WHERE shadow_mode = false;
```
Result: 0

### E6 Materializer idempotency

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-09T15:48:07Z
Script: `scripts/utv2-464-proof.ts`
Result: Second run upserted=330 (same as first run — no new rows created)

### E7 Feature gate enforcement

**Test evidence**
Test: `scripts/utv2-464-proof.ts` — feature gate check
Command: `npx tsx scripts/utv2-464-proof.ts`
Result: SYNDICATE_MACHINE_ENABLED=false produced scanned=0, zero rows written

### E8 No lifecycle contamination

**Repo-truth evidence**
Board scan service has no imports of submission-service, picks repo, or POST /api/submissions. Code review verified at commit `1b3cc21`.

### Rejection Analysis (informational — not a Phase 2 failure)

All 330 candidates rejected with `unsupported_market_family` + `invalid_odds_structure`. Root cause:
- `market_universe.market_type_id` is NULL on all rows — the current SGO `provider_offers` market keys do not resolve through `provider_market_aliases` to a `market_type_id`
- `current_over_odds` / `current_under_odds` NULL on all rows — odds not available in materialized data

This is correct Phase 2 behavior. The coarse filters are working as specified in contract §5.5.

### Live DB State (verified 2026-04-09T15:48)

```sql
market_universe_rows:    330
pick_candidate_rows:     330
pick_id_violation:       0
model_score_violation:   0
shadow_mode_violation:   0
qualified_count:         0
rejected_count:          330
```

### Phase 2 Delivery Summary

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

### Hard Boundaries — All Enforced in Code

- `pick_candidates.pick_id` — never set by `BoardScanService` (no setter path exists)
- `pick_candidates.model_score/model_tier/model_confidence` — never set (no setter path exists)
- `pick_candidates.shadow_mode` — hardcoded `true` default, no override
- `system-pick-scanner` — parallel path unchanged, does not touch `market_universe` or `pick_candidates`
- Materializer writes to `market_universe` only, no picks writes
- Board scan writes to `pick_candidates` only, no picks writes

## Acceptance Criteria Mapping

| Acceptance Criterion (verbatim from Linear) | Assertion # |
|---|---|
| market_universe contains >0 rows | 1 |
| pick_candidates contains >0 rows | 2 |
| pick_candidates.pick_id = NULL on all rows | 3 |
| pick_candidates.model_score = NULL on all rows | 4 |
| pick_candidates.shadow_mode = TRUE on all rows | 5 |
| Materializer idempotency | 6 |
| Feature gate enforced | 7 |
| No pick lifecycle contamination | 8 |

## Stop Conditions Encountered

None

## Sign-off

**Verifier:** claude/historical-retrofit — 2026-04-09
**PM acceptance:** historical — accepted at original gate closure
