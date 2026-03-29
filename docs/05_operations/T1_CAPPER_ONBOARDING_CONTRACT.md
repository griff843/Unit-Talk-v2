# T1 Contract — UTV2-56: Capper Onboarding Flow

**Status:** RATIFIED 2026-03-28
**Lane:** Codex (implementation)
**Tier:** T1
**Milestone:** M13
**Depends on:** `T1_CAPPER_TIER_SYSTEM_CONTRACT.md` — RATIFIED ✅
**Issue:** [UTV2-56](https://linear.app/unit-talk-v2/issue/UTV2-56)
**Blocked by:** UTV2-68 must land first (creates `BotConfig` extension + `tier-resolver.ts`)

---

## 1. Decision

When the capper role is assigned to a Discord member, the bot posts a structured welcome embed to the private capper onboarding channel. This is the sole automated onboarding action in V1.

**Trigger model:** `guildMemberUpdate` event (role-assignment detection), not a command.

**Welcome destination:** `DISCORD_CAPPER_CHANNEL_ID` = `1289478274615087146` — the existing private capper channel repurposed as the capper home / onboarding channel.

**Not DM-first.** DM delivery is architecturally blocked in V2. The welcome goes to the shared capper channel, visible to all cappers with access to that channel.

---

## 2. Required Intent (GuildMembers)

The bot must have the `GuildMembers` privileged intent enabled in the Discord developer portal. This is already listed in `DISCORD_BOT_FOUNDATION_SPEC.md §4.1`. Verify it is enabled before deploying this feature.

---

## 3. guildMemberUpdate Handler

**Location:** `apps/discord-bot/src/handlers/capper-onboarding-handler.ts`

**Trigger:** `guildMemberUpdate` fires when a guild member's roles, nickname, or other properties change. The handler inspects only the role diff.

**Logic:**

```
1. Compute addedRoleIds = new roles that were not in old member
2. If DISCORD_CAPPER_ROLE_ID not in addedRoleIds → return (no-op)
3. Resolve capperChannelId from BotConfig
4. Build welcome embed (see §4)
5. Fetch channel by capperChannelId
6. Post embed to channel
7. On error: log via observability, do not throw — handler failure must not crash the bot
```

The handler is registered in `main.ts` alongside `interactionCreate`:
```typescript
client.on('guildMemberUpdate', capperOnboardingHandler);
```

---

## 4. Welcome Embed Spec

**Title:** `👋 Welcome to Unit Talk Cappers — [display name]`
**Color:** `0x5865f2` (Discord blurple)

**Description:**
```
You've been added as a Unit Talk Capper. Here's what you need to know to get started.
```

**Fields (in order):**

| Field name | Value | Inline |
|---|---|---|
| Submit a pick | `Use /pick to submit picks through the canonical submission path.` | false |
| Your stats | `Use /stats to view your settled pick performance.` | false |
| Your recap | `Use /recap to review your last settled picks.` | false |
| Questions | `Reach out to an operator in this channel.` | false |

**Footer:** `Unit Talk · Capper Onboarding · [ISO timestamp]`

---

## 5. Error Handling

| Scenario | Behavior |
|---------|---------|
| `capperChannelId` cannot be resolved | Log warning: "capper onboarding channel not configured"; no-op |
| Channel fetch fails | Log warning; no-op — do not crash |
| Message send fails | Log warning with error; no-op |
| Handler throws unhandled | Log error via observability; swallow — must not crash process |

---

## 6. Out of Scope

- DM welcome sequence
- Role assignment from the bot
- `/capper-onboard` command (not needed — event-driven)
- Storing capper onboarding state in the DB
- Sending multiple messages or a follow-up sequence
- Detecting capper role removal
- Any interaction with `resolveMemberTier` (this handler uses raw role diff, not tier context)

---

## 7. Acceptance Criteria

- [ ] `client.on('guildMemberUpdate', ...)` registered in `main.ts`
- [ ] Handler fires only when `DISCORD_CAPPER_ROLE_ID` is in the added role set
- [ ] Welcome embed posted to channel `DISCORD_CAPPER_CHANNEL_ID`
- [ ] Handler failure is logged and swallowed — bot process does not crash
- [ ] `GuildMembers` intent documented as required in bot startup notes
- [ ] `pnpm verify` exits 0
- [ ] ≥ 3 net-new tests:
  - capper role added → embed posted to correct channel
  - non-capper role change → no-op
  - channel fetch failure → logged and swallowed, no crash
