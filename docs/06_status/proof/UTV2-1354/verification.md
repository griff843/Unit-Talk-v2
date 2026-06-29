# UTV2-1354: M3 Live Grading Verification

Lane type: verification (proof-only)
Tier: T2
Branch: `claude/utv2-1354-m3-live-grading-verification`
Date: 2026-06-29
Query timestamp: 2026-06-29 04:44 UTC

## Verification

### Context

UTV2-1350 confirmed the `settlement_records.listRecent` timeout was a full-table scan on an unindexed column — intermittent under load, not a permanent grading blocker. Live DB queries are now viable.

UTV2-1347 (merged SHA 39cc9e78) documented that UTV2-1345 added per-pick error details to `system_runs.details` in `apps/api/src/grading-service.ts`.

This lane queries live Supabase to evaluate all four M3 terminal criteria.

---

## Live DB Queries

### 1. grading.cron.heartbeat — last 7 days

```sql
SELECT 
  COUNT(*) as total_rows,
  COUNT(*) FILTER (WHERE status = 'succeeded') as succeeded,
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  MIN(created_at) as oldest,
  MAX(created_at) as newest
FROM system_runs
WHERE run_type = 'grading.cron.heartbeat'
  AND created_at >= NOW() - INTERVAL '7 days'
```

**Result:**
```json
{
  "total_rows": 195,
  "succeeded": 195,
  "failed": 0,
  "oldest": "2026-06-22 05:27:06.534697+00",
  "newest": "2026-06-29 04:01:52.397391+00"
}
```

**Assessment:** 195/195 heartbeats succeeded. 0 failures. No consecutive failures in 7 days.

---

### 2. grading.run — last 7 days summary

```sql
SELECT 
  COUNT(*) as total_rows,
  COUNT(*) FILTER (WHERE status = 'succeeded') as succeeded,
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'failed') / NULLIF(COUNT(*),0), 2) as failure_rate_pct,
  MIN(created_at) as oldest,
  MAX(created_at) as newest
FROM system_runs
WHERE run_type = 'grading.run'
  AND created_at >= NOW() - INTERVAL '7 days'
```

**Result:**
```json
{
  "total_rows": 511,
  "succeeded": 367,
  "failed": 144,
  "failure_rate_pct": "28.18",
  "oldest": "2026-06-22 05:27:06.138876+00",
  "newest": "2026-06-29 04:44:30.045544+00"
}
```

**Assessment:** 28.18% failure rate over 7 days — exceeds the 5% threshold. However, the 7-day window is heavily weighted by the 6/22-6/23 settlement_records crisis.

---

### 3. grading.run — failure rate by day

```sql
SELECT 
  DATE_TRUNC('day', created_at AT TIME ZONE 'UTC') as day,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE status = 'succeeded') as succeeded,
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'failed') / NULLIF(COUNT(*),0), 2) as failure_rate_pct
FROM system_runs
WHERE run_type = 'grading.run'
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY 1
ORDER BY 1 DESC
```

**Result:**
| Day (UTC) | Total | Succeeded | Failed | Failure % |
|-----------|-------|-----------|--------|-----------|
| 2026-06-29 (partial) | 32 | 24 | 8 | 25.00% |
| 2026-06-28 | 75 | 50 | 25 | 33.33% |
| 2026-06-27 | 110 | 70 | 40 | 36.36% |
| 2026-06-26 | 93 | 78 | 15 | 16.13% |
| 2026-06-25 | 80 | 69 | 11 | 13.75% |
| 2026-06-24 | 82 | 71 | 11 | 13.41% |
| 2026-06-23 | 15 | 4 | 11 | 73.33% |
| 2026-06-22 | 24 | 1 | 23 | 95.83% |

**Assessment:** Failure rate peaked at 95.83% on 6/22 during the settlement_records crisis, improved to 13-16% on 6/24-6/26, then elevated again 6/27-6/29 (25-36%). Baseline target is 1.46%. No day has reached the 5% threshold in the observation window.

---

### 4. Last 10 grading.run rows (most recent first)

**Result (all succeeded):**
| Timestamp (UTC) | Status | picksGraded | failed |
|----------------|--------|-------------|--------|
| 2026-06-29 04:44:30 | succeeded | 0 | 0 |
| 2026-06-29 04:34:57 | succeeded | 0 | 0 |
| 2026-06-29 04:27:59 | succeeded | 2 | 0 |
| 2026-06-29 04:19:23 | succeeded | 0 | 0 |
| 2026-06-29 04:01:51 | succeeded | 0 | 0 |
| 2026-06-29 04:01:16 | succeeded | 0 | 0 |
| 2026-06-29 03:53:41 | succeeded | 0 | 0 |
| 2026-06-29 03:42:40 | succeeded | 0 | 0 |
| 2026-06-29 03:28:22 | succeeded | 0 | 0 |
| 2026-06-29 03:21:29 | succeeded | 0 | 0 |

**Assessment:** 13+ consecutive successful runs since ~02:51 UTC. System is currently healthy.

---

### 5. Last 10 grading.run FAILED rows (details structure)

```sql
SELECT id, status, created_at, details
FROM system_runs
WHERE run_type = 'grading.run' AND status = 'failed'
ORDER BY created_at DESC LIMIT 10
```

**Result:**
| Timestamp (UTC) | details |
|----------------|---------|
| 2026-06-29 02:42:26 | `{"failed":1,"picksGraded":3}` |
| 2026-06-29 02:35:45 | `{"failed":3,"picksGraded":1}` |
| 2026-06-29 01:47:31 | `{"failed":1,"picksGraded":0}` |
| 2026-06-29 00:59:06 | `{"failed":2,"picksGraded":0}` |
| 2026-06-29 00:50:39 | `{"failed":1,"picksGraded":0}` |
| 2026-06-29 00:37:51 | `{"failed":1,"picksGraded":0}` |
| 2026-06-29 00:36:40 | `{"failed":1,"picksGraded":0}` |
| 2026-06-29 00:30:37 | `{"failed":1,"picksGraded":1}` |
| 2026-06-28 23:14:21 | `{"failed":1,"picksGraded":1}` |
| 2026-06-28 23:01:09 | `{"failed":4,"picksGraded":8}` |

**Critical finding:** All failed run records contain ONLY `{failed, picksGraded}` — no `errors` array. Confirmed by `jsonb_object_keys(details)` query across all 7-day failed rows: only `failed` and `picksGraded` keys appear in every failed record.

This is inconsistent with the code at `apps/api/src/grading-service.ts` lines 373-377:
```typescript
details: {
  picksGraded: gradedCount,
  failed: errorCount,
  ...(errorCount > 0 ? { errors: errorDetails } : {}),
},
```

The `errors` field should appear in `details` when `failed > 0`, but it is absent from all live records. This suggests either `completeRun` is not overwriting `startRun` details, or the production deployment differs from the current grading-service.ts code. This gap requires investigation.

---

### 6. Consecutive zero-graded failures in last 24h

Zero-graded failure = `status = 'failed'` AND `details->>'picksGraded' = '0'`.

From the 24h window (ordered chronologically), a cluster was identified:

| Timestamp (UTC) | Status | picksGraded | failed |
|----------------|--------|-------------|--------|
| 2026-06-29 00:30:37 | failed | 1 | 1 |
| 2026-06-29 00:36:40 | **failed** | **0** | 1 |
| 2026-06-29 00:37:51 | **failed** | **0** | 1 |
| 2026-06-29 00:50:39 | **failed** | **0** | 1 |
| 2026-06-29 00:59:06 | **failed** | **0** | 2 |
| 2026-06-29 01:10:04 | succeeded | 0 | 0 |
| 2026-06-29 01:21:51 | succeeded | 0 | 0 |

**Assessment:** 4 consecutive zero-graded failures between 00:36 and 00:59 UTC (8:36–8:59 PM ET). MLB is in active season at that time — these failures cannot be attributed to game schedule. The cluster resolved at 01:10 UTC and has not recurred.

---

## UTV2-1347 Error Persistence Visibility

UTV2-1347 documented that UTV2-1345 added `errors: [{ pickId, reason }]` to `system_runs.details` when grading fails. The code path in `grading-service.ts` lines 361-378 confirms the intent.

**Live DB evidence:** `errors` field is absent from ALL failed run records across 7 days. Only `{failed: N, picksGraded: M}` is present. This matches the `startRun` details format (line 368), NOT the `completeRun` format (lines 373-377).

**Gap:** Error persistence code is in source but not observable in live DB. Root cause investigation required — likely the `completeRun` repository method does not overwrite the `details` column, or the production deployment has not been restarted since the fix.

---

## pnpm type-check

```
PASS — TypeScript build clean (no output = no errors)
```

## pnpm test

```
# tests 19
# pass 19
# fail 0
# skipped 0
# duration_ms 715.255058
```

Note: `pnpm test` on this proof-only branch runs the transaction-rollback-service suite (19 tests). No test regressions.

## scripts/ci/r-level-check.ts

```
Verdict: PASS
Changed files: 2
Rules matched: (none) — no R-level artifacts required for this diff
```

---

## pnpm test:db

Command: `pnpm test:db`
Status: **FAIL** — pre-existing statement timeout, unrelated to this lane's changes

`pnpm test:db` was run against the live Supabase project (`zfzdnfwdarxucxtaojxm`). All 7
subtests timed out via `settlement_records.listRecent` in the CLV computation path
(`clv-feedback.ts → processSubmission → DatabaseSettlementRepository.listRecent`).

Root cause: `settlement_records` has no index on `created_at`. The 14 MB / ~13K-row table
requires a full sequential scan on every `ORDER BY created_at DESC` query, causing
statement timeouts even when a `since` lower-bound is passed. This is a pre-existing
performance gap; no changes in this lane affect the query path or table structure.

Basic DB connectivity confirmed: `scripts/ci/required-db-smoke.ts` passes in under 2s.

The index requirement is tracked as a follow-up infrastructure item.

---

## M3 Terminal Criteria Evaluation

| Criterion | Threshold | Observed | Verdict |
|-----------|-----------|----------|---------|
| C1: Heartbeat cron active — all recent `grading.cron.heartbeat` runs show `succeeded`; no consecutive failures in 7 days | 0 failures | 195/195 succeeded, 0 failed | **PASS** |
| C2: Failure rate at baseline — `grading.run` failure rate last 7 days ≤ 5% | ≤ 5% | 28.18% (144/511) | **FAIL** |
| C3: Zero-graded run investigation resolved — root cause documented and fixed or attributed | Error details visible in DB OR fix attributed | `errors` field absent from all failed run records; code fix deployed but not observable in live DB | **PARTIAL** |
| C4: No consecutive zero-graded failures in last 24h (unless attributed to game schedule) | 0 consecutive zero-graded failures | 4 consecutive at 00:36-00:59 UTC (not schedule-attributable); resolved by 01:10 UTC | **FAIL** |

---

## M3 Verdict: PARTIAL

**Positive signals:**
- C1 (heartbeat): PASS — 195/195 in 7 days, perfect record
- Current state: 13+ consecutive successful runs as of 04:44 UTC, no failures since 02:42 UTC
- The 7-day failure rate is heavily weighted by the 6/22-6/23 crisis (95-73%), which is now resolved per UTV2-1350
- If 6/22-6/23 data is excluded (6/24-6/29 only), failure rate remains 13-36% — still above threshold
- The error detail code (UTV2-1345) is correctly written in grading-service.ts

**Blocking gaps:**
- C2: 7-day failure rate 28.18% vs 5% threshold. Even excluding the crisis window, daily rates are 13-36%.
- C3: Error persistence not visible in live DB — `errors` field absent from failed run `details`. Root cause of zero-graded failures cannot be diagnosed from system_runs.
- C4: Zero-graded failure cluster (4 consecutive) at 00:36-00:59 UTC today, not schedule-attributable.

**Required for PASS:**
1. 7-day failure rate must reach ≤5% baseline — requires approximately 5 more clean days
2. Error detail persistence gap (C3) must be diagnosed — either `completeRun` is not updating `details`, or a production redeployment is needed
3. No recurrence of consecutive zero-graded failures

**Next actions:**
- Investigate why `completeRun` does not write `errors` array to `system_runs.details` in production
- Continue daily M3 monitoring; re-evaluate when 7-day window clears 6/22-6/23 data (approx 2026-06-30)
- If C3 gap confirmed as deployment issue, schedule a grading-service redeployment
