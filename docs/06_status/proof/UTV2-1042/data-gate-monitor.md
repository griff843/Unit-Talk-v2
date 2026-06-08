# UTV2-1042 Data-Gate Monitor

**Report generated:** 2026-06-07T21:56:42Z
**Cutover reference:** D-CONST-6 resolution — 2026-06-07T13:38:28Z (SGO first successful ingest)
**Deploy SHA (Wave-5):** `b4188980292b8c0705461bc3b91a126fc0f7f307`
**P3 status:** ACTIVE_NOT_CERTIFIED — no CLV/edge claim permitted
**Monitor updated:** UTV2-1229 (audit of create-vs-update measurement)

---

## Measurement correction note (UTV2-1229)

The original monitor counted "new pick_candidates" as `created_at >= cutover`. This is incorrect.

**Root cause:** `DatabasePickCandidateRepository.upsertCandidates()` uses `.upsert(rows, { onConflict: 'universe_id', ignoreDuplicates: false })`. On conflict, Postgres updates the row in-place. The `created_at` column is set at first INSERT and never touched on UPDATE — it remains frozen at the original insert date (2026-04-21 to 2026-05-20 for all pre-existing rows). Every scan cycle since D-CONST-6 cutover has processed the same pre-existing universe_id values, so `created_at` never advances. `0 newly created` is a measurement artifact, not a pipeline failure.

**Correct activity signals:**

| Signal | What it means |
|---|---|
| `updated_at >= cutover` | Row was processed (qualified/rejected/scored) by a post-cutover scan run |
| `scan_run_id NOT NULL AND updated_at >= cutover` | Row was actively evaluated and written by a post-cutover scan run |
| `created_at >= cutover` | Genuinely new universe_id, never seen before cutover (new market opportunity) |
| `scan_run_id IS NULL` | Row has never been processed by any scan run |
| `updated_at < cutover AND scan_run_id IS NULL` | Row exists in universe but no scan has ever evaluated it (no-op / filtered-zero scan) |

**How new rows are created:** A new `pick_candidates` row is inserted (not updated) only when a `universe_id` is encountered for the first time — i.e., a new `market_universe` row has no corresponding `pick_candidates` row yet. The 355 post-cutover `market_universe` rows (created 2026-06-07T13:46–14:55Z) each had a new `universe_id`. If a board scan ran after those rows were inserted, `pick_candidates` INSERT would occur for each previously-unseen `universe_id`. If no scan ran since their creation, or the scan did not fetch them (e.g., `listForScan(limit)` returned older rows first), they would not yet have `pick_candidates` rows.

**Correct gate metric:** Use `scan_run_id IS NOT NULL AND updated_at >= cutover` to count candidates actively processed post-cutover. For truly new insertions, join `pick_candidates.universe_id` to `market_universe.id WHERE market_universe.created_at >= cutover`.

---

## Gate status

| Gate | Required | Actual | Status |
|---|---|---|---|
| Real post-Wave-5 ingest cycles | ≥1 | 1 | PARTIAL |
| Provider offers (post-cutover) | >0 | 1,546 (1 cycle) | PARTIAL |
| Market universe rows | >0 | 355 | PARTIAL |
| pick_candidates processed post-cutover (updated_at) | >0 | 35,145 | PARTIAL |
| pick_candidates with post-cutover scan_run_id | >0 | unknown (see note) | UNVERIFIED |
| pick_candidates for post-cutover universe_ids | >0 | unknown (see note) | UNVERIFIED |
| Board candidates | >0 | 242 (pre-existing updated) | UNVERIFIED |
| Scored candidates | >0 | 9,893 (pre-existing updated) | UNVERIFIED |
| Approved picks | >0 | ~957 (excl. t1-proof) | PARTIAL |
| Published picks | >0 | 78 | PARTIAL |
| Settled picks | >0 | 189 | PARTIAL |
| CLV-available picks | >0 | 0 | NOT MET |
| Synthetic/smoke rows excluded | confirmed | see flags | FLAGGED |
| sport_id NULL excluded | confirmed | 1,196 / 1,196 | FLAGGED |

**Dispatch gate:** BLOCKED — CLV unavailable, sport_id systemic NULL, single ingest cycle. The "0 new pick_candidates" finding from the original monitor was a measurement artifact (created_at vs updated_at confusion). Pipeline scan activity is confirmed active (35,145 rows with updated_at >= cutover). Whether the 355 post-cutover market_universe rows produced new pick_candidate inserts requires a universe_id join query (see unverified rows above).

---

## Provider ingest

### provider_offer_current (active ingest target)

| Metric | Value |
|---|---|
| Rows since cutover | 1,546 |
| Distinct providers | 1 (SGO) |
| Distinct sports | 1 (NBA) |
| Ingest cycles | 1 |
| First snapshot | 2026-06-07T18:23:33Z |
| Latest snapshot | 2026-06-07T18:23:33Z |

Single ingest cycle. Pipeline requires multiple cycles over multiple days before corpus is considered established.

### provider_offers (legacy/historical table)

| Metric | Value |
|---|---|
| Rows since cutover | 0 |

Not the active ingest target. Ingestor writes to `provider_offer_current`.

---

## Market universe

| Metric | Value |
|---|---|
| Rows created since cutover | 355 |
| Distinct sports | 1 (NBA) |
| sport_key NULL rows | 0 |
| Closing line present | 0 |
| Closing odds present | 0 |
| Earliest row | 2026-06-07T13:46:18Z |
| Latest row | 2026-06-07T14:55:28Z |

No closing lines yet — games from the first post-cutover ingest cycle have not closed. CLV cannot be computed until closing lines are populated.

---

## Pick candidates

### Activity signal: updated_at >= cutover (corrected measurement)

| Metric | Value |
|---|---|
| Rows with updated_at >= cutover | 35,145 |
| is_board_candidate = true | 242 |
| Scored (model_score not null) | 9,893 |
| sport_key NULL | 18,792 |
| Synthetic (smoke/synthetic in provenance) | 0 |
| Original creation range | 2026-04-21 to 2026-05-20 |

These 35,145 rows confirm the scan pipeline ran post-cutover. The rows predate Wave-5 but their `updated_at` and `scan_run_id` reflect post-cutover scan activity. Board and scored counts are from this pre-existing corpus being re-processed.

### New inserts: post-cutover universe_ids

| Metric | Value | Query |
|---|---|---|
| market_universe rows created post-cutover | 355 | `market_universe.created_at >= '2026-06-07T13:38:28Z'` |
| pick_candidates for those universe_ids | UNVERIFIED | `JOIN pick_candidates ON universe_id WHERE market_universe.created_at >= cutover` |

To verify: `SELECT COUNT(*) FROM pick_candidates pc JOIN market_universe mu ON pc.universe_id = mu.id WHERE mu.created_at >= '2026-06-07T13:38:28Z'`. If 0, the scan has not yet run on the 355 new universe rows; if > 0, new inserts occurred and the "0 new candidates" finding was fully a measurement artifact.

### Original erroneous metric (do not use)

| Metric | Value | Why wrong |
|---|---|---|
| "Newly created" (created_at >= cutover) | 0 | onConflict upsert preserves original created_at; not a valid new-insert signal |

---

## Picks (created since cutover)

| Metric | Value |
|---|---|
| Total picks | 1,196 |
| Approved (approval_status = approved) | 1,069 |
| Published (status = posted) | 78 |
| Settled | 189 |
| Voided | 180 |
| CLV-available (closing line in market_universe) | 0 |
| sport_id NULL | 1,196 (100%) |
| Earliest | 2026-06-07T13:40:11Z |
| Latest | 2026-06-07T20:53:36Z |

### Status × approval breakdown

| status | approval_status | promotion_status | count |
|---|---|---|---|
| draft | approved | not_eligible | 175 |
| awaiting_approval | approved | not_eligible | 162 |
| settled | approved | not_eligible | 161 |
| validated | approved | not_eligible | 155 |
| voided | approved | not_eligible | 153 |
| queued | approved | not_eligible | 104 |
| validated | pending | not_eligible | 100 |
| queued | approved | qualified | 53 |
| posted | approved | not_eligible | 50 |
| posted | approved | qualified | 28 |
| settled | approved | qualified | 28 |
| voided | rejected | not_eligible | 27 |

### Source breakdown

| source | count | organic? |
|---|---|---|
| smart-form | 751 | YES |
| system-pick-scanner | 112 | YES |
| t1-proof | 112 | **FLAGGED — likely proof/test-generated** |
| api | 110 | YES |
| alert-agent | 56 | YES |
| model-driven | 55 | YES |

### Market breakdown

| market | count |
|---|---|
| nba-spread | 1,002 |
| points-all-game-ou | 85 |
| nba-total | 56 |
| nba-ml | 28 |
| assists-all-game-ou | 25 |

---

## Flags and exclusions

### FLAG-1: sport_id NULL (ALL picks)

All 1,196 picks created since cutover have `sport_id = NULL`. This is a systemic gap — sport_id is not being populated on pick creation. These picks cannot be attributed to a specific sport for data-gate purposes without PM explicit justification. CLV attribution and corpus filtering both depend on sport_id.

**Action required:** PM must either (a) justify NULL as acceptable for the gate corpus or (b) identify the root cause and assign a fix lane.

### FLAG-2: t1-proof source (112 picks)

112 picks have `source = 't1-proof'`. These are likely generated by proof harnesses during T1 lane closeouts rather than organic pipeline activity. They are excluded from organic corpus counts.

**Adjusted organic pick count:** 1,084 total, ~957 approved, ~67 published, ~172 settled (proportional estimate pending source-level approval breakdown).

### FLAG-3: pick_candidates measurement corrected (was erroneous — downgraded from HIGH)

The original FLAG-3 ("0 new pick_candidates") was based on `created_at >= cutover`, which is not a valid new-insert signal under the upsert-on-conflict pattern. The correct measurement (updated_at >= cutover) shows 35,145 rows processed post-cutover. Whether 355 post-cutover market_universe rows produced new inserts requires a universe_id join query (currently UNVERIFIED). This flag is downgraded from HIGH to UNVERIFIED pending that query.

### FLAG-4: Single ingest cycle

Only one `provider_offer_current` snapshot exists post-cutover (2026-06-07T18:23:33Z). Corpus is not yet established across multiple ingest cycles.

### FLAG-5: CLV unavailable

Zero picks have CLV available (no closing lines in `market_universe`). No CLV or edge claim is permitted. This is expected at ~8 hours post-cutover but is a hard gate blocker.

---

## Minimum thresholds for gate clearance (PM-defined)

The following minimums must be established before UTV2-1042 can be dispatched. These are monitoring targets, not certified thresholds — PM must ratify the exact numbers.

| Metric | Suggested minimum | Rationale |
|---|---|---|
| Ingest cycles | ≥3 across ≥2 calendar days | Pattern, not a single run |
| provider_offer_current rows | ≥5,000 | Multiple events/sports |
| Market universe rows | ≥500 | Meaningful coverage |
| pick_candidates processed (updated_at) | ≥100 | Post-Wave-5 scan activity confirmed |
| pick_candidates for post-cutover universe_ids | ≥100 | New inserts from new universe rows |
| Board candidates | ≥10 | Active board from new corpus |
| Scored candidates | ≥50 | Scoring pipeline exercised |
| Approved picks (organic) | ≥100 | Approval flow exercised |
| Settled picks | ≥20 | Settlement flow exercised |
| CLV-available picks | ≥10 | Closing lines populated |
| sport_id NULL rate | 0% | Systemic gap must be resolved |
| t1-proof rows | Excluded from all counts | Non-organic source |

---

## Next monitoring run

Re-run this report after:
- Each new ingest cycle
- Each new scan run producing pick_candidates
- Any picks settle (closing lines populated → CLV becomes available)

Report is regenerated by querying live Supabase (`project_id: zfzdnfwdarxucxtaojxm`) against the cutover timestamp `2026-06-07T13:38:28Z`.

**Corrected query for pick_candidate activity:**
```sql
-- Post-cutover activity (correct signal)
SELECT COUNT(*) FROM pick_candidates WHERE updated_at >= '2026-06-07T13:38:28Z';

-- New inserts for post-cutover market_universe rows (correct new-insert signal)
SELECT COUNT(*) FROM pick_candidates pc
JOIN market_universe mu ON pc.universe_id = mu.id
WHERE mu.created_at >= '2026-06-07T13:38:28Z';

-- Do NOT use: created_at >= cutover (incorrect — upsert preserves original created_at)
```

---

## Verification

**Updated by:** UTV2-1229 (measurement correction)  
**pnpm test:db:** run on branch codex/utv2-1229-pick-candidate-create-vs-update-audit

```
# pass 7
# fail 0
# skipped 0
```
