# T2 Contract — UTV2-68: Trial Management Commands (/trial-status, /upgrade)

**Status:** RATIFIED 2026-03-28
**Lane:** Codex (implementation)
**Tier:** T2
**Milestone:** M13
**Depends on:** `T1_CAPPER_TIER_SYSTEM_CONTRACT.md` — RATIFIED ✅
**Issue:** [UTV2-68](https://linear.app/unit-talk-v2/issue/UTV2-68)
**Blocked by:** none (this issue implements `tier-resolver.ts` + `BotConfig` extension as its first step)

---

## 1. Decision

Implement two member-facing Discord slash commands that consume canonical tier state:

- **`/trial-status`** — shows the member's current tier and, if on trial, what they have access to and what they would gain by upgrading.
- **`/upgrade`** — shows the upgrade path from the member's current tier. Bounded upgrade-path information only. Not a billing engine. No payment processing.

Both commands are read-only. They call `resolveMemberTier()` and format the result. No DB writes. No role mutations.

---

## 2. Implementation Prerequisites (first commit)

This issue creates the shared infrastructure that UTV2-56 also depends on:

- Extend `BotConfig` with `vipRoleId`, `vipPlusRoleId`, `trialRoleId`, `capperChannelId` per `T1_CAPPER_TIER_SYSTEM_CONTRACT.md §6`
- Update `parseBotConfig()` accordingly
- Add new env vars to `.env.example` with comments
- Create `apps/discord-bot/src/tier-resolver.ts` with `resolveMemberTier()` and `MemberTierContext` per contract §7

These must land in the same PR as the commands.

---

## 3. `/trial-status`

**File:** `apps/discord-bot/src/commands/trial-status.ts`

**Slash command definition:**
```
/trial-status
  (no options)
```

**Role guard:** none — available to all members.

**Response:** ephemeral always.

**Behavior:**
1. Call `resolveMemberTier(interaction.member, config)` to get `MemberTierContext`
2. Render tier status embed (see §5)

---

## 4. `/upgrade`

**File:** `apps/discord-bot/src/commands/upgrade.ts`

**Slash command definition:**
```
/upgrade
  (no options)
```

**Role guard:** none — available to all members.

**Response:** ephemeral always.

**Behavior:**
1. Call `resolveMemberTier(interaction.member, config)` to get `MemberTierContext`
2. If tier is already `vip_plus`: reply "You're already on our highest active tier."
3. Otherwise: render upgrade path embed (see §6)

`/upgrade` does not link to external billing URLs or payment surfaces. It describes what each higher tier unlocks. The call-to-action is directed to an operator/support channel for manual upgrade processing in V1.

---

## 5. `/trial-status` Embed Spec

**Title:** `📊 Your Unit Talk Access — [tier display name]`

**Color by tier:**
| Tier | Color |
|------|-------|
| `vip_plus` | `0xffd700` gold |
| `vip` | `0x5865f2` blurple |
| `trial` | `0x57f287` green |
| `free` | `0x99aab5` grey |

**Tier display names:**
| Tier | Display |
|------|---------|
| `vip_plus` | VIP+ |
| `vip` | VIP |
| `trial` | Trial |
| `free` | Free |
| `capper` | Capper (shown as addendum if `isCapper = true`) |

**Description by tier:**

- `free`: "You have free access to Unit Talk. Upgrade to VIP for full pick board and capper access."
- `trial`: "You're on a trial. You have temporary VIP-level access. Upgrade before your trial ends to keep it."
- `vip`: "You're a VIP member. You have access to Best Bets, recaps, and the full capper board."
- `vip_plus`: "You're VIP+. You have access to all VIP surfaces plus Trader Insights."

**Capper addendum** (append as a field if `isCapper = true`):
```
Field name: "Capper Role"
Value: "You also hold the Capper contributor role. Use /pick to submit picks."
Inline: false
```

**Footer:** `Unit Talk · /trial-status`

---

## 6. `/upgrade` Embed Spec

**Title:** `⬆️ Upgrade Your Access`
**Color:** `0x5865f2`

**Upgrade path description by current tier:**

- `free`:
  > **VIP** — Full pick board, capper board access, Best Bets, recaps.
  > **VIP+** — Everything in VIP plus Trader Insights.

- `trial`:
  > You're currently on a trial with VIP-level access.
  > **VIP** — Keep everything you have now, permanently.
  > **VIP+** — Add Trader Insights on top.

- `vip`:
  > **VIP+** — Adds Trader Insights and higher-access surfaces to your current VIP access.

- `vip_plus`:
  > You're already on our highest active tier.
  > *(Return early, no upgrade path to show)*

**CTA field (all upgrade-eligible tiers):**
```
Field name: "Ready to upgrade?"
Value: "Contact an operator in #support or reach out to staff directly."
Inline: false
```

**Footer:** `Unit Talk · /upgrade · V1 upgrade path`

---

## 7. Registration

`apps/discord-bot/src/command-registry.ts` — add both commands.

`apps/discord-bot/src/commands/help.ts` — add to `COMMAND_ENTRIES`:
```typescript
{ name: 'trial-status', description: 'Show your current access tier and what it includes' },
{ name: 'upgrade', description: 'See your upgrade path and what higher tiers unlock' },
```

Guild deploy must be re-run. Total registered commands after this PR: 9 (was 7 after UTV2-65).

---

## 8. Out of Scope

- Payment processing or billing integration
- External upgrade links
- Trial expiry enforcement or countdown timers
- Role assignment or removal from the bot
- Writing tier state to DB
- Black Label tier (reserved — no detection or display in V1)
- Admin commands to manage trial state

---

## 9. Acceptance Criteria

- [ ] `BotConfig` extended per `T1_CAPPER_TIER_SYSTEM_CONTRACT.md §6`
- [ ] `tier-resolver.ts` created with `resolveMemberTier()` and `MemberTierContext`
- [ ] `resolveMemberTier` is pure — no I/O
- [ ] New env vars in `.env.example` with comments
- [ ] `/trial-status` renders correct embed for each tier; capper addendum appears when `isCapper=true`
- [ ] `/trial-status` response is always ephemeral
- [ ] `/upgrade` renders correct upgrade path per tier; early return for `vip_plus`
- [ ] `/upgrade` response is always ephemeral
- [ ] Both commands registered in registry and listed in `/help`
- [ ] `pnpm verify` exits 0
- [ ] ≥ 5 net-new tests:
  - `resolveMemberTier`: free (no roles), trial, vip, vip_plus, capper+vip (both flags set)
  - `/trial-status` embed: correct color + description per tier
  - `/trial-status` capper addendum when `isCapper=true`
  - `/upgrade` returns early for `vip_plus`
  - `/upgrade` shows correct path for `free` and `trial`
