--
-- UTV2-1427: bootstrap delivery_kill_switch to preserve the pre-existing
-- production delivery posture.
--
-- delivery_kill_switch starts empty on creation, and the application's
-- fail-closed default (missing row => killed=true) means every governed
-- target would be silently disabled the moment the worker's kill-switch
-- check deploys, unless seeded. This migration seeds one row per governed
-- target, derived from packages/contracts/src/promotion.ts's
-- defaultTargetRegistry (the canonical source of truth for current
-- delivery posture) — not from assumption:
--
--   best-bets:          defaultTargetRegistry.enabled=true  -> killed=false
--                        (currently delivering; posture preserved)
--   trader-insights:    defaultTargetRegistry.enabled=true  -> killed=false
--                        (currently delivering; posture preserved)
--   exclusive-insights: defaultTargetRegistry.enabled=false
--                        (disabledReason: "Activation contract required
--                        before live delivery"; also listed in
--                        blockedDiscordTargets) -> killed=true
--                        (not currently approved for delivery; posture
--                        preserved)
--
-- actor='system-bootstrap' and reason document this as bootstrap
-- provenance so it is distinguishable from a later operator toggle.
-- ON CONFLICT DO NOTHING makes this idempotent and never clobbers a row
-- an operator may have already touched.
--
-- This migration changes nothing about what is approved for delivery —
-- it only makes the kill switch's starting state match what is already
-- live. Read errors and targets with no row remain fail-closed
-- (killed=true) exactly as before; this migration does not touch that
-- application-layer behavior.
--

INSERT INTO public.delivery_kill_switch (target, killed, actor, reason)
VALUES
  (
    'best-bets',
    false,
    'system-bootstrap',
    'UTV2-1427 bootstrap: preserve pre-existing production delivery posture (defaultTargetRegistry: enabled=true)'
  ),
  (
    'trader-insights',
    false,
    'system-bootstrap',
    'UTV2-1427 bootstrap: preserve pre-existing production delivery posture (defaultTargetRegistry: enabled=true)'
  ),
  (
    'exclusive-insights',
    true,
    'system-bootstrap',
    'UTV2-1427 bootstrap: preserve pre-existing production delivery posture (defaultTargetRegistry: enabled=false, disabledReason="Activation contract required before live delivery"; also in blockedDiscordTargets)'
  )
ON CONFLICT (target) DO NOTHING;
