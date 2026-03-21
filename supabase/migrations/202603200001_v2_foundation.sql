create extension if not exists pgcrypto;

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  source text not null,
  submitted_by text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'received',
  received_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint submissions_status_check check (
    status in ('received', 'validated', 'rejected', 'materialized')
  )
);

create table if not exists public.submission_events (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  event_name text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  participant_type text not null,
  sport text,
  league text,
  display_name text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint participants_type_check check (
    participant_type in ('player', 'team', 'league', 'event')
  )
);

create table if not exists public.participant_memberships (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  parent_participant_id uuid not null references public.participants(id) on delete cascade,
  role text,
  valid_from timestamptz,
  valid_to timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.picks (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid references public.submissions(id) on delete set null,
  participant_id uuid references public.participants(id) on delete set null,
  market text not null,
  selection text not null,
  line numeric(10, 2),
  odds integer,
  stake_units numeric(10, 2),
  confidence numeric(5, 2),
  source text not null,
  status text not null default 'draft',
  posted_at timestamptz,
  settled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint picks_status_check check (
    status in ('draft', 'validated', 'queued', 'posted', 'settled', 'voided')
  )
);

create table if not exists public.pick_lifecycle (
  id uuid primary key default gen_random_uuid(),
  pick_id uuid not null references public.picks(id) on delete cascade,
  lifecycle_state text not null,
  writer_role text not null,
  reason text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint pick_lifecycle_writer_role_check check (
    writer_role in ('submitter', 'promoter', 'poster', 'settler', 'operator_override')
  )
);

create table if not exists public.distribution_outbox (
  id uuid primary key default gen_random_uuid(),
  pick_id uuid not null references public.picks(id) on delete cascade,
  target text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint distribution_outbox_status_check check (
    status in ('pending', 'processing', 'sent', 'failed', 'dead_letter')
  )
);

create table if not exists public.distribution_receipts (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.distribution_outbox(id) on delete cascade,
  external_id text,
  receipt_type text not null,
  status text not null,
  payload jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.settlement_records (
  id uuid primary key default gen_random_uuid(),
  pick_id uuid not null references public.picks(id) on delete cascade,
  result text not null,
  source text not null,
  confidence numeric(5, 2),
  settled_by text,
  payload jsonb not null default '{}'::jsonb,
  settled_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  constraint settlement_records_result_check check (
    result in ('win', 'loss', 'push', 'void', 'cancelled')
  )
);

create table if not exists public.system_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null,
  status text not null default 'running',
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  actor text,
  details jsonb not null default '{}'::jsonb,
  constraint system_runs_status_check check (
    status in ('running', 'succeeded', 'failed', 'cancelled')
  )
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  actor text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists submissions_status_idx on public.submissions(status);
create index if not exists submission_events_submission_id_idx on public.submission_events(submission_id);
create index if not exists picks_submission_id_idx on public.picks(submission_id);
create index if not exists picks_status_idx on public.picks(status);
create index if not exists pick_lifecycle_pick_id_idx on public.pick_lifecycle(pick_id);
create index if not exists distribution_outbox_pick_id_idx on public.distribution_outbox(pick_id);
create index if not exists distribution_outbox_status_idx on public.distribution_outbox(status);
create index if not exists distribution_receipts_outbox_id_idx on public.distribution_receipts(outbox_id);
create index if not exists settlement_records_pick_id_idx on public.settlement_records(pick_id);
create index if not exists system_runs_status_idx on public.system_runs(status);
create index if not exists audit_log_entity_idx on public.audit_log(entity_type, entity_id);

