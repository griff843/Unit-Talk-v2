---
title: Member Role Access Authority
status: RATIFIED
type: Product Authority — T1
issue: UTV2-163
ratified: 2026-03-29
verified-at: 7993ec8 (main)
supersedes: ROLE_ACCESS_MATRIX.md (design-intent only — demoted)
see-also:
  - docs/05_operations/MEMBER_TIER_MODEL_CONTRACT.md
  - docs/03_product/MEMBER_ROLE_ACCESS_READINESS_AUDIT.md
---

# Member Role Access Authority

> **This is the authoritative product and business document for Unit Talk member tiers, role access, and tier lifecycle enforcement.**
>
> It is grounded in enforced runtime truth on `main` at `7993ec8`. Claims in this doc are either verified implementation or explicitly marked as **design intent**.
>
> If this doc conflicts with `MEMBER_TIER_MODEL_CONTRACT.md` (implementation contract) or `MEMBER_ROLE_ACCESS_READINESS_AUDIT.md` (gate log), runtime enforces truth. Resolve conflicts by reading the code.

---

## Design Philosophy

Unit Talk is a full platform. Discord is the primary delivery surface, not the product itself.

The platform has opinions about member tiers, trial mechanics, capper access, and operator authority. Discord reflects those opinions. Discord does not define them.

Consequences:
- Tier state lives in the `member_tiers` DB table. Discord role state is a sync target, not the source of truth.
- When Discord and `member_tiers` disagree, `member_tiers` wins for audit, history, and scheduled enforcement (e.g. trial expiry).
- Discord channel visibility is a manually-configured expression of tier access policy. V2 runtime does not programmatically grant or revoke channel permissions — that remains a Discord server admin operation.

---

## 1. Canonical Tier Model

### 1.1 Tier Values

Defined in `packages/contracts/src/index.ts` as `memberTiers` const. **Hyphens are canonical — no underscores.**

| Tier | Type | Description |
|---|---|---|
| `free` | Member | Default state. No paid access. Sees orientation, announcements, limited surfaces. |
| `trial` | Member | Temporary premium preview. Unlocks VIP-level surfaces for the trial period. |
| `vip` | Member | Main paid tier. Full Best Bets access, recaps, capper surfaces. |
| `vip-plus` | Member | Expanded paid tier. VIP + Trader Insights and higher-access surfaces. |
| `capper` | Internal | Contributor/talent role. Pick submission rights, capper ops surfaces, customer-facing brand. |
| `operator` | Internal | Operations role. Operator command access, internal workflow surfaces. |

**`black-label` is NOT a canonical tier.** It exists as a type placeholder in `tier-resolver.ts` only. It has no Discord role mapping, no env var, no route to resolution. Do not build against it until it is formally ratified.

**Priority order for tier resolution** (enforced in `tier-resolver.ts`): `vip-plus` > `vip` > `trial` > `free`. A member holding multiple paid roles resolves at the highest tier.

`capper` and `operator` are independent boolean flags, not tier levels. A capper can also be VIP+. An operator can also be a capper.

---

### 1.2 DB-Backed Tier State (`member_tiers`)

The `member_tiers` table is the canonical source of truth for tier state beyond real-time Discord role presence.

**Schema (migration `202603200017_member_tiers.sql`):**

```sql
member_tiers (
  id            uuid PRIMARY KEY,
  discord_id    text NOT NULL,
  tier          text NOT NULL CHECK (tier IN ('free','trial','vip','vip-plus','capper','operator')),
  source        text NOT NULL CHECK (source IN ('discord-role','manual','system')),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,       -- null = currently active
  changed_by    text,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now()
)
```

**Append-only semantics:** tier assignments are never updated or deleted. A tier ends by setting `effective_until = now()` on the active row. New assignments create new rows. This gives a complete, immutable history of every tier change.

**Active tier query:**
```sql
SELECT * FROM member_tiers
WHERE discord_id = :id AND effective_until IS NULL;
```

**Repository interface:** `MemberTierRepository` in `packages/db/src/repositories.ts`. Methods: `activateTier`, `deactivateTier`, `getActiveTiers`, `getTierHistory`, `getActiveMembersForTier`, `getTierCounts`, `getExpiredTrials`.

---

### 1.3 Discord Role → Tier Sync

`guildMemberUpdate` events trigger `createMemberTierSyncHandler()` in `apps/discord-bot/src/handlers/member-tier-sync-handler.ts`. It fires on every role change and:

1. Builds a `roleId → tier` map from `BotConfig` (VIP+, VIP, trial, capper, operator)
2. Computes added and removed roles by diffing `oldMember` vs `newMember`
3. Calls `POST /api/member-tiers` for each tier-relevant role change (activate on add, deactivate on remove)
4. All errors are swallowed — handler never crashes the bot

**The sync is best-effort.** If the API is down during a role change, that change is not retried automatically. The `member_tiers` table may temporarily diverge from Discord role state. This is accepted behavior — the table is a record of sync events, not a live mirror. Operators can correct gaps via `source: 'manual'` writes.

**Role IDs resolved from env vars:**

| Env var | Tier | Required |
|---|---|---|
| `DISCORD_VIP_PLUS_ROLE_ID` | `vip-plus` | Yes |
| `DISCORD_VIP_ROLE_ID` | `vip` | Yes |
| `DISCORD_TRIAL_ROLE_ID` | `trial` | No — if absent, trial role changes are not synced |
| `DISCORD_CAPPER_ROLE_ID` | `capper` | Yes |
| `DISCORD_OPERATOR_ROLE_ID` | `operator` | No — if absent, operator role changes are not synced |

---

## 2. Trial Lifecycle

### 2.1 Trial Start

When the Discord trial role is added to a member, `createMemberTierSyncHandler` calls `POST /api/member-tiers` with `action: activate, tier: trial`. The API writes a new `member_tiers` row with `effective_until = now() + TRIAL_DURATION_DAYS`.

**Canonical trial duration: 7 days.** Configurable via `TRIAL_DURATION_DAYS` env var (API process). Default = 7 when absent or invalid.

### 2.2 Trial Expiry

Trial expiry is automatic. `runTrialExpiryPass()` in `apps/api/src/trial-expiry-service.ts`:

1. Queries `member_tiers` for rows where `tier = 'trial' AND effective_until IS NOT NULL AND effective_until <= now()`
2. Calls `deactivateTier()` on each expired row
3. Writes an `audit_log` entry with `action = 'member_tier.trial_expired'`

`startTrialExpiryScheduler()` runs this pass every hour (configurable via `options.intervalMs`). It is wired into the API process startup/shutdown in `apps/api/src/index.ts`.

**Manual Discord role removal is not required for expiry.** The scheduler enforces expiry independently. However, if an operator manually removes the Discord trial role, the sync handler will also deactivate the `member_tiers` row (whichever happens first wins; `deactivateTier` is idempotent via no-op if already inactive).

**When trial expires:** the member's `member_tiers` trial row gets `effective_until` set to the expiry time. Their Discord role remains until manually removed or an operator removes it — V2 does not currently revoke Discord roles programmatically. This is a known gap: the DB state and Discord role state may desync until the role is removed.

### 2.3 Trial Surface Access

Trial should give members enough real value to support upgrade evaluation. Intended access (design intent — enforced by Discord server permissions, not V2 runtime):

- Best Bets channel
- Recaps
- Selected capper surfaces
- Trader Insights (if included in trial strategy — product decision)

When trial expires: access reverts to Free surface set.

---

## 3. Command-Level Access Control

V2 enforces access at the Discord command level via `checkRoles()` in `apps/discord-bot/src/role-guard.ts`. Commands declare `requiredRoles: string[]`. The router checks these before executing. On failure, the user receives an ephemeral "You don't have access to this command" reply.

### 3.1 Currently Gated Commands

| Command | Gate | Role required |
|---|---|---|
| `/pick` | Capper only | `DISCORD_CAPPER_ROLE_ID` |
| `/alerts-setup` | Operator only | `DISCORD_OPERATOR_ROLE_ID` (sentinel blocks all if absent) |

### 3.2 Open-Access Commands

These commands have no `requiredRoles` and are available to any guild member who can see the channel:

| Command | Access |
|---|---|
| `/stats` | Any member |
| `/leaderboard` | Any member |
| `/help` | Any member |
| `/recap` | Any member |
| `/trial-status` | Any member |
| `/upgrade` | Any member |
| `/heat-signal` | Any member |

**Note on `/trial-status` and `/upgrade`:** These commands display tier-based information (access summary, upgrade messaging) and are informational only. They do not unlock or restrict any access. Any member can invoke them.

### 3.3 Operator Gate Sentinel

If `DISCORD_OPERATOR_ROLE_ID` is not set in the environment, `requireOperatorRole()` returns `['__operator_role_not_configured__']` — a sentinel value that will never match any real role. This means `/alerts-setup` silently blocks all users. Set `DISCORD_OPERATOR_ROLE_ID` to a real Discord role ID to activate the operator gate.

---

## 4. Capper Role

Cappers are both internal contributors and customer-facing talent. The capper role is treated as a distinct identity, not a tier above VIP+.

### 4.1 What capper unlocks

- `/pick` command (enforced via `requiredRoles`)
- Capper onboarding welcome embed on role add (sent to `DISCORD_CAPPER_CHANNEL_ID`)
- Capper-visible Discord channels (Discord server configuration — not V2 runtime)

### 4.2 What capper does NOT change

- `resolveMemberTier()` returns `isCapper: true` as a separate boolean — it does not affect the tier string. A capper resolves as `free`, `trial`, `vip`, or `vip-plus` based on their paid roles.
- Pick submission is gated on the capper Discord role. The API (`POST /api/submissions`) itself does not enforce capper status — enforcement is at the Discord command layer.

### 4.3 Capper onboarding

`createCapperOnboardingHandler()` listens for `guildMemberUpdate`. When the capper role is added, it posts a welcome embed to `DISCORD_CAPPER_CHANNEL_ID`. This is separate from `createMemberTierSyncHandler()` (which handles DB sync). Both handlers are registered independently on `guildMemberUpdate`.

---

## 5. Operator Access

Operators access internal runtime tooling. The V2 operator surface is `apps/operator-web` (read-only dashboard) and the `/alerts-setup` Discord command.

### 5.1 Operator web

`GET /api/operator/snapshot` and related routes return internal state: pick pipeline health, outbox, worker status, settlement history, member tier counts. No authentication is currently enforced at the HTTP layer — access is controlled by network/deployment configuration.

`OperatorSnapshot.memberTiers.counts` provides a live count of active rows per tier from the `member_tiers` table. Best-effort: query errors fall back to zero counts without crashing the snapshot.

### 5.2 Operator Discord command

`/alerts-setup` is the only operator-gated Discord command. Blocked by sentinel if `DISCORD_OPERATOR_ROLE_ID` is not configured.

---

## 6. Tier Resolution in the Bot

`resolveMemberTier()` in `apps/discord-bot/src/tier-resolver.ts` resolves a member's tier at call time by checking `interaction.member.roles.cache`. This is stateless — it does not query `member_tiers`. It returns a `MemberTierContext`:

```typescript
interface MemberTierContext {
  discordUserId: string;
  tier: 'free' | 'trial' | 'vip' | 'vip-plus' | 'black-label';
  isCapper: boolean;
  isVip: boolean;
  isVipPlus: boolean;
  isTrial: boolean;
  resolvedAt: string;
}
```

**When to use `resolveMemberTier` vs `member_tiers`:**

| Use case | Source |
|---|---|
| Display member's current tier in an embed | `resolveMemberTier()` — fast, no DB |
| Tier history or audit trail | `member_tiers` table via API |
| Trial expiry check | `member_tiers.effective_until` |
| Count of active VIP members | `MemberTierRepository.getTierCounts()` |
| Operator snapshot tier view | `OperatorSnapshot.memberTiers.counts` |

---

## 7. Channel / Surface Access

Discord channel visibility is enforced by Discord server channel permission configuration. V2 does not programmatically manage channel permissions.

The intended access model (design intent — not yet a V2 runtime enforcement target):

| Surface | Free | Trial | VIP | VIP+ | Capper | Operator |
|---|---|---|---|---|---|---|
| Announcements | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Recaps (`discord:recaps`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Best Bets (`discord:best-bets`) | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| Trader Insights (`discord:trader-insights`) | — | (product decision) | — | ✓ | ✓ | ✓ |
| Exclusive Insights (`discord:exclusive-insights`) | — | — | — | — | ✓ | ✓ |
| Capper surfaces | — | — | — | — | ✓ | ✓ |
| Operator surfaces | — | — | — | — | — | ✓ |

**Recaps are an all-tier credibility and transparency surface.** They are intentionally accessible to all tiers including Free. Recap access is not a paid benefit — it is a platform integrity signal.

**Trial + Trader Insights** is a product decision. The contract does not mandate it. If trial strategy includes Trader Insights, Discord channel permissions should reflect it.

---

## 8. What Is Enforced vs What Is Design Intent

| Claim | Status |
|---|---|
| `member_tiers` table exists with correct schema | **Enforced** — migration 017 |
| Tier values use hyphens (`vip-plus`, not `vip_plus`) | **Enforced** — contracts type + resolver |
| Discord role changes sync to `member_tiers` via API | **Enforced** — sync handler wired in `main.ts` |
| Trial expires automatically after 7 days | **Enforced** — scheduler running hourly |
| `/pick` requires capper role | **Enforced** — `requiredRoles: [capperRoleId]` |
| `/alerts-setup` requires operator role | **Enforced** — `requireOperatorRole()` + sentinel |
| Operator snapshot shows tier counts | **Enforced** — live query, best-effort fallback |
| Channel visibility matches the table above | **Design intent** — Discord server config, not V2 code |
| Trial Discord role revoked on expiry | **Not implemented** — DB state is updated; Discord role removal is manual |
| Retroactive population of `member_tiers` for existing members | **Not implemented** — first-run population is manual or a separate script |
| `black-label` tier functional | **Not implemented** — placeholder only |
| `admin` and `moderator` roles in V2 | **Not implemented** — not in `memberTiers` const |

---

## 9. Open Decisions (Owner Review Required)

These questions are not blocking but should be resolved before the next tier-related sprint:

1. **Trial + Trader Insights:** Should trial members see `discord:trader-insights`? Affects Discord permission configuration.
2. **Discord role revocation on expiry:** Should the API or scheduler remove the Discord trial role when `effective_until` passes? This requires a bot write path (bot can remove roles via `GuildMember.roles.remove()`), currently not implemented.
3. **Free vs No Role:** Is "free" a role that is actively assigned, or the default state when no paid role is present? Currently it is the default (no role assigned). An explicit free role would allow better Discord permission targeting.
4. **Black Label:** When does this tier become active? What does it unlock? Currently a type placeholder.
5. **Admin/Moderator in V2:** Are these in scope for `member_tiers`? Currently not in the `memberTiers` const.
6. **Retroactive population:** How should existing members' tier history be backfilled into `member_tiers`? Manual script, bulk import, or ignored?

---

## 10. Authority and Conflict Resolution

| Document | Role | Status |
|---|---|---|
| **This document** | Product + business authority for tier model and access policy | **RATIFIED** |
| `MEMBER_TIER_MODEL_CONTRACT.md` | Implementation contract (schema, sync logic, repository) | RATIFIED — defer to this for implementation detail |
| `MEMBER_ROLE_ACCESS_READINESS_AUDIT.md` | Gate log — records when authority doc was unblocked | Historical — all gates PASS at `7993ec8` |
| `ROLE_ACCESS_MATRIX.md` | Original design intent draft | **DEMOTED** — superseded by this document. Channel access table above replaces §3 of that doc. Tier taxonomy in §2 of that doc is directionally correct but this document is authoritative. |
| `docs/05_operations/discord_routing.md` | Live Discord channel targets, delivery modes, routing gaps | Authoritative for delivery surface, not access policy |
