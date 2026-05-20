# UTV2-1014 Diff Summary

**Date:** 2026-05-20
**Issue:** Ingestor freshness failure + blocked operator SSH access
**Branch:** UTV2-1014

## Root Cause

`.env.production` was never written to the Hetzner server by any automated step in `deploy.yml`. The `docker-compose.yml` references `env_file: - .env.production` for all services (api, worker, ingestor, discord-bot), so any missing or stale env file causes the ingestor to run without `SGO_API_KEY`, producing no fresh offers.

The file was likely placed manually at initial Hetzner setup and was never updated or re-created on subsequent deploys.

## Files Changed

- `.github/workflows/deploy.yml` — added "Write .env.production to server" step to both `canary` and `promote` jobs; step uses stdin pipe (never command args) to avoid secret exposure in process list
- `.github/workflows/ingestor-scheduled-run.yml` — removed `*/5 * * * *` cron trigger; persistent ingestor daemon on Hetzner supersedes this bridge
- `.github/workflows/ops-add-operator-key.yml` — NEW: one-shot `workflow_dispatch` to append an operator's ed25519 public key to `~/.ssh/authorized_keys` on the deploy host; idempotent (grep-before-append)
- `.github/workflows/ops-ingestor-diagnose.yml` — NEW: `workflow_dispatch` SSH diagnostic: container status, inspect, last 100 log lines, `.env.production` presence check, `SGO_API_KEY` presence check; uploads output as artifact

## Secrets Written to Server

All delivered via stdin pipe, mode 600:
- `NODE_ENV`, `UNIT_TALK_APP_ENV`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `SGO_API_KEY`, `SGO_API_KEY_FALLBACK`
- `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`
- `UNIT_TALK_BOT_API_KEY`, `UNIT_TALK_INGESTOR_API_KEY`
- Runtime mode flags (`fail_closed` for all services)
- Autorun / cycle / adapter flags
