# Diff summary: UTV2-1980

Tier: T1 (migration). Replaces closed PR #1774 (superseded predecessor lane); migration and down script are byte-identical to #1774 head 8a46cc1bd.

| File | Change |
|---|---|
| supabase/migrations/20261022090000_revoke_governed_pick_performance_anon.sql | Sets `security_invoker = true` on `public.v_governed_pick_performance`; REVOKE ALL from PUBLIC, anon, authenticated, service_role; GRANT SELECT to service_role only. sha256 882d511b34a4e7e675ae1eb45e8c9b403210f11829fde379c6fc7e3d107f8b64 |
| db/migrations-rollback/20261022090000_revoke_governed_pick_performance_anon.down.sql | Restores measured pre-change posture (RESET security_invoker; anon, authenticated, service_role hold all privileges; PUBLIC none). sha256 f9fcd460097c787ab96dbd28558bed876ca46e175f5d953c7973c6a510f330a2 |
| .ops/work/UTV2-1980.md | Repo-authored work order (task contract source; no tracker credential was used) |

No production DDL applied. Production apply remains a separate Griff authorization.

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1775
