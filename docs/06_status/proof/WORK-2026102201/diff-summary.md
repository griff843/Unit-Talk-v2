# Diff summary: WORK-2026102201

This lane adds one transactional privilege-hardening migration for
`public.v_governed_pick_performance`. The migration switches the view to
security-invoker semantics, removes every view privilege from `PUBLIC`, `anon`,
and `authenticated`, and leaves `service_role` with `SELECT` only. It includes
an operator-only recovery sequence and the exact `has_table_privilege` matrix
for before/apply/recovery/reapply evidence.

| File | Change |
|---|---|
| `.ops/work/WORK-2026102201.md` | Captured PM-authorized T1 work order; production DDL remains forbidden. |
| `supabase/migrations/20261022090000_revoke_governed_pick_performance_anon.sql` | Applies the service-role-only view posture and documents recovery plus privilege-snapshot SQL. |
| `docs/06_status/proof/WORK-2026102201/*` | Records static proof, deferred staging proof, and the current reversibility/scope blocker without claiming completion. |

No application, contract, domain, generated database type, or production state
was changed.

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1773
Verified source SHA: `aa83590a8a98e366c3bf502e68d176b490011860`
