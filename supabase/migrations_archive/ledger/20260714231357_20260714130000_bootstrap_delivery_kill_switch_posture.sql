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
ON CONFLICT (target) DO NOTHING;;
