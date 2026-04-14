# UTV2-478 — Phase 5 Evidence Bundle

## Metadata

| Field | Value |
|---|---|
| Issue ID | UTV2-478 |
| Tier | T1 |
| Phase / Gate | Phase 5 — Governed Board-to-Pick Write Path |
| Owner | claude/orchestrator |
| Date | 2026-04-10 |
| Verifier Identity | claude/historical-retrofit |
| Commit SHA(s) | 9766ef9, 919599a, a32f168 |
| Related PRs | #214, #215 |

## Scope

**Claims:**
- All 7 live DB assertions pass (board-construction picks exist, shadow_mode transitions correct, audit trail complete, idempotency holds)
- Code review confirms auth gate, write path isolation, per-row linking, shadow_mode clearing, and audit record
- Unit tests cover all 5 Phase 5 invariants (12/12 pass)

**Does NOT claim:**
- Phase 6 feedback loop (attribution view, tuning)
- Governance brake for autonomous sources (Phase 7A concern)

## Assertions

| # | Assertion | Evidence Type | Source | Result | Evidence Ref |
|---|---|---|---|---|---|
| 1 | picks(source=board-construction) exists | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E1](#e1-board-construction-picks-exist) |
| 2 | Linked candidates have shadow_mode=false (0 violations) | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E2](#e2-linked-shadow-mode-false) |
| 3 | Unlinked candidates have shadow_mode=true (0 violations) | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E3](#e3-unlinked-shadow-mode-true) |
| 4 | Phase 5 boundary — no linked candidate with shadow_mode=true | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E4](#e4-phase5-boundary) |
| 5 | audit_log has board.pick_write.completed | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E5](#e5-audit-log-write-completed) |
| 6 | board-construction picks each have pick_lifecycle row | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E6](#e6-lifecycle-row-coverage) |
| 7 | Idempotency — no duplicate (market, selection, odds) per boardRunId | db-query | live DB `feownrheeefbcsehtsiw` | PASS | [E7](#e7-idempotency) |
| 8 | Auth gate — /api/board/write-picks operator-only | repo-truth | `apps/api/src/auth.ts:46` | PASS | [E8](#e8-auth-gate) |
| 9 | Write path isolation — CC writes nothing directly | repo-truth | code review | PASS | [E9](#e9-write-path-isolation) |
| 10 | Per-row immediate linking | repo-truth | `board-pick-writer.ts:250-271` | PASS | [E10](#e10-per-row-linking) |
| 11 | shadow_mode clearing code path | repo-truth | `board-pick-writer.ts` | PASS | [E11](#e11-shadow-mode-clearing) |
| 12 | Unit tests 12/12 PASS | test | `apps/api/src/board-pick-writer.test.ts` | PASS | [E12](#e12-unit-tests) |

## Evidence Blocks

### E1 Board construction picks exist

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-10
Script: `apps/api/src/scripts/utv2-478-board-pick-proof.ts`
Result:
```
{"assertion":"A1: picks(source=board-construction) exists","result":"PASS","evidence":{"rowCount":12}}
```

### E2 Linked shadow mode false

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-10
Result:
```
{"assertion":"A2: linked candidates have shadow_mode=false (0 violations)","result":"PASS","evidence":{"violations":0}}
```

### E3 Unlinked shadow mode true

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-10
Result:
```
{"assertion":"A3: unlinked candidates have shadow_mode=true (0 violations)","result":"PASS","evidence":{"violations":0}}
```

### E4 Phase5 boundary

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-10
Result:
```
{"assertion":"A4: Phase 5 boundary — no linked candidate with shadow_mode=true","result":"PASS","evidence":{"violations":0}}
```

### E5 Audit log write completed

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-10
Result:
```
{"assertion":"A5: audit_log has board.pick_write.completed for entity_type=syndicate_board","result":"PASS","evidence":{"rowCount":2}}
```

### E6 Lifecycle row coverage

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-10
Result:
```
{"assertion":"A6: board-construction picks each have pick_lifecycle row","result":"PASS","evidence":{"totalBoardPicks":12,"withLifecycleRow":12,"missingLifecycleCount":0,"sampleMissing":[]}}
```

### E7 Idempotency

**DB-query evidence**
Project ref: `feownrheeefbcsehtsiw`
Run at: 2026-04-10
Result:
```
{"assertion":"A7: idempotency — no duplicate (market, selection, odds) per boardRunId","result":"PASS","evidence":{"boardRunCount":1,"totalBoardPicks":12,"duplicateViolations":0,"sampleViolations":[]}}
```

API run log: written: 10, skipped: 0, errors: 2 on first pass; idempotency check correctly skipped 8 on second concurrent pass; total 12 board-construction picks in DB. Duplicate key errors on 2 candidates (ranks 9 and 10) were caused by concurrent curl invocations — the writer's idempotency check recovered and linked the correct existing pick.

### E8 Auth gate

**Repo-truth evidence**
`apps/api/src/auth.ts:46` maps `/api/board/write-picks` to `roles: ['operator']` only.
`apps/api/src/server.ts:345-368` applies `authenticateRequest()` + `authorizeRoute()` to ALL POST routes before dispatch.

### E9 Write path isolation

**Repo-truth evidence**
`apps/command-center/src/app/actions/board.ts` — only calls `fetch()` to `/api/board/write-picks`. Zero Supabase imports. Zero DB client. Command Center writes nothing directly.

### E10 Per-row linking

**Repo-truth evidence**
`board-pick-writer.ts:250-271` — `updatePickIdBatch([{ id: candidate.id, pick_id: pickId }])` called immediately after each successful `processSubmission()`. Not deferred to batch end. Idempotency: `candidate.pick_id !== null` check at line 141 skips already-linked rows.

### E11 Shadow mode clearing

**Repo-truth evidence**
`board-pick-writer.ts` — `shadow_mode=false` is set via `updatePickIdBatch()` immediately after successful pick creation and linking. Only set on successfully linked candidates.

### E12 Unit tests

**Test evidence**
Test: `apps/api/src/board-pick-writer.test.ts`
Command: `tsx --test apps/api/src/board-pick-writer.test.ts`
Result: 12/12 PASS (11 pre-existing + 1 added by Lane B)

| # | Invariant | Test name | Status |
|---|-----------|-----------|--------|
| INV-1 | shadow_mode=false on linked candidate | writes pick for a board candidate and links pick_id | COVERED |
| INV-2 | pick_id linked per-row | per-row linking: first candidate linked before second candidate is processed | COVERED |
| INV-3 | Already-linked candidate skipped | idempotent: second run skips already-linked candidates | COVERED |
| INV-4 | Audit action = board.pick_write.completed | audit record contains actor, boardRunId, written/skipped/errors | COVERED |
| INV-5 | Audit payload contains actor | Same test — asserts rec.payload.actor === testActor | COVERED |
| BOUNDARY | Non-finite odds skipped not errored | candidate with non-finite odds is counted in skipped, not errors or written | ADDED |

### Phase 5 Delivery Summary

| Issue | Title | Merge commit | PR |
|-------|-------|-------------|-----|
| UTV2-476 | Governed candidate-to-pick write path (P5-01) | `9766ef9` | #214 |
| UTV2-477 | CC board queue review surface + governed write action (P5-02) | `919599a` | #215 |
| UTV2-478 | DB truth, lifecycle, and audit proof | this doc | — |

## Acceptance Criteria Mapping

| Acceptance Criterion (verbatim from Linear) | Assertion # |
|---|---|
| picks(source=board-construction) exists in live DB | 1 |
| Linked candidates have shadow_mode=false | 2 |
| Unlinked candidates have shadow_mode=true | 3 |
| No linked candidate with shadow_mode=true | 4 |
| audit_log has board.pick_write.completed | 5 |
| board-construction picks each have pick_lifecycle row | 6 |
| Idempotency — no duplicate per boardRunId | 7 |
| Auth gate — operator-only | 8 |
| Write path isolation | 9 |
| Per-row immediate linking | 10 |
| shadow_mode clearing on link | 11 |
| Unit tests pass | 12 |

## Stop Conditions Encountered

None

## Sign-off

**Verifier:** claude/historical-retrofit — 2026-04-10
**PM acceptance:** historical — accepted at original gate closure
