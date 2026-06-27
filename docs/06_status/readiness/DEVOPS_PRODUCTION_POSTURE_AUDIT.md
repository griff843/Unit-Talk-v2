# DevOps Production Posture Audit

**Issue:** UTV2-1323
**Tier:** T2
**Audited:** 2026-06-27
**Verdict:** PARTIAL

---

## Audit Scope

Evaluate the production DevOps posture of Unit Talk V2: deploy workflow, rollback, CI gates, secrets handling, Hetzner container runtime, health checks, monitoring/alerting, and operational documentation. Includes known incidents through 2026-06-25.

---

## Summary Scorecard

| Dimension | Status | Notes |
|---|---|---|
| Deploy pipeline | PASS | canary → promote → smoke; env-rewrite risk documented |
| Rollback | PARTIAL | script + drill workflow exist; no rehearsed RTO target |
| CI gates | PASS | 10+ merge gates enforced on every PR |
| Secrets management | PASS | GH Secrets + inventory check at deploy entry |
| Container runtime | PASS | `restart: unless-stopped` + healthcheck on all services |
| Health checks | PARTIAL | ingestor healthcheck fixed (UTV2-1286); API health is binary; no deep check |
| Monitoring / alerting | PARTIAL | Uptime Kuma provisioned; Grafana/Loki in compose; no documented alert runbook |
| Incident discovery | PARTIAL | All incidents detected reactively (ops:brief); no proactive pager |
| Operational documentation | PARTIAL | ops:brief/digest exist; no formal runbook; no RTO/RPO declared |
| SGO key rotation | PASS | `SGO_API_KEY_FALLBACK` secret wired; rotate-key workflow present |

**Overall: PARTIAL** — deploy mechanics are solid and all services restart automatically, but monitoring is reactive, no formal RTO/RPO, and the env-rewrite pattern creates silent-wipe risk on manual env additions.

---

## 1. Deploy Pipeline

**Status: PASS**

### Pipeline shape (deploy.yml)

```
workflow_dispatch
  → verify (secret inventory + pnpm verify:static + deploy-check.ts)
  → rollback-dry-run (validates rollback.sh with supplied tag)
  → build (docker matrix: api / worker / ingestor / discord-bot → GHCR)
  → canary (API-only deploy + 300s health poll)
  → promote (all containers up; 300s health poll)
  → smoke (post-deploy HTTP /health assertion via SSH)
```

Progressive delivery: API canary lands and health-checks before full fleet promotion. Smoke gate runs post-promote and fails the job on non-200.

### Concurrency guard

```yaml
concurrency:
  group: production-deploy
  cancel-in-progress: false
```

Concurrent deploys queue rather than cancel — safe.

### env-rewrite risk (KNOWN DEBT)

Both `canary` and `promote` jobs overwrite `.env.production` on the server via `printf '%s\n' ... | ssh ... 'cat > .env.production'`. Any variable added manually to the server file **is silently wiped** on the next deploy. Pattern is documented; all persistent vars must live in GH Secrets + the workflow's printf block. See memory: `project-deploy-env-rewrite`.

### deploy-check.ts

`scripts/deploy-check.ts --skip-verify` runs a progressive delivery contract check before build. Validates image tag resolution, compose shape, and required env vars. `--skip-verify` skips the live-db portion; build-time static check only.

---

## 2. Rollback

**Status: PARTIAL**

### Mechanisms present

- `deploy/rollback.sh` — parameterized by `--tag`, `--host`, `--user`, `--path`, `--dry-run`. Wraps `docker compose pull + up` to the specified image tag.
- `ops-rollback-drill.yml` — `workflow_dispatch` workflow that exercises the rollback script on the production host.
- Auto-rollback in `canary` and `promote` jobs: if health poll times out AND `rollback_tag` is provided at dispatch time, `deploy/rollback.sh` is called automatically.
- `.unit-talk-release.previous` file written on server before each deploy, preserving prior tag.

### Gaps

- Auto-rollback in canary/promote only triggers if caller provided `rollback_tag` input. If omitted (common), failed deploy leaves services in degraded state and requires manual intervention.
- No documented RTO target. No rehearsal cadence for rollback drill.
- No confirmation step that rollback smoke passes (drill runs rollback but does not re-run smoke).

---

## 3. CI Gates

**Status: PASS**

Active gate count (checked on PR to main):

| Gate | Enforces |
|---|---|
| merge-gate.yml | Base CI required checks green |
| branch-discipline-guard | Branch name + commit message format, cross-issue ref prohibition |
| file-scope-lock-check | Files changed ⊆ declared scope |
| tier-label-check | T1/T2/T3 label required |
| proof-auditor-gate | Proof bundle present + SHA-bound |
| r-level-compliance-check | R-level artifact checklist |
| evidence-bundle-validate | Evidence JSON schema for T1 |
| t1-proof-gate | T1: pnpm test:db must be embedded in proof |
| readiness-regression-gate | readiness-score.json ≤48h stale, not RED |
| doc-truth-gate | Governance doc paths correct |
| invariant-registry-gate | Core invariant list unchanged |
| shadow-parity-required | Shadow parity rules enforced |

These gates form a fail-closed merge authority layer that enforces tier and proof requirements mechanically.

---

## 4. Secrets Management

**Status: PASS**

Secret inventory validation runs as the first step in `deploy.yml verify` job. Missing secrets fail the deploy immediately before any SSH connection is opened:

```
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID,
UNIT_TALK_BOT_API_KEY, UNIT_TALK_INGESTOR_API_KEY,
SGO_API_KEY, UNIT_TALK_DEPLOY_HOST, UNIT_TALK_DEPLOY_SSH_KEY
```

SGO key rotation: `SGO_API_KEY_FALLBACK` secret supported in compose + env rewrite. No rotation runbook documented, but the fallback mechanism is wired.

No secrets in repo, `.env.production` written chmod 600 via SSH. GH Actions permissions scoped to `contents: read` + `packages: write`.

---

## 5. Container Runtime

**Status: PASS**

All four production services (`api`, `worker`, `ingestor`, `discord-bot`) configured with:

```yaml
restart: unless-stopped   # api, worker, ingestor
restart: on-failure        # discord-bot (intentional difference)
healthcheck: ...
```

Monitoring stack (Grafana 11.0.0, Loki 3.0.0) also in compose with `restart: unless-stopped`. Caddy reverse proxy present.

Docker's `restart: unless-stopped` provides automatic container recovery on process crash. `UNIT_TALK_IMAGE_TAG` required in compose (`:?` operator) prevents stale-tag launches.

---

## 6. Health Checks

**Status: PARTIAL**

### Ingestor (fixed by UTV2-1286)

Prior healthcheck was `pgrep -f node` — passed even when the scheduler poll loop had died (5.5h incident 2026-06-20). Fixed: healthcheck now runs `apps/ingestor/src/healthcheck.ts` which tests the actual scheduler loop liveness, not process existence. Watchdog in compose detects unhealthy and triggers restart.

### API

`/health` HTTP endpoint returns 200. Deploy smoke and canary polls check this. Binary (up/down) only — no deep DB connectivity or queue depth check surfaced in the health response visible to ops.

### Worker / discord-bot

Healthchecks present in compose; specifics not audited at this depth. Both use `restart: unless-stopped` / `on-failure` recovery.

---

## 7. Monitoring and Alerting

**Status: PARTIAL**

### What exists

- **`pipeline-health-monitor.yml`** — daily cron (10:00 UTC) runs `scripts/pipeline-health.ts`, detects anomalies, posts to ops webhook if configured.
- **`ingestor-staleness-alert.yml`** — 5-minute cron checks provider-offer freshness and ingestor cycle gap via `pnpm ingestor:alert-check`; alerts to `UNIT_TALK_OPS_ALERT_WEBHOOK_URL`.
- **`deploy-monitoring.yml`** — `workflow_dispatch` deploys Uptime Kuma + container-health-watch.sh + disk-alert.sh to the Hetzner host.
- **`db-health-tripwire.yml`** — DB-level health tripwire (details not audited but workflow exists).
- **Grafana + Loki** in `docker-compose.yml` — log aggregation infra is provisioned.

### Gaps

- `UNIT_TALK_OPS_ALERT_WEBHOOK_URL` is optional (`:-` fallback to empty) — alerts silently drop if not configured.
- `deploy-monitoring.yml` is `workflow_dispatch` only — Uptime Kuma must be deployed manually; there is no proof it has been deployed or is currently running.
- No documented alert runbook: what to do when Uptime Kuma fires, what an ops alert means, who is paged.
- Grafana/Loki are in compose but no dashboards, datasources, or alert rules are configured in-repo.
- All production incidents through 2026-06-25 were discovered reactively via `pnpm ops:brief` or manual SSH inspection, not by an automated alert.

---

## 8. Operational Documentation

**Status: PARTIAL**

### What exists

- `pnpm ops:brief` — system state snapshot (lanes, Linear queue, runtime status)
- `pnpm ops:digest` — daily dispatch digest surfacing executable candidates
- `docs/05_operations/` — execution model, lane spec, truth-check spec, delegation policy, provider knowledge base
- `CLAUDE.md` — session discipline, invariants, authoritative doc index

### Gaps

- No formal incident runbook: no documented procedure for "ingestor not cycling", "settlement timeout", "deploy failure", "Supabase degraded".
- No RTO/RPO declared. No SLO or SLA defined.
- No on-call rotation or escalation path documented.
- No rollback rehearsal cadence documented.
- Ops alert webhook destination (Discord channel / Slack / PagerDuty) not documented in-repo.

---

## 9. Known Incidents (2026 Session)

| Date | Incident | Resolution |
|---|---|---|
| 2026-06-20 | Ingestor wedged 5.5h; `pgrep -f node` healthcheck masked dead loop | UTV2-1286 watchdog + healthcheck.ts fix |
| 2026-06-22 | Supabase write-path degradation; `system_runs` table 1.2GB bloat → 120s statement timeouts | VACUUM/ANALYZE (PM-gated); settle_pick_atomic retry (UTV2-1326) |
| 2026-06-22 | MLB `game_results` frozen 40h; PostgREST timeout on 17.8MB odds archive write | Size-guard + write-timeout fix (UTV2-1294) |
| 2026-06-23 | provider_offer_history dedup statement_timeout (no snapshot_at lower-bound) | UTV2-1315 snapshot_at lower-bound fix |

All discovered reactively. Monitoring tooling (Uptime Kuma, ingestor-staleness-alert) exists but alerting delivery path was not proven active during these incidents.

---

## 10. Open Risks

| Risk | Severity | Mitigation |
|---|---|---|
| env-rewrite wipes manual server additions silently | HIGH | All env vars must live in GH Secrets + workflow printf block — enforced by convention, not mechanically |
| Uptime Kuma not confirmed deployed | MEDIUM | Run `deploy-monitoring.yml` and verify; add proof to readiness ledger |
| Alert webhook optional → silent drop | MEDIUM | Make `UNIT_TALK_OPS_ALERT_WEBHOOK_URL` required in deploy secret inventory |
| Auto-rollback requires `rollback_tag` input | MEDIUM | Pre-populate rollback_tag with previous release SHA at dispatch time |
| No incident runbook | LOW-MEDIUM | Reactive only; documented in KNOWN_DEBT |
| Grafana has no configured dashboards | LOW | Loki infra ready; dashboards not provisioned |

---

## Recommended Follow-ups (not in scope of this audit)

1. Make `UNIT_TALK_OPS_ALERT_WEBHOOK_URL` required in the deploy secret inventory check.
2. Confirm Uptime Kuma is deployed and actively monitoring `/health` endpoints; add that proof to `readiness-score.json`.
3. Populate a minimal incident runbook for the 4 known incident patterns above.
4. Document rollback rehearsal cadence (e.g., quarterly drill).
5. Add a Grafana datasource config for Loki so logs are queryable post-deploy.

---

## Conclusion

The deploy pipeline is mechanically sound: canary → promote → smoke, with progressive delivery, secret inventory checks, and automatic container restart on all services. CI gates are comprehensive and fail-closed. The ingestor healthcheck gap that caused the 2026-06-20 incident is fixed. The primary remaining gaps are in **monitoring delivery proof** (Uptime Kuma deployed but not confirmed), **alert reliability** (webhook is optional), and **operational documentation** (no incident runbook, no RTO/RPO). Verdict: **PARTIAL** — production can receive traffic and self-heal from container failures, but monitoring is reactive and operational procedures are undocumented.
