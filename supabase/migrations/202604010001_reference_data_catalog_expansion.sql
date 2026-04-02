-- UTV2 Smart Form runtime proof follow-up:
-- add the missing sportsbook and NBA combo stat type that blocked live Griff843 submissions.

UPDATE public.sportsbooks
SET sort_order = CASE id
  WHEN 'pinnacle' THEN 1
  WHEN 'circa' THEN 2
  WHEN 'draftkings' THEN 3
  WHEN 'fanduel' THEN 4
  WHEN 'betmgm' THEN 5
  WHEN 'caesars' THEN 6
  WHEN 'pointsbet' THEN 7
  WHEN 'bovada' THEN 8
  WHEN 'bet365' THEN 9
  WHEN 'williamhill' THEN 10
  WHEN 'fanatics' THEN 11
  WHEN 'sgo' THEN 12
  ELSE sort_order
END
WHERE id IN (
  'pinnacle',
  'circa',
  'draftkings',
  'fanduel',
  'betmgm',
  'caesars',
  'pointsbet',
  'bovada',
  'bet365',
  'williamhill',
  'fanatics',
  'sgo'
);

INSERT INTO public.sportsbooks (id, display_name, sort_order, active)
VALUES ('fanatics', 'Fanatics', 11, true)
ON CONFLICT (id) DO UPDATE
SET display_name = EXCLUDED.display_name,
    sort_order = EXCLUDED.sort_order,
    active = EXCLUDED.active;

UPDATE public.stat_types
SET sort_order = CASE name
  WHEN 'Points' THEN 1
  WHEN 'Rebounds' THEN 2
  WHEN 'Assists' THEN 3
  WHEN 'Points + Assists' THEN 4
  WHEN 'Threes' THEN 5
  WHEN 'Steals' THEN 6
  WHEN 'Blocks' THEN 7
  ELSE sort_order
END
WHERE sport_id = 'NBA'
  AND name IN ('Points', 'Rebounds', 'Assists', 'Points + Assists', 'Threes', 'Steals', 'Blocks');

INSERT INTO public.stat_types (sport_id, name, sort_order, active)
VALUES ('NBA', 'Points + Assists', 4, true)
ON CONFLICT (sport_id, name) DO UPDATE
SET sort_order = EXCLUDED.sort_order,
    active = EXCLUDED.active;
