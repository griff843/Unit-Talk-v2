# DB Migration Workflow — Canonical Standard

**Status:** RATIFIED
**Date:** 2026-05-08
**Linear:** UTV2-856
**Parent:** UTV2-855 (DB truth / schema discipline umbrella)
**Tier:** T1 — Architecture / Operations
**Authority:** PM (A Griffin). Owned. Changes require PM approval.

---

## Purpose

This document is the authoritative workflow standard for all schema changes in Unit Talk V2. It defines who can do what, when, under what approval, and what constitutes a valid migration artifact. It unblocks the downstream implementation issues in the UTV2-855 bundle.

---

## DB Authority Model

The migration file is the source of schema truth. Period.

| Source | Role | Authority |
|---|---|---|
| `supabase/migrations/*.sql` | Schema source of truth | **Authoritative** |
| Live remote schema | Execution state | Authoritative for what currently exists |
| `supabase migration list --linked` | Ledger alignment check | Required before any apply |
| Dashboard Table Editor | Debug / read queries only | **Zero authority for schema** |
| `psql` direct session | Emergency debug only | Zero authority for schema |
| Agent-drafted migration | Draft only | Requires operator review before any apply |

If the migration file and the live schema disagree, the investigation begins with the ledger (`supabase migration list --linked`). Never resolve the discrepancy by editing the live schema directly.

---

## Migration Workflow — Standard Path

### Step 1: Draft

Agent (Claude or Codex) or developer writes the migration file:

```
supabase/migrations/YYYYMMDDNNNN_utv2_###_description.sql
```

Naming rules:
- Timestamp prefix: `YYYYMMDD` + 4-digit sequence (e.g., `202605080001`)
- Issue ID embedded: `utv2_###` (lowercase, underscore-separated)
- Description: kebab-or-underscore, no spaces

### Step 2: Local verification

Before any review request:

```bash
pnpm type-check   # must pass
pnpm verify       # must pass
```

If the migration adds or alters tables: regenerate types and verify the type-check passes:

```bash
pnpm supabase:types
pnpm type-check
```

### Step 3: Operator review

Agent surfaces the migration for operator review. The review must confirm:

1. Migration is additive or explicitly approved as destructive
2. Risk classification is declared (see below)
3. Dependency chain is correct (prior migration in ledger)
4. Hard dependencies exist in the remote ledger (not just local)

Operator approves in Linear (comment or label change) or in the PR. Chat approval is not sufficient — approval must appear in a durable artifact (PR comment, Linear comment, or label).

### Step 4: CI gate

The PR must be green on `pnpm verify` before any migration apply is considered. CI-failing migrations are never applied to production.

### Step 5: Ledger alignment check

Before applying:

```bash
supabase migration list --linked
```

Compare against local `supabase/migrations/`. Every migration in the local directory must either:
- Be present in the remote ledger, **or**
- Be the migration about to be applied

If the ledger is diverged (remote has rows local doesn't, or vice versa), surface the divergence to the operator before proceeding. Do not apply blindly.

### Step 6: Apply

```bash
supabase db push --linked
# or
supabase db push --project-ref zfzdnfwdarxucxtaojxm
```

This is the only sanctioned apply path. Never apply via:
- Dashboard "Table Editor"
- Dashboard SQL editor (for schema changes)
- Raw `psql` session
- Supabase MCP `apply_migration` tool without operator instruction in the current session
- Agent-generated SQL piped directly to the DB

### Step 7: Post-apply verification

After apply:

```bash
pnpm supabase:types
pnpm type-check
pnpm test:db
```

All three must pass. If `test:db` fails post-apply, the migration produced a broken runtime state. Escalate immediately — do not ship the PR.

### Step 8: Types commit

Commit the regenerated `packages/db/src/database.types.ts` alongside the migration in the same PR. The types and the migration ship together.

---

## Risk Classification

Every migration must be classified before operator review. Use this taxonomy:

| Class | Definition | Examples | Operator approval required |
|---|---|---|---|
| **Additive-safe** | New objects, no data mutation, no existing object changes | `CREATE TABLE`, `ADD COLUMN NULL`, `CREATE INDEX CONCURRENTLY` | Yes — standard review |
| **Constraint-add** | New constraint, existing data unaffected by `NOT VALID` | `ADD CONSTRAINT ... NOT VALID` | Yes — standard review |
| **Data-mutating** | Updates or inserts to existing rows | `UPDATE public.model_registry ...`, `INSERT INTO ... SELECT ...` | Yes — elevated review, row count estimate required |
| **Destructive** | Removes or truncates existing objects or data | `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `ALTER COLUMN TYPE` (breaking) | Yes — PM explicit sign-off, plus forward-fix plan if needed |
| **Cron-mutating** | Modifies scheduled job definitions | `SELECT cron.unschedule(...)`, `SELECT cron.schedule(...)` | Yes — elevated review, new cron body must be reviewed verbatim |

Mixed-class migrations (e.g., schema + data mutation) inherit the highest risk class in the set.

---

## Operator Approval Requirements

| Risk class | Minimum approval artifact |
|---|---|
| Additive-safe | PR review approval from operator |
| Constraint-add | PR review approval from operator |
| Data-mutating | PR review approval + row count estimate in PR description |
| Destructive | PM explicit comment + forward-fix plan in PR description |
| Cron-mutating | PM explicit comment + new cron body reviewed verbatim |

Approval is tied to the specific migration file SHA. If the file changes after approval, approval must be re-obtained.

---

## Agent Operational Rules

**Agents (Claude, Codex) may:**
- Draft migration files
- Run `supabase migration list --linked` (read-only)
- Run `pnpm supabase:types` (type regen, no DB write)
- Run `pnpm type-check`, `pnpm test:db` (read-only DB probes)
- Surface migration candidates with risk classification
- Produce proof artifacts documenting DB state

**Agents must not:**
- Run `supabase db push` without explicit operator instruction in the current session
- Run `supabase migration repair` without explicit operator instruction
- Modify the Supabase dashboard directly
- Apply any migration that the operator has not reviewed in the current session
- Create Supabase preview branches (see UTV2-867)

**Human operator must:**
- Approve every migration before apply
- Execute `supabase db push` or explicitly authorize an agent to do so
- Own the post-apply verification sign-off

---

## CI Discipline Requirements

Migrations are reviewed as part of PR CI. The following checks are required on every PR that includes a migration:

1. `pnpm verify` green (includes type-check, lint, build, test)
2. `pnpm supabase:types` re-run output committed — type check must still pass after regen
3. No `database.types.ts` hand-edits (diff must match `supabase gen types` output exactly)
4. Migration file naming must follow the convention (`YYYYMMDDNNNN_utv2_###_description.sql`)
5. Migration must not reference objects not yet in the remote ledger (dependency validation)

---

## Rollback and Forward-Fix Governance

See `docs/05_operations/DB_ROLLBACK_RUNBOOK.md` (UTV2-866) for the full recovery decision matrix.

Summary principles:
- Additive migrations: rollback possible via `DROP` in a follow-on migration
- Data-mutating migrations: forward-fix preferred; rollback requires operator-approved reversal migration
- Destructive migrations: forward-fix only; PITR is the emergency backstop
- Never edit the migration ledger (`supabase migration repair`) to hide a failed apply — surface the failure to the operator and treat it as an incident

---

## Current State Context (as of 2026-05-08)

The live schema is classified **D3** (diverged). Six migrations are present locally but absent from the remote ledger:

```
202605020001_utv2_725_pick_candidates_sport_key.sql          (medium risk)
202605020002_utv2_725_backfill_pick_candidates_pick_id.sql   (medium-high, defer)
202605030001_utv2_772_provider_offer_history_partition_retention.sql  (high)
202605030002_utv2_772_provider_offer_line_snapshots.sql      (high)
202605070001_utv2_845_stake_units_integrity_guard.sql        (medium)
202605070002_utv2_854_model_ownership_persistence.sql        (medium-high, blocked)
```

Recommended apply order and blocking rationale: `docs/06_status/proof/UTV2-855/phase9-manual-schema-reconciliation-plan.md`.

No migration in this set may be applied without operator review in a live session. This document does not itself authorize any apply.

---

## Cross-References

- `docs/05_operations/SUPABASE_CONNECTION_STRATEGY.md` — connection methods and credentials
- `docs/05_operations/DB_ENVIRONMENT_OPERATOR_POLICY.md` — environment authority model (UTV2-858)
- `docs/05_operations/DB_ROLLBACK_RUNBOOK.md` — rollback and forward-fix runbook (UTV2-866)
- `docs/05_operations/SUPABASE_BRANCH_COST_POLICY.md` — branch governance (UTV2-867)
- `docs/06_status/proof/UTV2-855/phase9-manual-schema-reconciliation-plan.md` — current D3 reconciliation plan
- `supabase/migrations/` — migration source of truth
- `packages/db/src/database.types.ts` — generated types (do not hand-edit)
