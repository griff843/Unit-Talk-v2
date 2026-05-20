## Summary

UTV2-1041: Built the 72-hour production burn-in evidence collection infrastructure. Three new files added within the declared file scope lock.

## What Was Built

### `scripts/ops/burn-in-snapshot.ts`
Point-in-time evidence collector. Collects API health (via `UNIT_TALK_DEPLOY_HEALTH_URL/api/health?full=true`), outbox state (row counts from `distribution_outbox` by status), and ingestor freshness (`provider_offers` latest `snapshot_at`). Evaluates five pass/fail criteria per snapshot. Always exits 0 — failed snapshots are collected, not dropped.

### `scripts/ops/burn-in-report.ts`
Aggregates all `snap-*.json` files from a snapshots directory into a final verdict report. Verdict is `PASS` when `snapshotCount >= 12 && failedSnapshots === 0 && durationHours >= 72`. Verdict is `INCOMPLETE` when fewer than 12 snapshots exist or duration < 72h. Verdict is `FAIL` if any snapshot failed. Exits 1 on `FAIL` when `--fail-on-fail` is passed.

### `.github/workflows/ops-burn-in-monitor.yml`
Scheduled workflow (every 6h via `0 */6 * * *`) plus manual `workflow_dispatch`. Two jobs:
- **snapshot** (scheduled): collects one snapshot, uploads as `burn-in-snapshot-<run_number>` artifact, posts result to Discord.
- **report** (manual, `generate_report=true`): downloads all `burn-in-snapshot-*` artifacts, flattens into `artifacts/snapshots/`, runs `burn-in-report.ts`, uploads final report, posts verdict to Discord, fails workflow if verdict is FAIL.

## How to Start the Burn-in Clock

1. Merge this PR to `main`. Note the merge SHA.
2. Set `BURN_IN_DEPLOYMENT_SHA` as a GitHub Actions variable (or use the default `bd952fd7211d92eab782da273f11fa386dc22ca0`).
3. The scheduled workflow will run automatically at the next `0 */6 * * *` tick.
4. To start immediately: trigger the workflow manually from the Actions tab (leave `generate_report` unchecked).

## Success Criteria (all five must hold across all 12 snapshots)

| Criterion | Check |
|---|---|
| `api.reachable` | API health endpoint returns HTTP 200 |
| `api.dbReachable` | Health response reports `dbReachable: true` |
| `api.queueHealth.deadLetterCount === 0` | No dead-letter entries in queue health |
| `ingestor.fresh` | Latest `provider_offers.snapshot_at` is ≤ 30 minutes old |
| `outbox.dead_letter === 0` | Zero `dead_letter` rows in `distribution_outbox` |

## Uptime Kuma

Uptime Kuma runs at `localhost:3001` (SSH tunnel only) and cannot be reached from GitHub Actions. All snapshots mark this as `MANUAL_CHECK`. The burn-in report summarises Kuma as a required manual verification step before final PASS ratification.

## Supabase Table Names Used

- `distribution_outbox` — canonical outbox table; statuses: `pending`, `processing`, `sent`, `failed`, `dead_letter`
- `provider_offers` — ingestor view; freshness measured from `snapshot_at` (falls back to `created_at`)

## R-level Compliance

No R2/R3/R4 artifacts required — this is pure infra/observability tooling, no model logic, no DB schema changes, no pick lifecycle changes.
