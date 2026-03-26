-- Migration 012: game_results - stores final stat values for grading.
-- One row per (event, participant, market_key, source).

create table game_results (
  id uuid default gen_random_uuid() primary key,
  event_id uuid not null references events(id),
  participant_id uuid references participants(id),
  market_key text not null,
  actual_value numeric not null,
  source text not null default 'manual',
  sourced_at timestamptz not null,
  created_at timestamptz default now() not null,

  constraint game_results_market_key_check
    check (char_length(market_key) > 0),
  constraint game_results_actual_value_finite
    check (actual_value is not null and actual_value > -9999 and actual_value < 99999),

  unique(event_id, participant_id, market_key, source)
);

create index game_results_event_participant_idx
  on game_results (event_id, participant_id, market_key);
