# WORK-2026092814 Diff Summary

Issue: WORK-2026092814
Tier: T2
Lane type: delivery-ui
Branch: claude/work-2026092814-bot-truthful-copy
PR URL: https://github.com/griff843/Unit-Talk-v2/pull/1688
Diff base: cc9e5a1826453c779c6593b3f2f2961b6f9d886f
Diff target: dd7994f2aea4b51b53027b2a035f0f66b097561a

| File | Change |
|---|---|
| `apps/discord-bot/src/commands/trial-status.ts` | VIP and VIP+ descriptions name only what is live |
| `apps/discord-bot/src/commands/upgrade.ts` | Same, for the upgrade path from free, trial and vip |
| `apps/discord-bot/src/commands/heat-signal.ts` | Description and empty state: line-movement alerts are not live yet |
| `apps/discord-bot/src/commands/help.ts` | `/heat-signal` help line matches |
| `apps/discord-bot/src/commands/recap.ts` | A missing CLV renders `unavailable` |
| `apps/discord-bot/src/commands/stats.ts` | A `CLV: unavailable` field when no pick has closing-line data |
| `apps/discord-bot/src/discord-bot-foundation.test.ts` | 4 new cases; the heat-signal empty-state assertion is updated |
| `apps/discord-bot/command-manifest.json` | Regenerated: the `/heat-signal` description |
| `.ops/work/WORK-2026092814.md` | Acceptance criteria for recap and stats state the implemented behaviour |

## SHA Binding

Merge SHA: pending merge
PR: https://github.com/griff843/Unit-Talk-v2/pull/1688
