# Deployment Telemetry Contract

**Status:** Ratified 2026-03-31
**Issue:** UTV2-137
**Authority:** Operational — metrics, deploy gates, staging config

---

## 1. Purpose

Add lightweight runtime metrics and deploy gates to the platform. This is the observability layer above logging (UTV2-153) — metrics tell you what's happening at a glance, logs tell you why.

## 2. Scope

Three deliverables, ordered by priority:

1. **Metrics endpoint** — `GET /metrics` on the API server
2. **Deploy gate script** — `pnpm deploy:check` pre-deployment validation
3. **Staging env config** — parameterized staging environment in `@unit-talk/config`

## 3. Metrics

### 3.1 Metrics endpoint

Add `GET /metrics` to `apps/api` that returns a JSON object (not Prometheus text format — keep it simple at T3). The endpoint is unauthenticated and responds on the existing API port.

### 3.2 Required metrics

| Metric | Type | Source |
|--------|------|--------|
| `api_requests_total` | counter | Increment on every API request |
| `api_request_duration_ms` | histogram buckets | Track p50/p95/p99 request latency |
| `api_errors_total` | counter | Increment on 4xx/5xx responses |
| `outbox_pending_count` | gauge | Current pending outbox rows |
| `outbox_dead_letter_count` | gauge | Current dead-letter outbox rows |
| `delivery_success_total` | counter | Worker delivery successes |
| `delivery_failure_total` | counter | Worker delivery failures |
| `picks_by_status` | gauge per status | Count of picks in each lifecycle state |
| `uptime_seconds` | gauge | Process uptime |

### 3.3 Implementation

Create a `MetricsCollector` class in `@unit-talk/observability`:

```typescript
interface MetricsCollector {
  increment(metric: string, labels?: Record<string, string>): void;
  gauge(metric: string, value: number, labels?: Record<string, string>): void;
  histogram(metric: string, value: number, labels?: Record<string, string>): void;
  snapshot(): MetricsSnapshot;
}
```

The collector is in-memory — no external metrics store required at T3. The `/metrics` endpoint calls `collector.snapshot()` and returns JSON.

### 3.4 Histogram buckets

For `api_request_duration_ms`: `[5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]`

The snapshot reports: count, sum, and per-bucket counts.

## 4. Deploy Gate Script

### 4.1 Script

Create `scripts/deploy-check.ts` (run via `pnpm deploy:check`):

```
1. Run pnpm verify (type-check + lint + build + test)
2. Check DB connectivity (attempt Supabase health check)
3. Check required env vars are set (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DISCORD_BOT_TOKEN)
4. Print pass/fail summary
5. Exit 0 on all pass, exit 1 on any fail
```

### 4.2 Output format

```
Deploy Gate Check — 2026-03-31T12:00:00Z
  [PASS] pnpm verify
  [PASS] Supabase connectivity
  [PASS] Required env vars
  [FAIL] Discord bot token missing

Result: FAIL (1 of 4 checks failed)
```

### 4.3 Package.json script

Add to root `package.json`:
```json
"deploy:check": "tsx scripts/deploy-check.ts"
```

## 5. Staging Environment

### 5.1 Config extension

Add `staging` as a valid `UNIT_TALK_APP_ENV` value in `@unit-talk/config`. Currently accepts `local` and `production`. Staging uses the same config structure but with different Supabase project credentials.

### 5.2 Staging env template

Create `.env.staging.example` with staging-specific values:
- Different `SUPABASE_URL` (staging project)
- Different `SUPABASE_SERVICE_ROLE_KEY`
- `UNIT_TALK_APP_ENV=staging`
- `UNIT_TALK_WORKER_DRY_RUN=true` (safety default for staging)
- `UNIT_TALK_SIMULATION_MODE=true` (safety default for staging)

### 5.3 No behavior changes

Staging environment does not change any runtime behavior — it's just a config parameterization. The safety defaults (dry-run, simulation mode) are env-var-level, not code-level.

## 6. Implementation Scope

### Allowed files

- `packages/observability/src/index.ts` — add MetricsCollector
- `packages/observability/src/index.test.ts` — metrics tests
- `apps/api/src/server.ts` — add `/metrics` route, wire metrics collector
- `scripts/deploy-check.ts` — new file
- `package.json` — add `deploy:check` script
- `packages/config/src/index.ts` — add `staging` to valid app env values (if enum exists)
- `.env.staging.example` — new file
- `.env.example` — add metrics-related comments if needed

### Forbidden files

- `packages/contracts/*`, `packages/domain/*`, `packages/db/*`
- `apps/worker/*`, `apps/operator-web/*`, `apps/discord-bot/*`
- `apps/command-center/*`, `apps/smart-form/*`

## 7. Verification

- `pnpm type-check` passes
- `pnpm test` passes
- New tests: MetricsCollector increment/gauge/histogram/snapshot
- Manual: `curl localhost:4200/metrics` returns JSON metrics snapshot

## 8. Rollback

Metrics endpoint is read-only and has no side effects. Deploy gate is a standalone script. Staging config is a new file. All are removable without impact.

## 9. Future Expansion (out of scope)

- Prometheus text format export
- Grafana dashboard for metrics (beyond logging)
- Distributed tracing (OpenTelemetry)
- Multi-environment CI/CD pipeline
- Alerting on metric thresholds (use Grafana alerting from logging for now)
