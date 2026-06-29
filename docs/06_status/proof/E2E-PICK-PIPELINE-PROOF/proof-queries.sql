-- E2E Pick Pipeline Proof Queries
-- Date: 2026-06-29
-- Issue: UTV2-1359
-- Run against: Supabase project zfzdnfwdarxucxtaojxm

-- 1. System state: pick counts by lifecycle state
SELECT status, COUNT(*) as count
FROM picks
GROUP BY status ORDER BY count DESC;

-- 2. Data ingestion: events and game_results
SELECT COUNT(*) as event_count, MAX(created_at) as latest_event FROM events;
SELECT COUNT(*) as game_result_count, MAX(created_at) as latest_result FROM game_results;

-- 3. Evidence plane pick: full record
SELECT p.id, p.status, p.source, p.market, p.selection, p.odds,
       p.approval_status, p.promotion_status, p.created_at
FROM picks p
WHERE p.id = 'a122bcca-602a-4e2f-8b0e-1853278e9043';

-- 4. Lifecycle events for evidence plane pick
SELECT from_state, to_state, writer_role, reason, created_at
FROM pick_lifecycle
WHERE pick_id = 'a122bcca-602a-4e2f-8b0e-1853278e9043'
ORDER BY created_at;

-- 5. Promotion history for evidence plane pick
SELECT target, status, score, reason, version, decided_at
FROM pick_promotion_history
WHERE pick_id = 'a122bcca-602a-4e2f-8b0e-1853278e9043';

-- 6. Audit trail for evidence plane pick
SELECT entity_type, action, actor, payload, created_at
FROM audit_log
WHERE entity_ref = 'a122bcca-602a-4e2f-8b0e-1853278e9043'
ORDER BY created_at;

-- 7. Settlement record with CLV and ROI
SELECT id, result, status, evidence_ref, payload, settled_at, stake_units
FROM settlement_records
WHERE pick_id = 'a122bcca-602a-4e2f-8b0e-1853278e9043';

-- 8. Governance approval pick: proves awaiting_approval → qualified → settled path
SELECT p.id, p.source, p.status, p.promotion_status, p.approval_status,
       p.market, p.selection, p.odds, p.created_at
FROM picks p
WHERE p.id = '26e4adb9-a059-45db-8a32-ab96cda71ed8';

-- 9. Lifecycle events for governance approval pick
SELECT from_state, to_state, writer_role, reason, created_at
FROM pick_lifecycle
WHERE pick_id = '26e4adb9-a059-45db-8a32-ab96cda71ed8'
ORDER BY created_at;

-- 10. ROI coverage across evidence-graded settlements
SELECT
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE payload->>'profitLossUnits' IS NOT NULL) as with_profit_loss_units,
  COUNT(*) FILTER (WHERE stake_units IS NOT NULL) as with_stake_units,
  COUNT(*) FILTER (WHERE result = 'win') as wins,
  COUNT(*) FILTER (WHERE result = 'loss') as losses,
  AVG((payload->>'profitLossUnits')::numeric)
    FILTER (WHERE payload->>'profitLossUnits' IS NOT NULL) as avg_pl
FROM settlement_records
WHERE corrects_id IS NULL
  AND evidence_ref LIKE 'game-result:%';

-- 11. CLV coverage across all settlements
SELECT
  COUNT(*) as total_settled,
  COUNT(*) FILTER (WHERE payload->>'clvRaw' IS NOT NULL) as with_clv_raw,
  COUNT(*) FILTER (WHERE payload->>'beatsClosingLine' IS NOT NULL) as with_beats_clv
FROM settlement_records
WHERE corrects_id IS NULL;

-- 12. pick_offer_snapshots constraint failure count
SELECT COUNT(*) as constraint_failures
FROM audit_log
WHERE action = 'closing_for_clv_snapshot_write_failed';

-- 13. Evidence plane picks graded today with CLV
SELECT
  p.id, p.source, p.market, p.selection, p.status,
  sr.result,
  sr.payload->>'clvRaw' as clv_raw,
  sr.payload->>'beatsClosingLine' as beats_closing_line,
  sr.settled_at
FROM picks p
JOIN settlement_records sr ON sr.pick_id = p.id AND sr.corrects_id IS NULL
WHERE p.status = 'awaiting_approval'
  AND sr.payload->>'clvRaw' IS NOT NULL
  AND DATE(sr.settled_at) = '2026-06-29'
ORDER BY sr.settled_at DESC
LIMIT 10;
