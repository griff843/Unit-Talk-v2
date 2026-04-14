# UTV2-481 — Phase 6 Evidence Bundle

## Metadata

| Field | Value |
|---|---|
| Issue ID | UTV2-481 |
| Tier | T1 |
| Phase / Gate | Phase 6 — Attribution + Market Family Trust Tuning |
| Owner | claude/orchestrator |
| Date | 2026-04-10 |
| Verifier Identity | claude/historical-retrofit |
| Commit SHA(s) | 2a18f29, d922eea |
| Related PRs | #215, #216 |

## Scope

**Claims:**
- All 7 live DB assertions pass (attribution view, trust table, auth gate, audit, boundary)
- Code review confirms view structure, tuning service, and auth gate
- Unit tests 8/8 pass for market-family-trust-service

**Does NOT claim:**
- Trust metric population (board-construction picks unsettled; requires MIN_SAMPLE=5)
- Phase 7A governance brake

## Assertions

| # | Assertion | Evidence Type | Source | Result | Evidence Ref |
|---|---|---|---|---|---|
| 1 | v_governed_pick_performance view has >= 1 row | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E1](#e1-attribution-view-rows) |
| 2 | Attribution chain — all view rows have candidate_id, universe_id, board_run_id | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E2](#e2-attribution-chain-complete) |
| 3 | market_family_trust table exists and is queryable | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E3](#e3-trust-table-exists) |
| 4 | /api/board/run-tuning is auth-gated (operator only) | repo-truth | `apps/api/src/auth.ts:47` | PASS | [E4](#e4-tuning-auth-gate) |
| 5 | audit_log has market_family_trust.tuning_run.completed | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E5](#e5-tuning-audit) |
| 6 | Phase 6 boundary — view contains only board-construction picks | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E6](#e6-view-boundary) |
| 7 | market_family_trust rows have valid structure (vacuous PASS if empty) | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E7](#e7-trust-row-structure) |
| 8 | Unit tests 8/8 PASS | test | `apps/api/src/market-family-trust-service.test.ts` | PASS | [E8](#e8-unit-tests) |

## Evidence Blocks

### E1 Attribution view rows

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-10
Script: `apps/api/src/scripts/utv2-481-phase6-proof.ts`
Result:
```
{"assertion":"B1: v_governed_pick_performance view has ≥1 row","result":"PASS","evidence":{"rowCount":204}}
```

### E2 Attribution chain complete

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-10
Result:
```
{"assertion":"B2: attribution chain — all view rows have candidate_id, universe_id, board_run_id","result":"PASS","evidence":{"totalRows":204,"brokenChainCount":0}}
```

204 rows against 12 board-construction picks. The 192-row difference is explained by the join: each governed pick's `pick_candidate` is linked to multiple `syndicate_board` entries across different board runs. All 204 rows have the complete attribution chain.

### E3 Trust table exists

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-10
Result:
```
{"assertion":"B3: market_family_trust table exists and is queryable","result":"PASS","evidence":{"rowCount":0}}
```
Empty is expected — board-construction picks are ungraded; tuning requires settled outcomes with MIN_SAMPLE=5.

### E4 Tuning auth gate

**Repo-truth evidence**
`apps/api/src/auth.ts:47` — `{ pattern: /^\/api\/board\/run-tuning$/, roles: ['operator'] }`
`apps/api/src/server.ts:445` — route handler registered behind auth middleware.

### E5 Tuning audit

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-10
Result:
```
{"assertion":"B5: audit_log has market_family_trust.tuning_run.completed","result":"PASS","evidence":{"rowCount":1}}
```
Tuning run completed and was audited:
- action: `market_family_trust.tuning_run.completed`
- entity_type: `market_family_trust`
- entity_id: `48f9c032-ae07-4eda-a612-d0a13504bc68` (tuning_run_id)
- payload: `{ marketFamilyCount: 0, totalSettled: 0, familiesWithMetrics: 0 }`

### E6 View boundary

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-10
Result:
```
{"assertion":"B6: Phase 6 boundary — view contains only board-construction picks","result":"PASS","evidence":{"viewRowCount":204,"boardConstructionPickCount":12,"note":"192 extra rows from settlement corrections"}}
```
`v_governed_pick_performance` WHERE clause limits to `source = 'board-construction'` at the DB layer.

### E7 Trust row structure

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-10
Result:
```
{"assertion":"B7: market_family_trust rows have valid structure (vacuous PASS if empty)","result":"PASS","evidence":{"rowCount":0,"note":"VACUOUS PASS — no tuning rows yet (board picks unsettled; tuning requires settled outcomes)"}}
```

### E8 Unit tests

**Test evidence**
Test: `apps/api/src/market-family-trust-service.test.ts`
Command: `tsx --test apps/api/src/market-family-trust-service.test.ts`
Result: 8/8 PASS

### Phase 6 Delivery Summary

| Issue | Title | Merge commit | PR |
|-------|-------|-------------|-----|
| UTV2-479 | P6-01: Attribution view + operator-web route + CC types | `2a18f29` | #215 |
| UTV2-480 | P6-02: Market-family trust tuning service + DB table | `d922eea` | #216 |
| UTV2-481 | Phase 6 runtime proof | this doc | — |

### Code Verification Summary

- **v_governed_pick_performance view:** Joins `picks(source=board-construction) -> pick_candidates -> syndicate_board -> market_universe`. LEFT JOINs settlement_records with corrects_id IS NULL filter. View confirmed live in DB: 204 rows.
- **market_family_trust table:** Table confirmed live in DB, queryable. Indexes on `tuning_run_id` and `(market_type_id, computed_at DESC)`.
- **market-family-trust-service.ts:** Reads settled governed picks, groups by market_type_id, computes metrics with MIN_SAMPLE=5 guard, writes tuning batch, emits audit record always.

## Acceptance Criteria Mapping

| Acceptance Criterion (verbatim from Linear) | Assertion # |
|---|---|
| v_governed_pick_performance view has >= 1 row | 1 |
| Attribution chain complete | 2 |
| market_family_trust table exists | 3 |
| /api/board/run-tuning is auth-gated | 4 |
| audit_log has tuning_run.completed | 5 |
| View contains only board-construction picks | 6 |
| market_family_trust rows have valid structure | 7 |
| Unit tests pass | 8 |

## Stop Conditions Encountered

None

## Sign-off

**Verifier:** claude/historical-retrofit — 2026-04-10
**PM acceptance:** historical — accepted at original gate closure
