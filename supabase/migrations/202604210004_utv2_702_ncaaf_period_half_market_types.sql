-- UTV2-702: Add 1H/2H period market type availability for NCAAF
-- Cross-sport (sport_id=NULL) aliases from UTV2-700 already cover the SGO keys;
-- only availability rows are needed here.

INSERT INTO public.sport_market_type_availability (sport_id, market_type_id)
VALUES
  ('NCAAF', '1h_moneyline'),
  ('NCAAF', '1h_spread'),
  ('NCAAF', '1h_total_ou'),
  ('NCAAF', '2h_moneyline'),
  ('NCAAF', '2h_spread'),
  ('NCAAF', '2h_total_ou')
ON CONFLICT (sport_id, market_type_id) DO NOTHING;
