# Runtime Mode Reference

Operator reference for all runtime-mode and app-env variables that gate fail-closed behaviour.
Shipped in UTV2-915; documented here per UTV2-953.

---

## Quick Summary

| Variable | Controls | Default (non-prod) | Required in production |
|---|---|---|---|
| `UNIT_TALK_APP_ENV` | Production-like detection — triggers enforcement for all services | `local` | Must be `production` or `staging` |
| `UNIT_TALK_API_RUNTIME_MODE` | API service fail-closed gate | `fail_open` | `fail_closed` |
| `UNIT_TALK_INGESTOR_RUNTIME_MODE` | Ingestor service fail-closed gate | `fail_open` | `fail_closed` |
| `UNIT_TALK_WORKER_RUNTIME_MODE` | Worker service fail-closed gate | `fail_open` | `fail_closed` |
| `UNIT_TALK_DISCORD_BOT_RUNTIME_MODE` | Discord bot service fail-closed gate | `fail_open` | `fail_closed` |
| `UNIT_TALK_ALERT_AGENT_RUNTIME_MODE` | Alert agent service fail-closed gate | `fail_open` | `fail_closed` |
| `UNIT_TALK_OPERATOR_RUNTIME_MODE` | Cross-service operator override (command-center reads this) | unset | `fail_closed` recommended |
| `COMMAND_CENTER_AUTH_MODE` | Command Center HTTP auth gate | `fail_open` | `fail_closed` |

---

## Variable Details

### `UNIT_TALK_APP_ENV`

**Valid values:** `local` | `ci` | `staging` | `production`

**What it does:**  
Determines whether the runtime is "production-like". When `staging` or `production` (or `NODE_ENV=production`), every per-service `*_RUNTIME_MODE` var is required to be explicitly `fail_closed` or the service refuses to start with `RuntimeConfigError`.

**Fail-closed trigger:** yes — `staging` and `production` values activate the enforcement gate.

**Enforcement point:** `packages/config/src/env.ts` → `isProductionLikeRuntime()`

---

### Per-service runtime mode vars

These follow the same pattern. Each is checked by `assertProductionRuntimeConfig()` at service startup.

**Valid values:** `fail_open` | `fail_closed`

**What happens if unset in production:** service throws `RUNTIME_MODE_REQUIRED` and exits.

**What happens if set to an invalid value:** service throws `RUNTIME_MODE_INVALID` and exits.

**What `fail_closed` means per service:**

| Variable | `fail_closed` behaviour |
|---|---|
| `UNIT_TALK_API_RUNTIME_MODE` | Auth bypass disabled; all required keys must be present; DB connection required |
| `UNIT_TALK_INGESTOR_RUNTIME_MODE` | SGO key required; autorun permitted; dry-run flag must be explicit |
| `UNIT_TALK_WORKER_RUNTIME_MODE` | Worker adapter must be `discord` (not `stub`); delivery auth required |
| `UNIT_TALK_DISCORD_BOT_RUNTIME_MODE` | Bot token required; guild ID required |
| `UNIT_TALK_ALERT_AGENT_RUNTIME_MODE` | Alert agent enabled; dry-run must be explicit |

**What `fail_open` means:**  
Missing or optional keys do not cause startup failure. Service continues in degraded/local mode.

---

### `UNIT_TALK_OPERATOR_RUNTIME_MODE`

**Valid values:** `fail_open` | `fail_closed` | unset

**What it does:**  
A cross-service operator override read by the command-center auth resolution chain
(`UNIT_TALK_COMMAND_CENTER_AUTH_MODE` → `COMMAND_CENTER_AUTH_MODE` → `UNIT_TALK_OPERATOR_RUNTIME_MODE`).
Setting this to `fail_closed` enforces authenticated operator sessions in command-center when the more
specific auth vars are absent.

**Enforcement point:** `apps/command-center/src/lib/server-api.ts`

---

### `COMMAND_CENTER_AUTH_MODE`

**Valid values:** `fail_open` | `fail_closed`

**What it does:**  
Controls whether the command-center web UI requires HTTP Basic Auth. In `fail_open` mode, the
UI is publicly accessible (appropriate for local/dev). In `fail_closed`, `COMMAND_CENTER_AUTH_USERNAME`
and `COMMAND_CENTER_AUTH_PASSWORD` (or `COMMAND_CENTER_AUTH_TOKEN`) must be set or the server rejects
all requests.

**Enforcement point:** `apps/command-center/src/lib/server-api.ts`

---

## Startup Failure Modes

| Error code | Meaning | Fix |
|---|---|---|
| `RUNTIME_MODE_REQUIRED` | Service started in production-like env with no `*_RUNTIME_MODE` set | Set the var to `fail_closed` |
| `RUNTIME_MODE_INVALID` | Value is not `fail_open` or `fail_closed` | Correct the value |
| `RUNTIME_MODE_MUST_FAIL_CLOSED` | Value is `fail_open` in a production-like env | Change to `fail_closed` |
| `RUNTIME_REQUIRED_ENV_MISSING` | `fail_closed` mode active but required keys are absent | Populate the missing keys |

All errors are thrown as `RuntimeConfigError` instances (`packages/config/src/env.ts`) and logged
as `startup_config_invalid` events before the process exits.

---

## Production Checklist

Before deploying to `staging` or `production`, verify all of the following are explicitly set to `fail_closed`:

```
UNIT_TALK_APP_ENV=production           # or staging
UNIT_TALK_API_RUNTIME_MODE=fail_closed
UNIT_TALK_INGESTOR_RUNTIME_MODE=fail_closed
UNIT_TALK_WORKER_RUNTIME_MODE=fail_closed
UNIT_TALK_DISCORD_BOT_RUNTIME_MODE=fail_closed
UNIT_TALK_ALERT_AGENT_RUNTIME_MODE=fail_closed
COMMAND_CENTER_AUTH_MODE=fail_closed
```

Omitting any of these on a `staging`/`production` host will cause that service to refuse to start.

---

## Related

- Enforcement implementation: `packages/config/src/env.ts` — `assertProductionRuntimeConfig()`
- Contract: `docs/05_operations/RUNTIME_MODE_CONTRACT.md` (UTV2-147)
- Environment contract: `docs/02_architecture/contracts/environment_contract.md`
