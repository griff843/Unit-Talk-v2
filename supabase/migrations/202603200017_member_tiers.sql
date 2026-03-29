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
