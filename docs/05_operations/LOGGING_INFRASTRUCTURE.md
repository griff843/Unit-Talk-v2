# Logging Infrastructure Contract

**Status:** Ratified 2026-03-31
**Issue:** UTV2-153
**Authority:** Operational — centralized logging infrastructure
**Vendor:** Loki + Grafana (self-hosted)

---

## 1. Purpose

Ship all service logs to a centralized Loki instance for cross-service incident diagnosis. Replace per-process SSH + grep with a single Grafana query UI.

## 2. Architecture

```
apps/api          ─┐
apps/worker        ├─ structured JSON (stdout) ─→ Loki HTTP push API ─→ Grafana UI
apps/discord-bot   │
apps/ingestor     ─┘
apps/alert-agent  ─┘
```

### Integration point

The existing `LogWriter` interface in `@unit-talk/observability` is the hook. Each service creates a logger with `createLogger({ service, writer })`. The new Loki writer pushes log entries to Loki's `/loki/api/v1/push` endpoint.

### Writer strategy

Use a **dual writer** — logs go to both console (for local dev / process stdout) and Loki (for centralized aggregation). In dev mode (no Loki URL configured), only console writer is active.

```typescript
const writer = createDualLogWriter(
  createConsoleLogWriter(),
  createLokiLogWriter({ url: process.env.LOKI_URL }),
);
```

## 3. Loki Log Writer

### Configuration

| Env var | Required | Default | Description |
|---------|----------|---------|-------------|
| `LOKI_URL` | No | — | Loki push URL (e.g., `http://localhost:3100`). If absent, Loki writer is disabled. |
| `LOKI_BATCH_SIZE` | No | `10` | Number of entries to batch before pushing |
| `LOKI_FLUSH_INTERVAL_MS` | No | `5000` | Max time between pushes (ms) |
| `LOKI_TENANT_ID` | No | — | X-Scope-OrgID header for multi-tenant Loki |

### Push format

Loki expects the Protobuf or JSON push format at `/loki/api/v1/push`:

```json
{
  "streams": [
    {
      "stream": {
        "service": "api",
        "level": "error",
        "env": "production"
      },
      "values": [
        ["<unix_nano_timestamp>", "<json_log_line>"]
      ]
    }
  ]
}
```

### Label strategy

Loki labels (indexed, low cardinality):
- `service` — api, worker, discord-bot, ingestor, alert-agent
- `level` — debug, info, warn, error
- `env` — production, staging, development

Everything else (correlationId, pickId, requestId, etc.) stays in the log line as structured JSON — queryable via Loki's LogQL parser.

### Batching

The writer buffers entries in memory and flushes on:
- Buffer reaches `LOKI_BATCH_SIZE` entries, OR
- `LOKI_FLUSH_INTERVAL_MS` elapsed since last flush

On process shutdown (SIGTERM/SIGINT), flush remaining buffer before exit.

### Failure handling

If Loki push fails:
- Log the failure to console (do not recurse)
- Drop the batch (logs are best-effort, not transactional)
- Do **not** retry — avoid backpressure on the application
- Do **not** block the application process

## 4. Querying

### Required queries (verify in Grafana)

| Query | LogQL |
|-------|-------|
| All errors in last hour | `{level="error"} \| json` |
| Pick journey by ID | `{} \| json \| pickId="<id>"` |
| Request trace by correlation ID | `{} \| json \| correlationId="<id>"` |
| Service-specific logs | `{service="worker"} \| json` |
| Error rate by service | `sum(rate({level="error"}[5m])) by (service)` |

### Alert rules

| Alert | Condition | Notification |
|-------|-----------|-------------|
| Error spike | `sum(rate({level="error"}[5m])) > 0.5` (>0.5 errors/sec sustained) | Discord webhook to operator channel |
| Service silent | No logs from a service for > 10 minutes | Discord webhook |

Alert rules are configured in Grafana, not in application code.

## 5. Retention

| Policy | Value |
|--------|-------|
| Minimum retention | 30 days |
| Recommended retention | 90 days |
| Storage | Loki default (filesystem or S3) |

Configure in `loki-config.yaml`:
```yaml
limits_config:
  retention_period: 720h  # 30 days
```

## 6. Deployment

### Docker Compose (development)

Add to the repo's `docker-compose.yml` (or create `docker-compose.logging.yml`):

```yaml
services:
  loki:
    image: grafana/loki:3.0.0
    ports:
      - "3100:3100"
    volumes:
      - loki-data:/loki
    command: -config.file=/etc/loki/local-config.yaml

  grafana:
    image: grafana/grafana:11.0.0
    ports:
      - "3200:3000"
    environment:
      - GF_AUTH_ANONYMOUS_ENABLED=true
      - GF_AUTH_ANONYMOUS_ORG_ROLE=Admin
    volumes:
      - grafana-data:/var/lib/grafana

volumes:
  loki-data:
  grafana-data:
```

### Production

Loki + Grafana deployed on the same host or a dedicated monitoring host. Connection via `LOKI_URL` env var pointed at the production Loki instance.

## 7. Implementation Scope

### Allowed files

- `packages/observability/src/index.ts` — add `createLokiLogWriter()` and `createDualLogWriter()`
- `packages/observability/src/index.test.ts` — tests for Loki writer (mock HTTP, batching, flush)
- `apps/api/src/server.ts` — wire dual writer if `LOKI_URL` is set
- `apps/worker/src/index.ts` — wire dual writer
- `apps/ingestor/src/index.ts` — wire dual writer
- `apps/alert-agent/src/alert-agent.ts` — wire dual writer (if it uses createLogger)
- `docker-compose.logging.yml` — Loki + Grafana compose file
- `.env.example` — add `LOKI_URL` variable

### Forbidden files

- `packages/contracts/*`, `packages/domain/*`, `packages/db/*`
- `apps/command-center/*`, `apps/smart-form/*`, `apps/operator-web/*`

## 8. Verification

- `pnpm type-check` passes
- `pnpm test` passes
- New tests: Loki writer batches entries, flushes on threshold, handles push failure gracefully
- Manual: start Loki via docker-compose, run API, verify logs appear in Grafana

## 9. Rollback

Remove `LOKI_URL` from env. All services revert to console-only logging. No application behavior change.
