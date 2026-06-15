-- Migration 007: extend promotion target CHECK constraints to allow 'trader-insights'
-- Required before any trader-insights DB writes (Week 11A, blocker A9)

alter table public.picks
  drop constraint if exists picks_promotion_target_check;

alter table public.picks
  add constraint picks_promotion_target_check
    check (promotion_target is null or promotion_target in ('best-bets', 'trader-insights'));

alter table public.pick_promotion_history
  drop constraint if exists pick_promotion_history_target_check;

alter table public.pick_promotion_history
  add constraint pick_promotion_history_target_check
    check (target in ('best-bets', 'trader-insights'));

-- Also extend override_action to allow trader-insights suppress action
alter table public.pick_promotion_history
  drop constraint if exists pick_promotion_history_override_action_check;

alter table public.pick_promotion_history
  add constraint pick_promotion_history_override_action_check
    check (override_action is null or override_action in ('force_promote', 'suppress_from_best_bets', 'suppress_from_trader_insights'));
