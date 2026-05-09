# Supabase Migration Reconciliation and Live Ownership Rollout Runbook

**Issue:** UTV2-855  
**Generated:** 2026-05-07  
**Status:** Operator-review required before any execution  
**Authority:** This document is the operator-approved plan. Codex executes only against this document, section by section, with operator sign-off at each checkpoint.

---

## 1. Current Live Truth

### Repo / Runtime State

| Layer | State |
|---|---|
| Migration file | `supabase/migrations/202605070002_utv2_854_model_ownership_persistence.sql` — **present in repo** |
| Runtime code | `candidate-scoring-service.ts`, `repositories.ts`, `runtime-repositories.ts`, `types.ts` — **updated in commit `38392b5`** |
| Runtime behavior | Scoring service attempts to write `model_registry_id`, `scoring_run_id`, `ownership_timestamp` on every scored candidate |
| Tests | Unit and DB smoke tests exist; pass against in-memory repo; **cannot pass against live DB** until columns exist |

### Local Schema State

Migration `202605070002` is in the repo. It has **not been applied** to the linked Supabase environment. The `ROLLBACK` statement was removed from the final migration file (the planning artifact in `proof/UTV2-853/migration-plan.sql` still contains `ROLLBACK`; the committed migration file does not).

### Linked Supabase State

As of the last schema probe (evidence.json, UTV2-854, generated 2026-05-07T21:58:12Z):

| Column / Table | Present in Live DB |
|---|---|
| `pick_candidates.model_registry_id` | **NO** |
| `pick_candidates.scoring_run_id` | **NO** |
| `pick_candidates.ownership_timestamp` | **NO** |
| `model_registry.registry_entity_type` | **NO** |
| `model_registry.source_type_compatibility` | **NO** |
| `model_registry.active_state` | **NO** |

**The repo can generate model-owned inventory in code, but the linked environment cannot yet persist it.**

### Migration Divergence State

`supabase db push --dry-run` reported remote migration-history divergence during UTV2-854 execution. The exact nature of the divergence (missing migration, checksum mismatch, orphaned entry, manual schema drift) was **not diagnosed** — the operator halted before mutating anything. DNS/hostname resolution also failed during `pnpm supabase:types` against the linked DB host, which prevented type regeneration proof.

### Current Ownership Metrics

| Metric | Value |
|---|---|
| Total picks | 4,204 |
| Total candidates | 19,792 |
| Scored candidates | 6,889 |
| Model-attributed (%) | **0%** |
| Model-generated inventory | **0** |
| Ownership write success (%) | **0%** — all writes fail because columns do not exist |
| Null ownership quarantined | 6,889 |
| Historical UNKNOWN rows | 4,202 (permanently UNKNOWN; no backfill permitted) |

**The system is in a split state:** runtime produces ownership writes; live database silently discards them because the columns are absent.

---

## 2. Risk Classification

### Low-Risk (safe to proceed without operator approval per-step)

- Reading migration history from `supabase.migrations` table (read-only SELECT)
- Inspecting remote schema via `information_schema` (read-only SELECT)
- Running `supabase db push --dry-run` (no mutations)
- Running `supabase migration list` (read-only)
- Comparing local migration files vs. remote history by checksum
- Running `pnpm verify` locally (no DB writes)

### Medium-Risk (require operator sign-off before execution)

- Applying migration `202605070002` via `supabase db push` or `supabase migration up`
- Normalizing `model_registry` metadata via the migration's `UPDATE` statement
- Adding FK constraints from `pick_candidates` to `model_registry`
- Regenerating `database.types.ts` via `pnpm supabase:types`

### High-Risk (forbidden without explicit operator approval AND written rationale)

- Force-pushing any migration (`supabase migration repair --status applied`)
- Manually editing the `supabase.migrations` table
- Dropping or recreating `pick_candidates` or `model_registry`
- Replaying migrations from scratch (`supabase db reset`)
- Manually patching `model_registry_id` values into historical rows
- Marking a diverged migration as applied without verifying it was actually applied

### Explicitly Forbidden (never do, no exceptions)

- Retroactive backfill of `model_registry_id` on historical pick_candidates rows
- Fabricating `ownership_timestamp` values for rows that were scored before the migration
- Creating a Supabase preview branch to "test" the migration state without operator approval
- Running `supabase db reset` against the linked (production) project
- Marking migrations as applied that were NOT applied

---

## 3. Migration-History Diagnosis Plan

### Step 3.1 — Inspect remote migration history

```sql
-- Run via Supabase MCP execute_sql or psql
SELECT version, name, statements, inserted_at
FROM supabase_migrations.schema_migrations
ORDER BY inserted_at ASC;
```

Expected output: a list of migration version timestamps. Compare against local `supabase/migrations/` directory listing.

### Step 3.2 — List local migrations

```bash
ls supabase/migrations/ | sort
```

Expected: sorted list from earliest to latest, ending with `202605070002_utv2_854_model_ownership_persistence.sql`.

### Step 3.3 — Compare checksums

For each migration that appears in the remote history, compare the `statements` field (or checksum if stored) against the local file content. Any difference indicates:
- The local file was modified after remote application (medium-risk)
- The remote history entry was edited directly (high-risk; do not attempt to repair)

### Step 3.4 — Classify the divergence

Run the decision matrix in Section 4 against these findings:

| Check | Command |
|---|---|
| Does remote history contain `202605070002`? | SELECT from schema_migrations WHERE version = '202605070002' |
| Does remote `pick_candidates` have `model_registry_id`? | SELECT column_name FROM information_schema.columns WHERE table_name='pick_candidates' AND column_name='model_registry_id' |
| Does remote `model_registry` have `active_state`? | SELECT column_name FROM information_schema.columns WHERE table_name='model_registry' AND column_name='active_state' |
| Any migration listed remotely that doesn't exist locally? | Cross-reference history output vs. local ls |
| Any local migration not listed remotely? | Cross-reference local ls vs. history output |

### Step 3.5 — DNS resolution check

If `pnpm supabase:types` fails:

```bash
# Check if Supabase CLI can reach the project
supabase status

# Check env config
echo $SUPABASE_DB_URL

# Check project ref
cat supabase/config.toml | grep project_id
```

If DNS fails but `supabase status` shows connected: the TypeScript codegen uses a direct DB connection string that may differ from the API URL. Verify `SUPABASE_DB_URL` or `DATABASE_URL` in `local.env` resolves to the correct host.

A DNS-only failure does NOT indicate migration divergence. Resolve DNS before diagnosing migration state.

---

## 4. Safe Reconciliation Decision Tree

### Case A — Remote missing migration only

**Condition:** Migration `202605070002` does not appear in `supabase.migrations` table. Remote schema does NOT have ownership columns. Local file is correct.

**Diagnosis:** The migration was never applied. This is the expected and safe state after a divergence warning caused the operator to halt.

**Safe action:**
1. Confirm the columns are absent (information_schema check)
2. Run `supabase db push --dry-run` to preview the migration
3. Operator approves the dry-run output
4. Run `supabase db push` (apply the migration)

**Forbidden action:** Do NOT run `supabase migration repair`. This case does not require repair — it requires a normal apply.

**Codex may execute:** Yes, after operator reviews dry-run output.

**Manual operator intervention:** Required for the dry-run review before apply.

---

### Case B — Migration exists in remote history but schema has no ownership columns

**Condition:** `supabase.migrations` contains `202605070002` but `pick_candidates.model_registry_id` does NOT exist in `information_schema`.

**Diagnosis:** The migration was recorded as applied but did not execute (e.g., the migration was run in `--repair` mode without actual SQL execution, or the migration ran inside a transaction that was rolled back but the history record was committed separately).

**Safe action:**
1. Verify the discrepancy by checking `information_schema.columns`
2. Do NOT re-apply the migration via `supabase db push` (it will skip because history says applied)
3. Run the migration SQL manually via `execute_sql` MCP tool: apply only the `ALTER TABLE` and `CREATE INDEX` statements
4. Verify columns exist after manual application

**Forbidden action:** Do NOT mark it applied again via repair. Do NOT drop and recreate the table.

**Codex may execute:** No — this requires manual operator execution of specific SQL statements via MCP. Codex proposes the exact SQL; operator executes it.

**Manual operator intervention:** Required. Operator runs the SQL directly.

---

### Case C — Remote schema manually drifted

**Condition:** Remote schema has some ownership columns but not all, OR has columns with different types/constraints than the migration defines.

**Diagnosis:** Someone (or another migration) manually altered the schema outside of the migration system. The migration file may conflict.

**Safe action:**
1. List all ownership-related columns and their types from `information_schema`
2. Compare against what `202605070002` defines
3. For each missing column: add it individually via `execute_sql` using `ADD COLUMN IF NOT EXISTS`
4. For each type mismatch: escalate to operator decision — do NOT attempt to alter column types automatically

**Forbidden action:** Do NOT run the full migration file without verifying each statement won't conflict. Do NOT drop and recreate columns that already exist with correct types.

**Codex may execute:** Partial — Codex may add missing columns via targeted SQL. Type mismatches are operator decisions.

**Manual operator intervention:** Required for type mismatch resolution.

---

### Case D — Migration history corrupted or orphaned

**Condition:** Remote history contains migration versions with NULL checksums, duplicate entries, or entries that don't correspond to any local file.

**Diagnosis:** Migration history is in an unreliable state. This is the highest-risk scenario.

**Safe action:**
1. Record the full contents of `supabase.migrations` (read-only)
2. Identify orphaned entries (in remote history, not in local `supabase/migrations/`)
3. Do NOT delete orphaned entries without understanding what schema changes they represent
4. Escalate to operator with a full history dump before any action

**Forbidden action:** Do NOT delete from `supabase.migrations`. Do NOT run `supabase db reset`. Do NOT run `supabase migration repair` against an orphaned entry.

**Codex may execute:** No — diagnosis only. No writes.

**Manual operator intervention:** Required before any reconciliation.

---

### Case E — DNS / host resolution issue only

**Condition:** `supabase db push --dry-run` or `pnpm supabase:types` fails with DNS lookup errors. No evidence of actual migration divergence.

**Diagnosis:** Network or environment issue. Not a migration problem.

**Safe action:**
1. Verify `SUPABASE_DB_URL` and `DATABASE_URL` in `local.env`
2. Verify Supabase project ref in `supabase/config.toml`
3. Run `supabase status` to confirm project linkage
4. If DNS fails: check VPN, firewall, or DNS resolver configuration
5. Once DNS resolves: re-run `--dry-run` to get accurate migration status

**Forbidden action:** Do NOT attempt to infer migration state from DNS errors. Do NOT apply migrations while DNS is broken.

**Codex may execute:** Environment diagnosis only. No DB writes until DNS is confirmed.

**Manual operator intervention:** Required if VPN/firewall is the cause.

---

## 5. Ownership Rollout Plan

Execute in this exact order. Do not skip steps. Do not proceed past a checkpoint without operator confirmation.

### Step 1 — Verify migration integrity

**What:** Run the diagnosis commands from Section 3 (Steps 3.1–3.5).  
**Output:** Classified divergence case (A/B/C/D/E).  
**Gate:** Do not proceed until case is classified and the decision tree resolution is agreed.

### Step 2 — Apply the ownership migration

**What:** Apply `202605070002_utv2_854_model_ownership_persistence.sql` using the appropriate mechanism for the classified case.  
**Dry-run command:**
```bash
supabase db push --dry-run
```
**Apply command (operator-approved only):**
```bash
supabase db push
```
**Gate:** Operator must review dry-run output before apply. Do not apply without operator sign-off.

**Why this comes second:** The columns must exist before any runtime verification or type regeneration can succeed. No downstream step is possible until the schema is correct.

### Step 3 — Verify ownership columns live

**What:** Confirm via `information_schema` that all six new columns exist with correct types.

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('pick_candidates', 'model_registry')
  AND column_name IN (
    'model_registry_id', 'scoring_run_id', 'ownership_timestamp',
    'registry_entity_type', 'source_type_compatibility', 'active_state',
    'owner', 'training_window_start', 'training_window_end',
    'validation_metrics', 'calibration_metadata',
    'promotion_approved_by', 'promotion_approved_at'
  )
ORDER BY table_name, column_name;
```

**Gate:** All expected columns present. No step 4 without this.

### Step 4 — Regenerate types

**What:** Run `pnpm supabase:types` to regenerate `database.types.ts`.
```bash
pnpm supabase:types
```
**Expected:** No errors. Generated file includes `model_registry_id`, `scoring_run_id`, `ownership_timestamp` on `pick_candidates` and new columns on `model_registry`.

**Gate:** Type generation succeeds with new columns present. Commit the updated types file.

**Why:** The runtime code references these types. Until regenerated, TypeScript will report the new fields as unknown or absent from the generated schema.

### Step 5 — Verify runtime compatibility

**What:** Run `pnpm verify` (full: type-check + lint + build + test).
```bash
pnpm verify
```
**Expected:** Green. The updated runtime code should compile cleanly against regenerated types. In-memory unit tests should pass.

**Gate:** `pnpm verify` exits 0. Do not proceed with live DB tests until this passes.

### Step 6 — Rerun ownership proof

**What:** Run the ownership persistence proof script against the live database.
```bash
npx tsx scripts/model-ownership/run-ownership-persistence-proof.ts
```
**Expected outputs:**
- `schema_probe.pick_candidates_model_registry_id: true`
- `schema_probe.pick_candidates_scoring_run_id: true`
- `schema_probe.pick_candidates_ownership_timestamp: true`
- `live_schema_ready: true`
- `ownership_write_success_pct > 0` for any newly scored candidates
- `metrics.model_attributed_pct` may remain 0 until a real scoring cycle runs

**Gate:** Schema probe passes. Live schema confirmed ready.

### Step 7 — Verify first legitimately owned candidate/pick

**What:** Trigger or observe a live scoring cycle that produces at least one candidate row with non-null `model_registry_id`, `ownership_timestamp`, and a valid FK to `model_registry`.

Verification query:
```sql
SELECT
  pc.id,
  pc.model_registry_id,
  pc.scoring_run_id,
  pc.ownership_timestamp,
  mr.model_name,
  mr.status,
  mr.active_state
FROM pick_candidates pc
JOIN model_registry mr ON mr.id = pc.model_registry_id
WHERE pc.model_registry_id IS NOT NULL
ORDER BY pc.ownership_timestamp DESC
LIMIT 5;
```

**Gate:** At least one row returned. All FK joins resolve. `ownership_timestamp` is post-migration (not a historical backfill). See Section 7 for the full first-success definition.

### Step 8 — Rerun dependent proofs

Once Step 7 passes, re-execute evidence generation for the four upstream standards, in order:

| Proof | Command / Script |
|---|---|
| UTV2-847 (truthworthiness) | Re-run truthworthiness evidence generator |
| UTV2-848 (provenance) | Re-run provenance evidence generator |
| UTV2-849 (source ledger) | Re-run source separation ledger |
| UTV2-850 (registry report) | Re-run champion model registry report |

**Why this order matters:** Each upstream report reads from live DB. Until the ownership columns are present and populated, these reports correctly show 0% model attribution. After Step 7, re-running them will produce the first non-zero model attribution numbers, which is the authentic milestone. Running them earlier would fabricate a false state.

---

## 6. Rollback Plan

### When rollback is required

- The migration apply fails mid-execution (partial column adds)
- The migration creates an FK that fails due to a data integrity violation
- Runtime code after type regeneration fails to compile against the new schema
- An unexpected constraint violation or index conflict is detected post-apply

### What rollback means

Because all new columns are defined as `ADD COLUMN IF NOT EXISTS` with nullable types and no `NOT NULL` constraints, the migration is **largely non-destructive**. However, the `UPDATE` statement in the migration (backfilling `model_registry` metadata fields) mutates existing rows.

Rollback options:

| Scope | Safe approach |
|---|---|
| Columns only (no rows changed) | `ALTER TABLE public.pick_candidates DROP COLUMN IF EXISTS model_registry_id, DROP COLUMN IF EXISTS scoring_run_id, DROP COLUMN IF EXISTS ownership_timestamp` — only if the migration must be reverted entirely |
| Registry metadata UPDATE | Cannot be automatically undone; requires a prior backup of `model_registry` rows or a compensating UPDATE to NULL out the newly set values |
| Index removal | `DROP INDEX IF EXISTS` for each named index |

**Preferred rollback approach:** Before applying, capture a snapshot of `model_registry` row state:

```sql
SELECT id, registry_entity_type, source_type_compatibility, active_state, updated_at
FROM model_registry
ORDER BY id;
```

Save this output as a rollback baseline. If the metadata UPDATE needs reverting, apply the inverse:

```sql
UPDATE model_registry SET
  registry_entity_type = NULL,
  source_type_compatibility = NULL,
  active_state = NULL
WHERE updated_at >= '<migration_apply_timestamp>';
```

Then drop the added columns and indexes.

### Migration history after rollback

If the migration was applied and then columns were dropped manually (not via Supabase migration), the `supabase.migrations` table will still record the migration as applied. This creates a Case B divergence (Section 4). Do NOT attempt to delete the history record. Instead, create a new migration (`202605070003_utv2_854_rollback.sql`) that re-drops the columns cleanly, so the history reflects the actual state.

### Explicitly forbidden rollback actions

- `supabase db reset` — destroys migration history and all data
- Manually DELETE from `supabase.migrations` — corrupts migration integrity
- Retroactively setting `model_registry_id` on pre-rollback rows to "preserve" fake ownership
- Marking the migration as not-applied via `supabase migration repair --status reverted` without a corresponding schema revert

### Preservation requirement

All historical rows with `model_registry_id IS NULL` must remain NULL after rollback. Do not touch historical data during rollback.

---

## 7. Ownership Success Criteria

### The first real success condition

At least one `pick_candidates` row must satisfy ALL of the following simultaneously:

```
model_registry_id IS NOT NULL
  AND ownership_timestamp IS NOT NULL
  AND scoring_run_id IS NOT NULL (or explicitly noted as warn-only pending system_runs linkage)
  AND model_registry_id references an existing model_registry row
    WHERE model_registry.status = 'champion'
    AND model_registry.active_state IS NOT NULL
  AND pick_candidates.model_score IS NOT NULL
  AND pick_candidates.ownership_timestamp > <migration_apply_timestamp>
```

AND the pick linked to this candidate (via `pick_candidates.pick_id`) must satisfy:

```
picks.source IN ('system-pick-scanner', 'board-construction')
  AND picks.is_model_generated = true  (if that column exists)
  OR the candidate's scoring cycle is confirmed to be model-driven, not manual
```

WITHOUT:

```
ownership_timestamp set retroactively to a date before the migration was applied
model_registry_id set to a value that was inserted specifically to satisfy this check
any UPDATE that targets historical rows (created_at < migration_apply_timestamp)
any fabrication of model attribution via manual SQL
```

### Why this milestone matters

This is the **first legitimately model-owned production pick** in UTV2 history. Every prior pick is permanently UNKNOWN. This row is the canonical proof that the full chain — scoring runtime → ownership persistence → registry FK → model attribution — operates end-to-end against real infrastructure.

Until this condition is met, `model_attributed_pct` must report 0%. Reporting any other value before this milestone is fabrication.

---

## 8. Codex Execution Packet

The following prompt is ready for Codex dispatch after the operator reviews and approves this runbook. Codex executes read-only diagnosis first, then waits for operator confirmation at each checkpoint before any write action.

---

**Codex execution prompt:**

```
You are executing UTV2-855: Supabase migration reconciliation and live ownership rollout.

The approved runbook is: docs/06_status/supabase_migration_reconciliation_runbook.md

Read that document fully before doing anything.

## Phase 1 — Diagnosis only (read-only, no writes)

Execute Section 3 of the runbook:

1. Run `supabase migration list` and capture output.
2. Query `supabase_migrations.schema_migrations` (or the equivalent table your Supabase CLI uses) for the full remote migration history.
3. Compare against the local `supabase/migrations/` directory.
4. Query `information_schema.columns` to confirm whether `pick_candidates.model_registry_id`, `pick_candidates.scoring_run_id`, `pick_candidates.ownership_timestamp`, `model_registry.registry_entity_type`, `model_registry.source_type_compatibility`, and `model_registry.active_state` exist in the live database.
5. Run `supabase db push --dry-run` and capture output.
6. Check DNS resolution: run `supabase status` and verify connectivity.

Using the results, classify the divergence as Case A, B, C, D, or E per Section 4 of the runbook.

Report:
- Classified case
- Full remote migration history (last 10 entries minimum)
- Schema probe results for all 6 ownership columns
- Dry-run output
- DNS/connectivity status

STOP. Do not proceed to Phase 2 until the operator confirms the classification and approves the remediation action for that case.

## Phase 2 — Remediation (operator-approved only)

After operator approves:

Execute Section 5 of the runbook, Steps 1–6 in order:

Step 2: Apply the migration using the mechanism approved for the classified case.
  - Case A: `supabase db push`
  - Case B: Execute targeted ALTER TABLE statements via execute_sql MCP
  - Case C: Add missing columns only via targeted ADD COLUMN IF NOT EXISTS statements
  - Case D: Report and stop — do not execute
  - Case E: Resolve DNS first, then re-diagnose

Step 3: Verify columns via information_schema query.
Step 4: Run `pnpm supabase:types`. Report output.
Step 5: Run `pnpm verify`. Report output.
Step 6: Run `npx tsx scripts/model-ownership/run-ownership-persistence-proof.ts`. Report output.

After each step, report results. Do not proceed to the next step without operator acknowledgment.

## Phase 3 — First ownership proof (operator-triggered)

After operator confirms Steps 1–6 complete:

Step 7: Execute the verification query from Section 5 Step 7 and report results.
Step 8: Re-run upstream evidence generators for UTV2-847, 848, 849, 850 and commit updated evidence bundles.

## Constraints

- Do NOT force-reset migrations.
- Do NOT mutate historical rows.
- Do NOT create Supabase preview branches.
- Do NOT execute destructive DB operations.
- Do NOT backfill ownership on historical pick_candidates rows.
- Do NOT mark migrations as applied that were not verified applied.
- STOP and report at each operator checkpoint. Do not self-authorize to proceed.
- Report exact SQL executed and its output at every step.
```

---

## Operator Checkpoints Summary

| Checkpoint | Gate | Codex alone? |
|---|---|---|
| Divergence classified | Section 3 complete, case labeled | Codex runs, reports |
| Remediation plan confirmed | Operator approves classified case action | Operator required |
| Dry-run reviewed | Operator reviews `supabase db push --dry-run` output | Operator required |
| Migration applied | Step 2 complete, schema verified | Codex executes after approval |
| Types regenerated | `pnpm supabase:types` green | Codex executes |
| `pnpm verify` green | All tests pass | Codex executes |
| Proof script green | Schema probe `live_schema_ready: true` | Codex executes |
| First owned candidate confirmed | Section 7 criteria met | Operator confirms |
| Upstream proofs re-run | 847/848/849/850 evidence updated | Codex executes |

---

## UTV2-855 Readiness for Codex Dispatch

UTV2-855 is **ready for Codex execution** after the operator:

1. Reviews this runbook and approves it
2. Confirms that Codex is not already running on a related task
3. Confirms that the current branch (`codex/utv2-854-persist-model-ownership`) is the correct execution context, or that a new branch for UTV2-855 should be created

Codex executes Phase 1 (diagnosis) immediately upon dispatch. Phases 2 and 3 require operator sign-off at each checkpoint.
