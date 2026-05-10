# UTV2-862 Final Lifecycle Verification

**Date:** 2026-05-09  
**Executor:** Codex  
**Branch:** `main`  
**Goal:** Clear the `merge_provider_offer_staging_cycle` gate only if the full provider-history lifecycle passes live.

---

## Runtime Observability Deploy

UTV2-869 was pushed successfully to `origin/main` at `f3cb05195b9028d077fbd4d7fd0ef2be97bf0928`.

The requested deploy did **not** complete. GitHub Actions workflow run `25618823962` failed in `Deploy check` because the `SUPABASE_URL` secret resolved empty.

- Run URL: [Deploy #25618823962](https://github.com/griff843/Unit-Talk-v2/actions/runs/25618823962)
- Result: **FAILED**
- Blocker: `SUPABASE_URL is not set or empty`

This is a deployment blocker for UTV2-869, but it is separate from the provider-history lifecycle gate decision below.

---

## Sequence Executed

| # | Function | Status | Notes |
|---|---|---|---|
| 1 | `summarize_provider_offer_history_partition('2026-04-29')` | **PASSED** | Returned `rows_summarized = 0`, `snapshot_date = 2026-04-29` |
| 2 | `drop_old_provider_offer_history_partitions(7)` | **FAILED** | SQLSTATE `42501`: `must be owner of table provider_offer_history_p20260502` |
| 3 | `prune_provider_offers_bounded(7,5000,20)` | **FAILED** | SQLSTATE `57014`: `canceling statement due to statement timeout` |

The calls were executed sequentially in the required order, so summarize did occur before drop in this live verification run.

---

## Baseline

| Metric | Value |
|---|---|
| `provider_offer_history` rows | `0` |
| `provider_offer_line_snapshots` rows | `0` |
| `provider_offer_line_snapshots` rows for `2026-04-29` | `0` |
| `provider_offers` rows | `8,191,206` |
| `provider_offers` oldest `created_at` | `2026-04-23T02:30:56.97176+00:00` |
| `provider_offers` newest `created_at` | `2026-04-29T13:05:01.15842+00:00` |
| `provider_offers_legacy_quarantine` rows | `8,191,206` |
| `provider_offers_legacy_quarantine` oldest `created_at` | `2026-04-23T02:30:56.97176+00:00` |
| `provider_offers_legacy_quarantine` newest `created_at` | `2026-04-29T13:05:01.15842+00:00` |

---

## Post-State

All visible public-table counts and `created_at` boundaries were unchanged after the run:

- `provider_offer_history` remained `0`
- `provider_offer_line_snapshots` remained `0`
- `provider_offers` remained `8,191,206`
- `provider_offers_legacy_quarantine` remained `8,191,206`

That means no row loss was observed on the live surfaces available from this workstation.

---

## Verification Checks

| Check | Result |
|---|---|
| summarize succeeds | ✅ PASS |
| drop succeeds | ❌ FAIL |
| prune succeeds | ❌ FAIL |
| summarize occurs before drop | ✅ PASS |
| no unexpected partition loss | ✅ PASS |
| no unexpected row loss | ✅ PASS |
| no timeout | ❌ FAIL |
| no SQL errors | ❌ FAIL |
| retention corruption | `false` |

---

## Blocking Findings

### 1. Drop phase fails on live ownership

`drop_old_provider_offer_history_partitions(7)` failed with:

```text
SQLSTATE 42501: must be owner of table provider_offer_history_p20260502
```

This is now the blocking defect in the partition-drop phase. The summarize fix is live, but the retention function still cannot drop at least one eligible partition under its current execution role.

### 2. Prune phase still times out under the required batch contract

`prune_provider_offers_bounded(7,5000,20)` failed with:

```text
SQLSTATE 57014: canceling statement due to statement timeout
```

Because the required `7,5000,20` contract still times out on live, the lifecycle cannot be considered healthy enough to clear the gate.

### 3. Cron and catalog visibility are limited from this workstation

This workstation can execute the live RPCs and verify public-table state through the service-role API, but it cannot query:

- `cron.job`
- `cron.job_run_details`
- `pg_inherits`

So the proof here relies on direct sequential RPC execution rather than cron-log or partition-catalog inspection.

---

## Follow-up Issues To File Or Track

1. **Provider-history retention drop RPC cannot drop partitions due to live ownership mismatch**
   The live retention function needs ownership or execution-context remediation so `drop_old_provider_offer_history_partitions(7)` can complete successfully.

2. **Provider-offers bounded prune still times out under the required 7/5000/20 contract on live**
   The live prune path still does not complete inside the current timeout budget and needs runtime or implementation remediation.

3. **UTV2-869 runtime observability deploy blocked by missing GitHub Actions secret**
   `origin/main` has the code, but workflow run `25618823962` did not deploy because `SUPABASE_URL` is empty in GitHub Actions.

---

## Gate Decision

**Do not clear the `merge_provider_offer_staging_cycle` gate.**

The required end-to-end lifecycle did not pass live. `summarize_provider_offer_history_partition('2026-04-29')` is now healthy, but the drop phase fails on ownership and the prune phase fails on timeout. Until both blocking defects are resolved and the same three-call sequence passes cleanly, the gate should remain closed.
