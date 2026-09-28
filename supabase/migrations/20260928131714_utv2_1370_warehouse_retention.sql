-- UTV2-1370 — governed archive-verified hot-retention pruning.
--
-- This migration creates a deliberately narrow database boundary. Callers get
-- EXECUTE on one phase only; they never receive DELETE/INSERT/UPDATE on source
-- tables or SELECT on the control tables. Object-store verification remains in
-- the runner, while this boundary independently rechecks policy age, exact hot
-- counts, inbound references, evidence freshness, plan expiry and the bounded
-- row ceiling inside the deleting transaction.
--
-- FAIL-CLOSED-PRECONDITION: public.warehouse_retention_plans, public.warehouse_retention_executions, public.warehouse_retention_recoveries, public.warehouse_retention_control_immutable(), public.warehouse_retention_source_config(text), public.warehouse_retention_assert_fk_contract(text), public.warehouse_retention_window_counts(text, timestamp with time zone, timestamp with time zone), public.warehouse_retention_plan_window(text, date, text, text, text, bigint, timestamp with time zone, timestamp with time zone, text, text, text), public.warehouse_retention_execute_window(uuid, text, timestamp with time zone, text), public.warehouse_retention_recover_window(uuid, jsonb, timestamp with time zone, text)

begin;

do $guard$
declare
  v_name text;
begin
  foreach v_name in array array[
    'warehouse_retention_plans',
    'warehouse_retention_executions',
    'warehouse_retention_recoveries'
  ] loop
    if to_regclass('public.' || v_name) is not null then
      raise duplicate_table using message = format('public.%s already exists; refusing before DDL', v_name);
    end if;
  end loop;

  if to_regprocedure('public.warehouse_retention_control_immutable()') is not null
     or to_regprocedure('public.warehouse_retention_source_config(text)') is not null
     or to_regprocedure('public.warehouse_retention_assert_fk_contract(text)') is not null
     or to_regprocedure('public.warehouse_retention_window_counts(text,timestamp with time zone,timestamp with time zone)') is not null
     or to_regprocedure('public.warehouse_retention_plan_window(text,date,text,text,text,bigint,timestamp with time zone,timestamp with time zone,text,text,text)') is not null
     or to_regprocedure('public.warehouse_retention_execute_window(uuid,text,timestamp with time zone,text)') is not null
     or to_regprocedure('public.warehouse_retention_recover_window(uuid,jsonb,timestamp with time zone,text)') is not null then
    raise duplicate_function using message = 'warehouse retention routine already exists; refusing before DDL';
  end if;

  foreach v_name in array array[
    'warehouse_retention_planner',
    'warehouse_retention_executor',
    'warehouse_retention_recovery'
  ] loop
    if exists (select 1 from pg_roles where rolname = v_name) then
      raise duplicate_object using message = format('role %s already exists; refusing before DDL', v_name);
    end if;
  end loop;
end
$guard$;

create role warehouse_retention_planner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication;
create role warehouse_retention_executor nologin noinherit nosuperuser nocreatedb nocreaterole noreplication;
create role warehouse_retention_recovery nologin noinherit nosuperuser nocreatedb nocreaterole noreplication;

create table public.warehouse_retention_plans (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  source_name text not null check (source_name in ('provider_offer_history', 'raw_payloads', 'odds_snapshots', 'system_runs')),
  window_start timestamptz not null,
  window_end timestamptz not null,
  manifest_id text not null,
  manifest_key text not null,
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  object_sha256 text not null check (object_sha256 ~ '^[0-9a-f]{64}$'),
  archive_row_count bigint not null check (archive_row_count >= 0),
  hot_row_count bigint not null check (hot_row_count >= 0),
  protected_row_count bigint not null check (protected_row_count >= 0),
  manifest_verified_at timestamptz not null,
  evidence_checked_at timestamptz not null,
  planned_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  requested_by text not null,
  db_session_user text not null,
  check (window_end > window_start),
  check (expires_at > planned_at)
);

create table public.warehouse_retention_executions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null unique references public.warehouse_retention_plans(id),
  source_name text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  manifest_id text not null,
  manifest_sha256 text not null,
  object_sha256 text not null,
  rows_before bigint not null,
  rows_deleted bigint not null,
  rows_after bigint not null,
  executed_at timestamptz not null default clock_timestamp(),
  requested_by text not null,
  db_session_user text not null,
  check (rows_before >= 0 and rows_deleted >= 0 and rows_after >= 0),
  check (rows_before = rows_deleted and rows_after = 0)
);

create table public.warehouse_retention_recoveries (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null unique references public.warehouse_retention_executions(id),
  rows_restored bigint not null check (rows_restored > 0),
  rows_after bigint not null check (rows_after = rows_restored),
  recovered_at timestamptz not null default clock_timestamp(),
  requested_by text not null,
  db_session_user text not null
);

alter table public.warehouse_retention_plans enable row level security;
alter table public.warehouse_retention_executions enable row level security;
alter table public.warehouse_retention_recoveries enable row level security;

revoke all on table public.warehouse_retention_plans from public;
revoke all on table public.warehouse_retention_executions from public;
revoke all on table public.warehouse_retention_recoveries from public;

do $revoke_data_api$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.warehouse_retention_plans from anon;
    revoke all on table public.warehouse_retention_executions from anon;
    revoke all on table public.warehouse_retention_recoveries from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.warehouse_retention_plans from authenticated;
    revoke all on table public.warehouse_retention_executions from authenticated;
    revoke all on table public.warehouse_retention_recoveries from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on table public.warehouse_retention_plans from service_role;
    revoke all on table public.warehouse_retention_executions from service_role;
    revoke all on table public.warehouse_retention_recoveries from service_role;
  end if;
end
$revoke_data_api$;

create function public.warehouse_retention_control_immutable()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using
    errcode = '55000',
    message = format('%I is append-only; UPDATE and DELETE are forbidden', tg_table_name);
end
$function$;

create trigger warehouse_retention_plans_immutable
before update or delete on public.warehouse_retention_plans
for each row execute function public.warehouse_retention_control_immutable();
create trigger warehouse_retention_executions_immutable
before update or delete on public.warehouse_retention_executions
for each row execute function public.warehouse_retention_control_immutable();
create trigger warehouse_retention_recoveries_immutable
before update or delete on public.warehouse_retention_recoveries
for each row execute function public.warehouse_retention_control_immutable();

create function public.warehouse_retention_source_config(p_source text)
returns jsonb
language sql
immutable
strict
set search_path = ''
as $function$
  select case p_source
    when 'provider_offer_history' then jsonb_build_object('relation', 'public.provider_offer_history', 'time_column', 'snapshot_at', 'hot_days', 45)
    when 'raw_payloads' then jsonb_build_object('relation', 'public.raw_payloads', 'time_column', 'snapshot_at', 'hot_days', 21)
    when 'odds_snapshots' then jsonb_build_object('relation', 'public.odds_snapshots', 'time_column', 'snapshot_at', 'hot_days', 45)
    when 'system_runs' then jsonb_build_object('relation', 'public.system_runs', 'time_column', 'started_at', 'hot_days', 90)
    else null
  end
$function$;

create function public.warehouse_retention_assert_fk_contract(p_source text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_relation regclass;
  v_actual text[];
  v_expected text[];
begin
  v_relation := case p_source
    when 'provider_offer_history' then 'public.provider_offer_history'::regclass
    when 'raw_payloads' then 'public.raw_payloads'::regclass
    when 'odds_snapshots' then 'public.odds_snapshots'::regclass
    when 'system_runs' then 'public.system_runs'::regclass
    else null
  end;
  if v_relation is null then
    raise check_violation using message = 'source is not in the warehouse retention allowlist';
  end if;

  select coalesce(array_agg(c.conname order by c.conname), array[]::text[])
    into v_actual
    from pg_catalog.pg_constraint c
   where c.contype = 'f'
     and c.confrelid = v_relation
     and c.conparentid = 0;

  v_expected := case p_source
    when 'provider_offer_history' then array[]::text[]
    when 'raw_payloads' then array['odds_snapshots_raw_payload_id_fkey']::text[]
    when 'odds_snapshots' then array[
      'odds_snapshot_corrections_new_snapshot_id_fkey',
      'odds_snapshot_corrections_snapshot_id_fkey',
      'odds_snapshots_prior_snapshot_id_fkey'
    ]::text[]
    when 'system_runs' then array[
      'pick_candidates_scoring_run_id_fkey',
      'pick_offer_snapshots_source_run_id_fkey',
      'provider_cycle_status_run_id_fkey',
      'provider_offer_current_source_run_id_fkey',
      'provider_offer_history_compact_source_run_id_fkey',
      'provider_offer_history_source_run_id_fkey',
      'provider_offer_staging_run_id_fkey'
    ]::text[]
  end;

  if v_actual is distinct from v_expected then
    raise check_violation using
      message = format('foreign-key contract changed for %s; expected %s, found %s', p_source, v_expected, v_actual);
  end if;
end
$function$;

create function public.warehouse_retention_window_counts(
  p_source text,
  p_window_start timestamptz,
  p_window_end timestamptz
)
returns table(hot_row_count bigint, protected_row_count bigint)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform public.warehouse_retention_assert_fk_contract(p_source);

  if p_source = 'provider_offer_history' then
    return query
    select count(*)::bigint, 0::bigint
      from public.provider_offer_history h
     where h.snapshot_at >= p_window_start and h.snapshot_at < p_window_end;
  elsif p_source = 'raw_payloads' then
    return query
    select count(*)::bigint,
           count(*) filter (where exists (
             select 1 from public.odds_snapshots o where o.raw_payload_id = r.id
           ))::bigint
      from public.raw_payloads r
     where r.snapshot_at >= p_window_start and r.snapshot_at < p_window_end;
  elsif p_source = 'odds_snapshots' then
    return query
    select count(*)::bigint,
           count(*) filter (where
             exists (select 1 from public.odds_snapshots n where n.prior_snapshot_id = o.id)
             or exists (select 1 from public.odds_snapshot_corrections c where c.snapshot_id = o.id or c.new_snapshot_id = o.id)
           )::bigint
      from public.odds_snapshots o
     where o.snapshot_at >= p_window_start and o.snapshot_at < p_window_end;
  elsif p_source = 'system_runs' then
    return query
    select count(*)::bigint,
           count(*) filter (where
             exists (select 1 from public.pick_candidates x where x.scoring_run_id = r.id)
             or exists (select 1 from public.pick_offer_snapshots x where x.source_run_id = r.id)
             or exists (select 1 from public.provider_cycle_status x where x.run_id = r.id)
             or exists (select 1 from public.provider_offer_current x where x.source_run_id = r.id)
             or exists (select 1 from public.provider_offer_history x where x.source_run_id = r.id)
             or exists (select 1 from public.provider_offer_history_compact x where x.source_run_id = r.id)
             or exists (select 1 from public.provider_offer_staging x where x.run_id = r.id)
           )::bigint
      from public.system_runs r
     where r.started_at >= p_window_start and r.started_at < p_window_end;
  else
    raise check_violation using message = 'source is not in the warehouse retention allowlist';
  end if;
end
$function$;

create function public.warehouse_retention_plan_window(
  p_source text,
  p_window_date date,
  p_manifest_id text,
  p_manifest_key text,
  p_manifest_sha256 text,
  p_archive_row_count bigint,
  p_manifest_verified_at timestamptz,
  p_evidence_checked_at timestamptz,
  p_object_sha256 text,
  p_idempotency_key text,
  p_requested_by text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_config jsonb;
  v_start timestamptz := p_window_date::timestamp at time zone 'UTC';
  v_end timestamptz := (p_window_date + 1)::timestamp at time zone 'UTC';
  v_now timestamptz := clock_timestamp();
  v_hot bigint;
  v_protected bigint;
  v_plan public.warehouse_retention_plans%rowtype;
begin
  if p_source = 'provider_offers_legacy_quarantine' then
    raise check_violation using message = 'provider_offers_legacy_quarantine is under unconditional prune hold';
  end if;
  v_config := public.warehouse_retention_source_config(p_source);
  if v_config is null then
    raise check_violation using message = 'source is not in the warehouse retention allowlist';
  end if;
  if v_end > date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC'
       - make_interval(days => (v_config->>'hot_days')::integer) then
    raise check_violation using message = 'window is still inside hot retention';
  end if;
  if p_evidence_checked_at < v_now - interval '5 minutes'
     or p_evidence_checked_at > v_now + interval '30 seconds' then
    raise check_violation using message = 'archive evidence is stale or future-dated';
  end if;
  if p_manifest_verified_at > p_evidence_checked_at then
    raise check_violation using message = 'manifest verification timestamp is later than the evidence check';
  end if;
  if p_manifest_id is null or p_manifest_id = ''
     or p_manifest_key is null or p_manifest_key !~ '^manifests/'
     or p_manifest_sha256 !~ '^[0-9a-f]{64}$'
     or p_object_sha256 !~ '^[0-9a-f]{64}$'
     or p_archive_row_count < 0
     or p_idempotency_key is null or p_idempotency_key = ''
     or p_requested_by is null or p_requested_by = '' then
    raise check_violation using message = 'archive evidence fields are incomplete or invalid';
  end if;

  select c.hot_row_count, c.protected_row_count
    into v_hot, v_protected
    from public.warehouse_retention_window_counts(p_source, v_start, v_end) c;

  if v_hot <> p_archive_row_count then
    raise check_violation using message = format('hot/archive row count mismatch: hot=%s archive=%s', v_hot, p_archive_row_count);
  end if;
  if v_protected <> 0 then
    raise foreign_key_violation using message = format('%s row(s) are reference-protected; whole-window prune refused', v_protected);
  end if;
  if v_hot = 0 then
    raise check_violation using message = 'empty hot window is not a prune canary';
  end if;
  if v_hot > 10000 then
    raise program_limit_exceeded using message = format('bounded canary ceiling is 10000 rows; window has %s', v_hot);
  end if;

  insert into public.warehouse_retention_plans (
    idempotency_key, source_name, window_start, window_end,
    manifest_id, manifest_key, manifest_sha256, object_sha256,
    archive_row_count, hot_row_count, protected_row_count,
    manifest_verified_at, evidence_checked_at, expires_at,
    requested_by, db_session_user
  ) values (
    p_idempotency_key, p_source, v_start, v_end,
    p_manifest_id, p_manifest_key, p_manifest_sha256, p_object_sha256,
    p_archive_row_count, v_hot, v_protected,
    p_manifest_verified_at, p_evidence_checked_at, v_now + interval '24 hours',
    p_requested_by, session_user
  )
  on conflict (idempotency_key) do nothing;

  select * into v_plan
    from public.warehouse_retention_plans
   where idempotency_key = p_idempotency_key;

  if v_plan.source_name <> p_source
     or v_plan.window_start <> v_start
     or v_plan.window_end <> v_end
     or v_plan.manifest_id <> p_manifest_id
     or v_plan.manifest_sha256 <> p_manifest_sha256
     or v_plan.object_sha256 <> p_object_sha256
     or v_plan.archive_row_count <> p_archive_row_count then
    raise unique_violation using message = 'idempotency key is already bound to different retention evidence';
  end if;

  return jsonb_build_object(
    'plan_id', v_plan.id,
    'source', v_plan.source_name,
    'window_start', v_plan.window_start,
    'window_end', v_plan.window_end,
    'manifest_id', v_plan.manifest_id,
    'manifest_sha256', v_plan.manifest_sha256,
    'object_sha256', v_plan.object_sha256,
    'archive_row_count', v_plan.archive_row_count,
    'hot_row_count', v_plan.hot_row_count,
    'protected_row_count', v_plan.protected_row_count,
    'planned_at', v_plan.planned_at,
    'expires_at', v_plan.expires_at,
    'status', 'dry_run_verified'
  );
end
$function$;

create function public.warehouse_retention_execute_window(
  p_plan_id uuid,
  p_manifest_sha256 text,
  p_evidence_checked_at timestamptz,
  p_requested_by text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_plan public.warehouse_retention_plans%rowtype;
  v_existing public.warehouse_retention_executions%rowtype;
  v_now timestamptz := clock_timestamp();
  v_hot bigint;
  v_protected bigint;
  v_deleted bigint;
  v_after bigint;
  v_execution_id uuid;
  v_partition regclass;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_plan_id::text, 1370));

  select * into v_plan
    from public.warehouse_retention_plans
   where id = p_plan_id;
  if not found then
    raise no_data_found using message = 'retention plan does not exist';
  end if;

  select * into v_existing
    from public.warehouse_retention_executions
   where plan_id = p_plan_id;
  if found then
    return jsonb_build_object(
      'execution_id', v_existing.id,
      'plan_id', v_existing.plan_id,
      'rows_deleted', v_existing.rows_deleted,
      'rows_after', v_existing.rows_after,
      'status', 'skipped_already_executed'
    );
  end if;

  if v_now > v_plan.expires_at then
    raise check_violation using message = 'retention plan expired';
  end if;
  if p_manifest_sha256 <> v_plan.manifest_sha256 then
    raise check_violation using message = 'manifest fingerprint changed since dry run';
  end if;
  if p_evidence_checked_at < v_now - interval '5 minutes'
     or p_evidence_checked_at > v_now + interval '30 seconds' then
    raise check_violation using message = 'execution archive evidence is stale or future-dated';
  end if;
  if p_requested_by is null or p_requested_by = '' then
    raise check_violation using message = 'requested_by is required';
  end if;

  if v_plan.source_name = 'provider_offer_history' then
    v_partition := to_regclass('public.provider_offer_history_p' || to_char(v_plan.window_start at time zone 'UTC', 'YYYYMMDD'));
    if v_partition is null then
      lock table public.provider_offer_history in share row exclusive mode;
    else
      execute format('lock table %s in share row exclusive mode', v_partition);
    end if;
  elsif v_plan.source_name = 'raw_payloads' then
    lock table public.raw_payloads in share row exclusive mode;
  elsif v_plan.source_name = 'odds_snapshots' then
    lock table public.odds_snapshots in share row exclusive mode;
  elsif v_plan.source_name = 'system_runs' then
    lock table public.system_runs in share row exclusive mode;
  else
    raise check_violation using message = 'source is not in the warehouse retention allowlist';
  end if;

  select c.hot_row_count, c.protected_row_count
    into v_hot, v_protected
    from public.warehouse_retention_window_counts(v_plan.source_name, v_plan.window_start, v_plan.window_end) c;
  if v_hot <> v_plan.hot_row_count or v_hot <> v_plan.archive_row_count then
    raise check_violation using message = format('hot count changed after dry run: planned=%s current=%s archive=%s', v_plan.hot_row_count, v_hot, v_plan.archive_row_count);
  end if;
  if v_protected <> 0 then
    raise foreign_key_violation using message = format('%s row(s) became reference-protected; prune refused', v_protected);
  end if;
  if v_hot = 0 or v_hot > 10000 then
    raise program_limit_exceeded using message = format('execution count %s is outside bounded canary range 1..10000', v_hot);
  end if;

  perform pg_catalog.set_config('unit_talk.warehouse_retention_plan_id', p_plan_id::text, true);

  if v_plan.source_name = 'provider_offer_history' then
    delete from public.provider_offer_history
     where snapshot_at >= v_plan.window_start and snapshot_at < v_plan.window_end;
  elsif v_plan.source_name = 'raw_payloads' then
    delete from public.raw_payloads
     where snapshot_at >= v_plan.window_start and snapshot_at < v_plan.window_end;
  elsif v_plan.source_name = 'odds_snapshots' then
    delete from public.odds_snapshots
     where snapshot_at >= v_plan.window_start and snapshot_at < v_plan.window_end;
  elsif v_plan.source_name = 'system_runs' then
    delete from public.system_runs
     where started_at >= v_plan.window_start and started_at < v_plan.window_end;
  end if;
  get diagnostics v_deleted = row_count;

  if v_deleted <> v_hot then
    raise check_violation using message = format('delete count mismatch: expected=%s deleted=%s', v_hot, v_deleted);
  end if;

  select c.hot_row_count into v_after
    from public.warehouse_retention_window_counts(v_plan.source_name, v_plan.window_start, v_plan.window_end) c;
  if v_after <> 0 then
    raise check_violation using message = format('post-delete window is not empty: %s row(s) remain', v_after);
  end if;

  insert into public.warehouse_retention_executions (
    plan_id, source_name, window_start, window_end,
    manifest_id, manifest_sha256, object_sha256,
    rows_before, rows_deleted, rows_after,
    requested_by, db_session_user
  ) values (
    v_plan.id, v_plan.source_name, v_plan.window_start, v_plan.window_end,
    v_plan.manifest_id, v_plan.manifest_sha256, v_plan.object_sha256,
    v_hot, v_deleted, v_after,
    p_requested_by, session_user
  ) returning id into v_execution_id;

  return jsonb_build_object(
    'execution_id', v_execution_id,
    'plan_id', v_plan.id,
    'source', v_plan.source_name,
    'window_start', v_plan.window_start,
    'window_end', v_plan.window_end,
    'rows_before', v_hot,
    'rows_deleted', v_deleted,
    'rows_after', v_after,
    'status', 'pruned'
  );
end
$function$;

create function public.warehouse_retention_recover_window(
  p_execution_id uuid,
  p_rows jsonb,
  p_evidence_checked_at timestamptz,
  p_requested_by text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_execution public.warehouse_retention_executions%rowtype;
  v_now timestamptz := clock_timestamp();
  v_count bigint;
  v_after bigint;
  v_recovery_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_execution_id::text, 1370));
  select * into v_execution
    from public.warehouse_retention_executions
   where id = p_execution_id;
  if not found then
    raise no_data_found using message = 'retention execution does not exist';
  end if;
  if exists (select 1 from public.warehouse_retention_recoveries where execution_id = p_execution_id) then
    raise unique_violation using message = 'retention execution was already recovered';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise check_violation using message = 'recovery payload must be a JSON array';
  end if;
  v_count := jsonb_array_length(p_rows);
  if v_count <> v_execution.rows_deleted or v_count = 0 or v_count > 10000 then
    raise check_violation using message = format('recovery row count mismatch or out of bounds: expected=%s supplied=%s', v_execution.rows_deleted, v_count);
  end if;
  if p_evidence_checked_at < v_now - interval '5 minutes'
     or p_evidence_checked_at > v_now + interval '30 seconds' then
    raise check_violation using message = 'recovery archive evidence is stale or future-dated';
  end if;
  if p_requested_by is null or p_requested_by = '' then
    raise check_violation using message = 'requested_by is required';
  end if;

  select c.hot_row_count into v_after
    from public.warehouse_retention_window_counts(v_execution.source_name, v_execution.window_start, v_execution.window_end) c;
  if v_after <> 0 then
    raise check_violation using message = format('recovery requires an empty hot window; found %s row(s)', v_after);
  end if;

  if v_execution.source_name = 'provider_offer_history' then
    if exists (
      select 1 from jsonb_populate_recordset(null::public.provider_offer_history, p_rows) r
       where r.snapshot_at < v_execution.window_start or r.snapshot_at >= v_execution.window_end
    ) then raise check_violation using message = 'recovery payload contains an out-of-window row'; end if;
    insert into public.provider_offer_history
      select * from jsonb_populate_recordset(null::public.provider_offer_history, p_rows);
  elsif v_execution.source_name = 'raw_payloads' then
    if exists (
      select 1 from jsonb_populate_recordset(null::public.raw_payloads, p_rows) r
       where r.snapshot_at < v_execution.window_start or r.snapshot_at >= v_execution.window_end
    ) then raise check_violation using message = 'recovery payload contains an out-of-window row'; end if;
    insert into public.raw_payloads
      select * from jsonb_populate_recordset(null::public.raw_payloads, p_rows);
  elsif v_execution.source_name = 'odds_snapshots' then
    if exists (
      select 1 from jsonb_populate_recordset(null::public.odds_snapshots, p_rows) r
       where r.snapshot_at < v_execution.window_start or r.snapshot_at >= v_execution.window_end
    ) then raise check_violation using message = 'recovery payload contains an out-of-window row'; end if;
    insert into public.odds_snapshots
      select * from jsonb_populate_recordset(null::public.odds_snapshots, p_rows);
  elsif v_execution.source_name = 'system_runs' then
    if exists (
      select 1 from jsonb_populate_recordset(null::public.system_runs, p_rows) r
       where r.started_at < v_execution.window_start or r.started_at >= v_execution.window_end
    ) then raise check_violation using message = 'recovery payload contains an out-of-window row'; end if;
    insert into public.system_runs
      select * from jsonb_populate_recordset(null::public.system_runs, p_rows);
  else
    raise check_violation using message = 'source is not in the warehouse retention allowlist';
  end if;

  select c.hot_row_count into v_after
    from public.warehouse_retention_window_counts(v_execution.source_name, v_execution.window_start, v_execution.window_end) c;
  if v_after <> v_count then
    raise check_violation using message = format('recovery verification failed: expected=%s hot=%s', v_count, v_after);
  end if;

  insert into public.warehouse_retention_recoveries (
    execution_id, rows_restored, rows_after, requested_by, db_session_user
  ) values (
    p_execution_id, v_count, v_after, p_requested_by, session_user
  ) returning id into v_recovery_id;

  return jsonb_build_object(
    'recovery_id', v_recovery_id,
    'execution_id', p_execution_id,
    'rows_restored', v_count,
    'rows_after', v_after,
    'status', 'recovered'
  );
end
$function$;

-- Existing immutability remains the default. The only exception is a DELETE
-- running inside the SECURITY DEFINER executor after it set a transaction-local
-- plan id. The custom roles themselves have no DELETE grant, so setting the GUC
-- directly cannot turn into table access.
create or replace function public.raw_payloads_immutable()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_plan_id text := coalesce(current_setting('unit_talk.warehouse_retention_plan_id', true), '');
begin
  if tg_op = 'DELETE'
     and v_plan_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     and exists (
       select 1 from public.warehouse_retention_plans p
        where p.id = v_plan_id::uuid
          and p.source_name = 'raw_payloads'
          and old.snapshot_at >= p.window_start
          and old.snapshot_at < p.window_end
          and clock_timestamp() <= p.expires_at
     ) then
    return old;
  end if;
  raise exception 'raw_payloads rows are immutable — no UPDATE or DELETE allowed (UTV2-1084)';
end
$function$;

create or replace function public.odds_snapshots_immutable()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_plan_id text := coalesce(current_setting('unit_talk.warehouse_retention_plan_id', true), '');
begin
  if tg_op = 'DELETE'
     and v_plan_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     and exists (
       select 1 from public.warehouse_retention_plans p
        where p.id = v_plan_id::uuid
          and p.source_name = 'odds_snapshots'
          and old.snapshot_at >= p.window_start
          and old.snapshot_at < p.window_end
          and clock_timestamp() <= p.expires_at
     ) then
    return old;
  end if;
  raise exception 'odds_snapshots rows are immutable — no UPDATE or DELETE allowed (UTV2-1085)';
end
$function$;

revoke execute on function public.warehouse_retention_control_immutable() from public;
revoke execute on function public.warehouse_retention_source_config(text) from public;
revoke execute on function public.warehouse_retention_assert_fk_contract(text) from public;
revoke execute on function public.warehouse_retention_window_counts(text, timestamptz, timestamptz) from public;
revoke execute on function public.warehouse_retention_plan_window(text, date, text, text, text, bigint, timestamptz, timestamptz, text, text, text) from public;
revoke execute on function public.warehouse_retention_execute_window(uuid, text, timestamptz, text) from public;
revoke execute on function public.warehouse_retention_recover_window(uuid, jsonb, timestamptz, text) from public;

do $revoke_functions$
declare
  v_role text;
  v_signature text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      foreach v_signature in array array[
        'public.warehouse_retention_control_immutable()',
        'public.warehouse_retention_source_config(text)',
        'public.warehouse_retention_assert_fk_contract(text)',
        'public.warehouse_retention_window_counts(text,timestamptz,timestamptz)',
        'public.warehouse_retention_plan_window(text,date,text,text,text,bigint,timestamptz,timestamptz,text,text,text)',
        'public.warehouse_retention_execute_window(uuid,text,timestamptz,text)',
        'public.warehouse_retention_recover_window(uuid,jsonb,timestamptz,text)'
      ] loop
        execute format('revoke execute on function %s from %I', v_signature, v_role);
      end loop;
    end if;
  end loop;
end
$revoke_functions$;

grant usage on schema public to warehouse_retention_planner, warehouse_retention_executor, warehouse_retention_recovery;
grant execute on function public.warehouse_retention_plan_window(text, date, text, text, text, bigint, timestamptz, timestamptz, text, text, text)
  to warehouse_retention_planner;
grant execute on function public.warehouse_retention_execute_window(uuid, text, timestamptz, text)
  to warehouse_retention_executor;
grant execute on function public.warehouse_retention_recover_window(uuid, jsonb, timestamptz, text)
  to warehouse_retention_recovery;

do $assert_privileges$
declare
  v_role text;
begin
  if exists (
    select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      cross join lateral pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) acl
     where n.nspname = 'public'
       and p.proname in (
         'warehouse_retention_plan_window',
         'warehouse_retention_execute_window',
         'warehouse_retention_recover_window'
       )
       and acl.grantee = 0
       and acl.privilege_type = 'EXECUTE'
  ) then
    raise insufficient_privilege using message = 'warehouse retention capability leaked EXECUTE to PUBLIC';
  end if;

  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      if has_function_privilege(v_role, 'public.warehouse_retention_plan_window(text,date,text,text,text,bigint,timestamptz,timestamptz,text,text,text)', 'EXECUTE')
         or has_function_privilege(v_role, 'public.warehouse_retention_execute_window(uuid,text,timestamptz,text)', 'EXECUTE')
         or has_function_privilege(v_role, 'public.warehouse_retention_recover_window(uuid,jsonb,timestamptz,text)', 'EXECUTE') then
        raise insufficient_privilege using message = format('warehouse retention capability leaked EXECUTE to %s', v_role);
      end if;
    end if;
  end loop;
  if not has_function_privilege('warehouse_retention_planner', 'public.warehouse_retention_plan_window(text,date,text,text,text,bigint,timestamptz,timestamptz,text,text,text)', 'EXECUTE')
     or has_function_privilege('warehouse_retention_planner', 'public.warehouse_retention_execute_window(uuid,text,timestamptz,text)', 'EXECUTE')
     or has_function_privilege('warehouse_retention_planner', 'public.warehouse_retention_recover_window(uuid,jsonb,timestamptz,text)', 'EXECUTE') then
    raise insufficient_privilege using message = 'planner privilege boundary is incorrect';
  end if;
  if not has_function_privilege('warehouse_retention_executor', 'public.warehouse_retention_execute_window(uuid,text,timestamptz,text)', 'EXECUTE')
     or has_function_privilege('warehouse_retention_executor', 'public.warehouse_retention_plan_window(text,date,text,text,text,bigint,timestamptz,timestamptz,text,text,text)', 'EXECUTE')
     or has_function_privilege('warehouse_retention_executor', 'public.warehouse_retention_recover_window(uuid,jsonb,timestamptz,text)', 'EXECUTE') then
    raise insufficient_privilege using message = 'executor privilege boundary is incorrect';
  end if;
  if not has_function_privilege('warehouse_retention_recovery', 'public.warehouse_retention_recover_window(uuid,jsonb,timestamptz,text)', 'EXECUTE')
     or has_function_privilege('warehouse_retention_recovery', 'public.warehouse_retention_plan_window(text,date,text,text,text,bigint,timestamptz,timestamptz,text,text,text)', 'EXECUTE')
     or has_function_privilege('warehouse_retention_recovery', 'public.warehouse_retention_execute_window(uuid,text,timestamptz,text)', 'EXECUTE') then
    raise insufficient_privilege using message = 'recovery privilege boundary is incorrect';
  end if;
end
$assert_privileges$;

-- The obsolete cron remains disabled. Never update cron.job directly; this is
-- an assertion only, and it refuses migration if production drift reactivated it.
do $assert_legacy_cron_disabled$
declare
  v_legacy_cron_active boolean := false;
begin
  if to_regclass('cron.job') is not null then
    execute $sql$
      select exists (
        select 1
        from cron.job
        where jobname = 'nightly-retention-prune'
          and active
      )
    $sql$
    into v_legacy_cron_active;
  end if;

  if v_legacy_cron_active then
    raise check_violation using message = 'legacy nightly-retention-prune is active; refusing governed retention installation';
  end if;
end
$assert_legacy_cron_disabled$;

commit;
