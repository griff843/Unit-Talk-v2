-- Down script for 202605140001_utv2_912_market_type_id_alias_backfill
--
-- Reverts:
--   Step 3: Nulls out market_type_id on market_universe rows that were backfilled
--           by this migration (rows that gained market_type_id via alias match).
--   Step 2: Removes the provider_market_aliases rows inserted by this migration.
--   Step 1: Removes the market_types rows inserted by this migration.
--
-- Note: market_universe rows backfilled by Step 3 are identified by their
-- market_type_id matching one of the alias-backed values inserted in Steps 1-2.
-- Rows that had market_type_id set by the application after this migration ran
-- may be incorrectly NULLed. Use PITR if data integrity is critical.
-- Refer to docs/05_operations/DB_ROLLBACK_RUNBOOK.md.

-- Step 3 revert: NULL out market_universe rows backfilled via the new aliases.
UPDATE market_universe mu
SET market_type_id = NULL
WHERE mu.market_type_id IN (
  '2p_moneyline', '2p_spread', '2p_total_ou',
  '3p_moneyline', '3p_spread', '3p_total_ou',
  'game_reg_moneyline', 'game_reg_spread', 'game_reg_total_ou', 'game_reg_ml3way',
  '2i_moneyline', '2i_spread', '2i_total_ou',
  '3i_moneyline', '3i_spread', '3i_total_ou',
  '4i_moneyline', '4i_spread', '4i_total_ou',
  '5i_moneyline', '5i_spread', '5i_total_ou',
  '6i_moneyline', '6i_spread', '6i_total_ou',
  '7i_moneyline', '7i_spread', '7i_total_ou',
  '8i_moneyline', '8i_spread', '8i_total_ou'
);

-- Step 2 revert: Remove provider_market_aliases added by this migration.
-- Keyed by (provider, provider_market_key) to avoid touching unrelated rows.
DELETE FROM provider_market_aliases
WHERE (provider, market_type_id) IN (
  ('sgo', '2p_moneyline'), ('sgo', '2p_spread'), ('sgo', '2p_total_ou'),
  ('sgo', '3p_moneyline'), ('sgo', '3p_spread'), ('sgo', '3p_total_ou'),
  ('sgo', 'game_reg_moneyline'), ('sgo', 'game_reg_spread'),
  ('sgo', 'game_reg_total_ou'), ('sgo', 'game_reg_ml3way'),
  ('sgo', '2i_moneyline'), ('sgo', '2i_spread'), ('sgo', '2i_total_ou'),
  ('sgo', '3i_moneyline'), ('sgo', '3i_spread'), ('sgo', '3i_total_ou'),
  ('sgo', '4i_moneyline'), ('sgo', '4i_spread'), ('sgo', '4i_total_ou'),
  ('sgo', '5i_moneyline'), ('sgo', '5i_spread'), ('sgo', '5i_total_ou'),
  ('sgo', '6i_moneyline'), ('sgo', '6i_spread'), ('sgo', '6i_total_ou'),
  ('sgo', '7i_moneyline'), ('sgo', '7i_spread'), ('sgo', '7i_total_ou'),
  ('sgo', '8i_moneyline'), ('sgo', '8i_spread'), ('sgo', '8i_total_ou')
);

-- Step 1 revert: Remove market_types added by this migration.
DELETE FROM market_types
WHERE id IN (
  '2p_moneyline', '2p_spread', '2p_total_ou',
  '3p_moneyline', '3p_spread', '3p_total_ou',
  'game_reg_moneyline', 'game_reg_spread', 'game_reg_total_ou', 'game_reg_ml3way',
  '2i_moneyline', '2i_spread', '2i_total_ou',
  '3i_moneyline', '3i_spread', '3i_total_ou',
  '4i_moneyline', '4i_spread', '4i_total_ou',
  '5i_moneyline', '5i_spread', '5i_total_ou',
  '6i_moneyline', '6i_spread', '6i_total_ou',
  '7i_moneyline', '7i_spread', '7i_total_ou',
  '8i_moneyline', '8i_spread', '8i_total_ou'
);
