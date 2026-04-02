# Provider State Addendum — 2026-04-02

**Status:** PROOF ARTIFACT — supersedes stale "single provider only" conclusion from the 2026-04-01 snapshot  
**Queried:** 2026-04-02 (live DB `feownrheeefbcsehtsiw`)  
**Issue:** UTV2-252

---

## Summary

The 2026-04-01 snapshot concluded "single provider only (SGO)." That conclusion is now superseded. The Odds API ingest fix (committed `99a6fd4`) successfully inserted the first Odds API rows on 2026-04-02. However, neither provider is continuously accumulating — both require attention before burn-in E4/E5 can be marked green.

---

## Provider State Table

| Provider | Row Count | First Row | Latest Row | Sports | Status |
|---|---|---|---|---|---|
| `sgo` | 10,417 | 2026-03-26 04:51 UTC | 2026-03-27 23:41 UTC | 3 | **STALLED** — no new rows since 2026-03-27 |
| `odds-api:draftkings` | 48 | 2026-04-02 00:02 UTC | 2026-04-02 00:02 UTC | 1 | **SINGLE BATCH** — not continuous |
| `odds-api:fanduel` | 48 | 2026-04-02 00:02 UTC | 2026-04-02 00:02 UTC | 1 | **SINGLE BATCH** — not continuous |
| `odds-api:betmgm` | 36 | 2026-04-02 00:02 UTC | 2026-04-02 00:02 UTC | 1 | **SINGLE BATCH** — not continuous |
| `odds-api:pinnacle` | 36 | 2026-04-02 00:02 UTC | 2026-04-02 00:02 UTC | 1 | **SINGLE BATCH** — not continuous |

**Total distinct providers:** 5 (1 SGO + 4 Odds API books)  
**Total Odds API rows:** 168 (single run, all sharing same `created_at`)

---

## Pre-Fix vs Post-Fix

| Dimension | Pre-Fix (≤ 2026-04-01) | Post-Fix (2026-04-02) |
|---|---|---|
| Distinct providers | 1 (SGO only) | 5 (SGO + 4 Odds API books) |
| Odds API rows | 0 | 168 |
| Odds API books | None | DraftKings, FanDuel, BetMGM, Pinnacle |
| Pinnacle data present | No | Yes — 36 rows |

---

## Ingest Continuity

| Provider | Continuous? | Evidence |
|---|---|---|
| SGO | **NOT proven** | All SGO rows cluster 2026-03-26 to 2026-03-27. No rows inserted in the 5+ days since. Ingest is stalled or the SGO scheduled job is not running. |
| Odds API (all 4 books) | **NOT proven** | All 168 rows share the same `created_at` (2026-04-02 00:02 UTC). This is a single-run batch capture, not a recurring schedule. |

**Conclusion:** The fix proved the Odds API pipeline is functional and produces correct rows. It did not establish continuous accumulation. Burn-in entry condition E5 ("Odds API ingestor configured and returning data") is *partially met* — the code works, but the scheduler has not run more than once.

---

## Required Actions Before E4/E5 Green

1. **SGO ingest restart** — investigate why SGO stalled after 2026-03-27. The scheduled job may not be running or the SGO API key/endpoint changed.
2. **Odds API continuous schedule** — run the ingestor with `UNIT_TALK_INGESTOR_AUTORUN=true` as a persistent background process, or schedule via cron. Verify a second distinct batch timestamp appears before marking E5 green.
3. **Pinnacle CLV dependency** — 36 Pinnacle rows exist (single batch). CLV computation can proceed for that batch, but ongoing CLV requires continuous Pinnacle accumulation.

---

## DB Query Used

```sql
-- Provider summary
SELECT provider_key, COUNT(*) as row_count,
       MIN(created_at) as first_at, MAX(created_at) as latest_at,
       COUNT(DISTINCT sport_key) as sports
FROM provider_offers
GROUP BY provider_key
ORDER BY row_count DESC;
```
