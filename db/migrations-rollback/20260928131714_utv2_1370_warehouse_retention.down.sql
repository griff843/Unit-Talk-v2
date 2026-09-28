begin;

do $refuse_after_use$
begin
  if to_regclass('public.warehouse_retention_executions') is not null
     and exists (select 1 from public.warehouse_retention_executions) then
    raise check_violation using message = 'retention executions exist; capability rollback requires an explicit receipt-preservation migration';
  end if;
  if to_regclass('public.warehouse_retention_plans') is not null
     and exists (select 1 from public.warehouse_retention_plans) then
    raise check_violation using message = 'retention plans exist; capability rollback requires an explicit receipt-preservation migration';
  end if;
end
$refuse_after_use$;

drop function if exists public.warehouse_retention_recover_window(uuid, jsonb, timestamptz, text);
drop function if exists public.warehouse_retention_execute_window(uuid, text, timestamptz, text);
drop function if exists public.warehouse_retention_plan_window(text, date, text, text, text, bigint, timestamptz, timestamptz, text, text, text);
drop function if exists public.warehouse_retention_window_counts(text, timestamptz, timestamptz);
drop function if exists public.warehouse_retention_assert_fk_contract(text);
drop function if exists public.warehouse_retention_source_config(text);

drop table if exists public.warehouse_retention_recoveries;
drop table if exists public.warehouse_retention_executions;
drop table if exists public.warehouse_retention_plans;
drop function if exists public.warehouse_retention_control_immutable();

create or replace function public.raw_payloads_immutable()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'raw_payloads rows are immutable — no UPDATE or DELETE allowed (UTV2-1084)';
end
$function$;

create or replace function public.odds_snapshots_immutable()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'odds_snapshots rows are immutable — no UPDATE or DELETE allowed (UTV2-1085)';
end
$function$;

-- Phase roles are cluster-wide and may be shared by another database in the
-- same cluster. Make them inert in this database; do not make rollback depend
-- on cross-database DROP ROLE side effects.
revoke all privileges on schema public from warehouse_retention_planner, warehouse_retention_executor, warehouse_retention_recovery;
revoke all privileges on all tables in schema public from warehouse_retention_planner, warehouse_retention_executor, warehouse_retention_recovery;
revoke all privileges on all sequences in schema public from warehouse_retention_planner, warehouse_retention_executor, warehouse_retention_recovery;
revoke all privileges on all functions in schema public from warehouse_retention_planner, warehouse_retention_executor, warehouse_retention_recovery;

commit;
