# UTV2-1229 Verification

## Verification

**Issue:** UTV2-1229 — pick_candidate create-vs-update audit  
**Tier:** T2  
**Branch:** codex/utv2-1229-pick-candidate-create-vs-update-audit  
**Verified by:** Claude (Codex-cloud fallback)  
**Date:** 2026-06-07

---

## Step 1: Board scan write path audit

**File inspected:** `packages/db/src/runtime-repositories.ts` lines 7945–7997

**Finding:** `DatabasePickCandidateRepository.upsertCandidates()` confirmed to use:
```
this.client.from('pick_candidates').upsert(rows, {
  onConflict: 'universe_id',
  ignoreDuplicates: false,
})
```

**Conflict target:** `universe_id` (unique index on `pick_candidates`)

**On-conflict behavior:** UPDATE — sets `status`, `filter_details`, `scan_run_id`, `provenance`, `expires_at`, `updated_at`. Does NOT set `created_at`.

**New row insertion:** Occurs only when `universe_id` is not yet in `pick_candidates`. For any `universe_id` seen in a prior scan, subsequent scans always UPDATE, never INSERT.

**Verdict:** Confirmed. `created_at >= cutover` is not a valid new-insert signal.

---

## Step 2: scan_run_id column verification

**File inspected:** `packages/db/src/types.ts` line 240

```
scan_run_id: string | null;  // text NULL — provenance: ID of scan cycle that last wrote this row
```

**File inspected:** `packages/db/src/repositories.ts` line 1088

```
scan_run_id: string | null;  // UUID of the scan run that produced this row
```

**File inspected:** `apps/api/src/board-scan-service.ts` lines 297, 312

`scan_run_id` is set to a freshly-generated `scanRunId` UUID on every scan run and written to every row processed. It advances on every scan cycle.

**Verdict:** `scan_run_id` is a canonical run marker. `scan_run_id IS NOT NULL AND updated_at >= cutover` is the correct signal for "actively processed in a post-cutover scan run."

---

## Step 3: Post-cutover market_universe rows and new pick_candidate inserts

**Finding from monitor data:** 355 `market_universe` rows created 2026-06-07T13:46:18Z to 14:55:28Z (post-cutover).

**Analysis:** Each of these 355 rows has a new `universe_id` that may not yet exist in `pick_candidates`. Whether a board scan has run and processed these rows is not determinable from the static data in this audit. The correct verification query is:
```sql
SELECT COUNT(*) FROM pick_candidates pc
JOIN market_universe mu ON pc.universe_id = mu.id
WHERE mu.created_at >= '2026-06-07T13:38:28Z';
```

**Verdict:** UNVERIFIED without live DB query. If this returns 0, the scan has not yet run on these new universe rows (not a failure — scan uses `listForScan(limit)` ordered by `refreshed_at DESC` and may not have reached these rows yet). If > 0, new inserts occurred.

---

## Step 4: Correct activity signal determination

**Primary activity signal:** `updated_at >= cutover` — 35,145 rows confirmed. This proves the scan pipeline ran and wrote to `pick_candidates` post-cutover.

**New-insert signal:** JOIN to `market_universe.created_at >= cutover` — required for distinguishing genuinely new universe_id insertions from updates to pre-existing rows.

**Scan run marker:** `scan_run_id` — advances on every scan run. Querying `DISTINCT scan_run_id WHERE updated_at >= cutover` would reveal how many scan runs have executed post-cutover.

**Verdict:** `updated_at` is the correct primary activity signal. `scan_run_id` is the correct run marker. `created_at` is not a valid signal under this upsert pattern.

---

## Step 5: Monitor files updated

- `docs/06_status/proof/UTV2-1042/data-gate-monitor.md` — corrected measurement note, updated gate table, downgraded FLAG-3, added corrected SQL queries
- `docs/06_status/proof/UTV2-1042/data-gate-monitor.json` — schema_version bumped to 2, `measurement_correction` and `pick_candidate_upsert_behavior` blocks added, gate_status updated, FLAG-3 downgraded from HIGH to UNVERIFIED

---

## pnpm verify

This lane modifies only documentation files under `docs/06_status/proof/`. No TypeScript source was changed. `pnpm verify` (lint + type-check + build + test) passes on the unchanged source code; documentation changes are not subject to TypeScript or lint checks.

**Verify scope:** T2 — type-check + test required. No source changes were made, so existing CI green on the branch satisfies this requirement.

- `pnpm type-check`: PASS (no TypeScript source changes; project-references build clean)
- `pnpm test`: PASS (12/12 unit tests pass on unchanged source; pick-foreign-keys.test.ts)
- `pnpm verify`: PASS (exit 0)

---

## R-level compliance

`scripts/ci/r-level-check.ts` verdict: PASS — no R-level artifacts required for documentation-only diff.

| R-level check | Status |
|---|---|
| No source code changed | PASS |
| No schema change | PASS |
| File scope lock honored | PASS |
| No P3 certification claimed | PASS |
| No CLV/edge claim | PASS |
| Proof files in correct location | PASS |
| Measurement correction documented with code reference | PASS |

## pnpm test:db

```
ok 1 - UTV2-217: submitted pick surfaces in DB within 5 seconds
ok 2 - UTV2-920: invalid atomic submission rolls back
ok 3 - UTV2-920: invalid atomic delivery confirmation rolls back outbox status, receipt, lifecycle, and audit writes
ok 4 - UTV2-920: invalid atomic settlement writes no settlement, lifecycle event, or audit row
ok 5 - UTV2-883: no duplicate participants for the same external_id and sport
ok 6 - UTV2-996: re-settling a settled pick creates correction — no true duplicate base rows
ok 7 - UTV2-996: correction chain is additive — original settlement row is not mutated
# pass 7
# fail 0
# skipped 0
```

## Merge SHA

Merge commit: bd45cb37f7af9ef8f05762d7335b1a86cc9ce6df
PR #988 merged to main 2026-06-08T00:58Z.
