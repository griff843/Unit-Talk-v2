# WORK-2026092403 — the production host stops accumulating disk it never reclaims

Tier: T1 (workflow files). Executor: claude.

## Measured problem (2026-09-24, read-only on unit-talk-prod-app-1)
- `/` 140G of 226G used. Docker images 141.2GB across 398 images, 79.96GB reclaimable: 68 generations each of api/worker/ingestor/discord-bot. Nothing removes a superseded release image.
- No container log rotation: every container uses json-file with an empty Config. The loki container's log is 5.07GB.
- The hourly disk alert and the 2-minute container-health watcher never run their scripts: cron redirects into /var/log (root:syslog 0775), which the deploy user cannot create files in, so the redirect fails before the script starts. Neither log file exists.

## Change
1. deploy.yml: after a successful promote, remove Unit Talk release images whose tag is neither the current release, the previous release, nor a SHA the host still keeps a configuration snapshot for. Never touch third-party images. Non-fatal.
2. deploy/production/docker-compose.yml: json-file rotation on every service.
3. deploy-monitoring.yml: cron logs under $DEPLOY_PATH/logs, which the deploy user owns.

## Not in scope
No deploy is dispatched, no host command is run, nothing is deleted by this lane. Takes effect only at Griff's next Deploy / Deploy Monitoring dispatch.
