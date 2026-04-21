-- UTV2-703: Add 1H/2H/quarter period market type availability for WNBA
-- Cross-sport (sport_id=NULL) aliases from UTV2-700 already cover the SGO keys;
-- only availability rows are needed here.

INSERT INTO public.sport_market_type_availability (sport_id, market_type_id)
VALUES
  ('WNBA', '1h_moneyline'),
  ('WNBA', '1h_spread'),
  ('WNBA', '1h_total_ou'),
  ('WNBA', '2h_moneyline'),
  ('WNBA', '2h_spread'),
  ('WNBA', '2h_total_ou'),
  ('WNBA', '1q_moneyline'),
  ('WNBA', '1q_spread'),
  ('WNBA', '1q_total_ou'),
  ('WNBA', '2q_moneyline'),
  ('WNBA', '2q_spread'),
  ('WNBA', '2q_total_ou'),
  ('WNBA', '3q_moneyline'),
  ('WNBA', '3q_spread'),
  ('WNBA', '3q_total_ou'),
  ('WNBA', '4q_moneyline'),
  ('WNBA', '4q_spread'),
  ('WNBA', '4q_total_ou')
ON CONFLICT (sport_id, market_type_id) DO NOTHING;
