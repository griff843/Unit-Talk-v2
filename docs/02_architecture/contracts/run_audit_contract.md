# Run and Audit Contract

## Metadata

| Field | Value |
|---|---|
| Owner | Architecture |
| Status | Ratified |
| Ratified | 2026-02-01 |
| Last Updated | 2026-03-29 — depth pass UTV2-160 |

---

## Purpose

This contract defines how long-running background work is recorded, how the audit log works, and what constitutes valid proof of completion. It governs two distinct surfaces: `system_runs` (job-level observability) and `audit_log` (entity-level immutable history).

---

## System Runs

`system_runs` is the canonical store for worker and job visibility. One row per logical run of any long-running background process.

### Schema

| Column | Purpose |
|---|---|
| `id` | Row UUID |
| `run_type` | Job type string (see below) |
| `status` | `running`, `succeeded`, `failed`, `cancelled` |
| `started_at` | Server clock (DB default) — set at INSERT |
| `finished_at` | Server clock — set by DB trigger when status → terminal |
| `idempotency_key` | Prevents duplicate concurrent runs for the same job |
| `details` | JSONB summary of run outcomes (counts, errors, etc.) |
| `created_at` | Same as `started_at`; set at INSERT |

**`finished_at` is set by a server-side DB trigger** (`system_runs_set_finished_at`), not by the application. This prevents clock skew between client and server. The application must not write `finished_at` directly.

### Run types

| `run_type` | Producer | Meaning |
|---|---|---|
| `distribution.process` | `apps/worker` | One poll/drain cycle of the outbox |
| `grading.run` | `apps/api` | Automated grading pass against `game_results` |
| `recap.post` | `apps/api` | Settlement recap Discord post |
| `alert.detection` | `apps/alert-agent` | Line movement detection pass |
| `alert.notification` | `apps/alert-agent` | Alert notification delivery pass |

### Idempotency

`system_runs.idempotency_key` has a unique partial index on `WHERE status IN ('running')`. This prevents two concurrent workers from both creating a `running` row for the same job type. The idempotency key is typically `<run_type>:<timestamp-bucket>`.

### Terminal statuses

| Status | Meaning |
|---|---|
| `succeeded` | Run completed normally |
| `failed` | Run encountered an unrecoverable error |
| `cancelled` | Run was cancelled (e.g., duplicate suppressed); treated as `degraded` in operator health |

A `running` row with no `finished_at` that is older than 5 minutes indicates a stuck worker. This is a health signal, not a normal state.

---

## Worker Liveness

Worker liveness is inferred from `system_runs`, not from a heartbeat table. A dedicated `worker_heartbeats` table is not implemented in V2. If future liveness needs cannot be expressed through `system_runs`, a separate heartbeat table may be proposed via ADR or contract update — never added ad hoc.

**Worker health verdict:**

| Condition | Verdict |
|---|---|
| Recent `distribution.process` run with `succeeded` | HEALTHY |
| Most recent run has `status = 'cancelled'` | DEGRADED |
| Most recent run has `status = 'failed'` | DEGRADED — investigate |
| No runs in the last 2 hours with pending outbox rows | DOWN |
| `running` row with no `finished_at` older than 5 min | DEGRADED — stuck worker |

This verdict is computed by the operator snapshot (`apps/operator-web/src/server.ts`) and is the `workerRuntime.status` field.

---

## Audit Log

`audit_log` is the entity-level immutable event history. Every significant state change on a canonical entity writes an audit row.

### Schema

| Column | Purpose |
|---|---|
| `id` | Row UUID |
| `action` | Event name (e.g., `submission.validated`, `distribution.sent`) |
| `entity_id` | UUID of the primary entity (outbox row, settlement record, promotion history row) |
| `entity_ref` | Pick ID as text (non-UUID cross-reference; nullable) |
| `actor` | Service or user that triggered the action |
| `created_at` | Event timestamp |
| `payload` | JSONB details |

### Immutability

`audit_log` is append-only. A DB trigger (`reject_audit_log_mutation`) prevents any UPDATE or DELETE. Any attempt to mutate an existing row will raise a DB error.

**Never UPDATE or DELETE from `audit_log`.** It is the permanent historical record.

### entity_id vs entity_ref

`entity_id` is the UUID FK to the primary entity involved in the event — **not** the pick ID. To find audit entries for a pick, query by `entity_ref = '<pick_id>'`.

Examples:
- `distribution.sent` event: `entity_id` = outbox row ID; `entity_ref` = pick ID
- `settlement.recorded` event: `entity_id` = settlement record ID; `entity_ref` = pick ID
- `promotion.qualified` event: `entity_id` = promotion history row ID; `entity_ref` = pick ID

**Known V2 quirk:** `audit_log` entries for `distribution.sent` may have `entity_ref = null`. The worker does not write `entity_ref` on distribution.sent events. This is not a delivery failure — it is a known gap in the worker's audit path.

### Required audit events

| Action | When written | entity_id points to |
|---|---|---|
| `submission.validated` | Pick accepted at submission | `picks.id` |
| `promotion.qualified` | Pick qualifies for a promotion target | `pick_promotion_history.id` |
| `promotion.not_qualified` | Pick fails promotion evaluation | `pick_promotion_history.id` |
| `distribution.sent` | Worker successfully delivers to Discord | `distribution_outbox.id` |
| `distribution.failed` | Worker delivery fails | `distribution_outbox.id` |
| `settlement.recorded` | Final settlement written | `settlement_records.id` |
| `pick.voided` | Pick voided by operator | `picks.id` |

---

## Completion Claims

A task or sprint item claiming that a pick was delivered, a grading run completed, or a settlement was written must be backed by DB evidence — not by log output or runtime self-report.

Preferred evidence order:
1. Live DB query (Supabase MCP or `pnpm test:db`)
2. Operator snapshot
3. API response
4. Worker/service log (weakest — self-report only)

**Operational dashboards (`apps/operator-web`) are consumers of audit state, not substitutes for it.** A green dashboard is not proof. The underlying `system_runs`, `audit_log`, and receipt rows are proof.

---

## Failure Behavior

| Failure | Behavior |
|---|---|
| DB unavailable when writing audit event | Audit write fails; the triggering operation should also fail (audit is not optional) |
| Duplicate audit row attempted | Each event write generates a unique `id`; duplicates are structurally impossible at the row level, but the caller must not write the same logical event twice |
| `system_runs` row left as `running` | DB trigger sets `finished_at` when status transitions to terminal; if worker crashes without transitioning, row stays `running` indefinitely — stale row detection is the recovery path |

---

## Audit and Verification

1. Verify `reject_audit_log_mutation` trigger exists on `audit_log` table post-migration.
2. For any completed delivery: confirm `audit_log` row exists with `action = 'distribution.sent'`.
3. For any grading run: confirm `system_runs` row exists with `run_type = 'grading.run'` and `status = 'succeeded'`.
4. For any stuck worker claim: query `system_runs WHERE status = 'running' AND started_at < now() - interval '5 minutes'`.
5. Do not use dashboard green status as evidence — query the tables directly.
