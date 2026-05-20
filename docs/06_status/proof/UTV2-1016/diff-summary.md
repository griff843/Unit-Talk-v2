# UTV2-1016 Diff Summary — Automate full Uptime Kuma 5-monitor + Discord notification provisioning

## Issue

`deploy-monitoring.yml` deployed Uptime Kuma but left 4 of 5 monitors and Discord notification
wiring as "MANUAL STEPS REMAINING" in the workflow output. Operators had to SSH-tunnel and
configure via the web UI after every deploy.

## Files Changed

| File | Change |
|------|--------|
| `deploy/monitoring/provision-kuma-monitors.sh` | NEW: full idempotent provisioning script |
| `.github/workflows/deploy-monitoring.yml` | Replace single-monitor step with two-step automated provisioning |

## What Was Automated

### Discord notification
- Type: `discord`
- Webhook source: `DISCORD_OPS_WEBHOOK_URL` secret (read from `.env.monitoring` on server)
- `isDefault: true`, `applyExisting: true` — applies to all monitors automatically

### Monitors (5 total)

| # | Name | Type | Target | Interval |
|---|------|------|--------|----------|
| 1 | Unit Talk API Health | HTTP | `http://api:4000/health` | 60s, 3 retries |
| 2 | Unit Talk Host Ping | Ping | `46.225.14.123` | 60s, 3 retries |
| 3 | Unit Talk Worker Liveness | HTTP | `http://api:4000/health?full=true` | 60s, 3 retries |
| 4 | Unit Talk Ingestor Freshness | HTTP | `http://api:4000/health?full=true` | 60s, 3 retries |
| 5 | Unit Talk Discord Bot | Docker container (HTTP fallback) | `unit-talk-discord-bot` | 60s, 3 retries |

**Notes on monitors 3 and 4:** Worker liveness and ingestor freshness are currently surfaced
through the API's `?full=true` health response. A dedicated worker or ingestor HTTP health port
can replace these in a future lane without changing the monitor provisioning structure.

**Note on monitor 5:** The provisioning script attempts the Uptime Kuma `docker` type first
(using the mounted Docker socket from `docker-compose.monitoring.yml`). If that type is
unavailable in the running Kuma version, it falls back to an HTTP monitor against the API
health endpoint. Either way the monitor is created and Discord-notified.

## Security Properties

- Admin password passes via `/tmp/kuma-pass` file (600 perms), never as a CLI argument
- Discord webhook URL reads from server-local `.env.monitoring` (600 perms), never passed
  through the workflow as a plaintext arg
- Python3 builds all JSON payloads to safely escape special characters
- Temp file deleted at the earliest opportunity inside the provisioning script

## Idempotency

The script calls `GET /api/monitors`, checks each monitor name, and skips creation if the
name already exists. Running the workflow multiple times does not produce duplicate monitors.
Admin setup (`POST /setup`) is also idempotent — Uptime Kuma returns 4xx when admin already
exists, which the script treats as success.

## Acceptance Criteria

- [x] All 5 monitors created automatically on workflow run
- [x] Discord notification wired to all monitors via `applyExisting: true`
- [x] No manual steps required after `deploy-monitoring.yml` completes
- [x] Script is idempotent (safe to re-run)
- [x] Secrets never appear in command-line arguments
- [x] `set -euo pipefail` throughout; login failure exits non-zero
