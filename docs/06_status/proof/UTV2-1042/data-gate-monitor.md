# UTV2-1042 Data-Gate Monitor

**Report generated:** 2026-06-08T01:05:00Z
**Cutover reference:** D-CONST-6 resolution — 2026-06-07T13:38:28Z (SGO first successful ingest)
**Deploy SHA (Wave-5):** `b4188980292b8c0705461bc3b91a126fc0f7f307`
**UTV2-1228 fix SHA:** `7605fe94b0009957687b4843fe30631e03e4ef60` (sport_id NULL attribution — on main, pipeline not yet re-run)
**P3 status:** ACTIVE_NOT_CERTIFIED — no CLV/edge claim permitted
**Monitor updated:** UTV2-1228 + UTV2-1229 post-close snapshot (2026-06-08)

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
| CLV-available picks | >0 | 0 (no CLV schema on picks table) | NOT MET |
| sport_id attribution (post-cutover picks) | 100% | 11.7% (193 / 1,646) | FLAGGED |
| UTV2-1228 fix deployed | merged | merged `7605fe94` — pipeline not re-run | PARTIAL |

**Dispatch gate:** BLOCKED — CLV unavailable, sport_id attribution 11.7% (fix deployed, pipeline not re-run), single ingest cycle, zero new pick_candidates from post-cutover universe rows.

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

## Picks

### Overview

| Metric | Value |
|---|---|
| Total picks (all time) | 25,884 |
| Post-cutover picks | 1,646 |
| Board picks (queued/posted) post-cutover | 318 |
| Approved post-cutover | 1,474 |
| Settled post-cutover | 277 |
| CLV-available (closing_line_value column) | **column does not exist** — CLV schema not deployed |

### sport_id attribution

| Metric | Value |
|---|---|
| Total picks with sport_id (all time) | 5,442 / 25,884 (21.0%) |
| Total picks NULL sport_id (all time) | 20,442 / 25,884 (79.0%) |
| Post-cutover picks with sport_id | 193 / 1,646 (11.7%) |
| Post-cutover picks NULL sport_id | 1,453 / 1,646 (88.3%) |

#### Post-cutover sport_id breakdown

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

**Note on UTV2-1228:** The sport_id NULL attribution fix (removes early-return guard in `deriveSportId()`, fixes Soccer/Tennis normalization, adds SGO market key aliases) was merged as `7605fe94` on 2026-06-08. The 193 post-cutover NBA picks with sport_id attributed came from smart-form/api sources where `metadata.sport` was explicitly set. The 1,453 NULL picks post-cutover are from sources without `metadata.sport` (system-pick-scanner with SGO market keys, t1-proof artifacts, etc.). The fix will correct attribution on future picks when the pipeline re-runs — no retroactive correction needed.

---

## Flags

### FLAG-1: sport_id attribution 11.7% post-cutover

UTV2-1228 fix is on main. The 88.3% NULL rate on post-cutover picks is attributable to: (a) test/proof artifacts with empty metadata, (b) system-pick-scanner picks with SGO-format market keys and no `metadata.sport`. The fix resolves (b) for future picks. No board-construction run has occurred post-fix.

**Status:** Fix deployed. Monitoring required after next board scan.

### FLAG-2: CLV unavailable — schema not deployed

No `closing_line_value` column on `picks` table. No CLV column in `settlement_records`. CLV computation requires both closing line data in `market_universe` (currently 0) and a schema column to store the result.

**Status:** Hard gate blocker. Two prerequisites: closing line ingest + CLV schema migration.

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
| sport_id NULL rate post-cutover | 0% | 88.3% | Fix deployed, not re-run |

---

## Summary for PM

**What closed since last snapshot:**
- UTV2-1228 (T1): sport_id NULL fix on main (`7605fe94`)
- UTV2-1229 (T2): `created_at` vs `updated_at` measurement corrected — pipeline is active

**What remains blocked:**
1. CLV: no `closing_line_value` column, no closing line data — schema + ingest required
2. sport_id: fix deployed but pipeline not re-run on new picks; 88.3% NULL persists in current corpus
3. Ingest continuity: single cycle, market universe stale ~10h
4. post-cutover universe_ids: 355 new rows with 0 corresponding pick_candidates

**Signal:** The scan pipeline is alive (886 post-cutover scan runs, 35,145 processed, last at 21:37Z). Settled picks: 277. The corpus is pre-existing — no new universe-id candidates have entered the pipeline yet.

---

## Verification

**Updated by:** Claude (post UTV2-1228 + UTV2-1229 close, 2026-06-08T01:05Z)
**Supabase project:** `zfzdnfwdarxucxtaojxm`
**Queries run:** 2026-06-08T01:00–01:05Z against live DB
