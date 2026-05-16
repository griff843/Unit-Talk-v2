# Production Secrets Rotation Procedure

Rotation is performed by updating GitHub Actions secrets (not by editing files on the server over SSH).

## Secret Groups

| Group | Secrets | Rotation trigger |
|-------|---------|-----------------|
| database | SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY | Key revocation or quarterly |
| discord | DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID | Bot compromise or Discord dev portal refresh |
| api_auth | UNIT_TALK_BOT_API_KEY, UNIT_TALK_INGESTOR_API_KEY | Suspected leak or quarterly |
| deploy_infra | UNIT_TALK_DEPLOY_HOST, UNIT_TALK_DEPLOY_USER, UNIT_TALK_DEPLOY_PATH, UNIT_TALK_DEPLOY_SSH_KEY, UNIT_TALK_DEPLOY_HEALTH_URL | Server change or key compromise |
| data_providers | SGO_API_KEY, ODDS_API_KEY | Provider key revocation |
| staging | UNIT_TALK_STAGING_DEPLOY_* | Same as deploy_infra |

## Rotation Steps

### 1. Pre-rotation: confirm existing deployment is healthy

```bash
curl -fsS "$DEPLOY_HEALTH_URL"
```

If health check fails, do not rotate until the system is healthy — rotation introduces a brief unavailable window.

### 2. Generate and stage the new credential

Get the new secret value from the provider (Supabase dashboard, Discord dev portal, etc.). Do not write it to any file.

### 3. Update the GitHub Actions secret

```
GitHub → Settings → Secrets and variables → Actions → [select secret] → Update
```

Paste the new value. GitHub encrypts it at rest; it is never visible after save.

### 4. Verify the new secret is valid before triggering a re-deploy

For Supabase keys: use the Supabase dashboard or `psql` to confirm connectivity with the new key.
For Discord tokens: use the Discord API to confirm the bot is authenticated.
For API keys (SGO, Odds): make a single test request to confirm the key is active.

### 5. Trigger a deploy to apply the new secret

```bash
gh workflow run deploy.yml
```

The deploy workflow's `Validate production secret inventory` step will fail closed if any required secret is absent. If it passes, the build and deployment proceed.

### 6. Post-rotation health check

After the deploy completes:

```bash
curl -fsS "$DEPLOY_HEALTH_URL"
```

If this fails, use the `rollback_tag` input on the deploy workflow to restore the previous release:

```bash
gh workflow run deploy.yml -f rollback_tag=<previous-image-tag>
```

The previous image tag is stored in `.unit-talk-release.previous` on the deploy host.

## Rules

- Never write secret values to disk on the deploy host or in the repo
- Never edit `.env.production` on the server as the primary rotation workflow — always go through GitHub Actions
- A secret with an empty or placeholder value causes `Validate production secret inventory` to fail before any build begins
- Missing secrets cause services to fail closed at startup via `assertProductionRuntimeConfig`
