-- UTV2-1085 rollback: drop odds_snapshots and odds_snapshot_corrections
-- Removes immutability triggers, indexes, RLS policies, and both tables.

DROP TABLE IF EXISTS odds_snapshot_corrections CASCADE;
DROP TABLE IF EXISTS odds_snapshots CASCADE;
DROP FUNCTION IF EXISTS odds_snapshots_immutable();
