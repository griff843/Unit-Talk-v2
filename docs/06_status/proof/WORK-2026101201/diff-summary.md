# Diff summary: WORK-2026101201

This repair keeps the Discord bot's existing five-role mapping and corrects the API boundary that
persists bot-synchronized member tiers.

| File | Change |
|---|---|
| `apps/api/src/routes/member-tiers.ts` | Accepts all configured bot-mapped tiers and supplies `computeTrialEffectiveUntil()` only when activating Trial. |
| `apps/api/src/member-picks.test.ts` | Covers default/configured Trial expiry, expiry-free VIP/VIP+, all mapped tiers, `free` rejection, and the absence of caller authorization elevation for Capper/Operator state. |
| `apps/discord-bot/src/discord-bot-foundation.test.ts` | Proves each of the five configured Discord roles is activated through the sync handler. |

No production Discord bot implementation changed: its API client and handler already forward the
configured mapping correctly. No auth implementation, repository interface, migration, environment,
secret, deployment, or production state changed.

## SHA Binding

Verified source SHA: `4e7c4a14445e9e1ff5d5a6f14de91845623e340a`
Merge SHA: pending merge
PR: pending
