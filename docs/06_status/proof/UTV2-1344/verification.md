# UTV2-1344 Verification Log

**Issue:** UTV2-1344 — M5 alert follow-up (grading staleness alert)
**Tier:** T2
**Branch:** codex/utv2-1344-m5-staleness-alert
**PR:** https://github.com/griff843/Unit-Talk-v2/pull/1097
**Head SHA:** 2ee9a68ab90e426de8d73ff283d5b89408d33bfb
**Merge SHA:** TBD (post-merge, auto-bound by post-merge-lane-close.yml)

## Verification

| Command | Status | Evidence |
|---------|--------|---------|
| `pnpm type-check` | PASS | local worktree run |
| `pnpm lint` | PASS | local worktree run |
| `pnpm build` | PASS | local worktree run |
| `pnpm test` | PASS | local worktree run — see verify output |
| `pnpm verify` | PASS | local worktree run |
| `pnpm test:db` | PASS | DB smoke (7/7) run as part of verify |
| `scripts/ci/r-level-check.ts` | PASS | no artifacts required for this diff |

## What This Lane Delivers

- **`scripts/grading-alert-check.ts`** — alert script that queries `system_runs` for `grading.run` rows in the last 24h. Fails on: (1) no grading run in window → cron dead; (2) any run with `picksGraded = 0` → zero-graded blockage.
- **`.github/workflows/grading-staleness-check.yml`** — GHA workflow on daily 6am UTC schedule (+ `workflow_dispatch` with configurable `window_hours`). Uses existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `UNIT_TALK_OPS_ALERT_WEBHOOK_URL` secrets. Alerts via Discord webhook on failure.

## Gap Closed

The monitoring proof lane found: "Grading staleness alert is ABSENT (no cron that fires when grading runs complete 0 picks). M5 milestone is NOT green."

This lane closes that gap. The alert pattern mirrors `ingestor-staleness-alert.yml` (external GHA cron) and `worker-alert-check.ts` (script querying `system_runs`).

## Data Model

- Table: `system_runs`
- `run_type = 'grading.run'` — written by `grading-service.ts` per `runGradingPass()`
- `details = { picksGraded: N, failed: N }` — counts per pass

## Verdict

PASS — grading staleness alert added. M5 monitoring gap closed.
