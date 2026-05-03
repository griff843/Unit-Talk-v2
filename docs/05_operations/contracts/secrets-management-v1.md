# Secrets Management Policy v1

## Overview

This policy defines production secrets handling for the Unit Talk V2 Hetzner self-hosted deployment. The MVP deployment uses one Hetzner EX44 database server and one Hetzner CCX23 application/worker server. Secrets are managed as flat files on the production servers for the initial deployment; no external secrets manager is required for v1.

The primary objective is to keep production credentials out of Git, out of logs, out of screenshots, and out of world-readable server locations while maintaining a simple operational model that can be rotated quickly during an incident.

## Secret Categories Table

| Category | Examples | Storage Location | Owner | Rotation Frequency |
| --- | --- | --- | --- | --- |
| Provider API keys | SGO key active `3cc3`, SGO key inactive `ef2c`, Odds API key | `/etc/unit-talk/secrets.env`; `UT_SGO_API_KEY` in GitHub Actions only when CI integration tests require it | Operations lead | Every 90 days, immediately on suspected exposure, and when provider access changes |
| Discord tokens | `discord-bot` token, `ops-bot` token | `/etc/unit-talk/secrets.env`; `UT_DISCORD_BOT_TOKEN` in GitHub Actions for bot deployment | Operations lead | Every 90 days, immediately on suspected exposure, and after bot permission changes |
| DB URLs and credentials | App DB URL, ingestion DB URL, service role keys, anon key | `/etc/unit-talk/secrets.env`; `UT_DATABASE_URL` and `UT_SUPABASE_SERVICE_ROLE_KEY` in GitHub Actions for migration CI | Database owner | Every 90 days for passwords and service role keys; immediately on suspected exposure |
| Deploy keys | SSH deploy key, GitHub Actions deploy key | Deploy host: `/home/deploy/.ssh/`; GitHub Actions: `UT_DEPLOY_SSH_KEY` | Infrastructure owner | Every 180 days, immediately on suspected exposure, and when deploy access changes |
| Internal service secrets | JWT secret, webhook secret | `/etc/unit-talk/secrets.env`; GitHub Actions only if a CI job requires the same integration path | Application owner | Every 90 days, immediately on suspected exposure, and after integration ownership changes |

## File Layout on Server

Production servers use the following layout:

| Path | Purpose | Production Rule |
| --- | --- | --- |
| `/etc/unit-talk/secrets.env` | Primary secrets file loaded by production systemd services | Required on production servers; never committed to Git |
| `/home/deploy/.secrets/` | Optional per-service secret directory for future service-specific split files | Optional; files must follow the same ownership and permissions model as the primary secrets file |
| Repo root `local.env` | Local development secrets only | Never present on a production server |

Server-side environment priority is explicit and service-owned: systemd units load `/etc/unit-talk/secrets.env` with `EnvironmentFile=/etc/unit-talk/secrets.env`. Production services must not rely on repo-root `local.env`, `.env`, or `.env.example` files on the server.

## Permissions Model

Production permissions must follow this model:

| Path or Principal | Required Setting |
| --- | --- |
| `/etc/unit-talk/` | Owned by `root`, group `unit-talk`, mode `750` |
| `/etc/unit-talk/secrets.env` | Owned by `root`, group `unit-talk`, mode `640` |
| `deploy` user | Member of `unit-talk` group with read access only through group permissions |
| World permissions | No world-readable, world-writable, or world-executable permissions on secrets directories or files |
| systemd unit files | Load secrets with `EnvironmentFile=/etc/unit-talk/secrets.env` |
| SSH private keys | Mode `600`, owned by the `deploy` user |
| SSH public keys | Stored only where needed, such as `/home/deploy/.ssh/authorized_keys`, with standard SSH permissions |

Services may read environment values after systemd loads them. Application code must not open `/etc/unit-talk/secrets.env` directly at runtime unless a service contract explicitly requires it.

## GitHub Actions Secrets

The following secrets must live in GitHub Actions when the corresponding CI/CD jobs are enabled:

| GitHub Actions Secret | Required For |
| --- | --- |
| `UT_DEPLOY_SSH_KEY` | CD pipeline access to the Hetzner application/worker server |
| `UT_SUPABASE_SERVICE_ROLE_KEY` | Migration runs and database administrative CI tasks |
| `UT_SGO_API_KEY` | CI integration tests that call SGO |
| `UT_DISCORD_BOT_TOKEN` | Bot deployment workflows that need to validate or deploy bot runtime configuration |
| `UT_DATABASE_URL` | Migration CI and DB smoke checks |

All GitHub Actions secret names must use the `UT_` prefix. Example: use `UT_DEPLOY_SSH_KEY`, not `DEPLOY_SSH_KEY`.

GitHub Actions secrets are not the production source of truth. The production source of truth for running services is `/etc/unit-talk/secrets.env` on the relevant Hetzner server.

## Rotation Runbook

### Provider API Keys

The operations lead initiates provider key rotation.

Steps:

1. Generate or activate the replacement key in the provider portal.
2. Update `/etc/unit-talk/secrets.env` with the replacement key on the affected server.
3. If CI uses the key, update the matching GitHub Actions secret such as `UT_SGO_API_KEY`.
4. Reload affected service units with `systemctl reload <service>` when supported; otherwise use `systemctl restart <service>`.
5. Verify the new key with the service health check and a provider request path that uses the key.
6. Revoke or deactivate the old key in the provider portal after verification passes.

Rollback:

1. Restore the previous key in `/etc/unit-talk/secrets.env` if it has not been revoked.
2. Reload or restart the affected services.
3. If the previous key was already revoked, create a new provider key and repeat verification before service traffic resumes.

### Discord Tokens

The operations lead initiates Discord token rotation.

Steps:

1. Regenerate the bot token in the Discord developer portal.
2. Update `/etc/unit-talk/secrets.env` with the new token.
3. Update `UT_DISCORD_BOT_TOKEN` in GitHub Actions if deployment workflows require it.
4. Restart the affected bot services with `systemctl restart <bot-service>`.
5. Verify bot login, slash command registration, and one non-destructive operational command.
6. Confirm the old token no longer authenticates.

Rollback:

1. Discord token regeneration invalidates the previous token, so rollback uses a newly regenerated token.
2. Generate another token, update `/etc/unit-talk/secrets.env`, restart the bot services, and verify login.

### DB Passwords and Keys

The database owner initiates database credential rotation.

Steps:

1. Generate the new database password or key in the Supabase dashboard.
2. Update `/etc/unit-talk/secrets.env` with the new app DB URL, ingestion DB URL, service role key, or anon key as applicable.
3. Update `UT_DATABASE_URL` and `UT_SUPABASE_SERVICE_ROLE_KEY` in GitHub Actions if CI uses the rotated credential.
4. Test a direct connection from the production server using the new credential.
5. Reload or restart affected services.
6. Verify application health checks, migration CI if applicable, and a read/write path that uses the credential.
7. Retire the old credential after verification passes.

Rollback:

1. If the old credential is still valid, restore it in `/etc/unit-talk/secrets.env`, update GitHub Actions if needed, and reload or restart services.
2. If the old credential has been invalidated, issue another new credential in Supabase and repeat verification.

### Deploy SSH Keys

The infrastructure owner initiates deploy SSH key rotation.

Steps:

1. Generate a new SSH keypair for deployment.
2. Add the new public key to `/home/deploy/.ssh/authorized_keys` on the Hetzner application/worker server.
3. Store the new private key in GitHub Actions as `UT_DEPLOY_SSH_KEY`.
4. Run a deployment verification workflow or a controlled SSH connectivity check from GitHub Actions.
5. Confirm the deployment path can connect and execute the expected deploy command.
6. Remove the old public key from `/home/deploy/.ssh/authorized_keys`.

Rollback:

1. If the old public key has not been removed, restore `UT_DEPLOY_SSH_KEY` to the old private key and re-run the deployment check.
2. If the old key was removed, add a new public key, update `UT_DEPLOY_SSH_KEY`, and verify deployment again.

### Internal Service Secrets

The application owner initiates internal service secret rotation.

Steps:

1. Generate a replacement JWT secret, webhook secret, or equivalent internal credential.
2. Update `/etc/unit-talk/secrets.env` on the affected server.
3. Update any GitHub Actions secret only if CI requires the same credential.
4. Reload or restart affected services.
5. Verify token issuance, token validation, webhook validation, and service health checks.
6. Retire the old secret after all active clients have moved to the new credential or after the accepted overlap window ends.

Rollback:

1. Restore the previous secret if it remains valid and was not compromised.
2. Reload or restart affected services and verify the relevant authentication or webhook path.
3. If compromise is possible, do not restore the old secret; generate a new replacement and repeat verification.

## Logging Policy

1. No secret values may appear in application logs at any log level.
2. Environment variable names may be logged, for example `SGO_API_KEY present`, but values must never be logged.
3. Health check endpoints must not return secret values, database URLs, connection strings, tokens, or key fragments.
4. Playwright and QA screenshots must not capture pages, terminal output, dashboards, or logs showing secret values.
5. Crash reports and stack traces must be scrubbed before external submission.
6. systemd journal entries from service start must not echo `EnvironmentFile` contents.
7. Services must use structured logging, and log processing must reject or redact any log line matching known secret patterns, including key-name prefixes such as `*_KEY`, `*_TOKEN`, `*_SECRET`, `DATABASE_URL`, `SUPABASE_*`, `DISCORD_*`, and `SGO_*`.

## Emergency Revocation Process

When a secret is believed compromised, execute this process immediately:

1. Identify scope: determine which secret is involved, which service uses it, where it may have been exposed, and when it was first possibly exposed.
2. Immediate action: revoke the compromised credential at the source, such as the provider portal, Discord developer portal, Supabase dashboard, GitHub, or server SSH authorized keys.
3. Within 5 minutes: update `/etc/unit-talk/secrets.env` with a new credential on the affected production server.
4. Reload or restart affected services with `systemctl reload <service>` when supported, or `systemctl restart <service>` when reload is not sufficient.
5. Scan application logs, systemd journal entries, CI logs, deploy logs, and provider access logs for evidence of use of the compromised secret.
6. Update GitHub Actions secrets if the compromised secret is also stored there.
7. Post an incident summary that includes what was exposed, blast radius, remediation steps, verification results, and timeline.
8. For database credentials, also rotate the Supabase service role key and anon key if either was in scope or may have been exposed with the compromised credential.
