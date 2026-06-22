# Supabase Write-Path Incident Runbook

**Status:** DRAFT
**Date:** 2026-06-22
**Linear:** UTV2-1290
**Tier:** T3 - Operations
**Authority:** Operations. Live production writes remain operator-owned.

---

## Purpose

This runbook defines the first-response and recovery workflow for incidents where Unit Talk V2 may be writing incorrect, unsafe, duplicate, or unauthorized data to Supabase.

Use this runbook for:

- Application write-path incidents: API submissions, promotion, lifecycle transitions, distribution enqueue, worker receipts, settlement, ingestion, or scanner-created rows.
- Database write-path incidents: migrations, backfills, manual SQL, Supabase dashboard writes, or ledger-repair mistakes that may have changed production state.
- Mixed incidents where runtime behavior and database state may both be wrong.

This runbook does not authorize any live write. Production project `zfzdnfwdarxucxtaojxm` remains governed by `DB_ENVIRONMENT_OPERATOR_POLICY.md` and `DB_MIGRATION_WORKFLOW.md`.

---

## Severity

Treat the incident as active until one of these is proven false:

1. A production writer is still capable of producing bad rows.
2. A migration or manual operation may have changed live schema or data outside the repo-backed apply path.
3. Operators cannot explain the exact affected tables, row counts, and time window.
4. Runtime health checks disagree with database truth.

Escalate immediately if any affected table includes:

- `picks`
- `pick_lifecycle`
- `audit_log`
- `distribution_outbox`
- `distribution_receipts`
- `settlement_records`
- `provider_offers`
- `provider_offer_history`
- `provider_offer_current`
- `submission_events`

---

## First Response

### 1. Stop the writer

Contain the source before investigating the symptom.

| Suspected source | Containment action |
|---|---|
| API submission or review endpoint | Stop the API process, remove the route from traffic, or block the caller at the edge. |
| Worker delivery path | Stop the worker process before it claims more outbox rows. |
| System pick scanner | Keep `SYSTEM_PICK_SCANNER_ENABLED=false`; do not flip it for verification. |
| Alert agent or ingestor | Stop the scheduled job or process that owns the write. |
| Migration apply | Stop all `supabase db push`, Management API, MCP apply, dashboard SQL, and repair activity. |
| Manual SQL or dashboard mutation | Stop the session and preserve the SQL text, timestamp, actor, and result output. |

Do not start a second writer to "test" the issue. Use read-only probes until the operator authorizes a recovery action.

### 2. Preserve evidence

Record the incident in the current Linear issue or incident channel with:

- UTC timestamp when the issue was noticed.
- Suspected writer and command, service, endpoint, or actor.
- Current branch, PR, deployment SHA, and migration version if known.
- Exact error message, log excerpt, or query result that triggered the incident.
- Whether the writer is now stopped.

Do not clean up rows before evidence is captured.

### 3. Freeze lane activity that overlaps the write path

Pause merges and deploys that touch the same writer, schema, or table family. Do not merge a migration, runtime writer, or worker change while the incident scope is unknown.

---

## Read-Only Triage

Run only read-only commands and queries during triage.

### Repo and runtime state

```bash
git status --short --branch
git log --oneline -5
pnpm ops:brief
pnpm pipeline:health
```

### Migration ledger state

```bash
supabase migration list --linked
```

Compare the linked ledger against `supabase/migrations/`. If the remote ledger contains rows not present locally, or local migrations are missing remotely outside the expected queue, stop and escalate to the operator.

### Table shape check

Use read-only SQL:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = '<affected_table>'
ORDER BY ordinal_position;
```

### Blast-radius row count

Prefer count queries before selecting payloads:

```sql
SELECT COUNT(*) AS affected_count
FROM public.<affected_table>
WHERE created_at >= '<incident_start_utc>'
  AND created_at < '<incident_end_utc>';
```

If a table does not have `created_at`, use the closest available timestamp or ID boundary and record the assumption.

### Lifecycle and audit consistency

For pick incidents, prove whether lifecycle and audit truth agree:

```sql
SELECT p.id, p.status, p.approval_status, p.source, p.created_at
FROM public.picks p
WHERE p.created_at >= '<incident_start_utc>'
ORDER BY p.created_at DESC
LIMIT 50;
```

```sql
SELECT pl.pick_id, pl.from_status, pl.to_status, pl.transition_reason, pl.created_at
FROM public.pick_lifecycle pl
WHERE pl.created_at >= '<incident_start_utc>'
ORDER BY pl.created_at DESC
LIMIT 50;
```

```sql
SELECT action, entity_id, entity_ref, created_at
FROM public.audit_log
WHERE created_at >= '<incident_start_utc>'
ORDER BY created_at DESC
LIMIT 50;
```

Remember:

- `picks.status` is the lifecycle state.
- `pick_lifecycle` is the lifecycle event table.
- `audit_log.entity_id` is the primary entity for the event, not automatically the pick ID.
- `audit_log.entity_ref` stores the pick ID as text when available.

---

## Classification

Classify the incident before choosing recovery.

| Class | Definition | Default response |
|---|---|---|
| Runtime-write | Application code wrote bad rows through a normal repository path. | Keep writer stopped, patch runtime, add regression test, then decide whether row repair is needed. |
| Direct-live-write | A dashboard, SQL shell, MCP apply, Management API, or unapproved command changed production. | Escalate to operator; compare ledger and schema; recover through forward-fix or PITR decision. |
| Migration-apply | `supabase db push` or equivalent failed, half-applied, or applied an unsafe migration. | Follow `DB_ROLLBACK_RUNBOOK.md`; do not run repair unless operator names the migration and status. |
| Ledger-drift | Migration ledger and repo migrations disagree. | Stop applies; reconcile with operator using ledger output and local migration list. |
| Data-backfill | A script or migration updated existing rows incorrectly. | Count affected rows; preserve before/after assumptions; forward-fix only after operator review. |
| Delivery-write | Worker claimed, retried, receipted, or dead-lettered rows incorrectly. | Stop worker; inspect outbox and receipts; do not replay until adapter and receipt semantics are known. |

---

## Recovery Paths

### Runtime-write recovery

1. Keep the writer stopped or gated.
2. Identify the smallest code path that can write the bad state.
3. Patch the code through the repository abstraction. Do not call Supabase directly from services.
4. Add or update `node:test` coverage using in-memory repositories.
5. If the incident touches lifecycle, promotion, audit, distribution, review, or settlement flow, add or run live DB proof according to the issue tier and current gate requirements.
6. Run:
   ```bash
   pnpm type-check
   pnpm test
   pnpm verify
   ```
7. Restart the writer only after the operator accepts the recovery plan and verification.

### Migration or direct-live-write recovery

1. Follow `DB_ROLLBACK_RUNBOOK.md`.
2. Default to a forward-fix migration unless PM chooses PITR.
3. Do not edit applied migration files.
4. Do not run `supabase migration repair` to hide a failed apply.
5. Do not apply a new migration before ledger alignment is understood.
6. After operator-approved recovery, run:
   ```bash
   pnpm supabase:types
   pnpm type-check
   pnpm test:db
   pnpm verify
   ```

### Row repair or backfill recovery

Row repair is a live data mutation and requires operator approval in the current session.

Before any repair:

1. Produce a row count and sample query.
2. State whether the affected rows are production rows, proof fixtures, or both.
3. State whether audit rows must be appended.
4. State whether lifecycle events must be inserted through the atomic lifecycle path.
5. Draft the repair as a migration or operator-reviewed script.

Never mutate `settlement_records` originals. Corrections use `corrects_id`.

Never update or delete `audit_log`.

Do not mutate pre-existing stranded `picks.status='awaiting_approval'` rows unless the execution packet explicitly authorizes that remediation.

---

## Forbidden Actions

Do not do any of the following during a write-path incident:

- Re-enable `SYSTEM_PICK_SCANNER_ENABLED`.
- Copy `local.env` into a worktree.
- Run `supabase db push` against production without explicit operator authorization for the specific migration.
- Run `supabase migration repair` without the operator naming the migration ID and target status.
- Apply migrations through the Supabase Management API before merge.
- Use dashboard Table Editor or SQL editor to make schema changes.
- Run `UPDATE`, `DELETE`, `TRUNCATE`, `DROP`, or breaking `ALTER` against production during triage.
- Replay outbox rows before worker receipt and retry semantics are understood.
- Write `picks.status` and `pick_lifecycle` separately from application code.
- Treat `approval_status` as a lifecycle state or `picks.status` as a promotion decision.

---

## Verification Checklist

Before declaring containment complete:

- [ ] Original writer is stopped, gated, or patched.
- [ ] Incident start and end timestamps are recorded.
- [ ] Affected tables are listed.
- [ ] Affected row count is recorded for each table.
- [ ] Migration ledger state is known.
- [ ] Runtime logs and DB truth agree.
- [ ] `pnpm type-check` passed after the fix.
- [ ] `pnpm test` passed after the fix.
- [ ] `pnpm verify` passed before PR closeout.
- [ ] `pnpm test:db` passed when required by tier or changed paths.
- [ ] Operator approved any live data mutation or migration apply.

---

## Closeout Artifact

The final incident note must include:

```markdown
## Summary
- What writer failed and how it was contained.
- What tables and rows were affected.
- What recovery path was chosen.

## Timeline
- <UTC timestamp> - Detection
- <UTC timestamp> - Writer stopped
- <UTC timestamp> - Blast radius confirmed
- <UTC timestamp> - Fix merged/applied
- <UTC timestamp> - Verification green

## Evidence
- Branch/PR/deploy SHA:
- Migration ledger result:
- Row-count queries:
- Verification commands:

## Follow-ups
- Regression tests:
- Guardrails:
- Operator actions:
```

---

## Current Incident — 2026-06-22 Supabase Write-Path Degradation

This runbook above covers *bad-data-written* incidents. The incident that opened UTV2-1290 is a
different class: a **write-path availability/performance degradation** — reads stay healthy, but writes
and atomic transactions intermittently time out. Captured here so the runbook also serves degradation
(not just data-correctness) incidents.

### Affected surfaces
- **Production ingestor** — crash-restart loop (RestartCount=109 in ~10h); startup `reapStaleRuns` / writes time out (the condition UTV2-1288 hardens against).
- **CI `pnpm verify`** (PR live-DB suites) — intermittent failures in `database-smoke`, `t1-proof-awaiting-approval` (UTV2-519/UTV2-521), `execution_intents` (UTV2-1132).
- **`pnpm test:db`** — intermittent (passed 7/7, then a full verify failed minutes later).
- **Deploy verify** — same write-path sensitivity.

### Exact error signatures
- `Could not query the database for the schema cache. Retrying.` (PostgREST schema-cache)
- `canceling statement due to statement timeout` (e.g. `execution_intents` INSERT, devig market lookups)
- `Failed to record audit log: unknown error` (`DatabaseAuditLogRepository.record`)
- `Failed to find pick: undefined` / `Failed to find pick by idempotency key: undefined`
- HTTP **520** (Cloudflare "Web server returning unknown error") and **521**
- statement timeouts on `odds_snapshots` / `raw_payloads` inserts

### Timeline (UTC, 2026-06-22)
- ~13:28 — PR CI verify DB-smoke: HTTP 520 + schema-cache errors
- ~17:21 — verify: audit-log + pick-lookup write failures
- ~17:39 — `test:db` PASS 7/7 (transient recovery)
- ~17:46 → ~18:25 → ~19:03 — full verify failures trending **down** (3–4 → 3 → 1), all in DB-write suites
- throughout — direct-SQL read probe healthy; ingestion row count still advancing

### Root-cause characterization (evidence-based, to confirm platform-side)
Reads healthy + writes degraded + isolated/light suites pass while full-`verify` concurrent load fails
⇒ **load / connection-pool / statement-timeout pressure**, likely compounded by **PostgREST
schema-cache** instability — **not** a total platform outage. Supporting signal: `get_advisors(performance)`
returned 354 advisories incl. **136 unindexed foreign keys** (raise per-write FK-check cost) and a
**connection-count advisory** (`auth_db_connections_absolute`). Still to confirm via Supabase-side logs/status
whether the trigger is a platform incident, PostgREST, pool saturation, query/index pressure, or our write pattern.

### Mitigation options (investigation output — **no code changes without PM approval**)
1. **Retry/backoff on transient writes** (bounded). Already implemented for the ingestor startup chain in the UTV2-1288 lane; consider extending the pattern to other write paths.
2. **Narrower / sharded DB smoke tests** — reduce concurrent live-DB load during `verify`.
3. **CI live-DB isolation** — dedicated Supabase preview branch and/or serialized live-DB jobs so concurrent CI runs don't saturate the prod pool.
4. **PostgREST / schema-cache recovery** — reload the schema cache / restart PostgREST when "schema cache" errors appear (operator-owned; document exact steps).
5. **Supabase plan / resource review** — compute add-on, connection-pool size, `statement_timeout`; address top unindexed FKs on hot write tables.
6. **Longer-term DB hosting options** — evaluate if degradation recurs.

> This is documentation/investigation only. None of the above is implemented by this lane. Each code/CI/infra
> mitigation requires a separate PM-approved lane.

---

## Cross-References

- `docs/05_operations/DB_ENVIRONMENT_OPERATOR_POLICY.md`
- `docs/05_operations/DB_MIGRATION_WORKFLOW.md`
- `docs/05_operations/DB_ROLLBACK_RUNBOOK.md`
- `docs/05_operations/MERGE_DEPLOY_DISCIPLINE.md`
- `docs/05_operations/SUPABASE_CONNECTION_STRATEGY.md`
- `docs/05_operations/WORKTREE_ISOLATION_POLICY.md`
