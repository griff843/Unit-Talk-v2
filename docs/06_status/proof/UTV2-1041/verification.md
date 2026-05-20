## Verification Guide — UTV2-1041 Burn-in Infrastructure

### How to Read the Report

The final report artifact is `burn-in-report.json` uploaded by the report job. Key fields:

| Field | Meaning |
|---|---|
| `verdict` | `PASS`, `FAIL`, or `INCOMPLETE` |
| `snapshotCount` | How many snapshots were collected |
| `requiredSnapshots` | 12 (72h / 6h intervals) |
| `durationHours` | Wall-clock hours between first and last snapshot |
| `failedSnapshots` | Count of snapshots where `passing === false` |
| `clockReset` | `true` if any snapshot failed (burn-in must restart from zero) |
| `criticalFailures` | Union of all failing criteria across all snapshots |
| `criteria` | Per-criterion pass/fail across the full burn-in window |
| `snapshots` | Per-snapshot summary (index, timestamp, passing, failures) |

### What PASS Means

`verdict === 'PASS'` means:
- All 12 snapshots were collected (`snapshotCount >= 12`)
- Zero snapshots failed (`failedSnapshots === 0`)
- The burn-in window spanned at least 72 hours (`durationHours >= 72`)
- All five criteria were continuously satisfied:
  - API was reachable in every snapshot
  - DB was reachable in every snapshot
  - Queue health reported zero dead-letter entries in every snapshot
  - Ingestor offered fresh data (≤ 30 minutes old) in every snapshot
  - `distribution_outbox` had zero `dead_letter` rows in every snapshot

A PASS report is the T1 proof artifact for UTV2-1041.

### What FAIL Means

Any snapshot with `passing: false` causes `verdict === 'FAIL'`. This means the 72h clock resets conceptually — the next burn-in run must collect 12 consecutive passing snapshots starting from the recovery point.

### What INCOMPLETE Means

Fewer than 12 snapshots exist, or the window is shorter than 72 hours. This is expected while the burn-in is in progress. Generate the report again after 72h have elapsed and all 12 snapshots are collected.

### How to Manually Trigger Report Generation

1. Go to Actions → "Ops — Burn-in Monitor (UTV2-1041)"
2. Click "Run workflow"
3. Check the "Generate final burn-in report" checkbox
4. Click "Run workflow"
5. When complete, download the `burn-in-report-<run_number>` artifact
6. The final verdict is in `burn-in-report.json`

### Required Secrets / Variables

| Name | Type | Purpose |
|---|---|---|
| `SUPABASE_URL` | Secret | Supabase project URL for DB queries |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Service role key for DB queries |
| `UNIT_TALK_DEPLOY_HEALTH_URL` | Secret | Base URL of the production API (e.g. `http://46.225.14.123`) |
| `UNIT_TALK_OPS_ALERT_WEBHOOK_URL` | Secret | Discord webhook for snapshot/report notifications |
| `BURN_IN_DEPLOYMENT_SHA` | Variable | Deployment SHA being certified (default: `bd952fd7211d92eab782da273f11fa386dc22ca0`) |

### Uptime Kuma (Manual Check)

Uptime Kuma runs at `localhost:3001` on the Hetzner host (SSH tunnel required). It cannot be polled from GitHub Actions. Before ratifying a PASS verdict, the operator must:

1. SSH to `46.225.14.123`
2. Verify Kuma shows all monitors green for the 72h window
3. Screenshot or export the Kuma status page
4. Attach to the evidence bundle or Linear issue comment

### Evidence Bundle Location

Once the burn-in completes with PASS verdict:
- Report JSON: `burn-in-report.json` (GitHub Actions artifact, retained 90 days)
- This verification guide: `docs/06_status/proof/UTV2-1041/verification.md`
- Diff summary: `docs/06_status/proof/UTV2-1041/diff-summary.md`
- Merge SHA: tied to the commit that introduced this infrastructure (the sha is in the Linear issue and PR description)

The T1 evidence bundle must reference the merge SHA of the production deploy being certified (`bd952fd7211d92eab782da273f11fa386dc22ca0`), not the merge SHA of this infrastructure PR.
