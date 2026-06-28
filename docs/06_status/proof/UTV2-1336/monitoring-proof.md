# UTV2-1336 Monitoring Proof — Production Surface Coverage

**Timestamp:** 2026-06-27  
**Author:** Claude Code (orchestrator)  
**Branch:** codex/utv2-1336-monitoring-proof  
**Purpose:** Timestamped proof of monitoring coverage across all required production surfaces.

---

## Summary Verdict

**PARTIAL** — Core runtime surfaces (API, ingestor, worker) have active monitoring with alerting. Grading has no dedicated scheduled monitor. Infrastructure has container-level watch and Uptime Kuma. Model performance and DB health have daily/6-hour GHA monitors.

---

## Surface Coverage

### 1. API

**Status: PRESENT**

**Health endpoint** (`apps/api/src/routes/health.ts`):
- `GET /health` — rich composite check: DB connectivity probe, schema drift scan, zombie-pick count, queue health metrics
- Response includes `status` (healthy/degraded/down), `dbReachable`, `schemaDrift`, `zombiePicks`, `queueHealth`, `version`
- HTTP 503 on any degraded or down condition (fail-closed)

**Model health** (`apps/api/src/routes/model-health.ts`):
- Dedicated model-health route backed by `model-health-scanner.ts`

**Uptime Kuma monitor** (provisioned by `deploy/monitoring/provision-kuma-monitors.sh`):
- `http://api:4000/health` — 60-second polling interval
- `http://api:4000/health?full=true` — separate monitor for full health probe
- Discord notification on failure via `DISCORD_OPS_WEBHOOK_URL`

**Alert mechanism:** Uptime Kuma → Discord ops webhook; HTTP 503 on unhealthy

---

### 2. Ingestor

**Status: PRESENT**

**Container healthcheck** (`apps/ingestor/src/healthcheck.ts` + `heartbeat.ts`):
- Heartbeat file written at every cycle-phase boundary (UTV2-1284/1286)
- `healthcheck.ts` exits 1 when heartbeat is stale/missing (replaces `pgrep -f node`)
- In-process watchdog force-exits process on stale heartbeat → Docker restart

**GHA staleness alert** (`.github/workflows/ingestor-staleness-alert.yml`):
- Schedule: every 5 minutes
- Checks cycle freshness, offer freshness, and results freshness via `scripts/ingestor-alert-check.ts`
- Thresholds: cycle ≤5 min, offers ≤5 min, results ≤60 min (production cadence)
- Alert channel: `UNIT_TALK_OPS_ALERT_WEBHOOK_URL` (Discord)

**Uptime Kuma monitor**:
- "Unit Talk Ingestor Freshness" — `http://api:4000/health?full=true` at 60s interval

**Alert mechanism:** GHA cron every 5 min → Discord; container HEALTHCHECK → Docker restart

---

### 3. Worker

**Status: PRESENT**

**Heartbeat alert** (`scripts/worker-alert-check.ts`):
- Queries `system_runs` for the most recent `worker.heartbeat` row
- Default stale threshold: 120 minutes (configurable via `WORKER_ALERT_THRESHOLD_MINUTES`)
- Emits CRITICAL log + Discord alert when stale or absent
- Intended for short-cron deployment (every 5–10 minutes)

**Delivery alerting** (`apps/worker/src/delivery-alerting.ts`):
- In-process delivery failure notifications

**Queue health metrics**:
- `recordQueueHealthMetrics` from `@unit-talk/observability` tracks queue state
- Surfaced through `/health?full=true` API endpoint

**Uptime Kuma monitor**:
- "Unit Talk Worker Liveness" — `http://api:4000/health?full=true` at 60s interval

**Alert mechanism:** `worker-alert-check.ts` → Discord; observability metrics via `/health`

---

### 4. Grading

**Status: PARTIAL**

**On-demand route** (`apps/api/src/routes/grading.ts`):
- `POST /grading/run` — triggers a grading pass on demand; no response-level health check

**Grading cron** (`apps/api/src/grading-cron.test.ts`):
- Grading runs are scheduled by the API; existence confirmed by test file
- No dedicated GHA workflow or external alert for grading staleness

**Pipeline health monitor** (`.github/workflows/pipeline-health-monitor.yml`):
- Daily at 10:00 UTC — checks `outbox_dead_letter_count` and `criticals` from `scripts/pipeline-health.ts`
- Outbox dead-letters include governance-brake-blocked picks; surfaces grading-adjacent failures
- Creates a Linear issue on anomaly detection

**Gap:** No dedicated grading heartbeat or staleness alert. If the grading cron stops advancing, the gap is only visible via the downstream pick-flow (zombie picks or settlement absence). See Gaps section.

---

### 5. Readiness / Pipeline Health

**Status: PRESENT**

**Pipeline Health Monitor** (`.github/workflows/pipeline-health-monitor.yml`):
- Schedule: daily 10:00 UTC
- Checks: outbox dead-letter count, criticals array from `scripts/pipeline-health.ts`
- On anomaly: creates Linear issue via GraphQL API (deduplicates open issues)
- Artifacts: `pipeline-health.json` retained 7 days

**DB Health Tripwire** (`.github/workflows/db-health-tripwire.yml`):
- Schedule: every 6 hours
- Checks: table sizes (`system_runs`, `raw_payloads`, `odds_snapshots`, `provider_offer_history`, `game_results`), autovacuum staleness, statement timeout rate, TOAST bloat ratio
- Configurable thresholds via env vars

**Model Performance Monitor** (`.github/workflows/model-performance-monitor.yml`):
- Schedule: daily 06:07 UTC
- Computes observable model edge tier + ROI thresholds from `scripts/roi-by-sport.ts`
- Discord alert on tier change or ROI crossing warning boundary
- Appends to `docs/06_status/model-performance-log.md`

**Track A Monitor** (`.github/workflows/track-a-monitor.yml`):
- Schedule: every 6 hours at :23
- Read-only CLV-path watch (UTV2-1276)
- Posts Linear comment only on trigger

**Burn-in Monitor** (`.github/workflows/ops-burn-in-monitor.yml`):
- Schedule: every 6 hours
- Collects snapshots; aggregates into a final burn-in verdict on demand
- Discord alert with PASS/FAIL verdict

---

### 6. Infrastructure

**Status: PRESENT**

**Uptime Kuma** (deployed via `deploy-monitoring.yml`):
- 5 provisioned monitors: API health, host ping (46.225.14.123), worker liveness, ingestor freshness, Discord bot
- Notification: Discord ops webhook
- Access via SSH tunnel on port 3001

**Container health watch** (`deploy/monitoring/container-health-watch.sh`):
- Cron: every 2 minutes on Hetzner host
- Monitors: `unit-talk-api-1`, `unit-talk-worker-1`, `unit-talk-ingestor-1`, `unit-talk-discord-bot-1`, `uptime-kuma`
- Docker health status checked (not just container running state)
- 10-minute cooldown per container to prevent alert spam
- Alert: Discord via `DISCORD_OPS_WEBHOOK_URL`

**Disk alert** (`deploy/monitoring/disk-alert.sh`):
- Cron: every hour at :05
- Disk growth alerting

---

## Gaps (Non-Blocking Observations)

1. **Grading staleness alert absent** — No dedicated GHA cron or heartbeat monitors grading-pass advancement. If the API grading cron stalls, detection relies on downstream zombie-pick counts surfaced by `/health`. A grading-heartbeat row in `system_runs` + a companion alert check (analogous to `worker-alert-check.ts`) would close this gap.

2. **Worker alert-check not wired to GHA cron** — `scripts/worker-alert-check.ts` exists and is correct but no GHA workflow schedules it (unlike the ingestor's `ingestor-staleness-alert.yml`). It is likely run server-side; a GHA cron mirror would add redundancy.

3. **Uptime Kuma monitors proxy via `/health?full=true`** — Ingestor and worker freshness are both inferred through the API's composite `/health?full=true` response. A direct ingestor heartbeat file HTTP export (or separate port) would provide an independent signal path.

4. **Discord bot monitoring is container-liveness only** — The `discord-bot` container is health-watched but there is no functional message-delivery probe or channel-post verification.

---

## Evidence Files Referenced

| File | Purpose |
|------|---------|
| `apps/api/src/routes/health.ts` | API health composite check |
| `apps/ingestor/src/healthcheck.ts` | Container healthcheck entry |
| `apps/ingestor/src/heartbeat.ts` | Heartbeat file protocol |
| `scripts/ingestor-alert-check.ts` | Ingestor staleness thresholds + Discord alert |
| `scripts/worker-alert-check.ts` | Worker heartbeat alert |
| `scripts/pipeline-health.ts` | Pipeline health report (outbox, queue SLO) |
| `.github/workflows/ingestor-staleness-alert.yml` | Every-5-min ingestor freshness check |
| `.github/workflows/pipeline-health-monitor.yml` | Daily pipeline health + Linear issue creation |
| `.github/workflows/db-health-tripwire.yml` | Every-6-hour DB size + vacuum checks |
| `.github/workflows/model-performance-monitor.yml` | Daily ROI + tier alert |
| `.github/workflows/deploy-monitoring.yml` | Uptime Kuma provisioning |
| `deploy/monitoring/container-health-watch.sh` | Every-2-min container liveness cron |
| `deploy/monitoring/provision-kuma-monitors.sh` | Uptime Kuma monitor provisioning |
