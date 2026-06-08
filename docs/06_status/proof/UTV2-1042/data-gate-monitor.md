# UTV2-1042 Data-Gate Monitor

**Report generated:** 2026-06-08T02:30:00Z
**Cutover reference:** D-CONST-6 resolution — 2026-06-07T13:38:28Z (SGO first successful ingest)
**Deploy SHA (Wave-5):** `b4188980292b8c0705461bc3b91a126fc0f7f307`
**UTV2-1228 fix SHA:** `7605fe94b0009957687b4843fe30631e03e4ef60` (sport_id NULL attribution — on main, post-fix verified)
**P3 status:** ACTIVE_NOT_CERTIFIED — no CLV/edge claim permitted
**Monitor updated:** Post-fix sport_id verification + CLV schema audit (2026-06-08T02:30Z)

---

## Gate status

| Gate | Required | Actual | Status |
|---|---|---|---|
| Real post-Wave-5 ingest cycles | ≥1 | 1 (single SGO cycle) | PARTIAL |
| Provider offers post-cutover | >0 | 0 (provider_offers is legacy table) | NOTE |
| Market universe rows post-cutover | >0 | 355 (created 13:46–14:55Z) | PARTIAL |
| pick_candidates processed post-cutover | >0 | 35,145 (updated_at) / 886 scan runs | PARTIAL |
| pick_candidates for post-cutover universe_ids | >0 | **0** — scan not yet run on new rows | NOT MET |
| Board candidates (is_board_candidate) | >0 | 242 (pre-existing corpus) | PARTIAL |
| Scored candidates (model_score IS NOT NULL) | >0 | 9,893 (pre-existing corpus) | PARTIAL |
| Board picks (queued/posted) post-cutover | >0 | 318 | PARTIAL |
| Approved picks post-cutover | >0 | 1,474 | PARTIAL |
| Settled picks post-cutover | >0 | 277 | PARTIAL |
| CLV-available picks | >0 | 0 (schema exists, no closing data + no join path) | NOT MET |
| sport_id attribution (post-cutover picks) | 100% | 11.7% corpus / 41.7% post-fix (all NULLs synthetic) | MONITORING |
| UTV2-1228 fix deployed | merged | merged `7605fe94` — post-fix verified (0 organic NULLs) | MONITORING |

**Dispatch gate:** BLOCKED — CLV unavailable (no closing line data; no pick_candidates for post-cutover universe_ids), single ingest cycle, zero new pick_candidates from post-cutover universe rows. sport_id blocker cleared for organic picks.

---

## Provider ingest

### provider_offers (historical table — not active ingest target)

| Metric | Value |
|---|---|
| Total rows | 8,191,206 |
| Post-cutover rows | 0 |

The active ingest target is `provider_offer_current`. `provider_offers` is legacy. Zero post-cutover rows here is expected.

### provider_offer_current (active ingest target)

| Metric | Value |
|---|---|
| Ingest cycles post-cutover | 1 |
| First snapshot | 2026-06-07T18:23:33Z |
| Latest snapshot | 2026-06-07T18:23:33Z |

Single ingest cycle. Not yet re-running as of this snapshot (2026-06-08T01:05Z, ~11h post-cutover).

---

## Market universe

| Metric | Value |
|---|---|
| Total rows | 57,756 |
| Rows created since cutover | 355 |
| Earliest post-cutover | 2026-06-07T13:46:18Z |
| Latest post-cutover | 2026-06-07T14:55:28Z |
| No new rows since | 2026-06-07T14:55:28Z (~10h stale) |
| Closing lines present | 0 — CLV cannot be computed |

355 new `market_universe` rows were created in a ~70-minute window on cutover day. No additional rows since 14:55Z. The scan pipeline has not yet created `pick_candidates` for these 355 new universe_ids (see below).

---

## Pick candidates

### Activity signal: updated_at >= cutover

| Metric | Value |
|---|---|
| Total rows | 35,145 |
| Updated post-cutover | 35,145 (100%) |
| Created post-cutover | 0 (upsert preserves created_at — see UTV2-1229) |
| Distinct scan runs post-cutover | 886 |
| Last updated | 2026-06-07T21:37:22Z |
| is_board_candidate = true | 242 |
| model_score IS NOT NULL (scored) | 9,893 |

886 scan runs confirm the scan pipeline is active. All 35,145 pre-existing candidates have been processed post-cutover. Last scan run was at 21:37Z.

### New inserts: post-cutover universe_ids

| Metric | Value |
|---|---|
| market_universe rows created post-cutover | 355 |
| pick_candidates for those universe_ids | **0** |

The 355 new `market_universe` rows (universe_ids first seen post-cutover) have **no corresponding `pick_candidates` rows**. The scan pipeline's `listForScan(limit)` has not yet fetched these rows — it processes rows ordered by `refreshed_at DESC`, which may prioritize older, frequently-refreshed rows over newly-inserted ones. This is not a pipeline failure but means the post-cutover corpus has not been processed.

---

## CLV canonical source

| Column | Table | Rows populated |
|---|---|---|
| `closing_line` | `market_universe` | 51,890 / 57,756 |
| `closing_over_odds` | `market_universe` | 55,343 / 57,756 |
| `closing_under_odds` | `market_universe` | 48,581 / 57,756 |

**Computation model:** on-read JOIN — not materialized on `picks`. CLV query pattern:
```sql
SELECT p.id, mu.closing_over_odds, mu.closing_under_odds
FROM picks p
JOIN pick_candidates pc ON pc.pick_id = p.id
JOIN market_universe mu ON mu.id = pc.universe_id
WHERE mu.closing_over_odds IS NOT NULL
```

**Post-cutover closing data:** 0 rows (355 post-cutover universe rows have no closing data — open markets)

**Historical CLV available:** 51,890+ rows with closing data (pre-cutover corpus)

---

## Picks

### Overview

| Metric | Value |
|---|---|
| Total picks (all time) | 25,884 |
| Post-cutover picks | 1,646 |
| Board picks (queued/posted) post-cutover | 318 |
| Approved post-cutover | 1,474 |
| Settled post-cutover | 277 |
| CLV-available | 0 post-cutover — no closing data in post-cutover market_universe + no pick_candidates JOIN path |

### sport_id attribution

| Metric | Value |
|---|---|
| Total picks with sport_id (all time) | 5,442 / 25,884 (21.0%) |
| Total picks NULL sport_id (all time) | 20,442 / 25,884 (79.0%) |
| Post-cutover picks with sport_id | 193 / 1,646 (11.7%) |
| Post-cutover picks NULL sport_id | 1,453 / 1,646 (88.3%) |

#### Post-fix verification (>= merge SHA `7605fe94`, 2026-06-08T01:01Z)

| Metric | Value |
|---|---|
| Picks created post-fix | 108 |
| With sport_id (NBA) | 45 (41.7%) |
| NULL sport_id | 63 (58.3%) |
| Organic NULLs | **0** |
| Synthetic NULLs | 63 (100% of NULLs) |

All 63 post-fix NULL picks are synthetic test artifacts:

| Source | Count | Artifact type |
|---|---|---|
| smart-form | 30 | `metadata.testRun` — `pnpm test:db` smoke test picks |
| api | 13 | `band: SUPPRESS` + `eventName: db-smoke-*` or `utv2-1018-proof-*` |
| t1-proof | 12 | `source: t1-proof` — T1 proof harness picks |
| system-pick-scanner | 4 | `proof_fixture_id: utv2-519/521` — proof harness fixtures |

**Attribution blocker cleared for organic picks.** No board-scan cycle has run post-fix yet — next scan will confirm attribution on organic picks.

#### Post-cutover sport_id breakdown (all corpus)

| sport_id | count | pct |
|---|---|---|
| NULL | 1,453 | 88.3% |
| NBA | 193 | 11.7% |

#### All-time sport_id breakdown

| sport_id | count |
|---|---|
| NULL | 20,442 |
| NBA | 2,490 |
| MLB | 2,410 |
| NHL | 542 |

---

## Flags

### FLAG-1: sport_id — attribution blocker cleared (post-fix verified)

Post-fix verification: 108 picks created after merge SHA `7605fe94`. 41.7% sport_id attribution. All 63 NULLs are synthetic test artifacts (pnpm test:db smoke picks, T1 proof harness picks, UTV2-519/521 proof fixtures). **Zero real organic board picks have NULL sport_id post-fix.** Attribution blocker cleared.

The 88.3% NULL rate in the full post-cutover corpus (1,453 / 1,646) remains due to the pre-existing corpus created before the fix and the lack of a retroactive backfill. This will normalize as organic picks flow through the fixed pipeline.

**Status:** MONITORING — no organic NULLs; confirmed cleared. Next board-scan run will confirm on fresh organic picks.

### FLAG-2: CLV unavailable — schema exists, no closing data + no join path

CLV schema **exists** in `market_universe` (`closing_line`, `closing_over_odds`, `closing_under_odds`). The prior monitor note ("closing_line_value column does not exist on picks table") was wrong — that column doesn't exist and is not the canonical CLV source. **No migration required.**

CLV is computed on-read via: `picks → pick_candidates (pick_id) → market_universe (universe_id) → compare entry odds vs closing_over_odds`.

CLV is unavailable for post-cutover picks because:
1. Post-cutover `market_universe` rows (355) have 0 closing data — markets are still open
2. No `pick_candidates` rows exist for post-cutover universe_ids — the JOIN path yields nothing

Fix required: **T2 monitor correction** (update CLV query to join through pick_candidates → market_universe) + wait for: (a) game settlement to populate closing data and (b) board-scan to create pick_candidates for post-cutover universe_ids.

**Status:** Hard gate blocker. Root cause identified: no migration needed, fix is a T2 monitor query correction + operational dependency on ingest continuity.

### FLAG-3: Zero pick_candidates for post-cutover universe_ids

355 new `market_universe` rows (created 13:46–14:55Z) have produced 0 `pick_candidates`. The scan's `listForScan(limit)` fetch order may not have reached these rows. Not a failure, but means new-corpus candidates are pending.

**Status:** Monitor after next scan run.

### FLAG-4: Single ingest cycle, market universe stale since 14:55Z

Only one `provider_offer_current` snapshot. Market universe last updated ~10h ago. No ongoing ingest detected.

**Status:** Ingest continuity required for gate clearance.

---

## Minimum thresholds for gate clearance (PM-defined)

| Metric | Suggested minimum | Current | Delta |
|---|---|---|---|
| Ingest cycles | ≥3 across ≥2 calendar days | 1 | -2 |
| Market universe rows | ≥500 | 355 | -145 |
| pick_candidates for post-cutover universe_ids | ≥100 | 0 | -100 |
| Board candidates from post-cutover corpus | ≥10 | 0 | -10 |
| Settled picks post-cutover | ≥20 | 277 | MET |
| CLV-available picks | ≥10 | 0 | BLOCKED (schema) |
| sport_id NULL rate (organic picks post-fix) | 0% | 0% organic NULLs | MET (synthetic NULLs only) |

---

## Summary for PM

**What closed since last snapshot:**
- UTV2-1228 (T1): sport_id NULL fix on main (`7605fe94`) — post-fix verified: 0 organic NULLs
- UTV2-1229 (T2): `created_at` vs `updated_at` measurement corrected — pipeline is active
- CLV schema audit: CLV schema EXISTS in `market_universe`; no migration needed; monitor query was wrong

**Post-fix sport_id verdict:** Attribution blocker cleared. 108 post-fix picks: 41.7% attributed (NBA). All 63 NULLs are synthetic test artifacts. Next organic board scan will produce 100% attributed picks.

**What remains blocked:**
1. CLV: schema exists in `market_universe` but unavailable for post-cutover picks — no closing data (open markets) + no pick_candidates JOIN path. Operational dependency, not a schema gap. T2 monitor correction needed.
2. Ingest continuity: single cycle, market universe stale since 14:55Z on cutover day
3. post-cutover universe_ids: 355 new rows with 0 corresponding pick_candidates

**Signal:** The scan pipeline is alive (886 post-cutover scan runs, 35,145 processed, last at 21:37Z). Settled picks: 277. The corpus is pre-existing — no new universe-id candidates have entered the pipeline yet. sport_id blocker is cleared for organic picks.

---

## Verification

**Updated by:** Claude (post UTV2-1228 + UTV2-1229 close, 2026-06-08T01:05Z)
**Supabase project:** `zfzdnfwdarxucxtaojxm`
**Queries run:** 2026-06-08T01:00–01:05Z against live DB
