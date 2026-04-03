create table if not exists public.model_health_snapshots (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.model_registry(id),
  sport text not null,
  market_family text not null,
  snapshot_at timestamptz not null default now(),
  win_rate numeric,
  roi numeric,
  sample_size integer not null default 0,
  drift_score numeric,
  calibration_score numeric,
  alert_level text not null default 'none' check (alert_level in ('none', 'warning', 'critical')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_model_health_snapshots_model_id
  on public.model_health_snapshots (model_id);

create index if not exists idx_model_health_snapshots_sport_market_family
  on public.model_health_snapshots (sport, market_family);

create index if not exists idx_model_health_snapshots_alerted_snapshot_at
  on public.model_health_snapshots (alert_level, snapshot_at)
  where alert_level != 'none';
