# UTV2-1229 Diff Summary

**Issue:** UTV2-1229 — Audit post-cutover pick_candidate creation vs update behavior and fix UTV2-1042 data-gate monitor
**Branch:** codex/utv2-1229-pick-candidate-create-vs-update-audit
**Tier:** T2
**Executor:** Codex-cloud (executed by Claude as fallback)

---

## Problem statement

The UTV2-1042 data-gate monitor at `docs/06_status/proof/UTV2-1042/data-gate-monitor.md` reported 0 newly created `pick_candidates` since D-CONST-6 cutover (2026-06-07T13:38:28Z). The concern was whether this indicated a pipeline failure or a measurement artifact.

---

## Root cause finding

The measurement was incorrect. The monitor used `created_at >= cutover` to count "new" pick_candidates. This is wrong because:

1. `DatabasePickCandidateRepository.upsertCandidates()` in `packages/db/src/runtime-repositories.ts` (line 7986) uses:
   ```
   .upsert(rows, { onConflict: 'universe_id', ignoreDuplicates: false })
   ```
2. On conflict with `universe_id`, Postgres performs an UPDATE — updating `status`, `filter_details`, `scan_run_id`, `provenance`, `expires_at`, and `updated_at`. It does NOT touch `created_at`.
3. `created_at` is set only at the original INSERT and remains frozen at the date the row was first created (2026-04-21 to 2026-05-20 for pre-existing rows).
4. Every post-cutover scan cycle processes the same pre-existing `universe_id` values → every cycle UPDATEs existing rows → `created_at` never advances beyond the pre-cutover range.
5. Result: `created_at >= cutover` always returns 0, regardless of scan activity.

**This is a measurement artifact, not a pipeline failure.**

---

## Correct activity signals

| Signal | Meaning | Status |
|---|---|---|
| `updated_at >= cutover` | Scan ran on this row post-cutover | 35,145 rows confirmed |
| `scan_run_id NOT NULL AND updated_at >= cutover` | Row actively evaluated by a post-cutover scan | Unverified (requires live query) |
| `JOIN market_universe WHERE mu.created_at >= cutover` | Candidate row exists for a post-cutover universe_id | Unverified (requires live query) |
| `created_at >= cutover` | **WRONG — do not use** | Artifact: always 0 under upsert pattern |

---

## Files changed

### `docs/06_status/proof/UTV2-1042/data-gate-monitor.md`

- Added "Measurement correction note (UTV2-1229)" section explaining the root cause
- Updated gate status table: replaced "pick_candidates newly created" (always-wrong) with "pick_candidates processed post-cutover (updated_at)" showing 35,145 PARTIAL
- Added UNVERIFIED rows for post-cutover scan_run_id and post-cutover universe_id join
- Downgraded FLAG-3 from HIGH to UNVERIFIED (erroneous metric corrected; pipeline activity confirmed; new inserts pending verification)
- Added corrected SQL queries at the bottom
- Updated dispatch gate rationale to reflect measurement correction

### `docs/06_status/proof/UTV2-1042/data-gate-monitor.json`

- Bumped `schema_version` from 1 to 2
- Added `monitor_updated_by: "UTV2-1229"` and `monitor_update_reason`
- Added `measurement_correction` block documenting the erroneous vs correct signals
- Added `pick_candidate_upsert_behavior` block documenting the onConflict strategy
- Updated `pick_candidates` object: replaced `newly_created_since_cutover: 0` with `rows_updated_since_cutover: 35145`, added `new_inserts_for_postcutover_universe_ids: "UNVERIFIED"`, added `erroneous_original_metric` for traceability
- Updated `gate_status`: replaced `pick_candidates_new: "NOT_MET"` with `pick_candidates_updated_postcutover: "PARTIAL"` and `pick_candidates_new_inserts_postcutover_universe: "UNVERIFIED"`
- Updated FLAG-3 from `severity: "HIGH"` to `severity: "UNVERIFIED"` with corrected description

---

## What was NOT changed

- No source code modified
- No schema changes
- No scoring logic changes
- No P3 certification claimed
- No CLV/edge claim made

---

## Scope compliance

File scope lock honored: only `docs/06_status/proof/UTV2-1042/data-gate-monitor.md`, `docs/06_status/proof/UTV2-1042/data-gate-monitor.json`, `docs/06_status/proof/UTV2-1229/diff-summary.md`, `docs/06_status/proof/UTV2-1229/verification.md` were written.

## Merge SHA

bd45cb37f7af9ef8f05762d7335b1a86cc9ce6df
PR #988 merged to main 2026-06-08T00:58Z.
