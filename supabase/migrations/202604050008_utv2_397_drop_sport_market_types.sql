-- UTV2-397: drop sport_market_types — superseded by sport_market_type_availability
--
-- sport_market_types stored high-level market categories (player-prop, moneyline, spread,
-- total, team-total). sport_market_type_availability stores canonical market_type_id values
-- (player_points_ou, moneyline, spread, etc.) with active flag, sort_order, and metadata.
--
-- All consumers have been migrated to sport_market_type_availability.
--
-- Rollback: restore from 202603200008_reference_data_foundation.sql CREATE TABLE block.

drop table if exists public.sport_market_types cascade;
