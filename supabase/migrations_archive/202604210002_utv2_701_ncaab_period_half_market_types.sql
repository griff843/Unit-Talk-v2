-- UTV2-701: Add 1H/2H period market type availability for NCAAB
-- Cross-sport (sport_id=NULL) aliases from UTV2-700 already cover the SGO keys;
-- only availability rows are needed here.

INSERT INTO public.sport_market_type_availability (sport_id, market_type_id)
VALUES
  ('NCAAB', '1h_moneyline'),
  ('NCAAB', '1h_spread'),
  ('NCAAB', '1h_total_ou'),
  ('NCAAB', '2h_moneyline'),
  ('NCAAB', '2h_spread'),
  ('NCAAB', '2h_total_ou')
ON CONFLICT (sport_id, market_type_id) DO NOTHING;
