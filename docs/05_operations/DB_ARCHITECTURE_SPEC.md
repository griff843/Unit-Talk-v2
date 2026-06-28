# DB Final Architecture Spec

**Issue:** UTV2-1328  
**Tier:** T2  
**Status:** Draft for PM ratification  
**Lane type:** SPEC-ONLY - no SQL execution, no DDL, no code changes, no DB mutations  
**Created:** 2026-06-27  

---

## Purpose

This document defines the final Unit Talk V2 database architecture boundaries:

- hot production Postgres
- historical archive / object-store tier
- factory, proof, and test database boundaries
- retention, partition, and index strategy
- table classifications
- migration gates
- monitoring requirements

It consolidates the DB operating model above the tactical retention and scaling docs. It does not authorize any production mutation, schema migration, delete, backfill, certification change, or live data movement.

---

## Non-Scope

The following actions are explicitly outside this lane:

- production data mutation
- schema migration
- delete, truncate, update, backfill, or repartition execution
- certification, scoring, lifecycle, promotion, settlement, or delivery behavior changes
- Supabase Management API writes
- direct dashboard SQL execution
- live DB recovery claims

Any future execution must be opened as a separate lane with its own tier, file scope, PM gate, verification, and proof bundle.

---

## Architecture Overview

Unit Talk V2 uses three database/storage classes. Each class has a different authority, mutability model, and verification bar.

| Class | Purpose | Authority | Mutation posture | Examples |
|---|---|---|---|---|
| Hot production DB | Current operational truth for picks, lifecycle, delivery, settlement, provider state, and command surfaces | Supabase Postgres project `zfzdnfwdarxucxtaojxm` | Runtime writes only through application repositories and approved migrations | `picks`, `pick_lifecycle`, `settlement_records`, `distribution_outbox`, `provider_offer_history` |
| Historical archive / object store | Durable storage for old or oversized data that is not needed for low-latency operations | PM-ratified archive contract plus immutable object paths | Append-only exports; deletion from hot DB only after a separate approved retention lane | archived `raw_payloads`, old `odds_snapshots`, old analytics snapshots |
| Factory / proof / test DBs | Isolated verification, fixture generation, schema rehearsal, and proof capture | Test harness or Supabase branch/isolated project per lane policy | Disposable or proof-scoped writes only; never treated as production truth | live proof fixtures, smoke-test rows, migration rehearsal branches |

The hot production DB remains the only canonical runtime source for active lifecycle state. Archive and proof stores may support investigation and replay, but they do not override hot production truth.

---

## Hot Production DB Boundary

### Responsibilities

The hot production DB stores data needed for current runtime decisions, operator inspection, and active customer-facing delivery:

- pick intake, lifecycle, approval, promotion, routing, delivery, and settlement state
- current provider offer state required for scoring, CLV, and settlement support
- short-window operational telemetry required for incident response
- immutable audit and event trails required to prove state transitions

### Hard invariants

- `picks.status` is the lifecycle state field.
- `pick_lifecycle` is the lifecycle event table.
- `audit_log` is immutable and append-only.
- `settlement_records` corrections use `corrects_id`; original settlement rows are never mutated.
- Services must use repository interfaces. Application services must not call Supabase directly.
- Lifecycle transitions must use the atomic lifecycle path, not ad hoc writes to `picks.status` and `pick_lifecycle`.

### Hot DB write classes

| Write class | Posture | Required behavior |
|---|---|---|
| Lifecycle and settlement truth | Fail-closed | If the write fails, the runtime operation fails and alerts. No silent degradation. |
| Delivery queue truth | Fail-closed | Missing outbox or receipt truth can create silent delivery drift. |
| Promotion/routing truth | Fail-closed for decision persistence | A pick cannot route to a live target without persisted, inspectable decision state. |
| Provider current state | Fail-closed for active scoring inputs | Current offer state that drives scoring must be queryable and bounded. |
| Telemetry and raw/archive payloads | Fail-open with bounded queues | Telemetry must not starve settlement or lifecycle writes. |

---

## Historical Archive / Object Store Boundary

The archive tier stores data that is valuable for audit, replay, incident review, model analysis, or provider debugging but does not need to live in hot Postgres for current operations.

### Canonical archive candidates

| Data | Archive target | Hot retention intent | Notes |
|---|---|---|---|
| Oversized `raw_payloads.payload` | S3-compatible object store | 30 days, with error carve-outs | See `DB_MAINTENANCE_RETENTION_SPEC.md`; object writes must be fail-open. |
| Large `odds_snapshots.price_blob` | S3-compatible object store or partition export | 30 days hot after carve-outs | CLV/settlement proof snapshots must be preserved before drop/delete. |
| Old operational telemetry | Object export or summarized table | 30 days hot, longer for failures | `system_runs` failures may need longer retention than successes. |
| Old analytics/model evidence | Object store with manifest | Issue-specific | Must be SHA-bound when used as proof. |

### Archive rules

1. Archive objects are immutable once written.
2. Object paths must include domain, year, month, source table, source row id, and content hash or manifest hash.
3. A successful archive write must be recorded in a DB-visible manifest or companion table before any hot-row delete is considered.
4. Hot DB deletion after archival requires a separate approved retention lane with pre/post evidence.
5. Object-store failure must not block settlement-critical writes.
6. Archive data is not operational authority unless a future ratified contract explicitly promotes a replay result back into hot DB truth.

Recommended path shape:

```text
s3://unit-talk-archive/
  raw_payloads/{YYYY}/{MM}/{raw_payload_id}.{hash}.json.gz
  odds_snapshots/{YYYY}/{MM}/{snapshot_id}.{hash}.json.gz
  system_runs/{YYYY}/{MM}/{run_id}.{hash}.json.gz
  manifests/{YYYY}/{MM}/{domain}/{manifest_id}.json
```

---

## Factory, Proof, and Test DB Boundary

### Factory DB

A factory DB is a controlled environment for generating representative data, replaying migrations, or exercising ingestion paths before production. It may use synthetic data, scrubbed exports, or Supabase branches, but it is never the source of production truth.

Factory DB requirements:

- isolated credentials
- no production Discord targets
- no automatic promotion to production state
- deterministic fixture labels and run ids
- teardown or retention policy declared before writes begin

### Proof DB / live proof fixtures

Live proof can write to production only when the issue tier and proof policy require it. Proof writes must be bounded, identifiable, and unique per run.

Required proof properties:

- unique fixture marker, preferably issue id plus `randomUUID()` or timestamp
- no reuse of idempotency fields that can collide with previous proof runs
- no mutation of known stranded or unrelated production rows
- proof artifact contains command, timestamp, branch SHA, and observed result
- T1 runtime proof uses the real repository path and live DB when required

### In-memory test repositories

In-memory repositories are valid for unit tests and fast local verification, but they do not prove Postgres constraints, trigger behavior, atomic RPC semantics, RLS posture, or live schema parity. Any DB-sensitive runtime lane must pair in-memory tests with the required live proof gate for its tier.

---

## Table Classification

| Classification | Definition | Examples | Retention posture | Archive posture |
|---|---|---|---|---|
| Core business truth | Rows required to reconstruct official pick, lifecycle, settlement, and delivery state | `picks`, `pick_lifecycle`, `settlement_records`, `distribution_outbox`, `distribution_receipts` | Permanent or PM-approved archive after long hot window | Export-only first; never destructive without explicit PM sign-off |
| Immutable audit/event truth | Append-only proof of decisions and state transitions | `audit_log`, `submission_events`, promotion history tables | Long hot retention; index before pruning | Export with SHA-bound manifest before any prune |
| Provider current truth | Current or recent data needed for scoring, CLV, and settlement support | `provider_offers`, `provider_offer_history`, `odds_snapshots`, `game_results` | Bounded by table-specific retention and partitions | Archive payload-heavy history before drop/delete |
| Telemetry and run metadata | Operational observability, debugging, and incident reconstruction | `system_runs`, worker run/certification metadata | Short hot window, failure carve-outs | Summarize or object-export when needed |
| Raw payload/archive source | Large source-provider bytes and replay material | `raw_payloads`, oversized provider blobs | Short hot window | Object store is preferred durable tier |
| Reference/configuration | Stable lookup, target, model, or environment configuration | sports, leagues, teams, capper/config tables, model registry tables | Permanent | Export as part of backup/restore proof |
| Factory/proof fixtures | Test-generated rows and evidence fixtures | issue-scoped proof rows | Issue-scoped or policy-scoped | Preserve only when proof requires immutability |

---

## Retention, Partition, and Index Strategy

### Retention principles

1. Every high-growth table must have a declared hot retention window.
2. Retention deletes must be batched, timeout-bounded, observable, and idempotent.
3. Retention must not delete active lifecycle, settlement, delivery, or proof rows.
4. Tables must have supporting indexes before any recurring prune job is scheduled.
5. Failed/error rows get longer carve-outs than success telemetry.
6. A retention lane must capture before/after counts, sizes, and vacuum/analyze evidence.

### Partition principles

Use range partitioning for large time-series tables where retention is naturally date-based and write patterns are append-heavy.

| Candidate | Partition key | Rationale |
|---|---|---|
| `provider_offer_history` | `snapshot_at` | Historical offer time series; partitioning already exists and should be monitored. |
| `system_runs` | `created_at` | High-volume telemetry; month partitions allow cheap retirement. |
| `odds_snapshots` | `snapshot_at` or `created_at` | Payload-heavy time series; partition drop is safer after archive proof. |
| `audit_log` | `created_at` | Append-only growth; partition only with careful audit retention policy. |

Partition drops are destructive. They require archive proof, PM approval, and a separate migration/execution lane.

### Index principles

- Every retention predicate needs a matching index before recurring deletes.
- Every operator-facing lookup needs an index or a documented query budget.
- Index creation on large hot tables must use the safest available Postgres/Supabase approach and a maintenance window when required.
- Index-only changes still follow the migration workflow because they change production schema and planner behavior.

---

## Migration Gates

All schema changes follow `docs/05_operations/DB_MIGRATION_WORKFLOW.md`.

Minimum gate by change class:

| Change class | Examples | Minimum gate |
|---|---|---|
| Spec-only | This document, non-executable architecture definitions | T2 docs verification, no DB apply |
| Read-only monitor | SELECT-only health workflow | T3/T2 depending on runtime sensitivity |
| Additive schema | new table, nullable column, new index | PM approval, migration PR, `pnpm verify`, type regeneration when needed |
| Data-mutating | backfill, archive manifest update, corrective insert | PM explicit approval, row-count estimate, maintenance window, before/after proof |
| Destructive | drop partition, delete old rows, truncate, drop column | PM explicit sign-off, archive/restore evidence, forward-fix plan |
| Runtime DB writer | service/repository behavior that writes DB state | Tier per path; live proof when required |

No migration may be applied directly to live Supabase before merge. The normal path is migration file in PR, verification, review, merge, then approved deploy via the sanctioned Supabase workflow.

---

## Monitoring Requirements

DB monitoring must distinguish code failure, proof insufficiency, and infrastructure unavailability.

Required monitors:

| Monitor | Frequency | Alert threshold | Owner/action |
|---|---|---|---|
| Hot table size | 6h | table-specific threshold or >50 MB growth per 6h | Post Linear alert with table, bytes, delta |
| Dead tuple and autovacuum staleness | 6h | no analyze/vacuum or stale >24h on hot table | Page PM for persistent NULL/stale values |
| Statement timeout rate | 1h/6h rollup | >3 timeouts/hour; >10/hour pages | Attach query/log excerpt and runtime surface |
| TOAST bloat | 6h | payload-heavy table >80% TOAST/index share | Recommend archive/retention lane |
| Partition health | daily | missing current/future partition or stale newest partition | Open migration/ops lane |
| Live proof classification | per CI run | `code_failed` blocks; infra state classified | Keep T1 fail-closed; docs/T2 static lanes can proceed per policy |
| Backup/restore proof | scheduled | missing or stale restore drill | Block destructive archive/delete proposals |

Monitoring workflows must be read-only unless explicitly ratified as maintenance jobs.

---

## Recovery and Proof Standard

No handoff may claim "DB recovered", "archive complete", "retention complete", or "partition migration safe" without evidence tied to the relevant commit or execution window.

Required evidence for DB recovery or retention claims:

- branch SHA or merge SHA
- measurement timestamp
- row counts before and after
- `pg_total_relation_size` before and after
- `last_vacuum`, `last_autovacuum`, `last_analyze`, and `last_autoanalyze`
- `n_dead_tup` and `n_live_tup`
- statement timeout count over the same window
- archive manifest path and hash when archive is involved
- rollback or forward-fix decision for destructive changes

Spec-only lanes such as UTV2-1328 satisfy proof through diff summary, static verification, and R-level/file-scope evidence. They do not assert runtime DB health.

---

## Execution Sequencing

Recommended future work order after PM ratifies this spec:

1. Confirm read-only DB health monitor coverage and alert routing.
2. Ratify archive manifest schema and object-store bucket contract.
3. Implement object-store archive writes for oversized payloads in a separate approved lane.
4. Prove hot table size, bloat, and vacuum monitor fidelity.
5. Run targeted retention lanes in order of operational risk: `system_runs`, `raw_payloads`, `odds_snapshots`.
6. Consider partition migrations only after retention and archive proof demonstrate the need.
7. Keep proof/factory DB policy separate from production migration policy so test data cannot be mistaken for runtime truth.

This document is the architecture boundary. It is not approval to execute any item in the sequence.

---

## Cross-References

- `docs/05_operations/DB_MAINTENANCE_RETENTION_SPEC.md`
- `docs/05_operations/DB_SCALING_STRATEGY.md`
- `docs/05_operations/DB_MIGRATION_WORKFLOW.md`
- `docs/05_operations/DB_ROLLBACK_RUNBOOK.md`
- `docs/05_operations/LIVE_DB_VERIFY_ISOLATION_BRANCH_PROTECTION.md`
- `docs/05_operations/SUPABASE_CONNECTION_STRATEGY.md`
- `docs/05_operations/POSTGRES_ROLE_MODEL.md`
- `docs/05_operations/r1-r5-rules.json`
