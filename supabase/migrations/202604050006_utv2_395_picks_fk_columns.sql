-- UTV2-395: add canonical foreign keys to picks for capper, sport, and market type
-- Backfills best-effort values from existing submission metadata without forcing
-- synthetic joins or mutating immutable audit history.

alter table public.picks
  add column if not exists capper_id text references public.cappers(id) on delete set null,
  add column if not exists sport_id text references public.sports(id) on delete set null,
  add column if not exists market_type_id text references public.market_types(id) on delete set null;

create index if not exists idx_picks_capper_id on public.picks(capper_id);
create index if not exists idx_picks_sport_id on public.picks(sport_id);
create index if not exists idx_picks_market_type_id on public.picks(market_type_id);

update public.picks as p
set sport_id = upper(trim(p.metadata->>'sport'))
where p.sport_id is null
  and upper(trim(p.metadata->>'sport')) in ('NBA', 'NFL', 'MLB', 'NHL', 'NCAAB', 'NCAAF', 'SOCCER', 'TENNIS');

update public.picks as p
set capper_id = c.id
from public.cappers as c
where p.capper_id is null
  and c.id = coalesce(
    nullif(trim(p.metadata->>'capper'), ''),
    (
      select nullif(trim(s.submitted_by), '')
      from public.submissions as s
      where s.id = p.submission_id
    )
  );

update public.picks as p
set market_type_id = mapped.market_type_id
from (
  select
    picks.id,
    case
      when nullif(trim(picks.metadata->>'marketTypeId'), '') in (
        'moneyline',
        'spread',
        'game_total_ou',
        'team_total_ou',
        'player_points_ou',
        'player_rebounds_ou',
        'player_assists_ou',
        'player_3pm_ou',
        'player_steals_ou',
        'player_blocks_ou',
        'player_turnovers_ou',
        'player_pra_ou',
        'player_pts_rebs_ou',
        'player_pts_asts_ou',
        'player_rebs_asts_ou',
        'player_batting_hits_ou',
        'player_batting_home_runs_ou',
        'player_batting_rbi_ou',
        'player_batting_walks_ou',
        'player_batting_total_bases_ou',
        'player_pitching_strikeouts_ou',
        'player_pitching_innings_pitched_ou'
      ) then trim(picks.metadata->>'marketTypeId')
      when lower(coalesce(
        nullif(trim(picks.metadata->>'marketTypeId'), ''),
        nullif(trim(picks.market), '')
      )) in ('moneyline') then 'moneyline'
      when lower(coalesce(
        nullif(trim(picks.metadata->>'marketTypeId'), ''),
        nullif(trim(picks.market), '')
      )) in ('spread', 'game_spread') then 'spread'
      when lower(coalesce(
        nullif(trim(picks.metadata->>'marketTypeId'), ''),
        nullif(trim(picks.market), '')
      )) in ('total', 'game_total', 'game-total', 'game_total_ou') then 'game_total_ou'
      when lower(coalesce(
        nullif(trim(picks.metadata->>'marketTypeId'), ''),
        nullif(trim(picks.market), '')
      )) in ('team-total', 'team_total', 'team_total_ou') then 'team_total_ou'
      when lower(coalesce(
        nullif(trim(picks.metadata->>'marketTypeId'), ''),
        nullif(trim(picks.market), '')
      )) in ('player.points', 'points', 'points-all-game-ou') then 'player_points_ou'
      when lower(coalesce(
        nullif(trim(picks.metadata->>'marketTypeId'), ''),
        nullif(trim(picks.market), '')
      )) in ('player.rebounds', 'rebounds', 'rebounds-all-game-ou') then 'player_rebounds_ou'
      when lower(coalesce(
        nullif(trim(picks.metadata->>'marketTypeId'), ''),
        nullif(trim(picks.market), '')
      )) in ('player.assists', 'assists', 'assists-all-game-ou') then 'player_assists_ou'
      when lower(coalesce(
        nullif(trim(picks.metadata->>'marketTypeId'), ''),
        nullif(trim(picks.market), '')
      )) in ('player.threes', 'player.3pm', 'threes', 'player_3pm_ou') then 'player_3pm_ou'
      when lower(coalesce(
        nullif(trim(picks.metadata->>'marketTypeId'), ''),
        nullif(trim(picks.market), '')
      )) in ('player.steals', 'steals') then 'player_steals_ou'
      when lower(coalesce(
        nullif(trim(picks.metadata->>'marketTypeId'), ''),
        nullif(trim(picks.market), '')
      )) in ('player.blocks', 'blocks') then 'player_blocks_ou'
      when lower(coalesce(
        nullif(trim(picks.metadata->>'marketTypeId'), ''),
        nullif(trim(picks.market), '')
      )) in ('player.turnovers', 'turnovers', 'turnovers-all-game-ou') then 'player_turnovers_ou'
      when lower(coalesce(
        nullif(trim(picks.metadata->>'marketTypeId'), ''),
        nullif(trim(picks.market), '')
      )) in ('player.pra', 'pra', 'pra-all-game-ou') then 'player_pra_ou'
      when lower(coalesce(
        nullif(trim(picks.metadata->>'marketTypeId'), ''),
        nullif(trim(picks.market), '')
      )) in ('player.points_rebounds', 'pr', 'pr-all-game-ou') then 'player_pts_rebs_ou'
      when lower(coalesce(
        nullif(trim(picks.metadata->>'marketTypeId'), ''),
        nullif(trim(picks.market), '')
      )) in ('player.points_assists', 'pa', 'pa-all-game-ou') then 'player_pts_asts_ou'
      when lower(coalesce(
        nullif(trim(picks.metadata->>'marketTypeId'), ''),
        nullif(trim(picks.market), '')
      )) in ('player.rebounds_assists', 'ra', 'ra-all-game-ou') then 'player_rebs_asts_ou'
      when lower(coalesce(
        nullif(trim(picks.metadata->>'marketTypeId'), ''),
        nullif(trim(picks.market), '')
      )) = 'batting-hits-all-game-ou' then 'player_batting_hits_ou'
      when lower(coalesce(
        nullif(trim(picks.metadata->>'marketTypeId'), ''),
        nullif(trim(picks.market), '')
      )) = 'batting-home-runs-all-game-ou' then 'player_batting_home_runs_ou'
      when lower(coalesce(
        nullif(trim(picks.metadata->>'marketTypeId'), ''),
        nullif(trim(picks.market), '')
      )) = 'batting-rbi-all-game-ou' then 'player_batting_rbi_ou'
      when lower(coalesce(
        nullif(trim(picks.metadata->>'marketTypeId'), ''),
        nullif(trim(picks.market), '')
      )) = 'batting-walks-all-game-ou' then 'player_batting_walks_ou'
      when lower(coalesce(
        nullif(trim(picks.metadata->>'marketTypeId'), ''),
        nullif(trim(picks.market), '')
      )) = 'pitching-strikeouts-all-game-ou' then 'player_pitching_strikeouts_ou'
      when lower(coalesce(
        nullif(trim(picks.metadata->>'marketTypeId'), ''),
        nullif(trim(picks.market), '')
      )) = 'pitching-innings-all-game-ou' then 'player_pitching_innings_pitched_ou'
      when lower(nullif(trim(picks.metadata->>'marketType'), '')) = 'player-prop' then
        case lower(nullif(trim(picks.metadata->>'statType'), ''))
          when 'points' then 'player_points_ou'
          when 'rebounds' then 'player_rebounds_ou'
          when 'assists' then 'player_assists_ou'
          when 'threes' then 'player_3pm_ou'
          when 'steals' then 'player_steals_ou'
          when 'blocks' then 'player_blocks_ou'
          when 'turnovers' then 'player_turnovers_ou'
          when 'points + rebounds + assists' then 'player_pra_ou'
          when 'points + rebounds' then 'player_pts_rebs_ou'
          when 'points + assists' then 'player_pts_asts_ou'
          when 'rebounds + assists' then 'player_rebs_asts_ou'
          when 'hits' then 'player_batting_hits_ou'
          when 'home runs' then 'player_batting_home_runs_ou'
          when 'rbi' then 'player_batting_rbi_ou'
          when 'walks' then 'player_batting_walks_ou'
          when 'total bases' then 'player_batting_total_bases_ou'
          when 'pitching strikeouts' then 'player_pitching_strikeouts_ou'
          when 'pitching innings pitched' then 'player_pitching_innings_pitched_ou'
          else null
        end
      when lower(nullif(trim(picks.metadata->>'marketType'), '')) = 'moneyline' then 'moneyline'
      when lower(nullif(trim(picks.metadata->>'marketType'), '')) = 'spread' then 'spread'
      when lower(nullif(trim(picks.metadata->>'marketType'), '')) = 'total' then 'game_total_ou'
      when lower(nullif(trim(picks.metadata->>'marketType'), '')) = 'team-total' then 'team_total_ou'
      else null
    end as market_type_id
  from public.picks
) as mapped
where p.id = mapped.id
  and p.market_type_id is null
  and mapped.market_type_id is not null;

create or replace function public.process_submission_atomic(
  p_submission jsonb,
  p_event jsonb,
  p_pick jsonb,
  p_idempotency_key text default null,
  p_lifecycle_event jsonb default null
) returns jsonb
language plpgsql
as $$
declare
  v_sub_row  public.submissions;
  v_pick_row public.picks;
  v_lce_row  public.pick_lifecycle;
begin
  insert into public.submissions (
    id, source, submitted_by, payload, status, received_at, created_at, updated_at
  ) values (
    (p_submission->>'id')::uuid,
    p_submission->>'source',
    p_submission->>'submitted_by',
    (p_submission->'payload')::jsonb,
    coalesce(p_submission->>'status', 'validated'),
    (p_submission->>'received_at')::timestamptz,
    coalesce((p_submission->>'created_at')::timestamptz, timezone('utc', now())),
    coalesce((p_submission->>'updated_at')::timestamptz, timezone('utc', now()))
  )
  returning * into v_sub_row;

  insert into public.submission_events (
    submission_id, event_name, payload, created_at
  ) values (
    (p_event->>'submission_id')::uuid,
    p_event->>'event_name',
    (p_event->'payload')::jsonb,
    (p_event->>'created_at')::timestamptz
  );

  insert into public.picks (
    id, submission_id, participant_id, capper_id, sport_id, market_type_id, market, selection,
    line, odds, stake_units, confidence, source,
    approval_status, promotion_status, promotion_target,
    promotion_score, promotion_reason, promotion_version,
    promotion_decided_at, promotion_decided_by,
    status, posted_at, settled_at,
    idempotency_key, metadata, created_at, updated_at
  ) values (
    (p_pick->>'id')::uuid,
    (p_pick->>'submission_id')::uuid,
    (p_pick->>'participant_id')::uuid,
    p_pick->>'capper_id',
    p_pick->>'sport_id',
    p_pick->>'market_type_id',
    p_pick->>'market',
    p_pick->>'selection',
    (p_pick->>'line')::numeric(10,2),
    (p_pick->>'odds')::integer,
    (p_pick->>'stake_units')::numeric(10,2),
    (p_pick->>'confidence')::numeric(5,2),
    p_pick->>'source',
    coalesce(p_pick->>'approval_status', 'approved'),
    coalesce(p_pick->>'promotion_status', 'not_eligible'),
    p_pick->>'promotion_target',
    (p_pick->>'promotion_score')::numeric(5,2),
    p_pick->>'promotion_reason',
    p_pick->>'promotion_version',
    (p_pick->>'promotion_decided_at')::timestamptz,
    p_pick->>'promotion_decided_by',
    coalesce(p_pick->>'status', 'validated'),
    (p_pick->>'posted_at')::timestamptz,
    (p_pick->>'settled_at')::timestamptz,
    p_idempotency_key,
    coalesce((p_pick->'metadata')::jsonb, '{}'::jsonb),
    coalesce((p_pick->>'created_at')::timestamptz, timezone('utc', now())),
    coalesce((p_pick->>'updated_at')::timestamptz, timezone('utc', now()))
  )
  on conflict (idempotency_key) where idempotency_key is not null
  do update set id = picks.id
  returning * into v_pick_row;

  if p_lifecycle_event is not null then
    insert into public.pick_lifecycle (
      pick_id, from_state, to_state, writer_role, reason, payload, created_at
    ) values (
      (p_lifecycle_event->>'pick_id')::uuid,
      p_lifecycle_event->>'from_state',
      p_lifecycle_event->>'to_state',
      p_lifecycle_event->>'writer_role',
      p_lifecycle_event->>'reason',
      coalesce((p_lifecycle_event->'payload')::jsonb, '{}'::jsonb),
      coalesce((p_lifecycle_event->>'created_at')::timestamptz, timezone('utc', now()))
    )
    returning * into v_lce_row;
  end if;

  return jsonb_build_object(
    'submission', to_jsonb(v_sub_row),
    'pick', to_jsonb(v_pick_row),
    'lifecycleEvent', case when v_lce_row.id is not null then to_jsonb(v_lce_row) else null end
  );
end;
$$;
