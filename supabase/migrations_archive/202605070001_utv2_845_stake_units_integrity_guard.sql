-- UTV2-845
-- Enforce canonical stake_units on future pick writes without rewriting
-- historical rows that legitimately lack explicit stake evidence.

alter table public.picks
  drop constraint if exists picks_stake_units_canonical_check;

alter table public.picks
  add constraint picks_stake_units_canonical_check
  check (stake_units is not null and stake_units > 0)
  not valid;
