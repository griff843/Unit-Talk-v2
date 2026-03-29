# Supabase Hardening Audit — Unit Talk V2

**Audit Date:** 2026-03-29
**Issue:** UTV2-139
**Lane:** Claude (verification)
**Live Project Ref:** `feownrheeefbcsehtsiw`
**Branch at Audit:** `claude/UTV2-56-capper-onboarding`

---

## Scope

This audit covers:
- RLS posture
- Service-role scope and key usage
- Secret handling in source and config
- Migration safety rules
- Backup/restore expectations
- Immutability enforcement
- Worker concurrency safety
- Idempotency guarantees

---

## 1. Row Level Security (RLS) Posture

**Status: DEFERRED BY DESIGN — not a gap**

RLS is not enabled on any table. No policies are defined. Zero occurrences of `ROW LEVEL SECURITY`, `CREATE POLICY`, or `ENABLE ROW LEVEL` in any migration file.

Writer authority is enforced at the application layer:
- `apps/api` is the sole canonical DB writer
- Services receive repository bundles and never call Supabase directly
- Repository interface segregation prevents unauthorized writes by construction

From `docs/05_operations/supabase_setup.md`:
> Application-layer enforcement for now. Postgres RLS deferred, not rejected. Reserved for a dedicated security migration once service-role/runtime patterns are stable.

**When to revisit:** After `getRuntimeMode()` + fail-closed startup (UTV2-147, UTV2-115, UTV2-116) are implemented and the service-role/anon usage split is stabilized.

---

## 2. Service-Role Scope

**Status: APPROPRIATE — all services use service role explicitly**

All three runtime services use `createServiceRoleDatabaseConnectionConfig()`:

| Service | Role Used | Location |
|---------|-----------|----------|
| `apps/api` | `service_role` | `server.ts:50` — `createServiceRoleDatabaseConnectionConfig(environment)` |
| `apps/worker` | `service_role` | `runtime.ts:37` — `createServiceRoleDatabaseConnectionConfig(environment)` |
| `apps/operator-web` | `service_role` | `server.ts:455,699,779,858` — `createServiceRoleDatabaseConnectionConfig(env)` |

The `DatabaseConnectionConfig` type carries a `role: 'anon' | 'service_role'` field — the role is tracked explicitly, not inferred.

The `anon` key path exists in `packages/db/src/client.ts` (default when `useServiceRole` is false) but is not currently activated by any service. This is dead code for now — correct behavior given RLS is deferred.

**Risk:** Once RLS is enabled, any service accidentally using the anon key will lose all access. The explicit opt-in pattern (`useServiceRole: true`) makes this visible before it becomes a runtime failure.

---

## 3. Secret Handling

**Status: SECURE — no credentials in source control**

Verification:
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`: all empty placeholders in `.env.example`
- `local.env` and `.env` are gitignored (contain real credentials)
- Live project ref (`feownrheeefbcsehtsiw`) appears only in documentation (`docs/05_operations/supabase_setup.md`) — not in source, config, or CI
- `supabase/config.toml` uses `project_id = "unit-talk-v2"` (local dev alias) — no live project ID embedded
- No hardcoded API keys found in any `.ts`, `.js`, or `.json` file

The env loading chain is:
```
.env.example → .env → local.env
```
Later files override earlier. `local.env` holds real credentials and is never committed.

`requireSupabaseEnvironment()` in `packages/config/src/env.ts` throws if any of the three Supabase vars are absent — credentials are required together or not at all. No partial-credential state is possible.

**Note:** `SUPABASE_ACCESS_TOKEN` appears in `.env.example` but is not referenced in `env.ts`. This is a dead template var — should be pruned in a future cleanup pass (low priority).

---

## 4. Migration Safety Rules

**Status: SAFE — 16 migrations applied, no gaps, no unsafe patterns**

Migration inventory (all applied to live project `feownrheeefbcsehtsiw`):

| Migration | Purpose |
|-----------|---------|
| `202603200001_v2_foundation.sql` | 11 canonical tables, CHECK constraints, FKs, indexes |
| `202603200002_v2_schema_hardening.sql` | `updated_at` triggers, lifecycle column rename, claim columns, audit immutability |
| `202603200003_distribution_receipts_idempotency.sql` | `idempotency_key` + unique partial index on `distribution_receipts` |
| `202603200004_system_runs_finished_at_trigger.sql` | BEFORE UPDATE trigger: `finished_at = now()` on terminal status |
| `202603200005_pick_promotion_state.sql` | Pick promotion state additions |
| `202603200006_settlement_runtime_alignment.sql` | Settlement runtime field alignment |
| `202603200007_promotion_target_multi.sql` | Extended `promotion_target` CHECK constraint to multi-target |
| `202603200008_reference_data_foundation.sql` | Reference data tables (events, participants, players, teams) |
| `202603200009_provider_offers.sql` | Provider offers table |
| `202603200010_entity_resolution_indexes.sql` | Entity resolution indexes |
| `202603200011_clv_lookup_index.sql` | CLV lookup index |
| `202603200012_game_results.sql` | Game results table |
| `202603200013_settlement_source_grading.sql` | Settlement source grading |
| `202603200014_alert_detections.sql` | Alert detections table |
| `202603200015_exclusive_insights_target.sql` | Exclusive insights promotion target |
| `202603200016_hedge_opportunities.sql` | Hedge opportunities table |

**Migration safety rules enforced:**
- All migrations use `IF NOT EXISTS` / `IF EXISTS` guards — safe to re-run
- All migrations use `CREATE OR REPLACE` for functions/triggers
- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` pattern used throughout — no conflicts on re-apply
- No `DROP TABLE` or `TRUNCATE` in any migration
- No migration mutates existing data rows (schema-only changes)
- `packages/db/src/database.types.ts` is generated via `pnpm supabase:types` — never hand-edited

**Next migration number:** `202603200017_*.sql`

---

## 5. Backup and Restore Expectations

**Status: DOCUMENTED — no V2-specific backup automation yet**

Supabase managed hosting provides:
- Point-in-time recovery (PITR) on Pro and Enterprise plans
- Daily backups on Free plan (7-day retention)
- Project: `feownrheeefbcsehtsiw` — plan tier should be verified by operator

**Restore considerations for V2:**
- `audit_log` is append-only and immutable (DB trigger enforced — see §6). It is the source of truth for sensitive mutations. Any restore must preserve all audit rows.
- `settlement_records` corrections use `corrects_id` self-reference FK. Partial restores that restore later rows without earlier rows will fail FK constraints. Restore must be full-table or time-consistent.
- `distribution_outbox` rows in `processing` status at time of backup may represent orphaned claims post-restore. After any restore, scan for `status = 'processing'` AND `claimed_at < (restored_at - 5 minutes)` and reset to `pending` before restarting workers.
- `system_runs` rows with `status = 'running'` at backup time are stale post-restore. These can be left as-is (worker health check handles them) or manually marked `failed`.

**There is no backup automation script in this repo.** Backup is delegated to Supabase managed hosting. This is acceptable for current scale.

---

## 6. Immutability Enforcement

**Status: HARDENED — DB trigger on `audit_log`**

Migration 002 installs a BEFORE UPDATE/DELETE trigger on `audit_log`:

```sql
create or replace function public.reject_audit_log_mutation()
returns trigger language plpgsql as $$
begin
  raise exception
    'audit_log is immutable: UPDATE and DELETE are not permitted on this table. '
    'Create a new audit record instead.';
end;
$$;

create trigger guard_audit_log_immutability
  before update or delete on public.audit_log
  for each row execute function public.reject_audit_log_mutation();
```

Any `UPDATE` or `DELETE` against `audit_log` throws a Postgres exception — including from service-role. This is enforced below the application layer.

Application-layer enforcement in `AGENTS.md` and `CLAUDE.md`:
> "audit_log = immutable, append-only; enforced by DB trigger — never UPDATE or DELETE from it"

**`settlement_records` immutability:** Enforced by application convention (`corrects_id` pattern) but NOT by a DB trigger. The DB allows UPDATE on `settlement_records`. This is a future hardening opportunity.

---

## 7. Concurrent Worker Safety

**Status: HARDENED — claim columns + partial index**

`distribution_outbox` supports safe concurrent processing via:

```sql
-- Claim columns for SELECT FOR UPDATE SKIP LOCKED
claimed_at timestamptz
claimed_by text

-- Partial index for stale-claim detection
CREATE INDEX distribution_outbox_claimed_at_processing_idx
  ON public.distribution_outbox(claimed_at)
  WHERE status = 'processing';
```

Workers claim rows by setting `claimed_at` and `claimed_by` before processing. Multiple worker instances can run concurrently without contention.

Stale claim detection (UTV2-119 — Worker stale-claim reaper) uses `distribution_outbox_claimed_at_processing_idx` to find rows stuck in `processing` with old `claimed_at` timestamps.

---

## 8. Idempotency Guarantees

**Status: HARDENED — 3 tables with unique partial indexes**

| Table | Column | Index |
|-------|--------|-------|
| `distribution_outbox` | `idempotency_key` | `distribution_outbox_idempotency_key_idx` — unique where not null |
| `distribution_receipts` | `idempotency_key` | `distribution_receipts_idempotency_key_idx` — unique where not null |
| `system_runs` | `idempotency_key` | `system_runs_idempotency_key_idx` — unique where not null |

Keys are caller-supplied (application layer computes them). Null keys are allowed for records without idempotency requirements.

**Design rationale (from memory):** `distribution_outbox` uses `idempotency_key` rather than `UNIQUE(pick_id, target)` to allow legitimate re-delivery (e.g., if a pick is re-queued after a retracted post).

---

## 9. Schema Correctness Verification

Key schema facts verified against live migration files — all match `AGENTS.md` and `CLAUDE.md`:

| Fact | Verified |
|------|---------|
| `picks.status` (not `lifecycle_state`) | ✓ |
| `pick_lifecycle` table (not `pick_lifecycle_events`) | ✓ |
| `pick_lifecycle.to_state` (renamed from `lifecycle_state` in migration 002) | ✓ |
| `audit_log.entity_id` = FK to primary entity (not pick_id) | ✓ |
| `audit_log.entity_ref` = pick_id as text | ✓ |
| `submission_events.event_name` (not `event_type`) | ✓ |
| `settlement_records.corrects_id` = self-referencing FK | ✓ |
| `audit_log` append-only via DB trigger | ✓ |

---

## 10. Open Items and Recommendations

### High Priority (before staging/production hardening)
1. **Fail-closed runtime mode (UTV2-115, UTV2-116, UTV2-147):** Currently, API and operator-web silently fall back to InMemory when credentials are absent. In staging/production this must be exit(1). These are in the Wave 1 Codex queue.

### Medium Priority
2. **RLS adoption:** After fail-closed startup is implemented and service-role patterns are stable, create a dedicated security migration to enable RLS on high-value tables (`picks`, `audit_log`, `settlement_records`). Define anon vs. service-role permissions explicitly.
3. **`settlement_records` mutation guard:** Add a BEFORE UPDATE trigger similar to `audit_log` to prevent direct mutation of settlement records at the DB layer (current enforcement is application-only).
4. **`SUPABASE_ACCESS_TOKEN` cleanup:** Remove dead template var from `.env.example`.

### Low Priority
5. **Backup automation:** Consider a `pnpm backup:check` script that verifies PITR is enabled on the live project. Currently no V2 automation.
6. **Key rotation ceremony:** Document a quarterly rotation process for `SUPABASE_SERVICE_ROLE_KEY`. No rotation has occurred since project creation.
7. **Post-restore runbook:** Document the stale-claim cleanup procedure for `distribution_outbox` after any DB restore.

---

## Audit Verdict

**Overall posture: APPROPRIATE for current development phase.**

No critical vulnerabilities. The two most important items — fail-closed runtime mode (UTV2-115/116/147) and RLS — are tracked in the issue queue and are understood by the team. The current application-layer enforcement is acceptable while these are being implemented.

The audit_log immutability trigger, settlement correction pattern, idempotency indexes, and worker claim columns represent production-quality hardening that is already in place.
