# T1 Contract — Capper Tier System (Shared Authority)

**Status:** RATIFIED 2026-03-28
**Lane:** Claude (contract authority) / Codex (downstream consumers)
**Tier:** T1
**Milestone:** M13
**Downstream consumers:** UTV2-56 (Capper Onboarding), UTV2-68 (Trial Management Commands)
**Blocked by:** none

---

## 1. Purpose

This contract is the shared authority surface for all V2 code that needs to reason about membership tiers, the capper role, or trial state.

It defines:
- The canonical tier model
- Trial semantics
- Where tier/trial state lives and who may read or mutate it
- The Discord role mapping re-ratified for V2
- The `MemberTierContext` data shape that runtime consumers depend on
- What belongs in V1 vs later subscription/billing growth
- Fallback and drift handling

Downstream contracts (UTV2-56, UTV2-68) consume this authority. They do not re-define it.

---

## 2. Canonical Tier Model

Six tiers are recognized in V2. The first five are member-facing. The last is a contributor role that is separate from the subscription hierarchy.

| Tier | Type | Description |
|------|------|-------------|
| `free` | Member | Permanent low-access state. Default for all non-trial, non-paid members. |
| `trial` | Member | Temporary premium preview. Time-bounded. Expires to `free` unless upgraded. |
| `vip` | Member | Primary paid subscriber tier. Access to Best Bets, recaps, capper access. |
| `vip_plus` | Member | Expanded paid tier. VIP access plus Trader Insights and higher-access surfaces. |
| `black_label` | Member | Reserved. Not active in V1. Architectural space only. |
| `capper` | Contributor | Pick submission role. Structurally separate from the member subscription hierarchy. A capper may also hold a member tier (e.g., VIP+), but the capper role is not a subscription tier. |

**Tier hierarchy for access gating (high to low):** `black_label` > `vip_plus` > `vip` > `trial` > `free`

Capper is not ranked in the member hierarchy. It is a contributor flag evaluated independently.

---

## 3. Trial Semantics

- Trial is a temporary state. It grants access equivalent to VIP for the trial window.
- Trial activation and expiry are external to the bot (manual role assignment or future automation — out of scope for V1).
- When trial expires, the Discord role is removed. The bot's next role resolution reflects the change immediately.
- The bot treats `trial` as equivalent to `vip` for access gating purposes unless a command explicitly distinguishes them.
- There is no trial countdown or expiry enforcement in V1. That is a future billing/automation concern.

---

## 4. Source of Truth for Tier/Trial State

**In V1, Discord role cache is the authoritative source of tier state.**

There is no separate tier/membership database table in V2 V1. The bot resolves a member's tier by reading `member.roles.cache` at interaction time or event time. No DB query is made for tier resolution.

This means:
- Tier is always resolved from live Discord role data, not from a stored snapshot.
- Role removal by an admin takes effect immediately on the next bot interaction.
- There is no "tier drift" between DB and Discord because there is no tier DB in V1.

**What this means for downstream consumers:** Call `resolveMemberTier(member)` at the point of interaction. Do not cache the result across interactions.

---

## 5. Discord Role Mapping (Re-Ratified for V2)

Role IDs are re-ratified from legacy production and must be set in `local.env`. They must never be hardcoded in source.

| Tier | Env var | Role ID (production) |
|------|---------|----------------------|
| `capper` | `DISCORD_CAPPER_ROLE_ID` | `1288140783643267092` |
| `vip` | `DISCORD_VIP_ROLE_ID` | `1288831350710865972` |
| `vip_plus` | `DISCORD_VIP_PLUS_ROLE_ID` | `1288831367291080745` |
| `trial` | `DISCORD_TRIAL_ROLE_ID` | *not yet assigned — leave blank until ratified* |

**Capper onboarding channel (re-ratified for V2):**
| Purpose | Env var | Channel ID |
|---------|---------|------------|
| Capper home / onboarding | `DISCORD_CAPPER_CHANNEL_ID` | `1289478274615087146` |

These values must appear in `.env.example` as empty-by-default with a comment indicating they are required for tier-gated commands and events.

`DISCORD_TRIAL_ROLE_ID` is optional in V1. If absent or empty, the trial tier detection returns `false` and falls back to `free`. This is intentional: trial activation is not required for V2 V1 to function.

---

## 6. BotConfig Extension

`apps/discord-bot/src/config.ts` currently only carries `capperRoleId`. This contract requires it to be extended for all tier-relevant role IDs.

**New fields to add to `BotConfig`:**

```typescript
export interface BotConfig {
  token: string;
  clientId: string;
  guildId: string;
  capperRoleId: string;           // existing — DISCORD_CAPPER_ROLE_ID
  vipRoleId: string;              // new — DISCORD_VIP_ROLE_ID
  vipPlusRoleId: string;          // new — DISCORD_VIP_PLUS_ROLE_ID
  trialRoleId: string | null;     // new — DISCORD_TRIAL_ROLE_ID (optional, null if unset)
  capperChannelId: string;        // new — DISCORD_CAPPER_CHANNEL_ID
  apiUrl: string;
  appEnv: AppEnv['UNIT_TALK_APP_ENV'];
}
```

`vipRoleId` and `vipPlusRoleId` are required at startup (fail-fast if absent).
`trialRoleId` is optional — absence does not fail startup.
`capperChannelId` is required at startup (used by UTV2-56 capper onboarding event handler).

`parseBotConfig(env)` must be updated accordingly. `DISCORD_CAPPER_ROLE_ID` remains required (already enforced).

---

## 7. resolveMemberTier — Canonical Function

A single pure function is the only permitted source of tier resolution across the bot.

**Location:** `apps/discord-bot/src/tier-resolver.ts` (new file, created in UTV2-68 implementation lane)

**Signature:**

```typescript
export function resolveMemberTier(
  member: GuildMember,
  config: Pick<BotConfig, 'capperRoleId' | 'vipRoleId' | 'vipPlusRoleId' | 'trialRoleId'>,
): MemberTierContext
```

**Output shape:**

```typescript
export interface MemberTierContext {
  discordUserId: string;
  tier: 'free' | 'trial' | 'vip' | 'vip_plus' | 'black_label';
  isCapper: boolean;
  isVip: boolean;
  isVipPlus: boolean;
  isTrial: boolean;
  resolvedAt: string;   // ISO timestamp
}
```

**Resolution rules (evaluated in order, first match wins):**

1. `isVipPlus` = `member.roles.cache.has(config.vipPlusRoleId)`
2. `isVip` = `member.roles.cache.has(config.vipRoleId)`
3. `isTrial` = `config.trialRoleId !== null && member.roles.cache.has(config.trialRoleId)`
4. `isCapper` = `member.roles.cache.has(config.capperRoleId)` (evaluated independently, not in the tier hierarchy)
5. `tier` =
   - `'vip_plus'` if `isVipPlus`
   - `'vip'` if `isVip`
   - `'trial'` if `isTrial`
   - `'free'` otherwise
   - `'black_label'` is reserved — no detection logic in V1

`resolveMemberTier` is a pure function. It does not read from DB, call the API, or perform any I/O.

---

## 8. Mutation Authority

The bot does **not** assign, remove, or modify Discord roles. That is an administrative action outside the bot's authority.

| Actor | Can mutate tier/role? |
|-------|----------------------|
| Admin (manual) | Yes |
| External automation / webhooks (future) | Yes |
| `apps/api` | No |
| Bot (`apps/discord-bot`) | No — read only |
| Operator web | No |

The bot reacts to role changes via `guildMemberUpdate` events (consumed by UTV2-56). It does not cause role changes.

---

## 9. Fallback and Drift Handling

| Scenario | Behavior |
|---------|---------|
| Member has no recognized role | Resolves to `free`. No error. |
| `DISCORD_TRIAL_ROLE_ID` absent from env | `isTrial = false`. No startup failure. |
| `guildMemberUpdate` fires for non-capper role change | Handler inspects role diff; no-ops if capper role not in the changed set. |
| Roles not yet populated in cache at startup | Bot does not pre-cache roles. Resolution happens at event/interaction time. |
| `black_label` role ID not yet configured | No detection in V1. Reserved space only. |

---

## 10. What Belongs in V1 vs Later

### V1 (this contract scope)

- `BotConfig` extension with tier role IDs
- `resolveMemberTier()` pure function
- `MemberTierContext` type
- Env var definitions and `.env.example` entries
- `guildMemberUpdate` listener for capper role detection (UTV2-56)
- `/trial-status` and `/upgrade` read commands (UTV2-68)
- Role-gating on existing commands using `resolveMemberTier`

### Deferred (not V1)

- Database-backed tier records or membership table
- Trial expiry automation or countdown enforcement
- Billing or subscription system integration
- Black Label tier activation and role assignment
- Automated role assignment from purchase webhook
- Trial start/end timestamp tracking
- Role assignment from the bot itself

---

## 11. Downstream Consumer Summary

Both downstream issues consume `resolveMemberTier` and the `BotConfig` extension defined here. Neither re-defines the tier model.

| Issue | Consumer scope |
|-------|----------------|
| **UTV2-56** Capper Onboarding | Listens on `guildMemberUpdate`; detects capper role added; posts welcome embed to `DISCORD_CAPPER_CHANNEL_ID`. Does not call `resolveMemberTier` — uses raw role diff only. Does not assign roles. |
| **UTV2-68** Trial Management Commands | Implements `/trial-status` and `/upgrade`. Calls `resolveMemberTier` to build the status reply. Read-only. |

**Implementation sequence:** UTV2-68 should be implemented first because it creates `tier-resolver.ts` and extends `BotConfig`. UTV2-56 depends on the extended `BotConfig` for `capperChannelId`.

---

## 12. Acceptance Criteria (for implementing lane)

- [ ] `BotConfig` extended with `vipRoleId`, `vipPlusRoleId`, `trialRoleId`, `capperChannelId`
- [ ] `parseBotConfig()` updated; `vipRoleId` and `vipPlusRoleId` fail-fast if absent; `trialRoleId` nullable
- [ ] `DISCORD_VIP_ROLE_ID`, `DISCORD_VIP_PLUS_ROLE_ID`, `DISCORD_TRIAL_ROLE_ID`, `DISCORD_CAPPER_CHANNEL_ID` added to `.env.example` with comments
- [ ] `tier-resolver.ts` created with `resolveMemberTier()` and `MemberTierContext`
- [ ] `resolveMemberTier` is pure — no I/O, no DB, no API calls
- [ ] `pnpm verify` exits 0
