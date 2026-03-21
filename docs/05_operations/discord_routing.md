# Discord Routing - V2 Canonical Target Taxonomy

## Guild

| Field | Value |
|---|---|
| Guild ID | `1284478946171293736` |
| Client ID | see `DISCORD_CLIENT_ID` in `local.env` |

## Approved V2 Targets

These are the canonical `discord:{name}` target strings used in the V2 outbox (`distribution_outbox.target`).
The worker resolves each string to a Discord channel ID via `UNIT_TALK_DISCORD_TARGET_MAP`.

| Target | Channel ID | Delivery Mode | Purpose |
|---|---|---|---|
| `discord:canary` | `1296531122234327100` | plain channel post | Integration canary. Always the first live target. Not a VIP+ channel. |
| `discord:best-bets` | `1288613037539852329` | plain channel post | Premium high-signal execution board for the top actionable plays. First non-canary lane, but defined by product identity before rollout role. |
| `discord:exclusive-insights` | `1288613114815840466` | plain channel post | S/A-tier pick analysis only (VIP+). |
| `discord:trader-insights` | `1356613995175481405` | plain channel post | Market movement, steam, sharp money alerts (VIP+). |
| `discord:game-threads` | `1291234713213734912` | thread post, not plain channel | Live game discussion. See architectural gap below. |
| `discord:strategy-room` | `1356624758485287105` | DM plus public acknowledgment | Personal AI coaching. See architectural gap below. |

## Approved Target Map

Canonical value for `UNIT_TALK_DISCORD_TARGET_MAP`:

```json
{
  "discord:canary": "1296531122234327100",
  "discord:best-bets": "1288613037539852329",
  "discord:exclusive-insights": "1288613114815840466",
  "discord:game-threads": "1291234713213734912",
  "discord:trader-insights": "1356613995175481405",
  "discord:strategy-room": "1356624758485287105"
}
```

## Targets Dropped From V2

These channels exist in the legacy `VIPPlusChannelService` but are not carried into V2:

| Legacy field | Channel ID | Reason dropped |
|---|---|---|
| `liveUpdates` | `1356624758485287106` | Thread-based live updates. V2 does not yet support thread routing. Re-add only through an ADR. |
| `coaching` | `1356624758485287107` | Redundant with `strategy-room`. Same DM-based coaching flow. Drop until a distinct coaching purpose is ratified. |

`discord:free-picks` appears in `.env.example` as a default distribution target but is not in the approved V2 target map. It must be explicitly ratified before being added to the map.

## Canary-First Posting Order

The safe progression for live posting is:

1. `discord:canary` - always first
2. `discord:best-bets` - first possible non-canary target
3. `discord:trader-insights`
4. `discord:exclusive-insights`
5. `discord:game-threads` - blocked until thread routing is implemented
6. `discord:strategy-room` - blocked until DM routing is implemented

Promotion from `discord:canary` to `discord:best-bets` is governed by:

- `docs/05_operations/canary_graduation_criteria.md`
- `docs/03_product/best_bets_channel_contract.md`

## Architectural Gaps

### `discord:game-threads` - thread routing not implemented

Legacy behavior used a game-specific thread ID and posted inside the thread. V2 currently posts to a resolved channel ID only. Posting directly to the parent game-threads channel would create top-level posts, not thread posts.

Required before enabling this target:
- define how `threadId` is resolved
- extend the delivery adapter or add a thread-routing adapter
- do not add this target to `UNIT_TALK_DISTRIBUTION_TARGETS` for live runs until resolved

### `discord:strategy-room` - DM routing not implemented

Legacy behavior sent a personal DM to the requesting user and then posted a public acknowledgment. V2 currently assumes one target equals one channel post.

Required before enabling this target:
- decide whether V2 will support public announcements, DM coaching, or both
- if DM coaching is in scope, add a DM-capable adapter and `userId` resolution
- do not add this target to `UNIT_TALK_DISTRIBUTION_TARGETS` for live runs until resolved

## Source Of Truth

These IDs were verified against the legacy repo on 2026-03-20:

- `C:\dev\unit-talk-production\apps\api\src\scripts\playwright-discord-screenshots.ts`
- `C:\dev\unit-talk-production\apps\api\src\services\VIPPlusChannelService.ts`

All IDs in the V2 target map match the legacy values exactly.

## Rules

- Never add a new target to `UNIT_TALK_DISTRIBUTION_TARGETS` for live runs without it appearing in this doc.
- Channel IDs in `UNIT_TALK_DISCORD_TARGET_MAP` must match the values in this table. Any mismatch is a bug.
- `discord:game-threads` and `discord:strategy-room` may exist in the target map but are delivery-blocked until their architectural gaps are resolved.
- The canary target is permanent. It must always be present and must always post before any content target.
- New targets, including `discord:free-picks`, require ratification in this doc before being added to the map.
- Passing canary does not authorize promotion by itself. `discord:best-bets` remains blocked until the graduation criteria document is explicitly satisfied and recorded.
- `discord:best-bets` must remain a selective execution board. It must not become the default destination for every approved pick.
