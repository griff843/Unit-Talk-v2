# UTV2-1031 Verification

**Issue:** UTV2-1031 — Live rollback drill: deploy bad image → health fails → rollback restores  
**Branch:** `feat/utv2-1031-rollback-drill`  
**Tier:** T2  
**Verifier:** griffadavi@gmail.com  

## How to run the drill

### Via GitHub Actions (primary path)

```bash
gh workflow run ops-rollback-drill.yml
```

Or from the GitHub UI:  
Actions → "Ops — Rollback Drill" → Run workflow → Run workflow

### Monitor progress

```bash
gh run list --workflow=ops-rollback-drill.yml --limit 5
gh run watch   # follow the most recent run
```

### Download the result artifact

```bash
gh run download <run-id> --name rollback-drill-result-<run-id>.json
cat rollback-drill-result-<run-id>.json/rollback-drill-result.json
```

### Run manually on the server (for debugging)

```bash
# Upload the script
scp deploy/rollback-drill.sh "$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PATH/scripts/rollback-drill.sh"

# Execute
ssh "$DEPLOY_USER@$DEPLOY_HOST" \
  "bash '$DEPLOY_PATH/scripts/rollback-drill.sh' --deploy-path '$DEPLOY_PATH'"

# Retrieve result
scp "$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PATH/rollback-drill-result.json" .
cat rollback-drill-result.json
```

## Acceptance criteria

All of the following must be true in `rollback-drill-result.json` for the drill to PASS:

| Field | Required value | What it proves |
|-------|---------------|----------------|
| `verdict` | `"PASS"` | All phases completed successfully |
| `pre_health_status` | `"200"` | API was healthy before the drill |
| `down_confirmed` | `true` | Health check correctly detected the API being stopped |
| `post_health_status` | `"200"` | `docker compose up -d --no-deps api` restored the service |
| `duration_seconds` | < 300 | Full stop-detect-restore cycle completes in under 5 minutes |

## What to check in the artifact

```json
{
  "verdict": "PASS",
  "fail_reason": "",
  "pre_health_status": "200",
  "down_confirmed": true,
  "post_health_status": "200",
  "drill_started_at": "2026-XX-XXTXX:XX:XXZ",
  "drill_completed_at": "2026-XX-XXTXX:XX:XXZ",
  "duration_seconds": <number>,
  "current_tag": "<sha>",
  "api_container": "unit-talk-api-1",
  "restore_command": "docker compose up -d --no-deps api"
}
```

A `verdict: "PASS"` with `down_confirmed: true` and `post_health_status: "200"` constitutes
proof that the rollback path works end-to-end against the real production host.

## Failure modes and diagnosis

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `pre_health_check_failed_status_XXX` | API was not healthy before drill ran | Resolve API health issue, then re-run |
| `container_stop_failed` | Container name mismatch | Pass `--api-container` with the correct name from `docker ps` |
| `down_not_confirmed_within_60s` | Health endpoint is behind a load balancer or keepalive keeps responding | Confirm the health URL resolves directly to the API container |
| `restore_health_not_confirmed_within_120s_*` | `docker compose up` failed or image pull issue | Check `docker compose logs api` on the server |
| SSH step fails | Secret rotation or key mismatch | Verify `UNIT_TALK_DEPLOY_SSH_KEY` is current |

## Required secrets

| Secret | Purpose |
|--------|---------|
| `UNIT_TALK_DEPLOY_SSH_KEY` | SSH private key for the Hetzner node |
| `UNIT_TALK_DEPLOY_HOST` | Hostname or IP of the production server (46.225.14.123) |
| `UNIT_TALK_DEPLOY_USER` | SSH username on the server |
| `UNIT_TALK_DEPLOY_PATH` | Absolute path to the deployment directory on the server |

## Concurrency guard

The workflow has `concurrency: group: rollback-drill` with `cancel-in-progress: false`.
A second drill run will queue rather than interrupt an in-progress one, preventing concurrent
`docker stop` calls on the same container.
