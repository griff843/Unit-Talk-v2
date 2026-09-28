# WORK-2026092810 Diff Summary

Issue: WORK-2026092810
Tier: T2
Lane type: delivery-ui
Branch: claude/work-2026092810-member-tier-gate
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1683
Diff base: d6ece6b4532c01bcff00b05c4804e93300025c5a
Diff target: 1c9b256546ae9b2804360eda13a492ed4d9eb7cb

| File | Change |
|---|---|
| `apps/discord-bot/src/role-guard.ts` | Adds `requireActivePickRoles(config)` |
| `apps/discord-bot/src/commands/live.ts` | Takes `requiredRoles`; the default factory supplies the active-pick roles |
| `apps/discord-bot/src/commands/today.ts` | Same as `live.ts` |
| `apps/discord-bot/src/discord-bot-foundation.test.ts` | 8 new cases; the existing `/live` render test passes a role list |

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1683
