-- Migration: UTV2-704 — MLB 1st inning market types + SGO aliases
--
-- Problem: SGO provides 1st inning offers (1i) for MLB (254+ rows in provider_offers)
-- that are completely unaliased — invisible to the smart form market picker.
-- These are NRFI-adjacent, among the most popular MLB bet types.
--
-- Fix:
--   1. Add market_types: 1i_moneyline, 1i_spread, 1i_total_ou
--   2. Add sport_market_type_availability rows for MLB
--   3. Add provider_market_aliases mapping SGO 1i keys → canonical IDs

-- ============================================================
-- 1. New market_types
-- ============================================================

INSERT INTO public.market_types (id, market_family_id, selection_type_id, display_name, short_label, requires_line, requires_participant, active, sort_order)
VALUES
  ('1i_moneyline', 'moneyline', 'home_away',  '1st Inning Moneyline', '1I ML',    false, false, true, 93),
  ('1i_spread',    'spread',    'home_away',  '1st Inning Spread',    '1I SPR',   true,  false, true, 94),
  ('1i_total_ou',  'total',     'over_under', '1st Inning Total',     '1I TOTAL', true,  false, true, 95)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. sport_market_type_availability — MLB
-- ============================================================

INSERT INTO public.sport_market_type_availability (sport_id, market_type_id, active, sort_order)
VALUES
  ('MLB', '1i_moneyline', true, 93),
  ('MLB', '1i_spread',    true, 94),
  ('MLB', '1i_total_ou',  true, 95)
ON CONFLICT (sport_id, market_type_id) DO NOTHING;

-- ============================================================
-- 3. provider_market_aliases (SGO) — MLB only
-- SGO uses "1i" for individual inning (vs "1ix3" for first-3-innings)
-- ============================================================

INSERT INTO public.provider_market_aliases (provider, provider_market_key, market_type_id, provider_display_name, sport_id)
VALUES
  ('sgo', 'points-all-1i-ml',     '1i_moneyline', '1st Inning Moneyline',      'MLB'),
  ('sgo', 'points-all-1i-ml3way', '1i_moneyline', '1st Inning Moneyline (3W)', 'MLB'),
  ('sgo', 'points-all-1i-sp',     '1i_spread',    '1st Inning Spread',          'MLB'),
  ('sgo', 'points-all-1i-ou',     '1i_total_ou',  '1st Inning Total',           'MLB')
ON CONFLICT (provider, provider_market_key, sport_id) DO NOTHING;
