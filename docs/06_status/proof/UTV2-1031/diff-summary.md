# UTV2-1031 Diff Summary — Rollback Drill Infrastructure

## Summary

**Issue:** UTV2-1031 — Live rollback drill: deploy bad image → health fails → rollback restores  
**Branch:** `feat/utv2-1031-rollback-drill`  
**Tier:** T2  

Delivers an end-to-end rollback drill script and GHA workflow that proves the stop-and-restore
production code path works before a live incident requires it.

## Evidence

| File | Change |
|------|--------|
| `deploy/rollback-drill.sh` | NEW: full stop/restore drill with verdict JSON |
| `.github/workflows/ops-rollback-drill.yml` | NEW: workflow_dispatch trigger, artifact upload |

## What was built

### `deploy/rollback-drill.sh` (new)

End-to-end rollback drill orchestrator. Runs on the production server via SSH. Proves the
complete stop-and-restore cycle:

1. **Pre-health capture** — `curl http://localhost:4000/health` → must be 200 before drill starts
2. **Simulate failure** — `docker stop unit-talk-api-1` takes the API container down
3. **Confirm downtime** — polls health endpoint every 5s, confirms non-200 within 60s
4. **Restore via rollback path** — `UNIT_TALK_IMAGE_TAG=<current> docker compose up -d --no-deps api`  
   (same code path as the real rollback from `deploy/rollback.sh`)
5. **Post-restore health poll** — polls every 5s for up to 120s, confirms 200 OK
6. **Verdict JSON** — writes `rollback-drill-result.json` with PASS/FAIL, timestamps, HTTP status codes

The restore step intentionally uses `docker compose up -d --no-deps api` — the same compose-based
restart that `deploy/rollback.sh` uses — to exercise the real production code path, not a bare
`docker start`.

Result files written to `$DEPLOY_PATH`:
- `rollback-drill-pre.json` — health response before drill
- `rollback-drill-during.json` — health status while API is stopped
- `rollback-drill-post.json` — health response after restore
- `rollback-drill-result.json` — verdict + metadata (downloaded by GHA)

### `.github/workflows/ops-rollback-drill.yml` (new)

`workflow_dispatch` workflow that orchestrates the drill end-to-end from GitHub Actions:

1. Validates four required secrets (SSH key, host, user, path)
2. Installs the SSH key and adds the host to `known_hosts`
3. Uploads `deploy/rollback-drill.sh` to `$DEPLOY_PATH/scripts/` on the server
4. Runs the drill via SSH (exits non-zero on FAIL verdict)
5. Downloads `rollback-drill-result.json` from the server
6. Checks the `verdict` field — exits 1 if not `PASS`
7. Uploads the result JSON as a GHA artifact (retention: 30 days)

## What the drill proves

| Claim | Evidence |
|-------|----------|
| Health check detects API outage | `down_confirmed: true` in result JSON |
| Rollback code path (`docker compose up -d --no-deps api`) restores service | `post_health_status: "200"` in result JSON |
| Full cycle time is acceptable | `duration_seconds` in result JSON |
| Drill is repeatable and automated | `workflow_dispatch` trigger in GHA |

## What the drill does NOT prove

- Image tag pinning (the drill stops and restarts the same image, not a different one)  
  → That path is covered by the canary gate in `deploy.yml` which uses `docker compose pull` + rollback on health failure
- All four services simultaneously (drill targets the API container only, the most critical health-check surface)
- Recovery from a host reboot or disk failure

## Files changed

```
deploy/rollback-drill.sh                          (new, +196 lines)
.github/workflows/ops-rollback-drill.yml          (new, +79 lines)
docs/06_status/proof/UTV2-1031/diff-summary.md   (this file)
docs/06_status/proof/UTV2-1031/verification.md   (new)
```
