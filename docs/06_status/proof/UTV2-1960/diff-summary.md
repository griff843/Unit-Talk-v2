# Diff summary: UTV2-1960

Execution SHA: `51bde4530b90ecfe3905132e881b6f6df06e6b97`

| File | Change |
|---|---|
| `apps/discord-bot/command-manifest.json` | Marks `/heat-signal` as not live. |
| `apps/discord-bot/src/commands/heat-signal.ts` | Uses truthful command and empty-state copy. |
| `apps/discord-bot/src/commands/help.ts` | Keeps help copy consistent with `/heat-signal`. |
| `apps/discord-bot/src/commands/trial-status.ts` | Lists only live VIP surfaces and marks future VIP+ intelligence unavailable. |
| `apps/discord-bot/src/commands/upgrade.ts` | Removes unsupported product promises from upgrade copy. |
| `apps/discord-bot/src/commands/recap.ts` | Renders missing CLV as unavailable. |
| `apps/discord-bot/src/commands/stats.ts` | Makes missing CLV visible and removes unsupported SGO-close attribution. |
| `apps/discord-bot/src/discord-bot-foundation.test.ts` | Adds focused regression and negative assertions for the adopted behavior. |

No `/live` or `/today` authorization, live Discord state, Whop/Stripe, official-picks, SGO, Black Label, API, worker, or database behavior changed.

## SHA Binding

Merge SHA: pending merge
PR: pending
