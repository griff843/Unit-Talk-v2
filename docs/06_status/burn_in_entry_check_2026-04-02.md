# Burn-In Entry Check — E1–E9 Assessment

**Status:** ASSESSMENT — PM decision required  
**Date:** 2026-04-02  
**Issue:** UTV2-256  
**Verdict:** ❌ NOT READY — E4, E9 fail; E5, E6, E7, E8 unverified from runtime

---

## Entry Condition Verdicts

| # | Condition | Verdict | Evidence |
|---|-----------|---------|----------|
| E1 | `pnpm verify` exits 0 | ✅ GREEN | Type-check clean, 188+ tests pass (confirmed 2026-04-02) |
| E2 | `pnpm type-check` exits 0 | ✅ GREEN | Zero type errors (confirmed 2026-04-02) |
| E3 | At least one capper actively submitting real picks | ✅ GREEN | 7 picks in last 24h, latest at 2026-04-02 14:31 UTC. Source: `smart-form` picks from griff843 |
| E4 | SGO ingestor running and inserting rows | ❌ RED | SGO last row: **2026-03-27 23:41 UTC** (5+ days stale). Zero SGO rows in last 24h |
| E5 | Odds API ingestor configured and returning data | ⚠️ PARTIAL | 168 rows from 4 books (DK/FD/BetMGM/Pinnacle) ingested on 2026-04-02 00:02 UTC — single batch, not continuous. Code proven working; scheduler not confirmed running |
| E6 | Worker process running with `UNIT_TALK_WORKER_AUTORUN=true` | ⚠️ UNVERIFIED | Cannot confirm from DB alone. Requires runtime check of operator snapshot |
| E7 | Operator snapshot accessible (`GET /api/operator/snapshot` → 200) | ⚠️ UNVERIFIED | Requires runtime check (app not started in this session) |
| E8 | Command Center accessible at port 4300 | ⚠️ UNVERIFIED | Requires runtime check |
| E9 | Discord canary delivery confirmed in last 24h | ❌ RED | Latest canary delivery: **2026-04-01 07:20 UTC** (~31h ago). Outside 24h window as of assessment time |

---

## Blocking Gaps

### E4 — SGO Ingest Stalled (P0 before burn-in)

SGO has not inserted new rows since 2026-03-27. The ingestor job is not running, or the SGO feed is unavailable. CLV computation, real-edge signals, and game result grading depend on SGO data continuity.

**Required fix:** Restart SGO ingestor with `UNIT_TALK_INGESTOR_AUTORUN=true` as a persistent background process and confirm new rows appear in `provider_offers`.

### E9 — No Recent Discord Canary Delivery

The last canary delivery was 2026-04-01 07:20 UTC. A new pick delivery via the worker to `discord:canary` is required within the 24h window before burn-in can be declared started.

**Required fix:** Submit a pick, confirm it is qualified and enqueued, start the worker, and verify a receipt row with `channel = 'discord:#canary'` and `status = 'sent'` appears.

---

## Non-Blocking Gaps (PM Confirmation Required)

| Gap | Action |
|-----|--------|
| E5 — Odds API single batch | Start ingestor scheduler; verify a second batch timestamp appears |
| E6 — Worker health | Start worker with `UNIT_TALK_WORKER_AUTORUN=true`; check operator snapshot |
| E7 — Operator snapshot | Start operator-web on port 4200; confirm `/api/operator/snapshot` returns 200 |
| E8 — Command Center | Start command-center on port 4300; confirm home page loads |

---

## DB Queries Used

```sql
-- E3: recent picks
SELECT COUNT(*) as picks_last_24h, MAX(created_at) as latest_pick
FROM picks WHERE created_at > now() - interval '24h';

-- E4: SGO ingest freshness
SELECT COUNT(*) FROM provider_offers
WHERE provider_key = 'sgo' AND created_at > now() - interval '24h';

-- E9: recent canary deliveries
SELECT channel, status, MAX(recorded_at) as latest, COUNT(*) as count
FROM distribution_receipts WHERE channel LIKE '%canary%'
GROUP BY channel, status ORDER BY latest DESC;
```
