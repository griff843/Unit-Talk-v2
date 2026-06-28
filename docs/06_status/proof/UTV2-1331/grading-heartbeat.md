# Grading Heartbeat Proof — UTV2-1331

**Timestamp:** 2026-06-27T21:20:00Z
**Query source:** Supabase zfzdnfwdarxucxtaojxm (live)
**Queried by:** Claude Sonnet 4.6 (orchestrator)

---

## Grading Run History (last 20 runs)

Actual column names differ from the issue spec: `system_runs` uses `run_type` (not `job_type`),
`finished_at` (not `completed_at`), and `details` (not `metadata`). Queries were corrected.

| run_type | status | started_at (UTC) | finished_at (UTC) | duration_ms | picks_graded | failed_picks |
|---|---|---|---|---|---|---|
| grading.run | failed | 2026-06-27 21:14:55 | 2026-06-27 21:14:55 | 297 | 0 | 2 |
| grading.run | failed | 2026-06-27 21:00:10 | 2026-06-27 21:00:11 | 287 | 0 | 1 |
| grading.run | succeeded | 2026-06-27 20:53:11 | 2026-06-27 20:53:11 | 221 | 0 | 0 |
| grading.run | succeeded | 2026-06-27 20:44:11 | 2026-06-27 20:44:11 | 249 | 1 | 0 |
| grading.cron.heartbeat | succeeded | 2026-06-27 20:31:23 | 2026-06-27 20:31:24 | 326 | — | — |
| grading.run | failed | 2026-06-27 20:31:23 | 2026-06-27 20:31:23 | 198 | 0 | 1 |
| grading.run | failed | 2026-06-27 20:30:34 | 2026-06-27 20:30:34 | 637 | 0 | 1 |
| grading.run | succeeded | 2026-06-27 20:20:34 | 2026-06-27 20:20:36 | 1143 | 3 | 0 |
| grading.run | succeeded | 2026-06-27 20:13:18 | 2026-06-27 20:13:18 | 219 | 0 | 0 |
| grading.run | succeeded | 2026-06-27 20:06:01 | 2026-06-27 20:06:01 | 206 | 0 | 0 |
| grading.run | succeeded | 2026-06-27 19:54:01 | 2026-06-27 19:54:01 | 200 | 5 | 0 |
| grading.run | succeeded | 2026-06-27 19:44:08 | 2026-06-27 19:44:08 | 214 | 0 | 0 |
| grading.run | succeeded | 2026-06-27 19:35:44 | 2026-06-27 19:35:44 | 203 | 0 | 0 |
| grading.cron.heartbeat | succeeded | 2026-06-27 19:34:09 | 2026-06-27 19:34:09 | 197 | — | — |
| grading.run | succeeded | 2026-06-27 19:34:08 | 2026-06-27 19:34:08 | 207 | 6 | 0 |
| grading.run | failed | 2026-06-27 19:24:08 | 2026-06-27 19:24:08 | 202 | 1 | 2 |
| grading.run | failed | 2026-06-27 19:11:01 | 2026-06-27 19:11:01 | 517 | 1 | 2 |
| grading.run | failed | 2026-06-27 18:55:46 | 2026-06-27 18:55:47 | 495 | 3 | 3 |
| grading.run | succeeded | 2026-06-27 18:45:40 | 2026-06-27 18:45:41 | 588 | 0 | 0 |
| grading.run | succeeded | 2026-06-27 18:36:59 | 2026-06-27 18:37:00 | 1092 | 0 | 0 |

### Heartbeat Cron Cycle History (last 10)

| cycle | status | started_at (UTC) | interval_from_prev |
|---|---|---|---|
| 69 | succeeded | 2026-06-27 20:31:23 | ~57 min |
| 68 | succeeded | 2026-06-27 19:34:09 | ~61 min |
| 67 | succeeded | 2026-06-27 18:33:36 | ~5 min |
| 66 | succeeded | 2026-06-27 18:28:13 | ~58 min |
| 65 | succeeded | 2026-06-27 17:30:43 | ~55 min |
| 64 | succeeded | 2026-06-27 16:35:01 | ~55 min |
| 63 | succeeded | 2026-06-27 15:40:03 | ~57 min |
| 62 | succeeded | 2026-06-27 14:42:41 | ~5 min |
| 61 | succeeded | 2026-06-27 14:37:30 | ~62 min |
| 60 | succeeded | 2026-06-27 13:35:00 | — |

All 69 heartbeat cron cycles have succeeded. Cadence is approximately 57–62 minutes (with occasional
double-fires ~5 min apart). No heartbeat failures on record.

---

## All-Time Grading Run Statistics

| metric | value |
|---|---|
| Total runs (all time) | 11,855 |
| Succeeded | 11,682 (98.5%) |
| Failed | 173 (1.46%) |
| Total picks graded (all time) | 1,112 |
| Oldest run | 2026-04-21 02:49:49 UTC |
| Newest run | 2026-06-27 21:14:55 UTC |

### Today (2026-06-27) Statistics

| metric | value |
|---|---|
| Runs today | 92 |
| Succeeded today | 60 (65.2%) |
| Failed today | 32 (34.8%) |
| Picks graded today | 202 |

Note: Today's failure rate (34.8%) is significantly elevated versus the historical baseline (1.46%).
The last two `grading.run` entries both failed with 0 picks graded. This is a signal worth monitoring.

---

## Pick Counts by Status

### picks table (status column)

| status | count |
|---|---|
| validated | 10,232 |
| voided | 7,747 |
| awaiting_approval | 7,734 |
| queued | 7,181 |
| settled | 7,180 |
| draft | 5,555 |
| posted | 3,163 |
| **Total** | **48,792** |

### pick_lifecycle table (latest state per pick)

| current_state | count |
|---|---|
| awaiting_approval | 7,884 |
| validated | 5,765 |
| queued | 5,379 |
| settled | 4,997 |
| voided | 4,014 |
| posted | 2,647 |
| **Total distinct picks tracked** | **30,686** |

Note: The `picks` table does not use a `lifecycle_state` column (as the issue spec assumed).
The lifecycle state machine lives in the `pick_lifecycle` event-log table. There is no `finalized`
state in the schema; `posted` is the terminal pre-settlement state eligible for grading.

---

## Grading Reach Assessment

- **Picks eligible for grading** (status = 'posted' in picks table): **3,163**
- **Picks settled** (graded picks, lifecycle terminal): **7,180** (picks table) / **4,997** (pick_lifecycle latest)
- **Last grading.cron.heartbeat completed at:** 2026-06-27T20:31:24Z (cycle 69)
- **Last grading.run completed at:** 2026-06-27T21:14:55Z (failed; last success = 20:53:11Z)
- **Grading service running:** YES — 92 grading.run executions today; cron heartbeat on cycle 69
- **Recent throughput:** 202 picks graded on 2026-06-27; 1,112 total all-time

### Evidence from system_runs

1. `grading.cron.heartbeat` runs are recorded every ~57 minutes, cycle counter incrementing
   monotonically (currently 69). All heartbeats have status = 'succeeded'. This confirms the
   scheduling daemon is alive and cycling.

2. `grading.run` events fire with details `{picksGraded: N, failed: M}`. Graded picks are reaching
   the service: 202 today, with individual runs grading 1–6 picks when game results are available.

3. Partial failures are present: some runs log `{failed: 1-3, picksGraded: N}` with status 'failed'.
   These appear when some picks in a batch resolve (picksGraded > 0) while others error. The last
   two runs both failed with picksGraded=0 — a short stall that warrants monitoring but does not
   indicate a stopped service.

4. The elevated today-failure rate (34.8%) vs historical (1.46%) is a concern. The `details.failed`
   field counts per-pick errors within a run, suggesting a subset of picks hitting missing/unavailable
   game result data rather than a systemic service crash.

---

## Verdict

**PARTIAL**

The grading heartbeat is confirmed running (cycle 69, ~57-minute cadence, 100% heartbeat success
rate). The grading service is actively processing picks: 202 graded today, 1,112 all-time. 3,163
picks in `posted` status are eligible for grading as game results arrive.

However, today's grading.run failure rate (34.8% vs 1.46% historical) is materially elevated, and
the two most recent runs both failed with zero picks graded. This is not a stopped service — the
heartbeat is alive and earlier runs today succeeded — but it is an anomaly requiring PM attention
to determine whether it reflects transient game-result unavailability or a recurring per-pick error
pattern requiring a code fix.

**Recommended PM action:** Review the `details.failed` pattern in today's failed runs. If picks are
consistently failing with the same pick IDs, that suggests a data-quality issue on specific picks
rather than a systemic grading failure.
