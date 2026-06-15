-- model_registry: durable registry of model versions and their operational status
create table if not exists public.model_registry (
  id uuid primary key default gen_random_uuid(),
  model_name text not null,
  version text not null,
  sport text not null,
  market_family text not null,
  status text not null default 'staged',
  champion_since timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint model_registry_status_check check (
    status in ('champion', 'challenger', 'staged', 'archived')
  )
);

create unique index model_registry_unique_champion_idx
  on public.model_registry(sport, market_family)
  where status = 'champion';

create index model_registry_sport_market_idx
  on public.model_registry(sport, market_family);

-- experiment_ledger: training/eval/backtest run history per model version
create table if not exists public.experiment_ledger (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.model_registry(id),
  run_type text not null,
  sport text not null,
  market_family text not null,
  status text not null default 'running',
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  metrics jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint experiment_ledger_run_type_check check (
    run_type in ('training', 'eval', 'backtest', 'calibration')
  ),
  constraint experiment_ledger_status_check check (
    status in ('running', 'completed', 'failed', 'cancelled')
  )
);

create index experiment_ledger_model_id_idx
  on public.experiment_ledger(model_id);
