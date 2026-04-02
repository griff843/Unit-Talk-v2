# Minimum Operational Lock Audit — 2026-04-02

**Status:** AUDIT ARTIFACT  
**Auditor:** Claude Code (systems architect lane)  
**Date:** 2026-04-02  
**Scope:** Operational truth assessment before formal burn-in — not a feature build  
**DB queried:** `feownrheeefbcsehtsiw` (live Supabase, 2026-04-02)  
**Evidence basis:** Live DB queries + repo code inspection + runtime observation

---

## 1. Executive Verdict

**System is NOT operationally ready for burn-in.**

Four independent subsystems are broken at the runtime level. Multiple code fixes committed to main have not been activated because the API process has not been restarted. The canonical backbone migrations — representing months of infrastructure work (UTV2-265 through UTV2-268) — have not been applied to the production database, making the Smart Form live-offer-first flow entirely non-functional in production. The worker is not running, leaving a qualified pick pending for 8+ hours. Discord delivery is down for real picks.

These are not edge cases or minor regressions. They are blockers.

---

## 2. Subsystem Classification

| Subsystem | Status | Confidence |
|---|---|---|
| Smart Form submission (basic) | **PARTIAL** | Proven via DB |
| Capper attribution (griff843) | **WORKING** | Proven for picks since 2026-04-02 00:47 |
| Confidence floor bypass | **BROKEN** | Proven via promotion history — fix not active at runtime |
| Promotion/lifecycle progression | **BROKEN** | Worker down; floor bypass inactive; board cap limiting |
| Discord delivery | **BROKEN** | Worker not running; stub receipts; last real canary 38h ago |
| Worker runtime | **BROKEN** | Not running; pending outbox unprocessed 8+ hours |
| Settlement (operator-triggered) | **PARTIAL** | Works when invoked; idempotency migration missing |
| Settlement (automated grading) | **PARTIAL** | Last ran 2026-03-27; SGO stalled |
| Scoring/intelligence (domain analysis) | **PARTIAL** | Present but edge source is confidence-delta, no real devig |
| Provider ingest — SGO | **BROKEN** | Stalled since 2026-03-27 |
| Provider ingest — Odds API | **PARTIAL** | Single batch 2026-04-02 00:02, not continuous |
| Smart Form live-offer browse | **BROKEN** | Canonical backbone migrations not applied to DB |
| Canonical backbone (UTV2-265 to 268) | **BROKEN** | Code merged; migrations never applied |
| Command Center operator truth | **PARTIAL** | Exists but misleading in 3 identified ways |

---

## 3. What Is Definitely Working

**Evidence level: proven via live DB queries.**

1. **Smart Form basic submission flow** — picks created, submissions created, market/selection/odds correctly persisted. 8 smart-form picks created on 2026-04-02.

2. **Capper attribution (post-fix)** — all smart-form submissions from 2026-04-02 00:47 UTC onward correctly record `submitted_by = 'griff843'`. Fix is working in production for new picks.

3. **Promotion evaluation engine** — domain analysis runs on every pick. `domainAnalysis` and `realEdge` are present on all recent smart-form picks. `pick_promotion_history` records are written with full score inputs, gate inputs, and explanation payloads for all recent picks.

4. **Atomic RPC functions** — `process_submission_atomic`, `enqueue_distribution_atomic`, `confirm_delivery_atomic`, `settle_pick_atomic` all exist in the DB. Atomic paths are available.

5. **Outbox creation** — qualified picks get outbox rows created correctly (`discord:best-bets` target, status `pending`).

6. **Operator settlement path** — 10 operator-triggered settlements recorded, picks correctly transitioned to `settled` state. Last operator settlement: 2026-04-01 07:20 UTC.

7. **Dead-letter gate** — worker correctly blocks test/proof-source picks from reaching real Discord (`proof-pick-blocked` gate). All 6 dead-letter rows are from test sources. This is correct behavior, not a delivery failure.

8. **Pick lifecycle FSM** — valid picks advance through `validated → queued → posted → settled` correctly. 14 settled picks, 21 posted, 9 queued. No illegal state transitions observed.

9. **Settlement idempotency on picks** — `picks.idempotency_key` column exists (migration applied).

---

## 4. What Is Partially Working

1. **Capper attribution (historical)** — 18 of 36 smart-form submissions have `submitted_by = null`. All pre-2026-04-02 picks are unattributed. The fix does not backfill. Historical attribution is broken; new picks are correct.

2. **Discord delivery — real channels** — real Discord delivery WAS working (12 receipts to `discord:1296531122234327100` through 2026-03-31, 7 to `discord:1356613995175481405` through 2026-03-28). It is not working now because the worker is not running. The delivery mechanism is proven functional when the worker is running.

3. **Scoring/intelligence** — `domainAnalysis` and `realEdge` are present on picks. However, `deviggingResult` is absent on all recent smart-form picks (no live provider data to match against). Edge source for all recent picks is `confidence-delta` (fallback path), not `real-edge`. Intelligence is running but degraded due to stalled ingest.

4. **Settlement automated grading** — 4 grading-source settlements exist from 2026-03-27. The grading pipeline ran once. It is not running now (dependent on SGO game results, which aren't accumulating).

5. **Odds API ingest** — 168 rows from 4 books (DraftKings/FanDuel/BetMGM/Pinnacle) ingested on 2026-04-02 00:02 UTC in a single batch. Code proven working. Not continuous.

6. **Promotion qualification** — picks with confidence ≥ 0.6 and sufficient scores DO qualify (evidence: `ec12fca9` qualified for best-bets, score 75.20). The promotion pipeline works for picks that clear all gates.

---

## 5. What Is Broken

### B1 — Confidence Floor Bypass NOT Active at Runtime (CRITICAL)

**Evidence:** All promotion decisions recorded on 2026-04-02 for `source = 'smart-form'` picks show `gateInputs.confidenceFloor = 0.6`. Picks with `confidence < 0.6` are being blocked by the floor even though the code fix in `apps/api/src/promotion-service.ts` (lines 162 and 439) sets `confidenceFloor = undefined` for smart-form source.

**Root cause:** The API process running when these picks were submitted was NOT using the fixed code. The fix is committed to main (`73978aa`) but the local API process was not restarted after the fix was deployed.

**Impact:** Picks submitted with conviction < 6 (confidence < 0.6) are suppressed and stuck in `validated/not_eligible`. At least 3 recent smart-form picks (14:31, 07:48, 06:53 UTC) were incorrectly blocked.

**Affected picks:** `81de3184`, `63fe67d3`, `0f52c900` — all `validated/not_eligible` due to `"pick confidence is below the best-bets floor"` despite coming from `smart-form` source.

### B2 — Worker Not Running (CRITICAL)

**Evidence:** Outbox row `cf80df18` (pick `ec12fca9`, target `discord:best-bets`, status `pending`) created at 06:24 UTC. No processing after 8+ hours. No new receipts recorded since `stub:discord:best-bets` at 02:19 UTC.

**Impact:** All qualified picks stuck in outbox. No Discord delivery. E9 burn-in condition will remain failed until worker restarts.

### B3 — Stub Receipt Recorded as "Sent" (MISLEADING)

**Evidence:** `distribution_receipts` contains a row with `channel = 'stub:discord:best-bets'`, `status = 'sent'`, recorded at 2026-04-02 02:19 UTC. This is a STUB delivery, not real Discord. Any operator surface counting this receipt as a real delivery is reporting false truth.

**Impact:** Command Center or operator views that show total delivery counts include this stub row. It creates misleading confidence about Discord connectivity.

### B4 — Canonical Backbone Migrations NOT Applied to Production DB (CRITICAL)

**Evidence:** Tables `canonical_sports`, `canonical_market_types`, `canonical_leagues`, `canonical_teams`, `canonical_players`, `provider_team_aliases`, `provider_market_aliases`, `canonical_events`, `canonical_players_teams` — NONE exist in the production database.

Migrations in `/supabase/migrations/`:
- `202604020001_canonical_reference_backbone.sql` — NOT applied
- `202604020002_canonical_market_taxonomy.sql` — NOT applied
- `202604020003_canonical_reference_bootstrap.sql` — NOT applied

**Impact:**
- Smart Form browse/search endpoints (`/api/reference-data/events/:id/browse`, `/api/reference-data/search`) will throw SQL errors at runtime — these tables don't exist.
- UTV2-274 live-offer-first Smart Form flow is entirely non-functional in production despite being "complete" in code.
- The entire canonical backbone sprint (UTV2-265, UTV2-266, UTV2-267, UTV2-268) is code-only. No DB state matches.
- Playwright e2e tests pass because all API calls are mocked — they prove nothing about live browse flow.

### B5 — SGO Ingest Stalled (CRITICAL for CLV/Grading)

**Evidence:** SGO last inserted row: 2026-03-27 23:41 UTC. Zero SGO rows in last 6 days. All recent smart-form picks have `deviggingResult: absent` and edge source `confidence-delta` — no SGO market data available.

**Impact:** Real-edge computation falls back to confidence-delta. CLV is not being computed. Automated grading is stalled. E4 burn-in condition remains failed.

### B6 — Settlement Idempotency Migration Missing

**Evidence:** `information_schema.table_constraints` shows no UNIQUE constraint on `settlement_records`. Migration `202603310002_settlement_idempotency.sql` not applied.

**Impact:** Double-settlement is possible. The atomic `settle_pick_atomic` RPC exists but the idempotency guarantee at the DB level (UNIQUE partial index on `settlement_records(pick_id, source)`) is not enforced.

---

## 6. What Is Blocked

1. **Burn-in start** — blocked by B2 (worker down), B4 (canonical migrations not applied), B1 (confidence floor not active), B5 (SGO stalled). Multiple E-conditions fail.

2. **Smart Form live-offer-first flow** — blocked by B4 (canonical DB tables don't exist). Even if the API starts correctly with the new code, browse/search calls will fail.

3. **Automated CLV computation** — blocked by B5 (SGO stalled). No Pinnacle closing lines accumulating.

4. **Automated grading** — blocked by B5 (SGO stalled). No game result data.

5. **Conviction < 6 picks qualifying** — blocked by B1 (confidence floor active on runtime API). These picks should qualify for best-bets but are being suppressed.

---

## 7. Contradictions and Misleading Surfaces

### C1 — PROGRAM_STATUS.md Claims "All Green"

`PROGRAM_STATUS.md` (last updated 2026-04-01) says: "Tests: All pass — 0 failures. Gates: `pnpm lint` PASS. `pnpm type-check` PASS. `pnpm test` PASS." This is true for the repo test suite. It is NOT true for runtime operation. The document does not say "runtime is healthy" but a reader would interpret it as indicating system health. It should be updated to distinguish repo health from runtime health.

### C2 — Playwright e2e Tests Pass But Live Browse Flow Is Broken

`PROGRAM_STATUS.md` claims "188 Playwright e2e tests" but the live-offer browse flow that UTV2-274 describes is completely unmocked in the DB. The Playwright spec at `apps/smart-form/e2e/smart-form-submission.spec.ts` mocks all API calls. These tests prove the UI logic works. They do NOT prove the live API returns correct data. In production, `/api/reference-data/events/:id/browse` would fail because `canonical_events` does not exist.

### C3 — Stub Receipt Inflates Delivery Count

The most recent `distribution_receipts` row (`2026-04-02 02:19`) has `channel = 'stub:discord:best-bets'`. Any surface counting "delivered picks" includes this stub. Command Center delivery stats that don't filter by channel prefix `stub:` will show misleadingly high delivery counts.

### C4 — Dead-Letter Count Is Not a Real Delivery Failure

All 6 dead-letter rows are from test/proof-source picks blocked by the `proof-pick-blocked` gate. If the Command Center exception queue shows "6 dead-letter" without source context, an operator would investigate a non-existent real delivery failure. The dead-letter queue is healthy; the label is misleading without the source annotation.

### C5 — Channel Key Inconsistency in Receipt History

Receipts show 4 different channel key formats for what is the same canary channel:
- `discord:#canary` (3 rows, 2026-04-01)
- `discord:1296531122234327100` (12 rows, 2026-03-31)
- `discord:discord:canary` (1 row, 2026-03-20, malformed double-prefix)
- `discord:canary` target in outbox vs `discord:#canary` in receipts

This format drift means channel-based analytics are unreliable. Counting receipts by channel will undercount because the same physical channel has multiple key representations.

### C6 — Confidence Bypass Fix Appears Active (Code), Isn't (Runtime)

Code at `apps/api/src/promotion-service.ts:162` correctly bypasses the confidence floor for `smart-form` source. Runtime promotion history for smart-form picks submitted TODAY shows `confidenceFloor: 0.6` still applied. The fix is in code but not in effect. Without this context, a code reviewer would say "fixed" while the operator sees picks still blocked.

---

## 8. Minimum Operational Requirements Not Yet Satisfied

| Requirement | Status | Evidence |
|---|---|---|
| Worker running continuously | ❌ NOT MET | Pending outbox row unprocessed 8+ hours |
| At least one real Discord canary delivery per 24h | ❌ NOT MET | Last real canary: 2026-04-01 07:20 (38h ago) |
| SGO ingest running and inserting rows | ❌ NOT MET | Last row: 2026-03-27 |
| Canonical backbone DB tables exist | ❌ NOT MET | Tables absent from production DB |
| Confidence floor bypass active for smart-form | ❌ NOT MET | Fix in code, not active at runtime |
| Settlement idempotency constraint applied | ❌ NOT MET | Migration not applied |
| Stub receipts filtered from operator delivery counts | ❌ NOT MET | `stub:` prefix not filtered |
| Channel key consistency in receipts | ❌ NOT MET | 4 different key formats |

---

## 9. Recommended Fix Order

Priority sequence based on operational dependency:

1. **P0 — Restart API process** (5 min) — activates confidence floor bypass and any other accumulated code fixes. Required before testing anything else.

2. **P0 — Apply pending DB migrations** (15 min) — `202603310002_settlement_idempotency.sql`, `202604020001_canonical_reference_backbone.sql`, `202604020002_canonical_market_taxonomy.sql`, `202604020003_canonical_reference_bootstrap.sql`. Unlocks live-offer browse, canonical backbone, settlement safety.

3. **P0 — Start worker process** (`UNIT_TALK_WORKER_AUTORUN=true`) (5 min) — processes pending outbox, restores Discord delivery path, unblocks E6/E9.

4. **P0 — Restart SGO ingestor** (10 min + investigation) — restore provider data accumulation, unblocks E4, restores real-edge and CLV paths. Root cause must be diagnosed first (API key, endpoint, scheduler).

5. **P1 — Start Odds API ingestor as continuous process** (10 min) — `UNIT_TALK_INGESTOR_AUTORUN=true`. Verify second distinct batch timestamp. Unblocks E5.

6. **P1 — Filter stub receipts from operator surfaces** — update Command Center delivery count queries to exclude `channel LIKE 'stub:%'`. Prevents false delivery confidence.

7. **P1 — Normalize channel key format** — standardize receipt `channel` field to canonical format (`discord:canary` not `discord:#canary`). Needed for accurate per-channel analytics.

8. **P2 — Historical capper attribution backfill** — `UPDATE submissions SET submitted_by = 'griff843' WHERE source = 'smart-form' AND submitted_by IS NULL`. Operator decision required. 18 rows affected.

9. **P2 — Verify settlement `fetch failed` is resolved** — manual test: operator-settle a live pick via Command Center, confirm no `fetch failed` error in API response.

---

## 10. Go / No-Go Verdict

**NO-GO for burn-in start.**

| Gate | Status |
|---|---|
| E1 — `pnpm verify` green | ✅ PASS |
| E2 — type-check clean | ✅ PASS |
| E3 — capper submitting real picks | ✅ PASS (7 picks today) |
| E4 — SGO ingest fresh | ❌ FAIL |
| E5 — Odds API continuous | ❌ FAIL |
| E6 — Worker running | ❌ FAIL |
| E7 — Operator snapshot accessible | ⚠️ UNVERIFIED |
| E8 — Command Center accessible | ⚠️ UNVERIFIED |
| E9 — Recent canary delivery | ❌ FAIL |

**Required before burn-in can start:** Restart API + apply migrations + start worker + restore SGO + verify E5/E6/E7/E8/E9 from runtime.

Items E4/E9 cannot be verified from code alone. They require physical process management: start the ingestor, start the worker, and confirm live DB rows.

---

## Appendix — Live DB Evidence

All queries run against `feownrheeefbcsehtsiw` on 2026-04-02.

### Pick lifecycle distribution
```
validated: 48  (46 not_eligible, 2 validated+qualified t1-proof w/ no outbox)
queued:     9  (all qualified)
posted:    21  (mixed promotion targets)
settled:   14
total:     92
```

### Smart-form promotion (recent picks, 2026-04-02)
| Pick | Created | Confidence | Trust | Best-bets result | Suppression reason |
|---|---|---|---|---|---|
| `ec12fca9` | 06:24 | 0.7 | 70 | qualified | — (queued, worker pending) |
| `18ab6770` | 02:24 | 0.7 | 70 | not_eligible | board cap (sameSport=3) |
| `ad834cba` | 02:24 | 0.8 | 80 | not_eligible | board cap (sameSport=3) |
| `0f52c900` | 06:53 | 0.4 | 40 | not_eligible | confidence floor (0.4 < 0.6) |
| `63fe67d3` | 07:48 | 0.5 | 50 | not_eligible | confidence floor + board cap |
| `81de3184` | 14:31 | 0.5 | 50 | not_eligible | confidence floor (0.5 < 0.6) |
| `3b3beb26` | 14:55 | 0.7 | 70 | not_eligible | board cap (sameSport=3) |

*Note: confidence floor should be `undefined` for smart-form picks — fix not active at runtime*

### Outbox state
```
pending:     1  (smart-form best-bets, created 06:24)
sent:       22  (best-bets:15, canary:6, trader-insights:1)
dead_letter: 6  (all t1-proof, correctly blocked)
```

### Distribution receipts (channels)
```
stub:discord:best-bets      1   last: 2026-04-02 02:19 ← STUB
discord:#canary             3   last: 2026-04-01 07:20
discord:1296531122234327100 12  last: 2026-03-31 00:55
discord:1356613995175481405  4  last: 2026-03-28 02:39
discord:1288613037539852329  6  last: 2026-03-28 02:39
discord:discord:canary      1   last: 2026-03-20 (malformed)
```

### Provider state
```
sgo                  10,417 rows  last: 2026-03-27  STALLED
odds-api:draftkings     48 rows   last: 2026-04-02 00:02  SINGLE BATCH
odds-api:fanduel        48 rows   last: 2026-04-02 00:02  SINGLE BATCH
odds-api:betmgm         36 rows   last: 2026-04-02 00:02  SINGLE BATCH
odds-api:pinnacle       36 rows   last: 2026-04-02 00:02  SINGLE BATCH
```

### DB tables present / missing
```
PRESENT: picks, submissions, distribution_outbox, distribution_receipts,
         pick_promotion_history, settlement_records, provider_offers,
         pick_lifecycle, audit_log, sports, sportsbooks, events,
         participants, sport_market_types, stat_types
         
MISSING: canonical_sports, canonical_leagues, canonical_teams,
         canonical_players, canonical_market_types, canonical_events,
         provider_team_aliases, provider_player_aliases,
         provider_market_aliases, provider_book_aliases
```
