# UTV2-670 Diff Summary — Read-only stale lane alerter

## What changed

### New: `scripts/ops/stale-lane-alerter.ts`
Read-only script that compares all lane manifests against GitHub PR/branch state and Linear issue state.

**Drift conditions detected:**
| Kind | Condition |
|---|---|
| `pr_merged_lane_open` | Manifest status != done but GitHub PR is merged |
| `branch_deleted_lane_open` | Manifest status != done but branch no longer exists on remote |
| `linear_done_lane_open` | Manifest status != done but Linear issue is completed/cancelled |
| `done_missing_closed_at` | Manifest status == done but closed_at is null |
| `zombie_lane` | Manifest status == in_progress and heartbeat_at older than 48h |

**Outputs:**
- Structured JSON report at `.out/ops/lane-drift/YYYY-MM-DDTHH.json` (when `--write-result`)
- Discord alert via `UNIT_TALK_OPS_ALERT_WEBHOOK_URL` if drift detected
- Exits 0 always — never blocks CI

**Read-only guarantee:** Script contains no `writeManifest`, `updateManifest`, `writeJsonFile`, or any manifest mutation calls. All GitHub and Linear calls are GET requests only.

### New: `.github/workflows/stale-lane-alerter.yml`
Scheduled workflow running every 6 hours and on `workflow_dispatch`. Uploads drift report as artifact.

### Updated: `package.json`
Added `ops:lane-alert` script entry: `tsx scripts/ops/stale-lane-alerter.ts`.

### Updated: `docs/05_operations/REQUIRED_SECRETS.md`
Added `UNIT_TALK_OPS_ALERT_WEBHOOK_URL` to canonical inventory (referenced by new workflow, optional).

## Local test result

```
[stale-lane-alerter] run_at=2026-04-19T16:21:09.253Z mode=local
  manifests: 13
  drift:     0
  verdict: CLEAN
```

13 manifests checked, 0 drift. Expected — two previously stale lanes (UTV2-608, UTV2-610) were closed in PR #364 before this issue was started.
