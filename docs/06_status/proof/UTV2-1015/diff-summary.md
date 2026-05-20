# UTV2-1015 — Diff Summary: Loki + Grafana Centralized Logging

## Audit Finding

Production had no centralized log aggregation. All service logs were ephemeral (Docker
container stdout only). Operators had no way to query structured JSON logs across
services, correlate events across api/worker/ingestor/discord-bot, or set retention
policies. This gap was identified in the infrastructure hardening audit.

## Files Changed

### `deploy/production/docker-compose.yml`
- Added `configs:` top-level block with `grafana_loki_datasource` inline — delivers
  the Loki datasource provisioning YAML into Grafana without requiring a separate
  directory SCP step in the deploy workflow.
- Added `loki` service: `grafana/loki:3.0.0`, bound `127.0.0.1:3100:3100` (not
  publicly exposed), named volume `loki-data`, uses Loki's built-in
  `local-config.yaml` (7-day retention minimum).
- Added `grafana` service: `grafana/grafana:11.0.0`, bound `127.0.0.1:3200:3000`
  (not publicly exposed), anonymous admin access, consumes `grafana_loki_datasource`
  config at `/etc/grafana/provisioning/datasources/loki.yml`.
- Added `LOKI_URL=http://loki:3100` inline `environment:` block to all four
  application services: `api`, `worker`, `ingestor`, `discord-bot`. The `env_file`
  directive is preserved — `environment:` only adds/overrides the compose-time-known
  value.
- Added `loki-data` and `grafana-data` named volumes to the `volumes:` section.

### `deploy/production/topology-spec.yml`
- Bumped `version: 1` to `version: 2` (service topology changed).
- Added `loki` and `grafana` service entries with image, port, bind, restart,
  resource limits, and deployment notes.
- Added `injected_env: [LOKI_URL]` to all four application service entries.
- Updated `network.members` to include `loki` and `grafana`.

## No New Files to SCP

The Grafana datasource provisioning config is delivered inline via Docker Compose
`configs:` — no `grafana/provisioning/` directory needs to be uploaded by the deploy
workflow. The existing deploy job SCP of `docker-compose.yml` is sufficient.

## Verification Steps (post-deploy)

1. SSH to `46.225.14.123`, open an SSH tunnel:
   `ssh -L 3200:127.0.0.1:3200 <user>@46.225.14.123`
2. Open `http://localhost:3200` in a browser — Grafana UI should load without a
   login prompt (anonymous admin).
3. Navigate to Explore → select `Loki` datasource (auto-provisioned, set as default).
4. Query `{job="api"}` — should return structured JSON log lines from the api service.
5. Repeat with `{job="worker"}`, `{job="ingestor"}`, `{job="discord-bot"}`.
6. Confirm Loki is unreachable from the public internet:
   `curl http://46.225.14.123:3100/ready` — should time out or be refused.
