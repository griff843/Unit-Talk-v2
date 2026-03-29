# Member Tier Model Contract

**Status:** RATIFIED 2026-03-29
**Lane:** claude (contract) — codex (implementation: UTV2-149)
**Authority:** Defines the `member_tiers` table, valid tier values, Discord role sync, and audit trail.
**Unblocks:** UTV2-150 (upgrade/trial audit trail), UTV2-155 (state machine formalization)

---

## Problem

Member tier state (VIP, VIP+, trial, capper, operator) is determined entirely by Discord role presence at runtime. There is no internal DB record of membership state — the only source of truth is Discord's role list, which:

- Requires live Discord API calls or cached role state to query
- Has no audit trail for tier transitions
- Cannot answer "when did this user become VIP+?" or "how many users are in trial right now?"
- Has no V2-side enforcement of invalid transitions

---

## Canonical Tier Values

```typescript
export const memberTiers = [
  'free',        // No paid role — general server access
  'trial',       // Trial access period (time-limited VIP-level)
  'vip',         // Paid VIP tier
  'vip-plus',    // Paid VIP+ tier (higher-signal channels)
  'capper',      // Verified capper (can submit picks)
  'operator',    // Operator/admin access
] as const;

export type MemberTier = (typeof memberTiers)[number];
```

Note: `free` is the baseline. A member can hold multiple tiers simultaneously (e.g., `capper` + `vip-plus`). The `member_tiers` table records one row per active tier assignment per member, not a single "current tier" value.

---

## DB Migration: `member_tiers`

New migration file: `202603200017_member_tiers.sql`

```sql
-- member_tiers: canonical source of truth for member tier state
-- Each row represents an active tier assignment for a Discord member.
-- Tier assignments are append-only — end a tier by setting effective_until,
-- never by deleting or updating the row.

create table if not exists public.member_tiers (
  id uuid primary key default gen_random_uuid(),

  -- Discord identity
  discord_id text not null,           -- Discord user ID (snowflake, as text)
  discord_username text,              -- Snapshot at time of assignment (may drift)

  -- Tier assignment
  tier text not null,
  effective_from timestamptz not null default timezone('utc', now()),
  effective_until timestamptz,        -- null = currently active

  -- Attribution
  source text not null,               -- 'discord-role' | 'manual' | 'system'
  changed_by text,                    -- actor (bot worker ID, operator ID, or 'system')
  reason text,                        -- human-readable reason for the change

  -- Metadata
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),

  constraint member_tiers_tier_check check (
    tier in ('free', 'trial', 'vip', 'vip-plus', 'capper', 'operator')
  ),
  constraint member_tiers_source_check check (
    source in ('discord-role', 'manual', 'system')
  )
);

-- Efficient lookup of active tiers for a member
create index if not exists member_tiers_discord_id_active_idx
  on public.member_tiers(discord_id)
  where effective_until is null;

-- Audit trail: all tier history for a member
create index if not exists member_tiers_discord_id_created_idx
  on public.member_tiers(discord_id, created_at);

-- Operator queries: all current members of a given tier
create index if not exists member_tiers_tier_active_idx
  on public.member_tiers(tier)
  where effective_until is null;
```

---

## Append-Only Semantics

**Never UPDATE or DELETE `member_tiers` rows.**

To end a tier assignment, set `effective_until = now()` on the active row. To start a new assignment, insert a new row.

A member's current active tiers = rows WHERE `discord_id = :id AND effective_until IS NULL`.

Tier history = all rows for a `discord_id`, ordered by `created_at`.

---

## Discord Role → Tier Mapping

The discord-bot's `guildMemberUpdate` handler already fires on role changes (UTV2-56 added this for capper roles). Extend it to sync all tier-relevant role changes.

Discord role ID → tier mapping (read from env vars):

```typescript
export interface DiscordRoleTierMapping {
  roleId: string;
  tier: MemberTier;
}

// Read from env at startup
function readRoleTierMappings(): DiscordRoleTierMapping[] {
  return [
    { roleId: process.env.DISCORD_VIP_ROLE_ID ?? '',         tier: 'vip' },
    { roleId: process.env.DISCORD_VIP_PLUS_ROLE_ID ?? '',    tier: 'vip-plus' },
    { roleId: process.env.DISCORD_TRIAL_ROLE_ID ?? '',       tier: 'trial' },
    { roleId: process.env.DISCORD_CAPPER_ROLE_ID ?? '',      tier: 'capper' },
    { roleId: process.env.DISCORD_OPERATOR_ROLE_ID ?? '',    tier: 'operator' },
  ].filter(m => m.roleId !== '');
}
```

**On role added:**
- If role maps to a tier and no active row exists for that `(discord_id, tier)` pair → INSERT new row with `effective_until = null`
- If an active row already exists for that pair → no-op (idempotent)

**On role removed:**
- Find active row for `(discord_id, tier)` WHERE `effective_until IS NULL`
- SET `effective_until = now()` on that row
- If no active row exists → no-op (idempotent)

---

## Sync Logic Location

In `apps/discord-bot/src/handlers/capper-onboarding-handler.ts` (or a new `member-tier-sync-handler.ts`):

```typescript
export async function syncMemberTierFromRoleChange(
  discordId: string,
  discordUsername: string | undefined,
  addedRoles: string[],
  removedRoles: string[],
  memberTierRepository: MemberTierRepository,
): Promise<void> {
  const mappings = readRoleTierMappings();

  for (const { roleId, tier } of mappings) {
    if (addedRoles.includes(roleId)) {
      await memberTierRepository.activateTier({
        discordId,
        discordUsername,
        tier,
        source: 'discord-role',
        changedBy: 'discord-bot',
        reason: `Discord role ${roleId} added`,
      });
    }

    if (removedRoles.includes(roleId)) {
      await memberTierRepository.deactivateTier({
        discordId,
        tier,
        changedBy: 'discord-bot',
        reason: `Discord role ${roleId} removed`,
      });
    }
  }
}
```

---

## Repository Interface

Add to `packages/db/src/repositories.ts`:

```typescript
export interface MemberTierActivateInput {
  discordId: string;
  discordUsername?: string | undefined;
  tier: MemberTier;
  source: 'discord-role' | 'manual' | 'system';
  changedBy: string;
  reason?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface MemberTierDeactivateInput {
  discordId: string;
  tier: MemberTier;
  changedBy: string;
  reason?: string | undefined;
}

export interface MemberTierRepository {
  /** Inserts a new active tier row (idempotent — no-op if already active). */
  activateTier(input: MemberTierActivateInput): Promise<MemberTierRecord>;

  /** Sets effective_until = now() on the active row (idempotent — no-op if not active). */
  deactivateTier(input: MemberTierDeactivateInput): Promise<void>;

  /** Returns all currently active tiers for a Discord member. */
  getActiveTiers(discordId: string): Promise<MemberTierRecord[]>;

  /** Returns full tier history for a Discord member, ordered by created_at. */
  getTierHistory(discordId: string): Promise<MemberTierRecord[]>;

  /** Returns all currently active members for a given tier. */
  getActiveMembersForTier(tier: MemberTier): Promise<MemberTierRecord[]>;

  /** Returns active tier counts per tier (for operator snapshot). */
  getTierCounts(): Promise<Record<MemberTier, number>>;
}
```

---

## Operator Snapshot

Add to `OperatorSnapshot`:

```typescript
memberTiers?: {
  counts: Record<MemberTier, number>;   // active member count per tier
  lastSyncedAt?: string;                // timestamp of most recent role sync
}
```

Populated by `repositories.memberTiers.getTierCounts()` in `createOperatorSnapshotProvider()`.

---

## Env Vars

Add to `.env.example`:

```
# Discord role IDs for member tier sync
DISCORD_VIP_ROLE_ID=
DISCORD_VIP_PLUS_ROLE_ID=
DISCORD_TRIAL_ROLE_ID=
DISCORD_CAPPER_ROLE_ID=         # already present for capper onboarding
DISCORD_OPERATOR_ROLE_ID=
```

---

## Acceptance Criteria (UTV2-149)

- [ ] Migration `202603200017_member_tiers.sql` written and applied to live DB
- [ ] `MemberTier` type + `memberTiers` const exported from `@unit-talk/contracts`
- [ ] `MemberTierRepository` interface in `packages/db/src/repositories.ts`
- [ ] `InMemoryMemberTierRepository` + `DatabaseMemberTierRepository` in `packages/db`
- [ ] `syncMemberTierFromRoleChange()` in discord-bot; wired into `guildMemberUpdate` handler
- [ ] Role additions → `activateTier`; role removals → `deactivateTier` (idempotent)
- [ ] Operator snapshot includes `memberTiers.counts`
- [ ] `pnpm supabase:types` run after migration
- [ ] `pnpm verify` passes
- [ ] New tests: role added → active tier row; role removed → effective_until set; idempotent on repeat

---

## Out of Scope

- Retroactive sync of existing Discord role state (first-run population is manual or a separate script)
- Trial expiry enforcement (that is UTV2-150) — **canonical duration ratified 2026-03-29: 7 days (`TRIAL_DURATION_DAYS = 7`). Auto/scheduled expiry is required; manual-only removal is not accepted.**
- Full state machine enforcement (that is UTV2-155 — blocked on this contract)
- Member tier API endpoints beyond the operator snapshot
