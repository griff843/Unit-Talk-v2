# WORK-2026101501 diff summary

MERGE_SHA: e22d68f9c8153afbabf4d88ad0ca102660cba26f

Scope is limited to the two approved implementation files:

- `apps/discord-bot/src/router.ts`
- `apps/discord-bot/src/discord-bot-foundation.test.ts`

The router handles only the three exact retired button IDs, requires non-empty string identity equality between the message author and current bot, replies once with the exact private copy, and logs acknowledgement failure without retrying or exposing reply content. Unknown components and the existing slash-command path are unchanged.

Focused tests cover all retired IDs in guild and DM contexts, malformed/foreign identities, already acknowledged interactions, failure logging, and bypass of registry/member/defer paths.
