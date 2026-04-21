-- Migration: UTV2-700 — Period / Half / Quarter / Inning market types + SGO aliases
--
-- Problem: SGO provides 6,500+ period-market offers (1H, 2H, 1Q-4Q for NBA;
-- 1H, F3/F5/F7 for MLB) that are not aliased to any canonical market_type_id.
-- These offers are invisible in the smart-form market-family picker because
-- sport_market_type_availability has no matching rows.
--
-- Fix:
--   1. Add canonical market_types for each period variant (half, quarter, inning)
--   2. Add sport_market_type_availability rows for NBA / MLB
--   3. Add provider_market_aliases mapping SGO keys → canonical IDs

-- ============================================================
-- 1. New market_types
-- ============================================================

-- Half markets (shared: NBA 1H/2H, MLB 1H)
INSERT INTO public.market_types (id, market_family_id, selection_type_id, display_name, short_label, requires_line, requires_participant, active, sort_order)
VALUES
  ('1h_moneyline', 'moneyline', 'home_away',  '1st Half Moneyline', '1H ML',    false, false, true, 50),
  ('1h_spread',    'spread',    'home_away',  '1st Half Spread',    '1H SPR',   true,  false, true, 51),
  ('1h_total_ou',  'total',     'over_under', '1st Half Total',     '1H TOTAL', true,  false, true, 52),
  ('2h_moneyline', 'moneyline', 'home_away',  '2nd Half Moneyline', '2H ML',    false, false, true, 53),
  ('2h_spread',    'spread',    'home_away',  '2nd Half Spread',    '2H SPR',   true,  false, true, 54),
  ('2h_total_ou',  'total',     'over_under', '2nd Half Total',     '2H TOTAL', true,  false, true, 55)
ON CONFLICT (id) DO NOTHING;

-- Quarter markets (NBA)
INSERT INTO public.market_types (id, market_family_id, selection_type_id, display_name, short_label, requires_line, requires_participant, active, sort_order)
VALUES
  ('1q_moneyline', 'moneyline', 'home_away',  '1st Quarter Moneyline', '1Q ML',    false, false, true, 60),
  ('1q_spread',    'spread',    'home_away',  '1st Quarter Spread',    '1Q SPR',   true,  false, true, 61),
  ('1q_total_ou',  'total',     'over_under', '1st Quarter Total',     '1Q TOTAL', true,  false, true, 62),
  ('2q_moneyline', 'moneyline', 'home_away',  '2nd Quarter Moneyline', '2Q ML',    false, false, true, 63),
  ('2q_spread',    'spread',    'home_away',  '2nd Quarter Spread',    '2Q SPR',   true,  false, true, 64),
  ('2q_total_ou',  'total',     'over_under', '2nd Quarter Total',     '2Q TOTAL', true,  false, true, 65),
  ('3q_moneyline', 'moneyline', 'home_away',  '3rd Quarter Moneyline', '3Q ML',    false, false, true, 66),
  ('3q_spread',    'spread',    'home_away',  '3rd Quarter Spread',    '3Q SPR',   true,  false, true, 67),
  ('3q_total_ou',  'total',     'over_under', '3rd Quarter Total',     '3Q TOTAL', true,  false, true, 68),
  ('4q_moneyline', 'moneyline', 'home_away',  '4th Quarter Moneyline', '4Q ML',    false, false, true, 69),
  ('4q_spread',    'spread',    'home_away',  '4th Quarter Spread',    '4Q SPR',   true,  false, true, 70),
  ('4q_total_ou',  'total',     'over_under', '4th Quarter Total',     '4Q TOTAL', true,  false, true, 71)
ON CONFLICT (id) DO NOTHING;

-- First-N-innings markets (MLB)
INSERT INTO public.market_types (id, market_family_id, selection_type_id, display_name, short_label, requires_line, requires_participant, active, sort_order)
VALUES
  ('f3_moneyline', 'moneyline', 'home_away',  'First 3 Innings Moneyline', 'F3 ML',    false, false, true, 80),
  ('f3_spread',    'spread',    'home_away',  'First 3 Innings Spread',    'F3 SPR',   true,  false, true, 81),
  ('f3_total_ou',  'total',     'over_under', 'First 3 Innings Total',     'F3 TOTAL', true,  false, true, 82),
  ('f5_moneyline', 'moneyline', 'home_away',  'First 5 Innings Moneyline', 'F5 ML',    false, false, true, 83),
  ('f5_spread',    'spread',    'home_away',  'First 5 Innings Spread',    'F5 SPR',   true,  false, true, 84),
  ('f5_total_ou',  'total',     'over_under', 'First 5 Innings Total',     'F5 TOTAL', true,  false, true, 85),
  ('f7_moneyline', 'moneyline', 'home_away',  'First 7 Innings Moneyline', 'F7 ML',    false, false, true, 86),
  ('f7_spread',    'spread',    'home_away',  'First 7 Innings Spread',    'F7 SPR',   true,  false, true, 87),
  ('f7_total_ou',  'total',     'over_under', 'First 7 Innings Total',     'F7 TOTAL', true,  false, true, 88)
ON CONFLICT (id) DO NOTHING;

-- Period markets (NHL — 1st period; keyed for future data)
INSERT INTO public.market_types (id, market_family_id, selection_type_id, display_name, short_label, requires_line, requires_participant, active, sort_order)
VALUES
  ('1p_moneyline', 'moneyline', 'home_away',  '1st Period Moneyline', '1P ML',    false, false, true, 90),
  ('1p_spread',    'spread',    'home_away',  '1st Period Spread',    '1P SPR',   true,  false, true, 91),
  ('1p_total_ou',  'total',     'over_under', '1st Period Total',     '1P TOTAL', true,  false, true, 92)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. sport_market_type_availability
-- ============================================================

-- NBA: halves + all 4 quarters
INSERT INTO public.sport_market_type_availability (sport_id, market_type_id, active, sort_order)
VALUES
  ('NBA', '1h_moneyline', true, 50),
  ('NBA', '1h_spread',    true, 51),
  ('NBA', '1h_total_ou',  true, 52),
  ('NBA', '2h_moneyline', true, 53),
  ('NBA', '2h_spread',    true, 54),
  ('NBA', '2h_total_ou',  true, 55),
  ('NBA', '1q_moneyline', true, 60),
  ('NBA', '1q_spread',    true, 61),
  ('NBA', '1q_total_ou',  true, 62),
  ('NBA', '2q_moneyline', true, 63),
  ('NBA', '2q_spread',    true, 64),
  ('NBA', '2q_total_ou',  true, 65),
  ('NBA', '3q_moneyline', true, 66),
  ('NBA', '3q_spread',    true, 67),
  ('NBA', '3q_total_ou',  true, 68),
  ('NBA', '4q_moneyline', true, 69),
  ('NBA', '4q_spread',    true, 70),
  ('NBA', '4q_total_ou',  true, 71)
ON CONFLICT (sport_id, market_type_id) DO NOTHING;

-- MLB: 1st half + F3/F5/F7
INSERT INTO public.sport_market_type_availability (sport_id, market_type_id, active, sort_order)
VALUES
  ('MLB', '1h_moneyline', true, 50),
  ('MLB', '1h_spread',    true, 51),
  ('MLB', '1h_total_ou',  true, 52),
  ('MLB', 'f3_moneyline', true, 80),
  ('MLB', 'f3_spread',    true, 81),
  ('MLB', 'f3_total_ou',  true, 82),
  ('MLB', 'f5_moneyline', true, 83),
  ('MLB', 'f5_spread',    true, 84),
  ('MLB', 'f5_total_ou',  true, 85),
  ('MLB', 'f7_moneyline', true, 86),
  ('MLB', 'f7_spread',    true, 87),
  ('MLB', 'f7_total_ou',  true, 88)
ON CONFLICT (sport_id, market_type_id) DO NOTHING;

-- NHL: 1st period
INSERT INTO public.sport_market_type_availability (sport_id, market_type_id, active, sort_order)
VALUES
  ('NHL', '1p_moneyline', true, 90),
  ('NHL', '1p_spread',    true, 91),
  ('NHL', '1p_total_ou',  true, 92)
ON CONFLICT (sport_id, market_type_id) DO NOTHING;

-- ============================================================
-- 3. provider_market_aliases (SGO)
-- Unique constraint: (provider, provider_market_key, sport_id)
-- sport_id = NULL for keys that appear cross-sport with the same mapping
-- sport_id = 'NBA'/'MLB' for keys that only appear in one sport
-- ============================================================

-- Half markets — same key appears in both NBA and MLB → sport_id NULL
INSERT INTO public.provider_market_aliases (provider, provider_market_key, market_type_id, provider_display_name, sport_id)
VALUES
  ('sgo', 'points-all-1h-ml',     '1h_moneyline', '1st Half Moneyline',     NULL),
  ('sgo', 'points-all-1h-sp',     '1h_spread',    '1st Half Spread',        NULL),
  ('sgo', 'points-all-1h-ou',     '1h_total_ou',  '1st Half Total',         NULL),
  ('sgo', 'points-all-1h-ml3way', '1h_moneyline', '1st Half Moneyline (3W)', NULL),
  ('sgo', 'points-all-2h-ml',     '2h_moneyline', '2nd Half Moneyline',     NULL),
  ('sgo', 'points-all-2h-sp',     '2h_spread',    '2nd Half Spread',        NULL),
  ('sgo', 'points-all-2h-ou',     '2h_total_ou',  '2nd Half Total',         NULL)
ON CONFLICT (provider, provider_market_key, sport_id) DO NOTHING;

-- Quarter markets — NBA only
INSERT INTO public.provider_market_aliases (provider, provider_market_key, market_type_id, provider_display_name, sport_id)
VALUES
  ('sgo', 'points-all-1q-ml',     '1q_moneyline', '1Q Moneyline',     'NBA'),
  ('sgo', 'points-all-1q-sp',     '1q_spread',    '1Q Spread',        'NBA'),
  ('sgo', 'points-all-1q-ou',     '1q_total_ou',  '1Q Total',         'NBA'),
  ('sgo', 'points-all-1q-ml3way', '1q_moneyline', '1Q Moneyline (3W)', 'NBA'),
  ('sgo', 'points-all-2q-ml',     '2q_moneyline', '2Q Moneyline',     'NBA'),
  ('sgo', 'points-all-2q-sp',     '2q_spread',    '2Q Spread',        'NBA'),
  ('sgo', 'points-all-2q-ou',     '2q_total_ou',  '2Q Total',         'NBA'),
  ('sgo', 'points-all-2q-ml3way', '2q_moneyline', '2Q Moneyline (3W)', 'NBA'),
  ('sgo', 'points-all-3q-ml',     '3q_moneyline', '3Q Moneyline',     'NBA'),
  ('sgo', 'points-all-3q-sp',     '3q_spread',    '3Q Spread',        'NBA'),
  ('sgo', 'points-all-3q-ou',     '3q_total_ou',  '3Q Total',         'NBA'),
  ('sgo', 'points-all-3q-ml3way', '3q_moneyline', '3Q Moneyline (3W)', 'NBA'),
  ('sgo', 'points-all-4q-ml',     '4q_moneyline', '4Q Moneyline',     'NBA'),
  ('sgo', 'points-all-4q-sp',     '4q_spread',    '4Q Spread',        'NBA'),
  ('sgo', 'points-all-4q-ou',     '4q_total_ou',  '4Q Total',         'NBA'),
  ('sgo', 'points-all-4q-ml3way', '4q_moneyline', '4Q Moneyline (3W)', 'NBA')
ON CONFLICT (provider, provider_market_key, sport_id) DO NOTHING;

-- First-N-innings markets — MLB only
INSERT INTO public.provider_market_aliases (provider, provider_market_key, market_type_id, provider_display_name, sport_id)
VALUES
  ('sgo', 'points-all-1ix3-ml',     'f3_moneyline', 'F3 Moneyline',     'MLB'),
  ('sgo', 'points-all-1ix3-sp',     'f3_spread',    'F3 Spread',        'MLB'),
  ('sgo', 'points-all-1ix3-ou',     'f3_total_ou',  'F3 Total',         'MLB'),
  ('sgo', 'points-all-1ix3-ml3way', 'f3_moneyline', 'F3 Moneyline (3W)', 'MLB'),
  ('sgo', 'points-all-1ix5-ml',     'f5_moneyline', 'F5 Moneyline',     'MLB'),
  ('sgo', 'points-all-1ix5-sp',     'f5_spread',    'F5 Spread',        'MLB'),
  ('sgo', 'points-all-1ix5-ou',     'f5_total_ou',  'F5 Total',         'MLB'),
  ('sgo', 'points-all-1ix5-ml3way', 'f5_moneyline', 'F5 Moneyline (3W)', 'MLB'),
  ('sgo', 'points-all-1ix7-ml',     'f7_moneyline', 'F7 Moneyline',     'MLB'),
  ('sgo', 'points-all-1ix7-sp',     'f7_spread',    'F7 Spread',        'MLB'),
  ('sgo', 'points-all-1ix7-ou',     'f7_total_ou',  'F7 Total',         'MLB'),
  ('sgo', 'points-all-1ix7-ml3way', 'f7_moneyline', 'F7 Moneyline (3W)', 'MLB')
ON CONFLICT (provider, provider_market_key, sport_id) DO NOTHING;
