# Secrets Inventory

Last updated: 2026-04-20
Issue: UTV2-612

## Classification

All environment variables are classified as either **Secret** (sensitive, must be managed) or **Config** (non-sensitive, can live in code/config files).

### Secrets (must NOT be in code, require managed storage)

| Variable | Used By | Category | Rotation Policy |
|----------|---------|----------|-----------------|
| `SUPABASE_URL` | All apps | Database | Stable (changes on project migration only) |
| `SUPABASE_SERVICE_ROLE_KEY` | API, worker, ingestor, ops scripts | Database | Rotate on compromise; full-access key |
| `SUPABASE_ANON_KEY` | Smart Form, command center | Database | Rotate on compromise; limited-access key |
| `SUPABASE_ACCESS_TOKEN` | CI, MCP, ops scripts | Database | Rotate quarterly; management API access |
| `DISCORD_BOT_TOKEN` | Discord bot, worker (delivery) | External API | Rotate on compromise |
| `DISCORD_CLIENT_ID` | Discord bot | External API | Stable (app ID) |
| `SGO_API_KEY` | Ingestor | External API | Rotate on provider request |
| `SGO_API_KEY_FALLBACK` | Ingestor | External API | Rotate with primary |
| `ODDS_API_KEY` | Ingestor | External API | Rotate on provider request |
| `OPENAI_API_KEY` | Alert agent, intelligence | External API | Rotate quarterly |
| `LINEAR_API_TOKEN` | Ops scripts, CI workflows | External API | Rotate quarterly |
| `FIBERY_API_TOKEN` | Ops scripts, CI workflows | External API | Rotate quarterly |
| `NOTION_API_KEY` | Legacy integration | External API | Rotate quarterly |
| `UNIT_TALK_JWT_SECRET` | API (auth) | Auth | Rotate on compromise; signs bearer tokens |
| `UNIT_TALK_API_KEY_OPERATOR` | API | Auth | Rotate quarterly |
| `UNIT_TALK_API_KEY_POSTER` | API | Auth | Rotate quarterly |
| `UNIT_TALK_API_KEY_SETTLER` | API | Auth | Rotate quarterly |
| `UNIT_TALK_API_KEY_SUBMITTER` | API | Auth | Rotate quarterly |
| `UNIT_TALK_API_KEY_WORKER` | API, worker | Auth | Rotate quarterly |
| `UNIT_TALK_OPS_ALERT_WEBHOOK_URL` | Ops digest, stale alerter | Webhook | Rotate on compromise |
| `FIBERY_UPDATE_WEBHOOK_TOKEN` | Fibery sync | Webhook | Rotate on compromise |
| `FIBERY_UPDATE_WEBHOOK_URL` | Fibery sync | Webhook | Stable |

**Total secrets: 22**

### Config (non-sensitive, can be in code/env files)

| Category | Count | Examples |
|----------|-------|---------|
| Alert thresholds | 16 | `ALERT_THRESHOLD_ML_*`, `ALERT_VELOCITY_WINDOW_*` |
| Worker tuning | 12 | `UNIT_TALK_WORKER_POLL_MS`, `CIRCUIT_BREAKER_*` |
| Ingestor config | 6 | `UNIT_TALK_INGESTOR_LEAGUES`, `POLL_MS` |
| Feature flags | 6 | `SYNDICATE_MACHINE_ENABLED`, `SYSTEM_PICKS_ENABLED` |
| Discord IDs | 7 | `DISCORD_GUILD_ID`, `DISCORD_*_CHANNEL_ID`, `DISCORD_*_ROLE_ID` |
| App config | 10 | `NODE_ENV`, `COMMAND_CENTER_PORT`, `SCORING_PROFILE` |
| Routing | 3 | `DISTRIBUTION_TARGETS`, `DISCORD_TARGET_MAP` |
| Other | 5 | `TRIAL_DURATION_DAYS`, `RECAP_DRY_RUN`, workspace names |

**Total config: ~65**

## Production Secret Management Strategy

### Current state (local.env)

All secrets live in `local.env` on the developer machine. `@unit-talk/config` loads them via three-layer merge: `.env.example` → `.env` → `local.env`. Process env overrides all.

### Target state (managed secrets)

For production hosting, secrets should be injected via environment variables from a managed source:

1. **Cloud hosting (recommended):** Use the hosting provider's secret management (e.g., Railway secrets, Render env groups, Fly.io secrets, AWS SSM/Secrets Manager)
2. **CI/CD:** GitHub Actions secrets (already in use for `LINEAR_API_TOKEN`, `DISCORD_BOT_TOKEN`, etc.)
3. **Local development:** `local.env` continues to work unchanged

### Migration path

1. **No code changes needed.** `@unit-talk/config` already reads `process.env` with highest priority. Any secret injected as an environment variable by the hosting platform overrides local files.
2. **Hosting setup:** Configure 22 secrets in the hosting provider's secret store
3. **Validation:** `pnpm env:check` (`scripts/validate-env.mjs`) validates required variables at startup
4. **Remove local.env from production:** Production runtime should NOT have `local.env` — secrets come from managed injection only

### What stays the same

- `@unit-talk/config` loadEnvironment() works identically — it already supports process.env override
- `.env.example` remains the canonical list of all variables (with empty/default values)
- `pnpm env:check` validates at startup — fail-closed if critical secrets missing
- Local development uses `local.env` as before

## Rotation Procedures

### Emergency rotation (compromise)

1. Rotate the compromised secret in the provider (Discord, Supabase, etc.)
2. Update the secret in the hosting provider's secret store
3. Restart affected services
4. Verify via health check endpoints
5. Record rotation in audit log

### Scheduled rotation (quarterly)

1. Generate new key/token from the provider
2. Update in hosting secret store
3. Restart services during low-traffic window
4. Verify via health checks
5. Deactivate old key after 24h verification period

## Ownership

| Secret Category | Owner |
|----------------|-------|
| Database (Supabase) | PM / Infrastructure |
| External APIs (SGO, Odds, OpenAI) | PM |
| Auth (JWT, API keys) | PM / Infrastructure |
| Discord | PM |
| CI/CD (Linear, Fibery, GitHub) | PM / Orchestrator |
| Webhooks | PM |
