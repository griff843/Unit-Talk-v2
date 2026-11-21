# Diff summary: UTV2-1980

Tier: T1 (migration). Replaces closed PR #1774 (superseded predecessor lane); the migration and down script are NO LONGER byte-identical to #1774 head 8a46cc1bd: they are role-guarded (delta below).

| File | Change |
|---|---|
| supabase/migrations/20261022090000_revoke_governed_pick_performance_anon.sql | Role-guarded (sha256 changed from 882d511b...). Sets `security_invoker = true` on `public.v_governed_pick_performance`; REVOKE ALL from PUBLIC, anon, authenticated, service_role; GRANT SELECT to service_role only. |
| db/migrations-rollback/20261022090000_revoke_governed_pick_performance_anon.down.sql | Restores measured pre-change posture (RESET security_invoker; anon, authenticated, service_role hold all privileges; PUBLIC none). |
| .ops/work/UTV2-1980.md | Repo-authored work order (task contract source; no tracker credential was used) |

Delta from #1774: (1) role-specific REVOKE/GRANT wrapped in pg_roles existence checks; (2) PUBLIC revoke and security_invoker unconditional; (3) added a fail-closed end-state check; (4) down script guarded and checked likewise; (5) `-- lint-override: truncate` for the TRUNCATE privilege name. Security behavior on Supabase (all three roles exist) is unchanged.

No production DDL applied. Production apply remains a separate Griff authorization.

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1775
