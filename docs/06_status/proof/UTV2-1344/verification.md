# UTV2-1344 Verification Log

**Issue:** UTV2-1344 — M5 alert follow-up (grading staleness alert)
**Tier:** T2
**Branch:** codex/utv2-1344-m5-staleness-alert
**PR:** TBD (post-push)
**Merge SHA:** TBD (post-merge)

## Verification

| Command | Status | Evidence |
|---------|--------|---------|
| `pnpm type-check` | PASS | local worktree run |
| `pnpm lint` | PASS | local worktree run |
| `pnpm build` | PASS | local worktree run |
| `pnpm test` | PASS | local worktree run — see verify output |
| `pnpm verify` | PASS | local worktree run |
| `scripts/ci/r-level-check.ts` | pending CI |

## What This Lane Delivers

- **`scripts/grading-alert-check.ts`** — alert script that queries `system_runs` for `grading.run` rows in the last 24h. Fails on: (1) no grading run in window → cron dead; (2) any run with `picksGraded = 0` → zero-graded blockage.
- **`.github/workflows/grading-staleness-check.yml`** — GHA workflow on daily 6am UTC schedule (+ `workflow_dispatch` with configurable `window_hours`). Uses existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `UNIT_TALK_OPS_ALERT_WEBHOOK_URL` secrets. Alerts via Discord webhook on failure.

## Gap Closed

UTV2-1336 monitoring proof found: "Grading staleness alert is ABSENT (no cron that fires when grading runs complete 0 picks). M5 milestone is NOT green."

This lane closes that gap. The alert pattern mirrors `ingestor-staleness-alert.yml` (external GHA cron) and `worker-alert-check.ts` (script querying `system_runs`).

## Data Model

- Table: `system_runs`
- `run_type = 'grading.run'` — written by `grading-service.ts` per `runGradingPass()`
- `details = { picksGraded: N, failed: N }` — counts per pass

## Verdict

PASS — grading staleness alert added. M5 monitoring gap closed.
