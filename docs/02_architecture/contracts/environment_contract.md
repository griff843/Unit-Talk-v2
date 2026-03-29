# Environment Contract

## Metadata

| Field | Value |
|---|---|
| Owner | Platform |
| Status | Ratified |
| Ratified | 2026-02-01 |
| Last Updated | 2026-03-29 — depth pass UTV2-160 |

---

## Purpose

This contract defines how environment variables are loaded, what the three environments are, which variables are required vs optional, and how each service behaves when variables are absent.

---

## Environments

| Environment | Description |
|---|---|
| `local` | Developer workstation. Uses `local.env` and/or `.env`. No production credentials required. |
| `staging` | Not currently provisioned in V2. Reserved for future use. |
| `production` | Deployed services against the live Supabase project (`feownrheeefbcsehtsiw`) and live Discord guild. |

---

## Load Order

All services load env through `@unit-talk/config`, which parses env files directly (no `dotenv` package):

```
local.env  →  .env  →  .env.example
```

- First file that defines a variable wins. Later files do not override earlier ones.
- `local.env` — gitignored; machine-local secrets and developer overrides
- `.env` — gitignored; optional local convenience config
- `.env.example` — committed; canonical template; defines all valid variables with safe defaults or blank values

**Rule:** `.env.example` is the authoritative variable registry. Every new env var introduced anywhere in the codebase must be added to `.env.example` with a comment before the code is merged.

---

## Variable Registry

### Required for live DB (production + DB tests)

| Variable | Purpose | Default |
|---|---|---|
| `SUPABASE_URL` | Supabase REST/realtime endpoint | — |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key; full DB access | — |

If either is absent, all services fall back to `InMemory*` repositories (no DB writes occur). This is the expected local-dev default.

### Required for Discord delivery

| Variable | Purpose | Default |
|---|---|---|
| `DISCORD_BOT_TOKEN` | Bot authentication token | — |
| `DISCORD_GUILD_ID` | Guild to deploy slash commands to | `1284478946171293736` |
| `DISCORD_CLIENT_ID` | App client ID for command deployment | — |
| `UNIT_TALK_DISCORD_TARGET_MAP` | JSON map of `target → channelId` | — |

If `DISCORD_BOT_TOKEN` is absent, Discord delivery is disabled. Worker and recap agent no-op their delivery paths. This is fail-safe behavior, not an error.

### Worker and delivery control

| Variable | Purpose | Default |
|---|---|---|
| `UNIT_TALK_WORKER_AUTORUN` | Enables worker auto-start on process boot | `false` |
| `UNIT_TALK_WORKER_POLL_INTERVAL_MS` | Outbox poll interval | `5000` |
| `UNIT_TALK_WORKER_CIRCUIT_BREAKER_THRESHOLD` | Consecutive failures before circuit opens | `5` |
| `UNIT_TALK_WORKER_CIRCUIT_BREAKER_COOLDOWN_MS` | Circuit open duration | `300000` |
| `ALERT_DRY_RUN` | Disables Discord delivery in alert agent | `true` |
| `RECAP_DRY_RUN` | Disables Discord delivery in recap agent | `true` |

### Runtime mode and feature flags

| Variable | Purpose | Default |
|---|---|---|
| `UNIT_TALK_RUNTIME_MODE` | `fail-closed` blocks all writes if Supabase absent; `in-memory` permits in-memory operation | `in-memory` |
| `UNIT_TALK_ENABLED_TARGETS` | Comma-separated list of enabled delivery targets | `discord:canary,discord:best-bets,discord:trader-insights` |
| `UNIT_TALK_SCORING_PROFILE` | Named scoring profile (`default` or `conservative`) | `default` |

### API safety limits

| Variable | Purpose | Default |
|---|---|---|
| `API_MAX_BODY_BYTES` | Max request body size for `POST /api/submissions` | `65536` (64 KB) |
| `API_RATE_LIMIT_RPM` | Max submission requests per minute per IP | `10` |

---

## Fail-Closed Runtime Mode

When `UNIT_TALK_RUNTIME_MODE=fail-closed`:

- API startup exits with non-zero if `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is absent.
- Operator-web startup exits with non-zero if `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is absent.
- This is the required mode for production deployments.

When `UNIT_TALK_RUNTIME_MODE=in-memory` (default):

- Missing Supabase credentials silently fall back to `InMemory*` repositories.
- This is the expected mode for local dev and unit tests.
- **Never use `in-memory` mode in production.**

Enforcement surface: `apps/api/src/server.ts` and `apps/operator-web/src/server.ts` check `UNIT_TALK_RUNTIME_MODE` at startup.

---

## Local Bootstrap Without Production Credentials

A developer must be able to run `pnpm test` and `pnpm build` with no credentials in any environment file. The test suite uses `InMemory*` repositories exclusively — no live DB connection is required.

To run with live DB:
- Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to `local.env`
- Run `pnpm test:db` (separate gate, not part of default `pnpm test`)

**Production credentials must never be required for local bootstrap.** If any test in `pnpm test` (not `pnpm test:db`) requires live credentials, that is a contract violation.

---

## Integration Ownership

Before any new integration can be added that depends on an env variable:

1. The variable must be added to `.env.example` with a clear comment
2. The service that owns the integration must handle graceful degradation if the variable is absent
3. If the integration is live-only (e.g., Discord, Supabase), it must use the dry-run or in-memory fallback pattern so `pnpm test` continues to pass without credentials

---

## Exception Rules

1. **CI environments** — CI uses environment secrets injected at the pipeline level; `.env` files are not committed to CI. CI must pass `pnpm test` without any `SUPABASE_*` or `DISCORD_*` variables.
2. **`pnpm test:db`** — explicitly requires live credentials; intended for DB smoke testing only.
3. **`pnpm env:check`** — validates that all required variables are present for a production-mode startup. Known to fail if `SUPABASE_SERVICE_ROLE_KEY` is present in `.env` without `UNIT_TALK_RUNTIME_MODE=fail-closed`. This is a known pre-existing behavior, not a contract violation.

---

## Audit and Verification

To verify environment contract compliance:

1. Run `pnpm test` with empty `local.env` — must pass with zero credential env vars.
2. Confirm `.env.example` lists every variable referenced in any service source file.
3. Confirm `local.env` and `.env` are in `.gitignore`.
4. Confirm no service uses `process.env` directly outside `@unit-talk/config` (grep for `process.env.` outside `packages/config/`).
5. In production: `UNIT_TALK_RUNTIME_MODE=fail-closed` must be set. Verify startup exits if Supabase credentials are absent.
