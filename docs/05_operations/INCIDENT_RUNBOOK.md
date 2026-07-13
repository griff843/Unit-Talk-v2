# Incident Response Runbook

**Status:** DRAFT — PM ratification required before treated as binding process
**Date:** 2026-07-13
**Linear:** UTV2-1428
**Tier:** T3 — docs/process, no runtime surface
**Authority:** Operations. This runbook does not authorize any live write or deploy action beyond what is already permitted by `DB_ENVIRONMENT_OPERATOR_POLICY.md`, `DEPLOY.yml`, and existing rollback tooling.

---

## Purpose

This is the general first-response runbook for Unit Talk V2 production incidents. It closes the Tier A launch-gate gap identified in `DISCORD_LAUNCH_GATE_AUDIT.md` (§5, "Incident response runbook — MISSING") and `DEVOPS_PRODUCTION_POSTURE_AUDIT.md` (§8, "No formal incident runbook").

Use this runbook for:
- Ingestor/scheduler failures (wedged loops, stale provider data)
- Database write-path degradation (slow queries, statement timeouts, table bloat)
- Delivery/governance-brake incidents (outbox stuck, brake tripped unexpectedly)
- Deploy failures (canary/promote health-check failure, bad image)

For a DB write-safety incident specifically (unsafe/duplicate/unauthorized writes), use `SUPABASE_WRITE_PATH_INCIDENT_RUNBOOK.md` instead — it has a dedicated severity/classification/recovery model. For DB schema rollback or forward-fix, use `DB_ROLLBACK_RUNBOOK.md`. For a full point-in-time database restore, use `WALPITR_RESTORE_RUNBOOK.md`. This runbook is the entry point that routes to those when the incident is DB-specific, and stands alone for the other three categories.

---

## Current Reality (read before assuming otherwise)

Per `DEVOPS_PRODUCTION_POSTURE_AUDIT.md` §7 and §9: **every production incident through 2026-06-25 was discovered reactively** — via `pnpm ops:brief`, manual SSH inspection, or a user noticing stale output — not by an automated alert firing and paging someone. Monitoring tooling exists (`pipeline-health-monitor.yml`, `ingestor-staleness-alert.yml`, `db-health-tripwire.yml`, Uptime Kuma via `deploy-monitoring.yml`) but:
- `UNIT_TALK_OPS_ALERT_WEBHOOK_URL` is optional — if unset, alerts silently drop instead of failing loudly.
- `deploy-monitoring.yml` (Uptime Kuma) is `workflow_dispatch` only — there is no proof it is currently deployed and running on the Hetzner host.
- There is no on-call rotation. There is one human operator (`griff843`) and this repo's Claude/Codex orchestrators; paging today means a person noticing, not a system alerting.

This runbook does not pretend that gap is closed. It defines the minimal process for the reality that exists today, and names what must change (below) to close it properly.

**Who gets paged, how (current state):** the operator (`griff843`) is the only page target. Today "paging" means: a scheduled `pnpm ops:brief` run surfaces an anomaly, a monitoring cron posts to the ops webhook (if configured), or the operator notices degraded behavior directly. There is no PagerDuty/on-call-rotation equivalent. Closing this gap (webhook required-not-optional, confirmed live Uptime Kuma, a real page path) is tracked as a follow-up, not solved by this document.

---

## Common Failure Signatures and First Response

### 1. Ingestor wedged / not cycling

**Signature:** `pnpm ops:brief` or `ingestor:alert-check` shows no new ingestion cycle for longer than the expected cadence; provider-offer freshness stale; `pgrep -f node` healthcheck reports the process alive even though its scheduler loop is dead (known false-negative — see 2026-06-20 incident below).

**First response:**
1. SSH to the Hetzner host; check ingestor container logs for the last logged cycle timestamp.
2. Confirm whether the process is truly wedged (no new log lines for > 2x the expected cycle interval) vs. genuinely idle (off-hours for the sport in question).
3. If wedged: restart the ingestor container. Do not restart the whole compose stack unless multiple services are affected.
4. After restart, confirm a new cycle completes and `pnpm ops:brief` shows fresh data within one cycle interval.
5. If this recurs, treat `pgrep`-only healthchecks as unverified — an alive process is not a cycling process. File as a known-debt follow-up rather than repeatedly restarting blind.

**Precedent:** 2026-06-20 — ingestor wedged 5.5h; `pgrep -f node` healthcheck masked the dead loop. Fixed by UTV2-1286 (watchdog + healthcheck.ts change). If this signature reappears, the watchdog is either not deployed on the affected host or has itself regressed — verify the watchdog is running before assuming a new root cause.

### 2. Database write-path degradation (slow queries, statement timeouts)

**Signature:** API/worker errors referencing Postgres `statement timeout`; `pnpm ops:brief` or manual query shows abnormally slow writes to a hot table; settlement or promotion appears frozen even though the app looks healthy.

**First response:**
1. Do NOT immediately assume a platform outage. Check for table bloat and stale statistics first — this has been the actual root cause twice (see precedent below), not a Supabase-side incident.
2. Query table sizes and last-vacuum/last-analyze timestamps for the tables in the affected write path.
3. If bloat/stale-stats is confirmed: this is a mitigation requiring `VACUUM`/`ANALYZE` against production — **PM-gated**, do not run without approval (per `DB_ENVIRONMENT_OPERATOR_POLICY.md`).
4. If a specific query is missing an index or a partition-pruning predicate (e.g., no lower-bound on a partitioned timestamp column), that is a code fix, not an ops action — route to a lane, do not hand-patch production.
5. For anything touching write safety (duplicate/unsafe/unauthorized rows), switch to `SUPABASE_WRITE_PATH_INCIDENT_RUNBOOK.md`'s severity and classification model instead of improvising here.

**Precedent:**
- 2026-06-22 — `system_runs` table bloat (1.2GB/130 rows, dead autovacuum) caused 120s statement timeouts across the write path. Mitigated via VACUUM/ANALYZE (PM-gated) plus a `settle_pick_atomic` retry (UTV2-1326).
- 2026-06-22 — MLB `game_results` frozen 40h from a 17.8MB odds-archive write timing out PostgREST. Fixed with a size-guard + write-timeout change (UTV2-1294).
- 2026-06-23 — `provider_offer_history` dedup query timed out at scale (60 partitions, 1.39M rows) because the query had no `snapshot_at` lower bound to prune partitions. Fixed by UTV2-1315.

### 3. Delivery / governance-brake incident (outbox stuck, brake behaving unexpectedly)

**Signature:** Outbox rows accumulate in a non-terminal state; a brake trips (or fails to trip) in a way that doesn't match the documented governance-brake lifecycle in `PHASE7R_RATIFICATION.md`; a delivery outcome is missing or duplicated for an attempt.

**First response:**
1. Confirm the outbox worker process is running and cycling (same wedge-check pattern as ingestor above).
2. Check the lifecycle state of the affected rows against the documented state machine — an invalid transition (e.g., `queued -> awaiting_approval` when it shouldn't be reachable) is a code bug, not an ops action; do not hand-write a lifecycle transition into the DB.
3. If the brake itself is the problem (tripped when it shouldn't have, or didn't trip when it should have), treat this as P0 per `docs/05_operations/P0_PROTOCOL_SPEC.md` — do not silently work around a brake; a fail-open brake is a governance failure, not a nuisance.
4. Exactly one `DeliveryOutcome` per attempt is an invariant (see root `CLAUDE.md` invariant #9) — if you observe more or fewer, that is itself the incident; stop and diagnose the outbox worker rather than manually reconciling counts.

**Precedent:** UTV2-1285 — candidate-pick-scanner brake performed invalid lifecycle transitions (`queued->awaiting_approval`, `voided->voided`), leaving ~65% of scanner picks stuck. Fixed with a state-aware `resolveGovernanceBrakeAction`.

### 4. Deploy failure (canary/promote health check failure, bad image)

**Signature:** `canary` or `promote` job in `deploy.yml` fails its health poll; the deployed image behaves unexpectedly in production; a bad image reaches `promote` before being caught.

**First response:** see Rollback Procedure below. The short version: if you dispatched with a `rollback_tag`, the pipeline attempts an automatic rollback on health-poll timeout. If you did not provide one (the common case), the deploy is left in a degraded state and you must roll back manually — this is a known, documented gap (see `DEVOPS_PRODUCTION_POSTURE_AUDIT.md` §2, §10), not a new discovery.

---

## Rollback Procedure

Reference: `deploy/rollback.sh`, `deploy.yml`'s `rollback-dry-run`/`canary`/`promote` jobs, `ops-rollback-drill.yml`.

### Mechanism

- `deploy/rollback.sh --tag <image-tag> [--host <host>] [--user <user>] [--path <remote-path>] [--dry-run]` rolls the docker-compose deployment back to a known image tag (`docker compose pull` + `up` at that tag).
- The server keeps a `.unit-talk-release.previous` file written before each deploy, recording the prior tag — this is the value to pass as `--tag` for "roll back one release."
- `deploy.yml` validates the rollback path on every run via the `rollback-dry-run` job (`deploy/rollback.sh --dry-run --tag ...`) before `build` proceeds — a broken rollback script fails CI, not just a live incident.
- Both `canary` and `promote` jobs will call `deploy/rollback.sh` automatically **if and only if** a `rollback_tag` was supplied at `workflow_dispatch` time and the post-deploy health poll times out.
- `ops-rollback-drill.yml` is a `workflow_dispatch` workflow that exercises the rollback script against the real production host — this is the rehearsal mechanism; it is not on a cadence today (see SLO section).

### Manual rollback steps (when auto-rollback did not trigger, i.e. `rollback_tag` was not supplied)

1. Identify the last-known-good tag: read `.unit-talk-release.previous` on the deploy host, or the merge SHA of the last PR that passed `smoke` in `deploy.yml`.
2. Dry-run first: trigger `deploy.yml` via `workflow_dispatch` with `rollback_tag` set to that tag, or run `deploy/rollback.sh --dry-run --tag <tag>` directly on the host to confirm the command that would execute.
3. Execute: `deploy/rollback.sh --tag <tag> --host <host> --user <user> --path <remote-path>` (or re-dispatch `deploy.yml` with `rollback_tag` set, which performs the equivalent through the pipeline).
4. Verify: re-run the `smoke` job's checks manually (health endpoint, expected version string) — the rollback drill itself does **not** currently re-run smoke automatically after rolling back (documented gap, `DEVOPS_PRODUCTION_POSTURE_AUDIT.md` §2).
5. Record the incident: time detected, tag rolled back from/to, and total time-to-recover, in this runbook's closeout log (below) or a dedicated incident doc if the blast radius warrants one.

### Known gaps in this mechanism (do not treat rollback as fully automatic)

- Auto-rollback only fires if `rollback_tag` was explicitly provided at dispatch — omitting it (the common/default case) means a failed deploy is left degraded until a human intervenes.
- No confirmed automatic re-verification (smoke) after a rollback completes.
- No rehearsal cadence exists for `ops-rollback-drill.yml` — see SLO section for the minimum being proposed here.

---

## Minimal SLO Targets

These are **starting targets**, not yet empirically validated against real production load unless noted. PM ratification should either accept them or set different numbers before they're treated as binding.

| Metric | Target | Status |
|---|---|---|
| API uptime | 99% monthly (allows ~7.3h/month downtime) | Not yet measured — no uptime dashboard confirmed live (Uptime Kuma deploy unconfirmed) |
| Ingestion freshness | Provider-offer data no staler than 2x the sport's expected ingestion cadence before alerting | Enforced today by `ingestor-staleness-alert.yml`; alert delivery depends on `UNIT_TALK_OPS_ALERT_WEBHOOK_URL` being set |
| Delivery latency | Outbox attempt to terminal `DeliveryOutcome` within 5 minutes under normal load | Not yet measured — no delivery-latency dashboard exists |
| DB RPO (recovery point objective) | ≤ 15 minutes of data loss | Declared in `WALPITR_RESTORE_RUNBOOK.md`; restore drill templated but RPO/RTO fields were never filled in (`docs/06_status/proof/UTV2-782.md` has unchecked boxes) — **not yet empirically verified** |
| DB RTO (recovery time objective) | ≤ 2 hours to restore and promote | Same as above — declared, not yet verified |
| Rollback rehearsal cadence | At minimum once per quarter, or after any change to `deploy.yml`/`rollback.sh` | No cadence exists today — `ops-rollback-drill.yml` is manual/ad hoc only |

**Follow-up required to close these gaps** (tracked, not solved by this document):
1. Make `UNIT_TALK_OPS_ALERT_WEBHOOK_URL` a required (not optional) deploy secret so alerts fail loudly instead of silently dropping.
2. Confirm Uptime Kuma is actually deployed and live on the Hetzner host; record proof in the readiness ledger.
3. Actually run the WAL/PITR restore drill (`WALPITR_RESTORE_RUNBOOK.md` Step 5-7) and fill in the measured RPO/RTO values in `docs/06_status/proof/UTV2-782.md`.
4. Pre-populate `rollback_tag` with the previous release SHA by default at dispatch time, so auto-rollback isn't opt-in.
5. Add a smoke re-check step to `ops-rollback-drill.yml` after rollback completes.

---

## Incident Closeout Log

Append one entry per incident handled under this runbook, in reverse-chronological order (newest first). This is a lightweight log, not a substitute for a dedicated incident doc when the blast radius warrants one (e.g. `SUPABASE_WRITE_PATH_INCIDENT_RUNBOOK.md`'s "Current Incident" section).

| Date | Category (1-4 above) | Detected via | Time to recover | Notes |
|---|---|---|---|---|
| _(none yet — this runbook is newly ratified)_ | | | | |

---

## Cross-References

- `docs/05_operations/SUPABASE_WRITE_PATH_INCIDENT_RUNBOOK.md` — DB write-safety incidents specifically
- `docs/05_operations/DB_ROLLBACK_RUNBOOK.md` — DB schema rollback / forward-fix decision matrix
- `docs/05_operations/WALPITR_RESTORE_RUNBOOK.md` — full point-in-time database restore
- `docs/06_status/readiness/DEVOPS_PRODUCTION_POSTURE_AUDIT.md` — source audit for the gaps this runbook addresses
- `docs/05_operations/DISCORD_LAUNCH_GATE_AUDIT.md` — Tier A launch-gate requirement this runbook satisfies
- `docs/05_operations/LAUNCH_GATE_DEFINITION.md` — launch-gate tier definitions and follow-up lane tracking
- `docs/05_operations/STANDING_GUARDRAILS.md` — P0 protocol and fail-closed invariants referenced above
