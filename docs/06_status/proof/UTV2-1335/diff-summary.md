# Diff Summary: UTV2-1335 — Alert Configuration Enforcement

## Summary

- Alert notifications fail closed on missing `DISCORD_BOT_TOKEN`: the delivery loop increments
  `result.failed` and continues rather than silently skipping, ensuring missing credentials
  are observable as failures (`packages/alert-runtime/src/alert-notification-service.ts` line 266).

- Missing or unresolvable `UNIT_TALK_DISCORD_TARGET_MAP` entries cause `resolveDiscordChannelId`
  to return `null`; if all channels resolve to null, `successChannels.length === 0` triggers
  `result.failed++` — no silent delivery (line 293).

- Dry-run mode is the safe default (`ALERT_DRY_RUN !== 'false'`): live Discord posting requires
  explicit opt-out, preventing accidental production alerts from misconfigured environments.

- Invalid numeric threshold env variables (e.g. `ALERT_THRESHOLD_SPREAD_WATCH`) cause
  `normalizePositiveNumber` to throw at startup, making bad config a hard failure rather than
  a silent fallback.

- All 45 alert-specific unit tests pass (detection + notification + channel resolution);
  static suite is green (700+ unit tests, # fail 0); R-level check PASS with no artifacts required.
