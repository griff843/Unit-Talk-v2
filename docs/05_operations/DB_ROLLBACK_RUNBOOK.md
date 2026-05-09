# DB Rollback and Forward-Fix Runbook

**Status:** RATIFIED
**Date:** 2026-05-08
**Linear:** UTV2-866
**Parent:** UTV2-855 (DB truth / schema discipline umbrella)
**Tier:** T2 — Operations
**Authority:** PM (A Griffin). Owned.

---

## Purpose

This runbook defines how to respond to a failed or bad migration in production. It covers the rollback decision, the forward-fix alternative, incident recovery sequencing, and the live recovery decision matrix. It is referenced by `DB_MIGRATION_WORKFLOW.md` (UTV2-856).

---

## Foundational Principle

> Supabase does not support declarative migration rollback via CLI. `supabase db push` is one-way. Rolling back means either PITR or a new forward-fix migration.

Design migrations to be safe to leave in place if something goes wrong. If a migration cannot be safely left half-applied, it must be split into smaller, independently-safe steps before it is submitted for operator review.

---

## Recovery Decision Matrix

Use this matrix first. Do not jump to action before classifying the incident.

| Migration type | Failure mode | Recommended path | Operator required |
|---|---|---|---|
| Additive-safe (new table / nullable column / index) | Apply failed mid-way | Inspect live schema → confirm partial state → forward-fix migration to finish or clean up | Yes |
| Additive-safe | Applied fully but runtime broke | Forward-fix: add missing grants, fix constraint, or revert in a new migration | Yes |
| Constraint-add (`NOT VALID`) | Apply failed | Constraint not added — low risk, retry after fixing cause | Yes |
| Data-mutating | Apply failed mid-way | Partial row writes possible — inspect affected tables → scope damage → forward-fix or PITR | Yes — escalate immediately |
| Data-mutating | Applied, results incorrect | Forward-fix reversal migration (operator-reviewed) or PITR if data integrity is compromised | Yes — PM sign-off |
| Destructive (`DROP`, `TRUNCATE`) | Apply failed mid-way | Object may be partially dropped — PITR is the recovery path | Yes — PM sign-off + PITR |
| Destructive | Applied, data lost | PITR only | Yes — PM sign-off |
| Cron-mutating | Applied with wrong cron body | Forward-fix: reschedule with corrected body; disable cron job immediately if actively destructive | Yes — operator executes |

---

## Step-by-Step Incident Response

### Phase 1: Halt and assess (< 5 minutes)

1. Stop any further `supabase db push` operations immediately.
2. Run a ledger check:
   ```bash
   supabase migration list --linked
   ```
3. Query the live schema to confirm current state. Use Dashboard SQL editor (read-only):
   ```sql
   SELECT column_name, data_type, is_nullable
   FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = '<affected_table>'
   ORDER BY ordinal_position;
   ```
4. Determine: is the failure in-flight (partial apply) or post-apply (bad outcome)?
5. Open a Linear comment on the current issue with: failure mode, ledger output, and affected objects.

### Phase 2: Scope the damage (< 15 minutes)

For data-mutating failures:
```sql
-- Count affected rows before and after the mutation point
SELECT COUNT(*) FROM public.<table_name> WHERE <condition>;
```

For constraint failures:
```sql
-- Check for constraint violations
SELECT * FROM public.<table_name> WHERE NOT (<constraint_expression>) LIMIT 20;
```

For cron-mutating failures:
```sql
-- Check current cron state
SELECT jobid, jobname, schedule, command, active FROM cron.job ORDER BY jobid;
```

Record the scope in the Linear comment.

### Phase 3: Decide — rollback vs. forward-fix

Use the matrix above. Default to forward-fix for all cases except:
- Data is irrecoverably corrupted (requires PITR)
- A destructive action completed and the data is gone (requires PITR)

If PITR is required, escalate to PM immediately and halt all further DB actions. PITR restores the entire DB to a point in time — all changes since the restore point are lost, not just the bad migration.

### Phase 4: Execute the recovery

#### Forward-fix path

1. Draft a new migration file:
   ```
   supabase/migrations/YYYYMMDDNNNN_utv2_###_forward_fix_description.sql
   ```
2. Classify the forward-fix migration using the risk taxonomy in `DB_MIGRATION_WORKFLOW.md`.
3. Test locally:
   ```bash
   supabase db reset   # replay all migrations locally
   pnpm type-check
   pnpm test:db
   ```
4. Surface to operator for review. Operator approves in Linear or PR comment.
5. Apply via `supabase db push --linked`.
6. Post-apply: run `pnpm test:db` and `pnpm supabase:types`. Both must pass.

#### PITR path

PITR (Point-in-Time Recovery) is the emergency backstop for data loss. It is executed via the Supabase dashboard, not the CLI.

1. Open Supabase Dashboard → Project → Settings → Database Backups.
2. Identify the restore point (timestamp before the bad migration apply).
3. PM must authorize the restore explicitly (the restore point discards all changes since that timestamp).
4. Execute restore from Dashboard.
5. After restore: re-run `supabase migration list --linked` to confirm ledger state.
6. Re-apply any migrations that landed between the restore point and the bad migration (in order, after reviewing each).
7. Run `pnpm test:db` to confirm runtime health.
8. Commit a proof artifact documenting the incident, the restore point, and the recovery outcome.

---

## Migration Failure Handling Standards

### Half-applied state

A half-applied migration is the most dangerous state. Supabase CLI applies migrations as a transaction when possible, but some DDL (index creation, large table mutations) may not be fully transactional.

Signs of half-applied state:
- `supabase migration list --linked` shows the migration as applied, but the live schema is incomplete
- Runtime errors appear for objects that were supposed to be created
- Row counts are lower than expected after a data-mutating migration

If half-applied state is confirmed:
1. Do not run `supabase migration repair` to hide the problem.
2. Assess whether the partial state is safe to leave until a forward-fix is ready.
3. If the partial state is actively harmful (e.g., a partial constraint drop leaves rows without expected integrity), escalate to PITR decision.

### `supabase migration repair`

`supabase migration repair` manipulates the `supabase_migrations.schema_migrations` ledger. It does not change the live schema. Misuse can make the ledger disagree with reality.

Only use repair when:
- A migration applied successfully to the live schema but was not recorded in the ledger (e.g., applied outside the CLI)
- Operator explicitly names the migration ID and the target status (`--status applied` or `--status reverted`)

Never run repair to "un-apply" a migration that actually ran — it will cause the next `db push` to re-apply a migration to an already-modified schema, producing unpredictable results.

### Cron job failures

If a cron-mutating migration produced a bad cron schedule:

1. Disable the affected cron job immediately:
   ```sql
   SELECT cron.unschedule('<job-name>');
   ```
2. Verify no cron executions are in-flight:
   ```sql
   SELECT * FROM cron.job_run_details WHERE job_id = <job_id> ORDER BY start_time DESC LIMIT 5;
   ```
3. Draft a forward-fix migration that restores the correct cron schedule.
4. Operator reviews the new cron body verbatim before apply.

---

## Prohibited Rollback Patterns

These patterns are explicitly prohibited:

| Pattern | Why prohibited |
|---|---|
| Manually editing `supabase/migrations/*.sql` after the migration has been applied to production | Migration file history becomes false; future replays are corrupted |
| Running `supabase migration repair --status reverted` on a migration that actually ran | Causes double-apply on next push |
| Dropping a table in the Dashboard to "undo" a migration | Creates remote-only drift; not tracked in ledger |
| Applying PITR without PM sign-off | PITR discards all changes since the restore point — unauthorized data loss |
| Running a destructive forward-fix without operator review | Forward-fix migrations are migrations and must follow the full workflow |

---

## Unsafe Rollback Patterns — Special Cases

### Provider retention slice (`202605030001`, `202605030002`)

These migrations include a cron reschedule and a function that **drops historical partitions when executed**. If applied incorrectly:
- Do not attempt to manually undo the cron body by editing cron state without reviewing the full schedule.
- The `drop_old_provider_offer_history_partitions` function will delete data if called. Do not call it during recovery without verifying partition boundaries.

### Ownership persistence (`202605070002`)

Includes `UPDATE public.model_registry`. If the update produced wrong values:
- Identify affected rows and their pre-migration values (from PITR or prior proof artifacts).
- Draft a forward-fix that re-applies correct values for affected rows.
- Do not use PITR for this class of error unless the row count impact is unacceptably large.

---

## Post-Recovery Checklist

After any recovery action (forward-fix or PITR):

- [ ] `supabase migration list --linked` matches expected state
- [ ] `pnpm type-check` passes
- [ ] `pnpm test:db` passes
- [ ] Affected tables and objects verified via read query
- [ ] Linear comment updated with: recovery path taken, post-recovery state, and proof references
- [ ] Proof artifact committed to `docs/06_status/proof/UTV2-###/`
- [ ] If PITR was used: PM sign-off recorded in Linear

---

## Cross-References

- `docs/05_operations/DB_MIGRATION_WORKFLOW.md` — canonical migration workflow (UTV2-856)
- `docs/05_operations/DB_ENVIRONMENT_OPERATOR_POLICY.md` — environment and operator policy (UTV2-858)
- `docs/05_operations/SUPABASE_CONNECTION_STRATEGY.md` — connection and credential reference
- `docs/05_operations/WALPITR_RESTORE_RUNBOOK.md` — WAL/PITR backup restore runbook (UTV2-782)
- `docs/06_status/proof/UTV2-855/phase9-manual-schema-reconciliation-plan.md` — current migration queue
