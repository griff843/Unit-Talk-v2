# Diff summary: UTV2-1947

| File | Change |
|---|---|
| `apps/discord-bot/src/role-guard.ts` | Fails closed for empty, malformed, duplicate, or DM role state and defines active-pick and VIP+ authorization sets. |
| `apps/discord-bot/src/commands/live.ts` | Reads posted picks only from the member-safe API route. |
| `apps/discord-bot/src/commands/today.ts` | Reads posted and settled picks only from the member-safe API route. |
| `apps/discord-bot/src/commands/heat-signal.ts` | Adds VIP+ authorization and keeps the inactive capability truthful with zero API reads. |
| `apps/discord-bot/src/commands/my-picks.ts` | Removes mutable-name identity matching and returns unavailable with zero API reads until canonical identity exists. |
| `apps/discord-bot/src/discord-bot-foundation.test.ts` | Proves member routes, persona authorization, fail-closed role state, zero-read unavailable paths, and preserved UTV2-1960 copy behavior. |

Generated lane/proof metadata records the T1 CI deferral and model-routing decision. No live Discord, Whop, Stripe, official-picks, SGO, or Black Label state changed.

## SHA Binding

Merge SHA: pending merge
PR: pending
Execution SHA: b7ad1a63fd25f3f47fd92c2db8c004f1624a97cf
