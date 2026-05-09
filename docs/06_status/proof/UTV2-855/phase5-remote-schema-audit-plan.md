# UTV2-855 Phase 5 — Manual Remote Schema Audit Plan

**Issue:** UTV2-855  
**Phase:** 5 (Manual Remote Schema Audit)  
**Generated:** 2026-05-07  
**Status:** Planning only — no writes approved  
**Authority:** Operator must approve any action beyond read-only schema inspection.

---

## 1. Current State

### Phase 4 outcome

Phase 4 attempted Option A recovery: locate the SQL bodies of remote-only migration versions from git history, stash state, worktree artifacts, and any alternative branch. Recovery failed for all seven remote-only versions. None of the SQL bodies could be reconstructed locally.

### Remote-only migration versions (unrecovered)

These seven versions appear in the remote `supabase_migrations.schema_migrations` ledger but have no corresponding local file and no recoverable SQL body:

| Version | Format | Date implied | Recovery status |
|---|---|---|---|
| `20260424202018` | YYYYMMDDHHMMSS | 2026-04-24 20:20:18 | Not recoverable |
| `20260425030626` | YYYYMMDDHHMMSS | 2026-04-25 03:06:26 | Not recoverable |
| `20260425030656` | YYYYMMDDHHMMSS | 2026-04-25 03:06:56 | Not recoverable |
| `20260425132920` | YYYYMMDDHHMMSS | 2026-04-25 13:29:20 | Not recoverable |
| `20260427045252` | YYYYMMDDHHMMSS | 2026-04-27 04:52:52 | Not recoverable |
| `20260427182229` | YYYYMMDDHHMMSS | 2026-04-27 18:22:29 | Not recoverable |
| `202604300003` | YYYYMMDD#### | 2026-04-30 seq 3 | Not recoverable |

**Format note:** Local migrations use `YYYYMMDD####` sequential numbering. The six `YYYYMMDDHHMMSS` versions were applied with a different tool or from a different checkout (likely direct `supabase db push` from a CI environment or untracked branch). `202604300003` uses local format but is absent from the repo, suggesting it was applied from a branch that was not merged or was squashed.

### Live schema state

The linked Supabase environment does NOT have the ownership columns from `202605070002`:

- `pick_candidates.model_registry_id` — absent
- `pick_candidates.scoring_run_id` — absent
- `pick_candidates.ownership_timestamp` — absent
- `model_registry.registry_entity_type` — absent
- `model_registry.source_type_compatibility` — absent
- `model_registry.active_state` — absent

### Ownership rollout state

**Blocked.** The runtime code (UTV2-854, commit `38392b5`) writes ownership fields that do not exist in the live schema. Every scored candidate write silently omits ownership. `model_attributed_pct = 0%` and will remain so until the schema is reconciled.

### Classification confirmed

**Case D** from the UTV2-855 runbook: migration history is divergent with unrecoverable remote-only entries. The standard `supabase db push` path is not safe. A manual remote schema audit is required before any reconciliation action can be approved.

---

## 2. Audit Objective

Determine whether the remote database schema, as it exists today, is a safe and known baseline from which the ownership migration (`202605070002`) can be applied without risk.

Specifically:
1. Does the live remote schema contain all objects that local migrations and app code expect to exist?
2. Does the live remote schema contain objects that the seven remote-only migrations created — and if so, are those objects safe, intentional, and compatible with current app code?
3. Is there any unknown schema drift (objects with no local migration origin and no app-code expectation)?
4. Can the remote schema be treated as the ground truth baseline, with the seven unrecovered migrations absorbed into current state, allowing the ownership migration to apply cleanly on top?

This audit does not modify any schema. It produces an evidence artifact that the operator uses to decide whether to approve reconciliation.

---

## 3. Required Read-Only Remote Schema Inventory

Execute the following queries via Supabase MCP `execute_sql`. All are read-only (`SELECT` only). No writes.

### 3.1 Full table inventory

```sql
SELECT
  table_schema,
  table_name,
  table_type
FROM information_schema.tables
WHERE table_schema IN ('public', 'supabase_migrations')
ORDER BY table_schema, table_name;
```

Look for unexpected tables with no local migration origin.

### 3.2 Column inventory for all public tables

```sql
SELECT
  table_name,
  column_name,
  ordinal_position,
  column_default,
  is_nullable,
  data_type,
  udt_name,
  character_maximum_length,
  numeric_precision,
  numeric_scale
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;
```

This is the primary comparison artifact. Every column returned must be traced to either a local migration file or a remote-only migration. Untraced columns are schema drift.

### 3.3 Index inventory

```sql
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
```

### 3.4 Constraint inventory

```sql
SELECT
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name,
  cc.check_clause
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
LEFT JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name
  AND tc.table_schema = ccu.table_schema
LEFT JOIN information_schema.check_constraints cc
  ON tc.constraint_name = cc.constraint_name
  AND tc.table_schema = cc.constraint_schema
WHERE tc.table_schema = 'public'
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;
```

### 3.5 Trigger inventory

```sql
SELECT
  trigger_schema,
  trigger_name,
  event_manipulation,
  event_object_table,
  action_timing,
  action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;
```

### 3.6 Function inventory

```sql
SELECT
  routine_schema,
  routine_name,
  routine_type,
  data_type AS return_type,
  routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public'
ORDER BY routine_name;
```

### 3.7 RLS policy inventory

```sql
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

RLS enabled state per table:

```sql
SELECT
  n.nspname AS schema,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY c.relname;
```

### 3.8 Enum inventory

```sql
SELECT
  n.nspname AS schema,
  t.typname AS enum_name,
  e.enumlabel AS enum_value,
  e.enumsortorder AS sort_order
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
ORDER BY enum_name, sort_order;
```

### 3.9 View inventory

```sql
SELECT
  table_schema,
  table_name AS view_name,
  view_definition
FROM information_schema.views
WHERE table_schema = 'public'
ORDER BY table_name;
```

### 3.10 Full migration ledger

```sql
SELECT
  version,
  name,
  inserted_at
FROM supabase_migrations.schema_migrations
ORDER BY inserted_at ASC;
```

Count:

```sql
SELECT COUNT(*) AS total_migrations FROM supabase_migrations.schema_migrations;
```

### 3.11 Supabase extensions

```sql
SELECT
  extname,
  extversion,
  nspname AS schema
FROM pg_extension e
JOIN pg_namespace n ON n.oid = e.extnamespace
ORDER BY extname;
```

### 3.12 Ownership columns spot-check (pre-migration state)

Dedicated check — all six columns should be **absent** before the migration is applied:

```sql
SELECT
  table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'pick_candidates' AND column_name IN (
      'model_registry_id', 'scoring_run_id', 'ownership_timestamp'
    ))
    OR
    (table_name = 'model_registry' AND column_name IN (
      'registry_entity_type', 'source_type_compatibility', 'owner',
      'training_window_start', 'training_window_end',
      'validation_metrics', 'calibration_metadata',
      'promotion_approved_by', 'promotion_approved_at', 'active_state'
    ))
  )
ORDER BY table_name, column_name;
```

Expected result: **zero rows.** Any row returned here indicates the migration was partially or fully applied outside this process — classify as Case D3 anomaly.

### 3.13 Priority target deep-check: pick_candidates

```sql
SELECT
  column_name,
  ordinal_position,
  is_nullable,
  data_type,
  udt_name,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'pick_candidates'
ORDER BY ordinal_position;
```

### 3.14 Priority target deep-check: model_registry

```sql
SELECT
  column_name,
  ordinal_position,
  is_nullable,
  data_type,
  udt_name,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'model_registry'
ORDER BY ordinal_position;
```

---

## 4. Comparison Method

### Layer A — Live remote schema

Source: output of queries in Section 3.

### Layer B — Local migrations

Build the expected schema story from:
- `supabase/migrations/` (99 files, range `202603200001` through `202605070002`)
- Known remote-only versions (7 versions, range `20260424202018` through `202604300003`)
- The ownership migration `202605070002_utv2_854_model_ownership_persistence.sql` defines exactly what must be absent pre-audit

### Layer C — Generated database types

Compare the live remote column inventory (Section 3.2) against `packages/db/src/database.types.ts`:
- Columns in types file but absent remotely: type file is stale or a migration was rolled back
- Columns in remote schema but absent from types file: remote has drifted forward since types were last generated
- The six ownership columns must be absent from both types file and remote (they are not yet applied)

### Layer D — App code expectations

The following tables must exist in the live remote schema for the runtime to function. Verify each is present in the Section 3.1 output:

**Must exist:** `picks`, `pick_candidates`, `model_registry`, `system_runs`, `market_universe`, `provider_offers`, `provider_offer_current`, `provider_offer_history`, `provider_cycle_failures`, `experiment_ledger`, `distribution_receipts`, `settlements`, `game_results`, `alert_detections`, `market_universe`

**Columns that must exist on `pick_candidates`** (from earlier merged migrations):
`id`, `pick_id`, `universe_id`, `scan_run_id`, `provenance`, `model_score`, `model_tier`, `model_confidence`, `shadow_mode`, `is_board_candidate`, `sport_key`

**Columns that must NOT yet exist on `pick_candidates`** (pending UTV2-854 migration):
`model_registry_id`, `scoring_run_id`, `ownership_timestamp`

### Drift classification per object

For each object found in the remote schema, assign one classification:

| Class | Meaning |
|---|---|
| `locally-covered` | Traces to a local migration file present in `supabase/migrations/` |
| `remote-only` | Traces to one of the seven unrecovered versions only |
| `unknown-drift` | No traceable migration origin in local or remote-only set |
| `ownership-pending` | Expected by UTV2-854 code but correctly absent (pending migration) |

Any `unknown-drift` object must be documented with full DDL and a risk assessment before any forward action.

---

## 5. Decision Tree

### Case D1 — Remote schema matches app expectations; all unrecovered drift is explained

**Condition:**
- All core tables and columns expected by app code are present in the live schema
- All objects traceable only to remote-only migrations are recognizable (e.g., they appear in later local migrations as IF NOT EXISTS, or they are auxiliary indexes/views consistent with the April 24–30 work period)
- No `unknown-drift` objects exist
- Ownership columns are absent (correctly pending)
- No type mismatches on critical columns

**Interpretation:** The seven remote-only migrations created objects that were subsequently absorbed into the local codebase. The remote schema is a coherent, trusted baseline.

**Safe operator action:**
1. Create a local baseline marker migration documenting the remote-only history (no-op SQL with `-- baseline` comment, marking the absorbed versions)
2. Apply the ownership migration `202605070002` on top of the verified baseline
3. Proceed with the ownership rollout per the UTV2-855 runbook Sections 5–7

**Codex may execute:** Yes — baseline marker migration creation + ownership migration apply, after operator reviews the audit artifact and approves in writing.

**Manual operator intervention:** Required to review audit artifact before Codex executes.

---

### Case D2 — Remote schema contains intentional objects missing locally; objects are recognizable and safe

**Condition:**
- Some tables, columns, indexes, or functions exist in the remote schema with no traceable origin in any migration (local or remote-only)
- These objects are identifiable as intentional (e.g., a support view, a helper function, an additional partial index)
- They do not conflict with any local migration or app code expectation

**Interpretation:** Schema has drifted via direct Dashboard or CI-applied SQL that bypassed the migration system. The drift is real but benign and must be captured.

**Safe operator action:**
1. Extract each untraced object's DDL (via `pg_get_indexdef`, `pg_get_viewdef`, `information_schema`, etc.)
2. Draft a new local migration `202605080001_utv2_855_baseline_reconcile.sql` containing `CREATE ... IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` for each untraced object — making the drift official
3. Do NOT apply this migration remotely (objects already exist). Mark as `--baseline` in comments. Insert into remote ledger via `supabase migration repair --status applied` **only** after explicit operator in-session approval
4. Apply the ownership migration on top

**Codex may execute:** Codex produces the draft reconciliation SQL. Operator reviews. Codex does NOT execute `migration repair` without written operator approval.

**Manual operator intervention:** Required before `migration repair`.

---

### Case D3 — Remote schema contains unknown, conflicting, or risky drift

**Condition:** Any of:
- A column exists with a different type than what local migrations define (e.g., `uuid` vs `text` on a FK column)
- A table exists that is not referenced in any migration and not referenced in app code
- A constraint exists that would block `202605070002` (e.g., `NOT NULL` on a column the migration tries to add as nullable)
- RLS policies exist that are not in any local migration and could block runtime writes
- Triggers with unknown behavior on `pick_candidates` or `model_registry`
- Ownership columns already partially present (migration was partially applied by unknown path)

**Interpretation:** The schema cannot be treated as a safe baseline without manual investigation. Do not attempt any reconciliation.

**Safe action:**
1. Record all anomalies in the audit artifact
2. Stop — do not proceed
3. Deliver the full anomaly list to the operator
4. No migration applies, no reconciliation, no `migration repair` until each anomaly is individually resolved

**Codex may execute:** Audit artifact only. No writes.

**Manual operator intervention:** Required. Each anomaly must be assessed individually.

---

### Case D4 — Remote schema cannot be inspected; connectivity remains broken

**Condition:** `execute_sql` via Supabase MCP fails with DNS, timeout, connection refused, or auth errors. Queries in Section 3 cannot complete.

**Required action:**
1. Verify `SUPABASE_ACCESS_TOKEN` is present and valid in `local.env`
2. Verify Supabase project ref: `grep project_id supabase/config.toml`
3. Run `supabase status` to confirm project linkage and CLI auth
4. If MCP is broken, attempt `psql` with `DATABASE_URL` from `local.env` for read-only queries as a fallback
5. If all connectivity is broken: stop, document the failure state, escalate to operator

**Codex may execute:** Connectivity diagnosis only. No schema writes.

**Manual operator intervention:** Required to restore connectivity before audit can proceed.

---

## 6. Forbidden Actions

Until the operator explicitly approves an action in-session, the following are unconditionally forbidden regardless of case classification:

| Action | Why forbidden |
|---|---|
| `supabase migration repair --status applied` | Mutates migration history; Case D2 only + requires explicit approval |
| `supabase migration repair --status reverted` | Unmarks applied migrations; forbidden unconditionally |
| `supabase db push` (any form) | Cannot push with unresolved remote ledger divergence |
| Live `ALTER TABLE` via `execute_sql` | Bypasses migration history integrity |
| `supabase db reset` | Destroys all remote data and migration history |
| Preview branch creation | Not approved for this issue |
| Manual `INSERT`/`DELETE`/`UPDATE` on `supabase_migrations.schema_migrations` | Direct history mutation; forbidden unconditionally |
| `UPDATE pick_candidates SET model_registry_id = ...` | Historical ownership fabrication; forbidden unconditionally |
| Treating audit output as proof of schema correctness without operator review | Audit produces evidence; operator decides |

---

## 7. Codex Phase 6 Execution Packet

The following prompt is ready for Codex dispatch. Codex executes read-only schema inspection only and stops for operator review before any write action.

---

```
You are executing UTV2-855 Phase 6: read-only remote schema audit.

The approved plan is: docs/06_status/proof/UTV2-855/phase5-remote-schema-audit-plan.md

Read that document fully before acting.

## Hard constraints

- No writes. No ALTER TABLE. No migration apply. No migration repair. No db push. No preview branches.
- If you are uncertain whether an action is read-only, STOP and report.
- You are auditing. You are not fixing.

## Step 1 — Connectivity check

Use Supabase MCP (mcp__supabase__execute_sql or mcp__claude_ai_Supabase__execute_sql) to run:

  SELECT 1 AS ping;

If this fails: classify as Case D4. Report the exact error. Stop.
If this succeeds: proceed.

## Step 2 — Full schema inventory

Execute each query from Section 3 of the audit plan in order (3.1 through 3.14). Capture the full result of each query. Do not truncate or summarize. Every row matters.

## Step 3 — Migration ledger comparison

From query 3.10, extract the full list of remote versions.

Compare against local migration files:

  ls supabase/migrations/ | sort

Produce:
- versions in remote ledger only (not in local files)
- versions in local files only (not in remote ledger — these are pending)
- count of matched versions

Verify that the seven known remote-only versions are the ONLY remote-only discrepancy:
  20260424202018, 20260425030626, 20260425030656, 20260425132920,
  20260427045252, 20260427182229, 202604300003

If there are additional unrecognized remote-only versions: record them explicitly. Report to operator before proceeding to classification.

## Step 4 — Ownership columns spot-check

Execute query 3.12.
Expected: zero rows.
If any ownership columns exist: record them as a Case D3 anomaly. Report immediately.

## Step 5 — App code expectation cross-check

Verify that all required tables from Section 4 (Layer D) exist in the Section 3.1 output.

For each core table, spot-check that critical columns are present using the Section 3.2 output.

Use grep to sample column references from app code:

  grep -n "pick_candidates\." packages/db/src/runtime-repositories.ts | head -20

Cross-reference any referenced columns against Section 3.13 output for pick_candidates.

## Step 6 — Drift classification

For each object in the remote schema inventory (tables, columns, indexes, constraints, triggers, functions, RLS policies, enums, views), classify as:
  locally-covered | remote-only | unknown-drift | ownership-pending

Document every object classified as unknown-drift with its full definition.

## Step 7 — Case classification

Using the decision tree from Section 5, classify the overall audit result as D1, D2, D3, or D4.

If D3: list every anomaly. Stop. Do not proceed to any write action.
If D1 or D2: list all remote-only and unknown-drift objects with full definitions.

## Step 8 — Produce audit artifact

Write the audit findings to:
  docs/06_status/proof/UTV2-855/phase6-remote-schema-audit.json

Structure:
{
  "audit_date": "<ISO timestamp>",
  "connectivity": "ok|failed",
  "migration_ledger": {
    "remote_total": <n>,
    "local_total": <n>,
    "matched_count": <n>,
    "remote_only_versions": ["20260424202018", ...],
    "local_only_versions": ["202605070002", ...],
    "unexpected_remote_only": []
  },
  "ownership_columns_pre_check": {
    "any_ownership_column_present": false,
    "unexpected_columns": []
  },
  "schema_inventory_summary": {
    "table_count": <n>,
    "column_count": <n>,
    "index_count": <n>,
    "constraint_count": <n>,
    "trigger_count": <n>,
    "function_count": <n>,
    "rls_policy_count": <n>,
    "enum_count": <n>,
    "view_count": <n>
  },
  "drift_classification": {
    "locally_covered_count": <n>,
    "remote_only_count": <n>,
    "unknown_drift_count": <n>,
    "ownership_pending_count": <n>,
    "unknown_drift_objects": []
  },
  "case_classification": "D1|D2|D3|D4",
  "anomalies": [],
  "operator_action_required": "<what operator must decide>",
  "writes_executed": false
}

## Step 9 — Report

Report:
1. Case classification (D1/D2/D3/D4)
2. Full migration ledger comparison (all remote-only versions, all local-only versions)
3. Ownership columns spot-check result
4. Drift classification summary
5. All unknown-drift objects with definitions (if any)
6. All anomalies (if any)
7. Recommended operator action per the decision tree
8. Explicit confirmation: writes_executed = false

STOP after this report.
Do not take any action beyond the audit artifact and the report.
Operator decision is required before Phase 7.
```
