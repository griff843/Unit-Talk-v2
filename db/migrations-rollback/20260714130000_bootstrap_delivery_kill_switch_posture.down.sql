-- Down script for 20260714130000_bootstrap_delivery_kill_switch_posture
-- Reverts: deletes exactly the three rows this migration seeded, matched
-- on both target AND actor='system-bootstrap' — if an operator has since
-- toggled one of these targets (actor changes on every setKilled call),
-- this down script correctly leaves that operator-set row alone rather
-- than reverting live operational state.

DELETE FROM public.delivery_kill_switch
WHERE target IN ('best-bets', 'trader-insights', 'exclusive-insights')
  AND actor = 'system-bootstrap';
