# Minimum Operational Lock — Proposed Linear Issues

**Status:** DRAFT — PM review required before creating  
**Date:** 2026-04-02  
**Source:** `minimum_operational_lock_audit_2026-04-02.md`

Issues are sequenced by operational dependency. All are required unless marked optional.

---

## Issue 1 — Apply Pending Canonical Backbone DB Migrations

**Title:** Apply unapplied Supabase migrations to unlock canonical backbone and settlement safety

**Why it matters:**  
4 migrations are in the repo but have never been applied to production Supabase. The canonical backbone tables (`canonical_sports`, `canonical_market_types`, `canonical_teams`, etc.) do not exist in the DB. Every API endpoint added by UTV2-265 through UTV2-268 that queries these tables will throw a SQL error at runtime. The Smart Form live-offer browse flow is completely non-functional because of this. Settlement idempotency is also missing (`202603310002`). All downstream development that assumes these tables exist is building on unmigrated ground.

**Scope:**  
Apply exactly these migration files to Supabase:
- `supabase/migrations/202603310002_settlement_idempotency.sql`
- `supabase/migrations/202604020001_canonical_reference_backbone.sql`
- `supabase/migrations/202604020002_canonical_market_taxonomy.sql`
- `supabase/migrations/202604020003_canonical_reference_bootstrap.sql`

Regenerate `packages/db/src/database.types.ts` after applying.

**Acceptance criteria:**
- `canonical_sports`, `canonical_market_types`, `canonical_teams`, `canonical_players`, `provider_team_aliases`, `provider_market_aliases`, `provider_book_aliases` all exist in Supabase
- `settlement_records` has UNIQUE partial index on `(pick_id, source)`
- `packages/db/src/database.types.ts` regenerated and committed to match new schema
- `pnpm test:db` passes
- `pnpm type-check` passes

**Owner model:** PM-review (apply migrations) + Claude (type regen + verify)  
**Tier:** T1  
**Priority:** P0  
**Lane:** PM-review → Claude  
**Kind:** runtime / migration  
**Area:** db  
**Dependencies:** None  
**Burn-in blocker:** YES — live-offer browse fails without canonical tables

---

## Issue 2 — Restart API, Worker, and Ingestor Processes with Correct Config

**Title:** Process restart: API (fixed code), worker (AUTORUN=true), ingestor (AUTORUN=true)

**Why it matters:**  
Three runtime processes are either not running or running stale code:
1. **API** — confidence floor bypass fix (`73978aa`) is in main but the running process is using old code. Smart-form picks with conviction < 6 are incorrectly suppressed.
2. **Worker** — not running. 1 qualified pick (`ec12fca9`) has been pending in outbox for 8+ hours. No Discord delivery since 2026-04-01 07:20.
3. **Ingestor** — not running continuously. SGO stalled since 2026-03-27. Odds API ran once (single batch).

**Scope:**  
This is an operational (process management) task, not a code task:
- Restart API: `cd C:/Dev/Unit-Talk-v2-main && npx tsx apps/api/src/index.ts`
- Start worker: `UNIT_TALK_WORKER_AUTORUN=true npx tsx apps/worker/src/index.ts`
- Start ingestor: `UNIT_TALK_INGESTOR_AUTORUN=true npx tsx apps/ingestor/src/index.ts`
- Diagnose why SGO stopped ingesting (check SGO_API_KEY validity, endpoint, scheduler)
- Verify second Odds API batch timestamp appears within 1 hour

**Acceptance criteria:**
- API running on port 4000 with fixed code (confirm via `POST /api/submissions` response shape)
- Smart-form pick with conviction=5 (confidence=0.5) qualifies for best-bets (`promotion_status = 'qualified'` with NO confidence floor suppression in history)
- Worker processing pending outbox row `cf80df18` — confirm `status = 'sent'` in DB
- New `distribution_receipts` row with `channel = 'discord:canary'` (or `discord:best-bets`) and `status = 'sent'` appears
- SGO: new rows in `provider_offers` with `provider_key = 'sgo'` after restart
- Odds API: at least 2 distinct `created_at` timestamps for `provider_key LIKE 'odds-api%'` rows

**Owner model:** PM-review (process management)  
**Tier:** T1  
**Priority:** P0  
**Lane:** PM-review  
**Kind:** runtime  
**Area:** api / ingestor / worker  
**Dependencies:** Issue 1 (apply migrations before restarting API)  
**Burn-in blocker:** YES — E4, E6, E9 all fail without this

---

## Issue 3 — Fix Receipt Channel Key Inconsistency

**Title:** Normalize distribution_receipts channel key format and filter stub receipts from operator surfaces

**Why it matters:**  
The `distribution_receipts` table contains 4 different string formats for what is the same Discord canary channel: `discord:#canary`, `discord:1296531122234327100`, `discord:discord:canary` (malformed), and the stub variant `stub:discord:best-bets`. This means channel-based analytics (delivery counts per channel, per-target health) are unreliable — the same physical channel has multiple key representations and the stub row is counted as a real delivery.

**Scope:**  
Two bounded changes:
1. **Worker delivery adapter**: standardize the `channel` value written to `distribution_receipts` to use the canonical target key (`discord:canary`, `discord:best-bets`, `discord:trader-insights`) — not the raw channel ID and not the `#`-prefix format.
2. **Operator surfaces**: update Command Center and operator-web delivery count queries to exclude `channel LIKE 'stub:%'` rows.

Historical receipts with inconsistent keys should be left as-is (do not backfill). New receipts should use the canonical format going forward.

**Acceptance criteria:**
- New receipts after the fix use `discord:canary` (not `discord:#canary`, not channel ID)
- Command Center delivery count for best-bets excludes stub rows
- `pnpm test` green
- `pnpm type-check` green

**Owner model:** Claude  
**Tier:** T2  
**Priority:** P1  
**Lane:** Claude  
**Kind:** bug / runtime  
**Area:** worker / command-center / operator-web  
**Dependencies:** Issue 2 (worker must be running to verify new receipts)  
**Burn-in blocker:** YES — E9 verification requires accurate channel key to confirm canary delivery

---

## Issue 4 — Verify and Harden Canonical Browse/Search APIs Against Missing DB State

**Title:** Runtime-test canonical browse/search APIs after migrations applied; add graceful failure mode

**Why it matters:**  
The browse (`/api/reference-data/events/:id/browse`) and search (`/api/reference-data/search`) endpoints were added by UTV2-268/UTV2-274. They query canonical tables that did not exist in production DB until Issue 1 is applied. After Issue 1 applies the migrations, these endpoints need to be tested against the actual DB to confirm they work. Additionally, if canonical tables exist but are empty (seeds not run), the endpoints should return empty results gracefully rather than SQL errors.

**Scope:**
- After Issue 1 (migrations applied): run `GET /api/reference-data/events/:id/browse` and `GET /api/reference-data/search?q=test` against live API, confirm 200 or graceful empty response (not 500)
- If endpoints return SQL errors due to missing seed data: identify which tables need seeding and run the bootstrap seeding script
- Confirm `GET /api/reference-data/catalog` still returns V1_REFERENCE_DATA catalog correctly (this path is hardcoded and should not break)
- Playwright e2e tests should run with mock server AND against live API (or document that e2e only tests mocked paths)

**Acceptance criteria:**
- `GET /api/reference-data/events/any-id/browse` returns 200 or 404 (not 500)
- `GET /api/reference-data/search?q=test&sportId=NBA` returns 200 with `data: []` if no data, not SQL error
- Catalog endpoint still returns sports/sportsbooks/cappers
- `pnpm type-check` green after DB type regen

**Owner model:** Claude  
**Tier:** T1  
**Priority:** P1  
**Lane:** Claude  
**Kind:** runtime / proof  
**Area:** api / smart-form  
**Dependencies:** Issue 1 (migrations), Issue 2 (API restart)  
**Burn-in blocker:** YES — live-offer browse cannot work until this is proven

---

## Issue 5 — SGO Ingest Root Cause Diagnosis and Restart

**Title:** Diagnose SGO ingest stall (since 2026-03-27) and restore continuous accumulation

**Why it matters:**  
SGO has not inserted new rows since 2026-03-27 23:41 UTC — over 6 days. This blocks: real-edge computation (falls back to confidence-delta), automated grading (depends on game results from SGO feed), CLV computation (depends on closing line data). The root cause is unknown — could be API key expiry, endpoint change, network issue, or scheduler not running.

**Scope:**
- Check `SGO_API_KEY` is set and valid in `local.env`
- Check ingestor logs or run manually: `cd C:/Dev/Unit-Talk-v2-main && npx tsx apps/ingestor/src/index.ts` with `UNIT_TALK_INGESTOR_AUTORUN=false` (single run), observe output
- If API key issue: renew key
- If scheduler issue: ensure continuous run (`UNIT_TALK_INGESTOR_AUTORUN=true`)
- Confirm new SGO rows appear in `provider_offers` within 30 minutes
- Document root cause

**Acceptance criteria:**
- `SELECT COUNT(*) FROM provider_offers WHERE provider_key = 'sgo' AND created_at > now() - interval '30m'` > 0
- Ingestor log shows successful SGO fetch with no auth/connection errors
- Root cause documented

**Owner model:** PM-review (check API key) + Claude (diagnose, fix, verify)  
**Tier:** T1  
**Priority:** P0  
**Lane:** Joint  
**Kind:** runtime / bug  
**Area:** ingestor  
**Dependencies:** None  
**Burn-in blocker:** YES (E4 fails without this)

---

## Issue 6 — Historical Capper Attribution Backfill (Optional, PM Decision)

**Title:** Backfill `submitted_by = 'griff843'` on 18 historical null-attributed smart-form submissions

**Why it matters:**  
18 smart-form submissions (all pre-2026-04-02) have `submitted_by = NULL`. The capper attribution fix is correct for new submissions. Historical picks have no attribution, which means operator surfaces can't filter "my picks" for the full history. This is a data quality issue, not a code bug.

**Scope:**  
Single SQL statement:
```sql
UPDATE submissions
SET submitted_by = 'griff843'
WHERE source = 'smart-form' AND submitted_by IS NULL;
```

This updates exactly 18 rows. It does NOT update `picks` (which has no `submitted_by` column — attribution is via the `submissions` join).

**Acceptance criteria:**
- `SELECT COUNT(*) FROM submissions WHERE source = 'smart-form' AND submitted_by IS NULL` = 0
- No other sources affected

**Owner model:** PM-review required before execution (confirms all historical smart-form picks are from griff843)  
**Tier:** T2  
**Priority:** P2  
**Lane:** PM-review  
**Kind:** hardening  
**Area:** api  
**Dependencies:** None  
**Burn-in blocker:** NO — operational without this

---

## Issue 7 — Verify Settlement `fetch failed` Is Resolved

**Title:** Confirm settlement endpoint does not throw `fetch failed` error from Command Center UI

**Why it matters:**  
The audit prompt references a prior `fetch failed` runtime error on the settlement path. DB evidence shows settlements ARE being recorded (10 operator, 4 grading). The error may have been transient, or may still occur only under specific conditions (e.g., Command Center → API → DB under certain pick states). This must be confirmed resolved before burn-in where settlement is a daily operation.

**Scope:**
- Operator-settle a live pick through Command Center UI (`POST /api/picks/:id/settle`)
- Confirm no `fetch failed` error in API response or browser network tab
- Confirm settlement record in DB
- Confirm pick status transitions to `settled`

**Acceptance criteria:**
- Settlement request completes with 200
- New row in `settlement_records`
- Pick status = `settled`
- No `fetch failed` error in API logs or network response

**Owner model:** PM-review (manual test)  
**Tier:** T1  
**Priority:** P1  
**Lane:** PM-review  
**Kind:** proof  
**Area:** settlement / api  
**Dependencies:** Issue 2 (API must be running with fixed code)  
**Burn-in blocker:** YES — settlement is a daily burn-in checklist item

---

## Issue 8 — Annotate Dead-Letter Queue With Source Context in Command Center

**Title:** Add source annotation to exception/dead-letter queue to distinguish test picks from real failures

**Why it matters:**  
All 6 dead-letter rows are from `source = 't1-proof'` or `source = 'test-proof-step1'`. They are correctly blocked by the `proof-pick-blocked` gate. However, the Command Center exception page shows "6 dead-letter" without source context. An operator responding to this count would spend time triaging a non-issue. The dead-letter queue should show source and the specific error, not just a count.

**Scope:**
- In Command Center exception/dead-letter view: add `source` column and `last_error` summary
- No API changes required — `distribution_outbox.last_error` and the joined `picks.source` are already queryable via operator-web
- Add `source` filter to dead-letter query in operator-web route

**Acceptance criteria:**
- Dead-letter queue in Command Center shows source alongside error message
- `picks.source = 'smart-form'` rows are visually distinguishable from `t1-proof` rows
- No new API endpoints required — existing data surfaced

**Owner model:** Codex  
**Tier:** T2  
**Priority:** P2  
**Lane:** Codex  
**Kind:** runtime / hardening  
**Area:** command-center / operator-web  
**Dependencies:** None  
**Burn-in blocker:** NO — cosmetic clarity, not blocking

---

## Issue 9 — Board Cap Tuning Review (PM Decision)

**Title:** Review and document board cap policy impact on smart-form capper picks

**Why it matters:**  
The best-bets board cap is `perSport: 3, perSlate: 5, perGame: 1`. As of 2026-04-02 14:55 UTC, 3 NBA picks are on the board — the cap is saturated. Subsequent NBA picks are blocked regardless of score, confidence, or conviction. For a single-capper system where all picks come from one person on one sport on a given day, the `perSport: 3` cap will routinely block valid picks after the third NBA pick.

**Scope:**
- PM decision: is `perSport: 3` the intended cap for burn-in, or should it be higher?
- If cap should be loosened: update `bestBetsPromotionPolicy.boardCaps.perSport` in `packages/contracts/src/promotion.ts`
- No DB change required — policy is in code
- If cap is intentional: document the expected behavior (3rd+ NBA pick of day will not post)

**Acceptance criteria:**
- Board cap value is documented as intentional or updated with PM approval
- If updated: `pnpm test` green, policy version bumped

**Owner model:** PM-review  
**Tier:** T2  
**Priority:** P2  
**Lane:** PM-review  
**Kind:** contract / hardening  
**Area:** domain  
**Dependencies:** None  
**Burn-in blocker:** NO — but will block picks regularly if not addressed

---

## Summary Table

| # | Title | Tier | Priority | Lane | Burn-in blocker |
|---|-------|------|----------|------|-----------------|
| 1 | Apply canonical backbone + settlement idempotency migrations | T1 | P0 | PM-review → Claude | YES |
| 2 | Restart API/worker/ingestor with correct config | T1 | P0 | PM-review | YES |
| 3 | Fix receipt channel key format + filter stubs | T2 | P1 | Claude | YES |
| 4 | Verify canonical browse/search APIs after migration | T1 | P1 | Claude | YES |
| 5 | SGO ingest root cause + restart | T1 | P0 | Joint | YES |
| 6 | Historical capper attribution backfill | T2 | P2 | PM-review | NO |
| 7 | Verify settlement `fetch failed` resolved | T1 | P1 | PM-review | YES |
| 8 | Dead-letter queue source annotation | T2 | P2 | Codex | NO |
| 9 | Board cap tuning review | T2 | P2 | PM-review | NO |
