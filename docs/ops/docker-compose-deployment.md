# Docker Compose Deployment Procedure

## 1. Image Pinning Policy

Production deployments must use digest-pinned or semver-pinned container images only.

- Do not use `latest` for production release promotion.
- Prefer immutable digest references when the registry and deploy tooling support them.
- When a semver tag is used, set it explicitly through environment variables before deployment.
- Use the image tag pattern `${SERVICE_IMAGE_TAG:-vX.Y.Z}` so each service has a clear default and can be overridden without editing compose files.

Examples:

```bash
export API_IMAGE_TAG=v2.14.0
export WORKER_IMAGE_TAG=v2.14.0
export INGESTOR_IMAGE_TAG=v2.14.0
export DISCORD_BOT_IMAGE_TAG=v2.14.0
export SCANNER_IMAGE_TAG=v2.14.0
export COMMAND_CENTER_IMAGE_TAG=v2.14.0
```

## 2. Service Layout Table

| service        | image                                                          | exposed ports                                     | healthcheck endpoint                                                   | restart policy |
| -------------- | -------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------- | -------------- |
| api            | `unit-talk/api:${API_IMAGE_TAG:-vX.Y.Z}`                       | `4001:4000` for load balancer ingress             | `/health` on port `4000` inside the container                          | `always`       |
| worker         | `unit-talk/worker:${WORKER_IMAGE_TAG:-vX.Y.Z}`                 | none                                              | process heartbeat through compose/container status                     | `always`       |
| ingestor       | `unit-talk/ingestor:${INGESTOR_IMAGE_TAG:-vX.Y.Z}`             | none                                              | process heartbeat through compose/container status                     | `always`       |
| discord-bot    | `unit-talk/discord-bot:${DISCORD_BOT_IMAGE_TAG:-vX.Y.Z}`       | none                                              | process heartbeat through compose/container status                     | `always`       |
| scanner        | `unit-talk/scanner:${SCANNER_IMAGE_TAG:-vX.Y.Z}`               | none by default                                   | `/health` when an HTTP scanner is enabled, otherwise process heartbeat | `always`       |
| command-center | `unit-talk/command-center:${COMMAND_CENTER_IMAGE_TAG:-vX.Y.Z}` | `3000:3000` only when routed by the load balancer | `/health` on port `3000` when enabled                                  | `always`       |

## 3. systemd Unit Setup

Wire Docker Compose to systemd so the production stack starts automatically on boot and is stopped cleanly during host shutdown.

Create `/etc/systemd/system/unit-talk-v2.service`:

```ini
[Unit]
Description=Unit Talk V2 Docker Compose stack
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/opt/unit-talk-v2
EnvironmentFile=/opt/unit-talk-v2/.env.container
RemainAfterExit=yes
ExecStart=/usr/bin/docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
ExecStop=/usr/bin/docker compose -f docker-compose.yml -f docker-compose.prod.yml down
TimeoutStartSec=180
TimeoutStopSec=120

[Install]
WantedBy=multi-user.target
```

Enable and start the unit:

```bash
sudo systemctl daemon-reload
sudo systemctl enable unit-talk-v2.service
sudo systemctl start unit-talk-v2.service
sudo systemctl status unit-talk-v2.service
```

## 4. Deployment Command Sequence

Run production deploys from the repository root on the deployment host.

1. Pull the intended release branch or commit.
2. Export semver or digest-pinned image tags for every service being deployed.
3. Run the preflight check:

   ```bash
   node scripts/deploy-check.ts
   ```

4. Trigger and confirm a pre-deploy backup. If `BACKUP_HOOK` is configured, call it before pulling images.
5. Pull images:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
   ```

6. If the deploy includes a migration and the deployment was invoked with `--migrate`, run the migration command after backup confirmation and before service replacement.
7. Start or update services:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
   ```

8. Poll health for up to 60 seconds. Require the API `/health` endpoint and all process-based services to report running or healthy.
9. Append a deployment event to `deploy.log` with timestamp, operator, git SHA, services deployed, and outcome.

## 5. Healthcheck Endpoints

| service           | healthcheck                                                               |
| ----------------- | ------------------------------------------------------------------------- |
| api               | HTTP `GET /health`                                                        |
| worker            | process heartbeat through compose/container status                        |
| ingestor          | process heartbeat through compose/container status                        |
| scanner           | HTTP `GET /health` when HTTP mode is enabled; otherwise process heartbeat |
| discord-bot       | process heartbeat through compose/container status                        |
| Redis/Valkey      | `PING`                                                                    |
| monitoring agents | process heartbeat through systemd, compose, or the agent supervisor       |

## 6. Preflight Checklist

Complete these steps before any migration-bearing deploy:

- Confirm a pre-deploy backup exists and is restorable.
- Review all migrations included in the target commit range.
- Document the rollback plan, including whether database rollback is reversible or requires backup restore.
- Run `node scripts/deploy-check.ts` and require it to pass.
- Confirm every image tag is semver-pinned or digest-pinned.
- Confirm no blocked Discord target is enabled as part of the deploy.

## 7. Migration Ordering Rules

Apply backward-compatible migrations first. Additive migrations are safe to pair with a service deploy when the old and new code can both run against the changed schema.

Allowed additive examples:

- Add nullable columns.
- Add tables.
- Add indexes that do not block writes for the deployment window.
- Add new enum values only when existing readers tolerate them.

Destructive schema changes must be deployed in a separate phase after traffic cutover and verification. Destructive changes include drops, renames, type changes, constraint tightening, and data rewrites that old code cannot tolerate. Never mix additive and destructive phases in the same deploy.

## 8. Rollback Procedure

Service rollback uses the previous known-good image tag for one service at a time:

```bash
export API_IMAGE_TAG=v2.13.4
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps api
```

Use the matching service tag variable for non-API services, then replace `<service>` with the service name:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps <service>
```

Migration rollback is allowed only when the migration is reversible through a reviewed down script. If the migration is not safely reversible, restore from the pre-deploy backup and redeploy the previous compatible service image set.

## 9. Audit and Logging Expectations

Use `docker logs` and the systemd journal for local investigation:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail=200 api
journalctl -u unit-talk-v2.service -n 200 --no-pager
```

Production compose services must use the `json-file` logging driver with `max-size: 10m` and `max-file: 3`. Configure a centralized log drain target such as Loki or CloudWatch for durable retention and cross-service search.

Every deployment event must be written to `deploy.log` with:

- ISO timestamp
- operator
- git SHA
- services deployed
- outcome
