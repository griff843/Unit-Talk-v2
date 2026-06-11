# UTV2-1257 Diff Summary

## Files Changed

| File | Change |
|------|--------|
| `deploy/production/docker-compose.yml` | Added `grading-cron` service (25 lines) |
| `.github/workflows/deploy.yml` | Added grading-cron env vars to both deploy steps (6 lines) |

## Key Design Decisions

1. **Same API image, command override**: Re-uses the existing `unit-talk/api` image (`ghcr.io/griff843/unit-talk-v2/api`) with `command: ["node_modules/.bin/tsx", "apps/api/src/grading-cron.ts"]`. No new Docker image required; grading-cron.ts is already compiled/present in the API image.

2. **`unless-stopped` restart policy**: Matches worker/ingestor policy. Survives container crashes and host reboots.

3. **`pgrep -f 'grading-cron'` healthcheck**: Same pattern as worker/ingestor. Application-layer staleness alerting (`GRADING_STALE_WARN_MS=2700000`) provides the hang-detection complement, firing to `UNIT_TALK_OPS_ALERT_WEBHOOK_URL` if `grading.run` gap exceeds 45 minutes.

4. **`UNIT_TALK_OPS_ALERT_WEBHOOK_URL` safe default**: Uses `${UNIT_TALK_OPS_ALERT_WEBHOOK_URL:-}` pattern (same as UTV2-1255 fix) — empty string if secret not set. No new required secret.

5. **Depends on `api: service_healthy`**: Prevents grading-cron from starting before the API is ready to serve repository requests.
