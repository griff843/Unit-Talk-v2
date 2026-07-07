// Discord ops — DATA CONTRACTS for sections that have no data source yet.
//
// What IS wired today comes from src/lib/data/discord-ops.ts
// (distribution_outbox + distribution_receipts). Everything below requires
// a new surface before it can be populated.
//
// TODO(data-contract): needs the Discord bot (or apps/api) to persist
// bot heartbeat, guild role/permission audits, and channel-visibility scans
// into Supabase (or expose them via an API endpoint) before these sections
// can leave shell state.

export interface DiscordBotHealth {
  botUserId: string;
  guildId: string;
  online: boolean;
  lastHeartbeatAt: string | null;
  gatewayLatencyMs: number | null;
  shardCount: number | null;
}

export interface RolePermissionAuditRow {
  roleId: string;
  roleName: string;
  memberCount: number;
  grantsAdministrator: boolean;
  canPostInVipChannels: boolean;
  lastAuditedAt: string | null;
  findings: string[];
}

export interface VipLeakageCheck {
  channelId: string;
  channelName: string;
  expectedAudience: 'vip' | 'public' | 'staff';
  observedAudience: 'vip' | 'public' | 'staff' | 'unknown';
  leaking: boolean;
  lastCheckedAt: string | null;
  detail: string | null;
}
