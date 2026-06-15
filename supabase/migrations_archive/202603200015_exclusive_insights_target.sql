-- Migration 015: extend promotion target CHECK constraints to allow 'exclusive-insights'
-- Required before any exclusive-insights DB writes (UTV2-87)

alter table public.picks
  drop constraint if exists picks_promotion_target_check;

alter table public.picks
  add constraint picks_promotion_target_check
    check (promotion_target is null or promotion_target in ('best-bets', 'trader-insights', 'exclusive-insights'));

alter table public.pick_promotion_history
  drop constraint if exists pick_promotion_history_target_check;

alter table public.pick_promotion_history
  add constraint pick_promotion_history_target_check
    check (target in ('best-bets', 'trader-insights', 'exclusive-insights'));

