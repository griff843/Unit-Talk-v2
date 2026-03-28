# UTV2-M12 Closure Proof

**Milestone:** M12
**Status:** IN PROGRESS — awaiting UTV2-68, UTV2-69, UTV2-70
**Verifier:** Claude lane
**Ratified:** 2026-03-27 (contract date)
**Verified:** — (fill at closure)
**Commit at verification:** —

---

## M12 Deliverables

| Issue | Title | PR | Status |
|-------|-------|-----|--------|
| UTV2-68 | T2 SGO Results Auto-Ingest | — | PENDING |
| UTV2-69 | T3 Grading Cron | — | PENDING |
| UTV2-70 | T2 RecapAgent | — | PENDING |

---

## Pre-Verification State

```
git rev-parse HEAD: —
pnpm verify: — / — tests
```

---

## Gate Results (fill at closure)

| Gate | Status | Notes |
|------|--------|-------|
| `pnpm env:check` | — | |
| `pnpm lint` | — | |
| `pnpm type-check` | — | |
| `pnpm build` | — | |
| `pnpm test` | — | __/__ passing |
| `pnpm verify` (full chain) | — | |

Test delta: 678 (M11 baseline) → __ (M12 close)

---

## UTV2-68 Verification — SGO Results Auto-Ingest

### AC-1: `game_results` rows exist after a completed event

```
-- Query game_results for a completed event
SELECT event_id, participant_id, market_key, actual_value, source, sourced_at
FROM game_results
WHERE source = 'sgo'
LIMIT 10;
```

Result: `insertedResultsCount ≥ 1` in ingestor cycle log

- [ ] PASS / FAIL — `game_results` rows found for completed event(s)
- [ ] Event: ___________________
- [ ] Participants with results: ___

### AC-2: Ingestor logs `insertedResultsCount` and `skippedResultsCount`

Ingestor response excerpt:
```json

```

- [ ] PASS / FAIL

### AC-3: Idempotency — running twice produces no duplicates

Second cycle `insertedResultsCount`:
- [ ] PASS / FAIL — second run = 0 inserted, ≥0 skipped

---

## UTV2-69 Verification — Grading Cron

### AC-1: Grading pass fires on interval

API process log evidence:
```

```

- [ ] PASS / FAIL — `runGradingPass` called; result logged

### AC-2/3: Concurrent suppression + error resilience

- [ ] PASS / FAIL — tested via unit tests (see test file)

### AC-4: Live auto-grade

`POST /api/grading/run` response:
```json

```

`settlement_records` query:
```json

```

- [ ] `source: 'grading'` — PASS / FAIL
- [ ] `result` correct — PASS / FAIL
- [ ] Pick transitions to `settled` — PASS / FAIL

### Idempotency: second `POST /api/grading/run`

```json

```

- [ ] `graded: 0` — PASS / FAIL

---

## UTV2-70 Verification — RecapAgent

### AC-1/2: Window calculations

Unit test evidence:
- [ ] `getRecapWindow('daily')` correct midnight-to-midnight — PASS / FAIL
- [ ] `getRecapWindow('weekly')` correct Mon–Sun — PASS / FAIL

### AC-3: Collision detection

- [ ] `detectRecapCollision(first Monday of month)` returns `'combined'` — PASS / FAIL

### AC-6: `POST /api/recap/post` live call

Request: `{ "period": "daily" }`

Response:
```json

```

Discord embed confirmed in `discord:best-bets`:
- [ ] PASS / FAIL — embed visible / message ID: ___________________

### AC-7: No-op when token absent

- [ ] PASS / FAIL — returns `{ ok: false, reason: 'DISCORD_BOT_TOKEN not configured' }` in test

---

## Feed Block Unchanged

`POST /api/picks/:id/settle` with `source: 'feed'`:
- [ ] Still returns 409 — PASS / FAIL

---

## Audit Log

Sample `audit_log` row for auto-graded pick:
```json

```

- [ ] `action: 'settlement.graded'` — PASS / FAIL
- [ ] `gradingContext` in payload — PASS / FAIL

---

## Verdict

- [ ] All ACs green
- [ ] No regressions
- [ ] `pnpm verify` exits 0
- [ ] Discord embed confirmed live

**M12 Status:** PASS / FAIL

---

## Post-Closure Updates Required

- [ ] `PROGRAM_STATUS.md` — M12 CLOSED, M13 queued
- [ ] `ISSUE_QUEUE.md` — UTV2-68/69/70/71 all → DONE
- [ ] Linear — UTV2-98/99/100/101 → Done
