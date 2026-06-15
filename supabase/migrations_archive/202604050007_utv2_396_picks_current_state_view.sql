-- UTV2-396: canonical current-state read surface for operator consumers

create or replace view public.picks_current_state as
select
  p.*,
  c.display_name as capper_display_name,
  s.display_name as sport_display_name,
  mt.display_name as market_type_display_name,
  ph.status as promotion_status_current,
  ph.target as promotion_target_current,
  ph.score as promotion_score_current,
  ph.decided_at as promotion_decided_at_current,
  sr.result as settlement_result,
  sr.status as settlement_status,
  sr.source as settlement_source,
  sr.created_at as settlement_recorded_at,
  pr.decision as review_decision,
  pr.decided_by as review_decided_by,
  pr.decided_at as review_decided_at
from public.picks as p
left join public.cappers as c on c.id = p.capper_id
left join public.sports as s on s.id = p.sport_id
left join public.market_types as mt on mt.id = p.market_type_id
left join lateral (
  select
    h.status,
    h.target,
    h.score,
    h.decided_at
  from public.pick_promotion_history as h
  where h.pick_id = p.id
  order by h.decided_at desc, h.created_at desc, h.id desc
  limit 1
) as ph on true
left join lateral (
  select
    sr_inner.result,
    sr_inner.status,
    sr_inner.source,
    sr_inner.created_at
  from public.settlement_records as sr_inner
  where sr_inner.pick_id = p.id
  order by sr_inner.created_at desc, sr_inner.id desc
  limit 1
) as sr on true
left join lateral (
  select
    pr_inner.decision,
    pr_inner.decided_by,
    pr_inner.decided_at
  from public.pick_reviews as pr_inner
  where pr_inner.pick_id = p.id
  order by pr_inner.decided_at desc, pr_inner.created_at desc, pr_inner.id desc
  limit 1
) as pr on true;
