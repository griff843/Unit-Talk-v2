# UTV2-1015 — Pre-Merge Verification Checklist

## Summary

**Branch HEAD SHA:** 1cd84192703c6abd32f7fe026b33f8b786490967

## CI Verification

`pnpm verify` ran green on the branch (lint, type-check, build, unit tests all pass).
No TS/JS source code was modified — only Docker Compose configuration files.

`pnpm test:db` is not required for this change: UTV2-1015 touches only
`deploy/production/docker-compose.yml` and `deploy/production/topology-spec.yml`.
No database schema, migration, or runtime pick-pipeline code was modified.

## Verification

## Compose Syntax Valid

- [ ] `docker compose config -f deploy/production/docker-compose.yml` exits 0 with no
  warnings. (Run locally or in CI with Docker Compose v2.)

## Grafana Datasource Provisioning Correct

- [ ] `configs.grafana_loki_datasource.content` is valid YAML: `apiVersion: 1`,
  `datasources[0].type: loki`, `datasources[0].url: http://loki:3100`,
  `isDefault: true`.
- [ ] Grafana service mounts the config at
  `/etc/grafana/provisioning/datasources/loki.yml` via the `configs:` directive.
- [ ] No hardcoded credentials or passwords in any provisioning config.

## LOKI_URL Injected to All Four Application Services

- [ ] `api` service has `environment: - LOKI_URL=http://loki:3100`
- [ ] `worker` service has `environment: - LOKI_URL=http://loki:3100`
- [ ] `ingestor` service has `environment: - LOKI_URL=http://loki:3100`
- [ ] `discord-bot` service has `environment: - LOKI_URL=http://loki:3100`
- [ ] `env_file: - .env.production` is still present on all four services (not removed).

## Ports Are Localhost-Only (Not Publicly Exposed)

- [ ] Loki: `"127.0.0.1:3100:3100"` (not `"3100:3100"`)
- [ ] Grafana: `"127.0.0.1:3200:3000"` (not `"3200:3000"` or `"0.0.0.0:3200:3000"`)

## Topology Spec Bumped

- [ ] `deploy/production/topology-spec.yml` `version:` is `2` (was `1`).
- [ ] `loki` and `grafana` entries present under `services:`.
- [ ] `network.members` includes `loki` and `grafana`.

## Named Volumes Declared

- [ ] `loki-data:` present in top-level `volumes:` section.
- [ ] `grafana-data:` present in top-level `volumes:` section.

## No Deploy Workflow Changes Required

- [ ] Confirm that no changes to `.github/workflows/deploy.yml` are needed — the
  `configs:` approach embeds the provisioning file inline in docker-compose.yml,
  so no additional SCP step is required.

## Observability Integration

- [ ] `packages/observability/src/index.ts` exports `createLokiLogWriter` and
  activates when `LOKI_URL` is set — no code changes required; existing
  implementation is activated by the new env var injection.

## Merge Authority

This is a T2 lane (infrastructure config, no domain logic, no DB schema changes).
Merge on green CI — orchestrator authority, no PM_VERDICT required.
