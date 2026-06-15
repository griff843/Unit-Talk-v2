alter table public.picks
  add column if not exists approval_status text not null default 'approved',
  add column if not exists promotion_status text not null default 'not_eligible',
  add column if not exists promotion_target text,
  add column if not exists promotion_score numeric(5, 2),
  add column if not exists promotion_reason text,
  add column if not exists promotion_version text,
  add column if not exists promotion_decided_at timestamptz,
  add column if not exists promotion_decided_by text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'picks_approval_status_check'
  ) then
    alter table public.picks
      add constraint picks_approval_status_check
      check (approval_status in ('pending', 'approved', 'rejected', 'voided', 'expired'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'picks_promotion_status_check'
  ) then
    alter table public.picks
      add constraint picks_promotion_status_check
      check (promotion_status in ('not_eligible', 'eligible', 'qualified', 'promoted', 'suppressed', 'expired'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'picks_promotion_target_check'
  ) then
    alter table public.picks
      add constraint picks_promotion_target_check
      check (promotion_target is null or promotion_target in ('best-bets'));
  end if;
end $$;

create table if not exists public.pick_promotion_history (
  id uuid primary key default gen_random_uuid(),
  pick_id uuid not null references public.picks(id) on delete cascade,
  target text not null,
  status text not null,
  score numeric(5, 2),
  reason text,
  version text not null,
  decided_at timestamptz not null,
  decided_by text not null,
  override_action text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pick_promotion_history_target_check'
  ) then
    alter table public.pick_promotion_history
      add constraint pick_promotion_history_target_check
      check (target in ('best-bets'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pick_promotion_history_status_check'
  ) then
    alter table public.pick_promotion_history
      add constraint pick_promotion_history_status_check
      check (status in ('not_eligible', 'eligible', 'qualified', 'promoted', 'suppressed', 'expired'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pick_promotion_history_override_action_check'
  ) then
    alter table public.pick_promotion_history
      add constraint pick_promotion_history_override_action_check
      check (
        override_action is null
        or override_action in ('force_promote', 'suppress_from_best_bets')
      );
  end if;
end $$;

create index if not exists picks_promotion_target_idx
  on public.picks(promotion_target)
  where promotion_target is not null;

create index if not exists picks_promotion_status_idx
  on public.picks(promotion_status);

create index if not exists pick_promotion_history_pick_id_idx
  on public.pick_promotion_history(pick_id, created_at desc);

create index if not exists pick_promotion_history_target_status_idx
  on public.pick_promotion_history(target, status, decided_at desc);
