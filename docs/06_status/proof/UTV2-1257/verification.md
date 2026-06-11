# UTV2-1257 Verification — grading-cron Managed Production Home

## Summary

Adds `grading-cron` as a managed Docker Compose service in `deploy/production/docker-compose.yml` using the existing `unit-talk/api` image with a command override. Wires `UNIT_TALK_GRADING_CRON_AUTORUN=true` and optional `UNIT_TALK_OPS_ALERT_WEBHOOK_URL` into both `.env.production` write steps in `.github/workflows/deploy.yml`.

## Problem Addressed

`grading.run` system runs stopped 2026-06-08 14:03Z when a local WSL process died. The grading-cron had no managed production home — it was never in docker-compose and `GRADING` env vars were absent from `.env.production`. Evidence settlements = 0 since UTV2-1251 deploy; settled CLV-path stays 0/50 blocking UTV2-1042/UTV2-1250.

## Changes

### `deploy/production/docker-compose.yml`

Added `grading-cron` service:
- Image: `ghcr.io/griff843/unit-talk-v2/api` (same API image, command override)
- Command: `["node_modules/.bin/tsx", "apps/api/src/grading-cron.ts"]`
- `env_file: .env.production` (inherits all production env vars)
- `restart: unless-stopped`
- `depends_on: api (service_healthy)` — waits for API before starting
- Healthcheck: `pgrep -f 'grading-cron'` every 60s with 30s start period
- Resource limits: 256m memory, 0.25 CPU

### `.github/workflows/deploy.yml`

Both `.env.production` write steps (canary and promote) now emit:
- `UNIT_TALK_GRADING_CRON_AUTORUN=true` — activates the infinite `startGradingCronLoop`
- `UNIT_TALK_OPS_ALERT_WEBHOOK_URL=${UNIT_TALK_OPS_ALERT_WEBHOOK_URL:-}` — optional ops webhook for staleness alerts (safe empty default)

Both `env:` secret blocks now reference `UNIT_TALK_OPS_ALERT_WEBHOOK_URL: ${{ secrets.UNIT_TALK_OPS_ALERT_WEBHOOK_URL }}`.

## Verification

### `pnpm verify:quick`
```
lint: PASS
type-check: PASS
env:check: PASS
```

### `pnpm verify` (full)
```
env:check: PASS
lint: PASS
type-check: PASS
build: PASS
test: PASS (exit 0)
verify:commands: PASS
  - command-manifest: 14 commands verified
  - check-migration-versions: 119 files, no duplicate versions
  - lint-migrations: 119 files, no findings
```

## Production Impact

- On next deploy: `grading-cron` starts as a managed container alongside api/worker/ingestor/discord-bot
- The `startGradingCronLoop` infinite loop runs with 5-minute poll interval (default `UNIT_TALK_GRADING_CRON_POLL_MS=300000`)
- Writes `grading.cron.heartbeat` runs after each cycle
- Emits staleness alert to ops webhook if `grading.run` gap exceeds 45 minutes
- Depends on API being healthy; auto-restarts on failure

## UTV2-1250 Readiness Impact

Once this ships and a grading pass runs successfully:
- `grading.run` rows resume accumulating from Hetzner
- Evidence settlements begin for `awaiting_approval` picks with completed events
- UTV2-1250 monitoring clock starts moving (combined with UTV2-1258 fetch cap fix)
