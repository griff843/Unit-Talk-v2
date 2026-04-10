# UTV2-478 — Phase 5 Evidence Bundle

**Status:** COMPLETE — 7/7 assertions PASS (live DB, 2026-04-10)
**Date:** 2026-04-10
**Verified by:** Claude Code orchestrator + Supabase DB (feownrheeefbcsehtsiw)
**Proof script:** `apps/api/src/scripts/utv2-478-board-pick-proof.ts`

---

## Phase 5 Delivery Summary

| Issue | Title | Merge commit | PR |
|-------|-------|-------------|-----|
| UTV2-476 | Governed candidate-to-pick write path (P5-01) | `9766ef9` | #214 |
| UTV2-477 | CC board queue review surface + governed write action (P5-02) | `919599a` | #215 |
| UTV2-478 | DB truth, lifecycle, and audit proof | this doc | — |

---

## Pre-Trigger State (verified 2026-04-09)

No `board-construction` picks exist in the live DB yet — the operator has not yet triggered
`POST /api/board/write-picks` against the live running API. This is expected: the feature branch
has not been merged to main and the API hasn't been restarted with Phase 5 code.

The following boundary checks are **vacuously PASS** in this state (no violations can exist
if no board-construction picks have been written):

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| A2 | Linked candidates have shadow_mode=false (0 violations) | **VACUOUS PASS** | 0 linked candidates exist |
| A3 | Unlinked candidates have shadow_mode=true (0 violations) | **VACUOUS PASS** | No pick_id IS NULL AND shadow_mode=false rows |
| A4 | Phase 5 boundary — no linked candidate with shadow_mode=true | **VACUOUS PASS** | 0 linked candidates exist |

The following checks **require a live write trigger** (cannot be verified without board-construction picks):

| # | Check | Status |
|---|-------|--------|
| A1 | picks(source=board-construction) exists | PENDING — requires live trigger |
| A5 | audit_log has board.pick_write.completed | PENDING — requires live trigger |
| A6 | board-construction picks each have pick_lifecycle row | PENDING — requires live trigger |
| A7 | Idempotency — no duplicate (market, selection, odds) per boardRunId | PENDING — requires live trigger |

---

## Code Verification (COMPLETE)

### Auth gate — PASS

`apps/api/src/auth.ts:46` maps `/api/board/write-picks` to `roles: ['operator']` only.
`apps/api/src/server.ts:345-368` applies `authenticateRequest()` + `authorizeRoute()` to ALL
POST routes before dispatch. No unauthenticated path exists.

### Write path isolation — PASS

`apps/command-center/src/app/actions/board.ts` — only calls `fetch()` to `/api/board/write-picks`.
Zero Supabase imports. Zero DB client. Command Center writes nothing directly.

### Latest-run truth — PASS

`apps/operator-web/src/routes/board-queue.ts` — Step 1 queries syndicate_board ordered by
`created_at DESC LIMIT 1` → gets `latestRunId`. Step 2 scopes all joins to that run ID only.
No historical run mixing possible.

### Per-row immediate linking — PASS (code review)

`board-pick-writer.ts:250-271` — `updatePickIdBatch([{ id: candidate.id, pick_id: pickId }])`
called immediately after each successful `processSubmission()`. Not deferred to batch end.
Idempotency: `candidate.pick_id !== null` check at line 141 skips already-linked rows.

### shadow_mode clearing — PASS (code review)

`board-pick-writer.ts` — `shadow_mode=false` is set via `updatePickIdBatch()` immediately
after successful pick creation and linking. Only set on successfully linked candidates.

### Audit record — PASS (code review)

`board-pick-writer.ts:291-310` — `audit.record()` called with:
- `entityType: 'syndicate_board'`
- `entityId: boardRunId`
- `action: 'board.pick_write.completed'`
- `payload: { boardRunId, boardSize, written, skipped, errors, pickIds, actor }`

### Scope discipline — PASS

No suppress/reroute code in any Phase 5 changed file (grepped). No Phase 6 logic.
No direct `picks` write in command-center or operator-web.

---

## Unit Test Verification (COMPLETE)

**File:** `apps/api/src/board-pick-writer.test.ts`
**Test count:** 12/12 PASS (11 pre-existing + 1 added by Lane B)

| # | Invariant | Test name | Status |
|---|-----------|-----------|--------|
| INV-1 | shadow_mode=false on successfully linked candidate | `writes pick for a board candidate and links pick_id` + `shadow_mode correctness: only cleared on successfully linked candidates` | **COVERED** |
| INV-2 | pick_id linked per-row, not batch-deferred | `per-row linking: first candidate linked before second candidate is processed` | **COVERED** |
| INV-3 | Already-linked candidate skipped | `idempotent: second run skips already-linked candidates` | **COVERED** |
| INV-4 | Audit action = board.pick_write.completed | `audit record contains actor, boardRunId, written/skipped/errors` | **COVERED** |
| INV-5 | Audit payload contains actor | Same test — asserts `rec.payload.actor === testActor` | **COVERED** |
| BOUNDARY | Non-finite odds → skipped not errored | `candidate with non-finite odds is counted in skipped, not errors or written` | **ADDED** |

---

## Live Trigger Protocol (PENDING)

To complete the proof, the operator must:

1. Merge this branch to main and restart the API with Phase 5 code
2. Ensure `syndicate_board` has a current run (Phase 4 proof showed 12 rows in run `9e494126-7c45-4522-ae6a-35b2cf1dd3ad`)
3. From the Command Center Decision workspace → Board Queue → click **"Write N Pending Picks"**
   OR: `curl -X POST http://localhost:4000/api/board/write-picks -H "Authorization: Bearer <operator-key>"`
4. Run the proof script:
   ```
   npx tsx apps/api/src/scripts/utv2-478-board-pick-proof.ts
   ```
5. All 7 assertions must output `"result": "PASS"` and the final line must read `RESULT: 7/7 PASS`
6. Paste the full output into this document under **Live DB State** below and mark status COMPLETE

---

## Live DB State — Full Proof (2026-04-10)

**Trigger:** `POST /api/board/write-picks` via Phase 5 API (main, commit `a32f168`)
**boardRunId:** `682c84c6-fa37-4613-962c-bd49363c837e`
**Compute:** Micro (1 GB RAM, 2-core ARM CPU) — upgraded from NANO to resolve resource exhaustion
**Index:** `CREATE INDEX IF NOT EXISTS idx_picks_source ON picks (source);` applied before run

```
=== UTV2-478: Board-Pick Write Path Proof (Phase 5) ===

{"assertion":"A1: picks(source=board-construction) exists","result":"PASS","evidence":{"rowCount":12}}
{"assertion":"A2: linked candidates have shadow_mode=false (0 violations)","result":"PASS","evidence":{"violations":0}}
{"assertion":"A3: unlinked candidates have shadow_mode=true (0 violations)","result":"PASS","evidence":{"violations":0}}
{"assertion":"A4: Phase 5 boundary — no linked candidate with shadow_mode=true","result":"PASS","evidence":{"violations":0}}
{"assertion":"A5: audit_log has board.pick_write.completed for entity_type=syndicate_board","result":"PASS","evidence":{"rowCount":2}}
{"assertion":"A6: board-construction picks each have pick_lifecycle row","result":"PASS","evidence":{"totalBoardPicks":12,"withLifecycleRow":12,"missingLifecycleCount":0,"sampleMissing":[]}}
{"assertion":"A7: idempotency — no duplicate (market, selection, odds) per boardRunId","result":"PASS","evidence":{"boardRunCount":1,"totalBoardPicks":12,"duplicateViolations":0,"sampleViolations":[]}}

RESULT: 7/7 PASS
```

**API run log:** `written: 10, skipped: 0, errors: 2` on first pass; idempotency check correctly skipped 8 on second concurrent pass; total 12 board-construction picks in DB.
**Duplicate key errors** on 2 candidates (ranks 9 and 10) were caused by concurrent curl invocations during the wait — the writer's idempotency check recovered and linked the correct existing pick. No data integrity violation.

---

## Verdict

| Layer | Status |
|-------|--------|
| Code review | **PASS** — all invariants verified in source |
| Unit tests | **PASS** — 12/12, all 5 Phase 5 invariants covered |
| Live DB proof | **PASS** — 7/7 assertions, 2026-04-10 |

**Phase 5 gate: CLOSED — all proof layers complete. Phase 6 may begin.**
