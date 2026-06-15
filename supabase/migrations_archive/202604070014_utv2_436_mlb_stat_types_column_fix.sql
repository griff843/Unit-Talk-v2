-- UTV2-436: Fix MLB stat_types column drift
--
-- Migration 202604050010 used the non-existent column `abbreviation` on
-- public.stat_types. The correct columns are `short_label`, `display_name`,
-- and `canonical_key` (all NOT NULL since migration 202604020002).
--
-- This migration correctly inserts the missing MLB stat types.
-- All statements are idempotent (WHERE NOT EXISTS / ON CONFLICT DO NOTHING).
-- Safe to apply whether or not 202604050010 partially succeeded.

INSERT INTO public.stat_types (sport_id, name, display_name, short_label, canonical_key, sort_order)
SELECT 'MLB', v.name, v.display_name, v.short_label, v.canonical_key, v.sort_order
FROM (VALUES
  ('Singles',       'Singles',       '1B', 'singles',      40),
  ('Doubles',       'Doubles',       '2B', 'doubles',      41),
  ('Triples',       'Triples',       '3B', 'triples',      42),
  ('Earned Runs',   'Earned Runs',   'ER', 'earned_runs',  50),
  ('Hits Allowed',  'Hits Allowed',  'HA', 'hits_allowed', 51),
  ('Pitcher Outs',  'Pitcher Outs',  'PO', 'pitcher_outs', 52)
) AS v(name, display_name, short_label, canonical_key, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.stat_types
  WHERE sport_id = 'MLB' AND canonical_key = v.canonical_key
);
