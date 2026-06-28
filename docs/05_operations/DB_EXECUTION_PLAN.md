# DB Finalization — Gated Execution Plan

**Issue:** UTV2-1341  
**Tier:** T2  
**Status:** Draft execution plan for PM ratification  
**Lane type:** Docs-only plan. No SQL execution, DDL, code changes, DB mutations, Supabase branch creation, or production apply are authorized by this document.  
**Created:** 2026-06-27  

---

## Purpose

This document converts `docs/05_operations/DB_ARCHITECTURE_SPEC.md` into a gated execution sequence for finalizing the Unit Talk V2 database operating model.

It defines the order, ownership boundaries, proof requirements, and stop conditions for future implementation lanes covering:

- hot production DB health and ledger alignment
- migration queue reconciliation
- retention, archive, and partition work
- monitoring and evidence capture
- production apply and post-apply verification

This plan is intentionally non-executable. Each lane below requires its own Linear issue, tier, allowed file scope, operator approval, verification evidence, and PR.

---

## Non-Scope

This plan does not authorize:

- production data mutation
- schema migration creation or application
- `supabase db push`
- `supabase migration repair`
- Supabase preview branch creation
- direct dashboard SQL writes
- delete, truncate, repartition, backfill, or archive execution
- changes to runtime services, repositories, lifecycle logic, promotion logic, settlement logic, delivery workers, or generated DB types

Any future lane that needs one of those actions must carry explicit scope and approval in that lane's packet.

---

## Execution Principles

1. **Migration files remain schema authority.** Live schema is execution state; it is not edited directly.
2. **Production write authority stays with the operator.** Agents may draft, verify, and report; production applies require current-session operator authorization.
3. **No live DDL before merge.** Migration apply happens only after review, CI, merge, and sanctioned deploy flow.
4. **Hot truth stays in Postgres.** Archive and proof stores support replay and investigation but do not override active runtime truth.
5. **Destructive work is last.** Archive proof, restore proof, row counts, and PM sign-off must exist before any delete, drop, truncate, or partition retirement.
6. **Runtime-critical truth fails closed.** Lifecycle, settlement, promotion/routing, delivery queue, and current provider state cannot silently degrade.
7. **Every claim needs evidence.** "Recovered", "retained", "archived", "healthy", and "applied" require timestamped proof tied to a branch, PR, or merge SHA.

---

## Lane Sequence

### Phase 0 — Static Plan Ratification

**Goal:** Ratify this execution sequence before any implementation lane begins.

**Allowed actions:**

- Review this plan against `DB_ARCHITECTURE_SPEC.md`, `DB_MIGRATION_WORKFLOW.md`, `DB_ENVIRONMENT_OPERATOR_POLICY.md`, and `DB_ROLLBACK_RUNBOOK.md`.
- Confirm lane ordering and stop conditions.
- Record PM changes as docs-only edits.

**Exit evidence:**

- PR containing this document.
- `pnpm verify` pass or documented baseline failure.
- R-level compliance output.

**Stop conditions:**

- PM changes the DB authority model.
- The plan requires work outside the ratified DB architecture.

### Phase 1 — Read-Only Inventory and Ledger Baseline

**Goal:** Capture the current production/schema baseline without mutation.

**Allowed actions:**

- Run read-only ledger checks such as `supabase migration list --linked`.
- Capture local migration inventory from `supabase/migrations/`.
- Capture read-only table size, index, partition, dead tuple, and autovacuum/analyze state.
- Identify remote-only, local-only, and divergent migration state.

**Explicitly forbidden:**

- `supabase db push`
- `supabase migration repair`
- dashboard schema edits
- row updates or backfills

**Exit evidence:**

- Ledger comparison.
- Table classification mapping to the DB architecture categories.
- Read-only health snapshot with timestamp and project ref.
- List of migrations that need separate implementation lanes.

**Stop conditions:**

- Ledger output differs from the expected D3 baseline in `DB_MIGRATION_WORKFLOW.md`.
- Remote-only schema objects appear without a migration source.
- A read-only probe indicates active corruption or runtime-impacting DB failure.

### Phase 2 — Migration Queue Classification

**Goal:** Convert pending migration candidates into separately reviewable execution lanes.

**Allowed actions:**

- Classify each migration candidate using the risk taxonomy in `DB_MIGRATION_WORKFLOW.md`.
- Declare dependencies, remote ledger prerequisites, expected generated type changes, and post-apply tests.
- Split mixed-risk migrations when needed.

**Exit evidence:**

- One risk record per migration candidate.
- Apply order proposal.
- Required approval artifact for each migration.
- Rollback or forward-fix posture for each migration.

**Stop conditions:**

- A migration combines destructive, data-mutating, and additive work that cannot be reviewed independently.
- A migration depends on a missing remote ledger entry.
- A migration touches lifecycle, settlement, audit, promotion, or delivery truth without corresponding runtime proof requirements.

### Phase 3 — Local and Branch Rehearsal

**Goal:** Prove candidate migrations can replay safely before production review.

**Allowed actions:**

- Run local replay with `supabase db reset` when local Supabase is intentionally available.
- Run `pnpm supabase:types` only in lanes allowed to touch generated DB types.
- Use a Supabase preview branch only after explicit operator approval.

**Exit evidence:**

- Replay command output.
- Type generation diff, if applicable.
- `pnpm type-check`, `pnpm test`, and issue-specific DB tests required by that lane.
- Preview branch teardown plan when a branch is approved.

**Stop conditions:**

- Local replay fails in a way not understood.
- Generated type changes exceed the migration scope.
- Preview branch cost or lifetime cannot be bounded.

### Phase 4 — Hot Retention, Archive, and Partition Preparation

**Goal:** Prepare high-growth table work without deleting hot truth.

**Allowed actions:**

- Draft archive manifest format and object path conventions.
- Identify indexes needed for retention predicates.
- Measure candidate table growth, TOAST share, partition state, and query budget.
- Prepare non-destructive migration candidates for indexes or manifest tables.

**Exit evidence:**

- Before-count and size snapshot.
- Archive candidate list by table and predicate.
- Required indexes for each retention predicate.
- Explicit carve-outs for active lifecycle, settlement, delivery, proof, and failure rows.

**Stop conditions:**

- Archive manifest cannot prove object integrity.
- Retention predicate could select active business truth.
- Partition retirement would drop data without restore evidence.

### Phase 5 — Monitoring and Alerting Implementation

**Goal:** Add read-only monitors before recurring maintenance jobs or destructive actions.

**Allowed actions:**

- Implement or schedule read-only DB health checks in an approved lane.
- Define alert thresholds for table growth, dead tuple staleness, statement timeouts, TOAST bloat, and partition health.
- Add proof classification for live DB checks where CI needs to distinguish code failure from infrastructure unavailability.

**Exit evidence:**

- Monitor definitions and thresholds.
- Sample output from read-only checks.
- Escalation owner and action for each alert.

**Stop conditions:**

- A monitor needs write access to report status.
- Alert thresholds are not tied to an operational response.

### Phase 6 — Production Apply Windows

**Goal:** Apply approved migrations through the sanctioned production path only.

**Prerequisites:**

- PR merged.
- Operator approval artifact exists for the exact migration file SHA.
- `pnpm verify` green on the PR.
- Ledger alignment checked immediately before apply.
- Rollback or forward-fix posture recorded.

**Allowed actions:**

- Operator runs `supabase db push --linked` or grants explicit current-session authorization for the named migration.
- Agent may observe, capture output, and run approved post-apply verification.

**Exit evidence:**

- Apply command output or operator attestation.
- Post-apply `pnpm supabase:types`, `pnpm type-check`, and `pnpm test:db` where required.
- Ledger state after apply.
- Runtime smoke result for affected surface.

**Stop conditions:**

- Ledger diverges before apply.
- Apply returns non-zero or unexpected output.
- Post-apply `pnpm test:db` fails.
- PostgREST schema cache or runtime errors appear after apply.

### Phase 7 — Destructive or Data-Mutating Maintenance

**Goal:** Execute any archive-backed delete, partition drop, or corrective data mutation only after all prior gates pass.

**Prerequisites:**

- Separate PM-approved lane.
- Row count estimate.
- Before/after table size plan.
- Archive manifest path and hash when data leaves hot Postgres.
- Forward-fix or PITR decision recorded.
- Maintenance window approved.

**Exit evidence:**

- Before and after row counts.
- Before and after `pg_total_relation_size`.
- Dead/live tuple and vacuum/analyze state.
- Archive manifest hash, if archive is involved.
- Statement timeout observation over the same window.

**Stop conditions:**

- Predicate includes active lifecycle, settlement, delivery, or proof rows.
- Archive write or manifest verification fails.
- PM sign-off for destructive work is absent.

---

## Required Lane Artifacts

Each future execution lane must produce:

- issue id, tier, branch, and allowed file scope
- risk classification
- command log or concise proof artifact
- verification result with timestamp and commit SHA
- R-level compliance result
- explicit statement of whether production was read, written, or untouched
- rollback or forward-fix posture when schema or data changes are involved

Lanes that touch migrations must also produce:

- migration filename and SHA
- ledger precheck output
- operator approval artifact
- generated DB type status
- post-apply verification plan

Lanes that touch retention/archive/destructive paths must also produce:

- row-count estimate
- archive manifest/hash evidence when applicable
- before/after relation size evidence
- PM sign-off reference

---

## Ownership Boundaries

| Work class | Owner / authority | Notes |
|---|---|---|
| Execution planning | PM-ratified docs lane | This document defines sequence only. |
| Migration draft | Implementation lane | Requires separate allowed scope. |
| Production migration apply | Operator | Agent only with current-session explicit authorization. |
| Runtime DB writer changes | Codex implementation lane | Must use repositories and required live proof by tier. |
| Docs/status artifacts outside lane scope | Claude/status lane | Do not edit unless explicitly allowed. |
| Generated DB types | Migration lane only | Never hand-edit. |
| Destructive maintenance | PM explicit sign-off | Separate lane and evidence bundle required. |

---

## Finalization Criteria

The DB finalization program is complete only when all of the following are true:

- migration ledger and local migration source are reconciled or explicitly documented as intentionally divergent
- pending migration queue has been applied, deferred, or closed with PM decision records
- hot production DB table classifications are current
- retention/archive candidates have manifests, indexes, and proof requirements before execution
- monitoring exists for table growth, stale vacuum/analyze, statement timeouts, TOAST bloat, and partition health
- destructive/data-mutating maintenance has independent PM approval and proof
- recovery runbooks remain linked from every migration or maintenance lane

Until then, no lane may claim "DB finalized" or "DB recovered"; it may only claim the specific gate it completed.

