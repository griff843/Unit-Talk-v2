import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const ADMINISTRATOR_PERMISSION = 1n << 3n;
const VIEW_CHANNEL_PERMISSION = 1n << 10n;

export const QA_CHANNEL_KEYS = [
  'qaBotLog',
  'qaAccessCheck',
  'qaPickDelivery',
  'freePicks',
  'vipPicks',
  'vipPlusPicks',
  'adminOps',
  'recap',
] as const;

export const QA_ROLE_KEYS = ['admin', 'operator', 'capper', 'vip', 'vipPlus', 'free', 'noAccess'] as const;

export type QaChannelKey = (typeof QA_CHANNEL_KEYS)[number];
export type QaRoleKey = (typeof QA_ROLE_KEYS)[number];

export type QaRoleChannelMap = {
  guildId: string;
  roles: Record<QaRoleKey, string>;
  channels: Record<QaChannelKey, string>;
};

export type DiscordRole = {
  id: string;
  name: string;
  permissions: string;
};

export type DiscordPermissionOverwrite = {
  id: string;
  type: 0 | 1;
  allow: string;
  deny: string;
};

export type DiscordGuildChannel = {
  id: string;
  type: number;
  name: string;
  parent_id?: string | null;
  permission_overwrites?: DiscordPermissionOverwrite[];
};

export type DiscordEmbedField = {
  name?: string;
  value?: string;
  inline?: boolean;
};

export type DiscordEmbed = {
  title?: string;
  fields?: DiscordEmbedField[];
  color?: number;
};

export type DiscordMessage = {
  id: string;
  embeds?: DiscordEmbed[];
};

export type VisibilitySnapshot = {
  expectedVisible: QaChannelKey[];
  actualVisible: QaChannelKey[];
  missingChannels: QaChannelKey[];
  leakedChannels: QaChannelKey[];
};

export type EvaluatedQaAccess = {
  personaId: string;
  roleKey: QaRoleKey;
  snapshot: VisibilitySnapshot;
};

const PERSONA_ROLE_KEY: Record<string, QaRoleKey> = {
  free: 'free',
  free_user: 'free',
  vip: 'vip',
  vip_user: 'vip',
  vip_plus_user: 'vipPlus',
  no_access: 'noAccess',
};

const EXPECTED_VISIBLE_CHANNELS: Record<QaRoleKey, QaChannelKey[]> = {
  admin: ['qaBotLog', 'qaAccessCheck', 'qaPickDelivery', 'freePicks', 'vipPicks', 'vipPlusPicks', 'adminOps', 'recap'],
  operator: ['qaBotLog', 'qaAccessCheck', 'qaPickDelivery', 'freePicks', 'vipPicks', 'vipPlusPicks', 'adminOps', 'recap'],
  capper: ['qaAccessCheck', 'qaPickDelivery', 'freePicks', 'vipPicks', 'vipPlusPicks', 'recap'],
  vip: ['qaAccessCheck', 'qaPickDelivery', 'freePicks', 'vipPicks', 'recap'],
  vipPlus: ['qaAccessCheck', 'qaPickDelivery', 'freePicks', 'vipPicks', 'vipPlusPicks', 'recap'],
  free: ['qaAccessCheck', 'freePicks', 'recap'],
  noAccess: [],
};

export function resolveRepoRoot(): string {
  const cwd = process.cwd();
  const candidates = [cwd, path.resolve(cwd, '..', '..')];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'local.env')) || existsSync(path.join(candidate, 'pnpm-workspace.yaml'))) {
      return candidate;
    }
  }
  return cwd;
}

export function parseEnvFile(filePath: string): Map<string, string> {
  const env = new Map<string, string>();
  const content = readFileSync(filePath, 'utf8');

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) continue;
    env.set(trimmed.slice(0, separatorIndex).trim(), trimmed.slice(separatorIndex + 1).trim());
  }

  return env;
}

export function readQaEnv(key: string, repoRoot: string): string | undefined {
  const direct = process.env[key];
  if (direct && direct.trim().length > 0) return direct;

  const localEnvPath = path.join(repoRoot, 'local.env');
  if (!existsSync(localEnvPath)) return undefined;
  return parseEnvFile(localEnvPath).get(key);
}

export function parsePermissionBitfield(value: string | undefined): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export function loadQaRoleChannelMap(mapPath: string): QaRoleChannelMap {
  const raw = readFileSync(mapPath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<QaRoleChannelMap>;

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid QA role/channel map at ${mapPath}`);
  }
  if (!parsed.guildId || typeof parsed.guildId !== 'string') {
    throw new Error(`QA role/channel map missing guildId at ${mapPath}`);
  }
  if (!parsed.roles || typeof parsed.roles !== 'object') {
    throw new Error(`QA role/channel map missing roles at ${mapPath}`);
  }
  if (!parsed.channels || typeof parsed.channels !== 'object') {
    throw new Error(`QA role/channel map missing channels at ${mapPath}`);
  }

  for (const key of QA_ROLE_KEYS) {
    if (typeof parsed.roles[key] !== 'string' || parsed.roles[key].trim().length === 0) {
      throw new Error(`QA role/channel map missing roles.${key} at ${mapPath}`);
    }
  }
  for (const key of QA_CHANNEL_KEYS) {
    if (typeof parsed.channels[key] !== 'string' || parsed.channels[key].trim().length === 0) {
      throw new Error(`QA role/channel map missing channels.${key} at ${mapPath}`);
    }
  }

  return parsed as QaRoleChannelMap;
}

export function loadQaDiscordContext(repoRoot = resolveRepoRoot()) {
  const qaBotToken = readQaEnv('DISCORD_QA_BOT_TOKEN', repoRoot);
  const qaGuildId = readQaEnv('DISCORD_QA_GUILD_ID', repoRoot);
  const qaRoleMapPath = readQaEnv('DISCORD_QA_ROLE_MAP', repoRoot);
  const qaChannelMapPath = readQaEnv('DISCORD_QA_CHANNEL_MAP', repoRoot);

  return {
    repoRoot,
    qaBotToken,
    qaGuildId,
    qaRoleMapPath,
    qaChannelMapPath,
  };
}

export function requireQaDiscordContext(repoRoot = resolveRepoRoot()) {
  const context = loadQaDiscordContext(repoRoot);

  if (!context.qaBotToken || !context.qaGuildId || !context.qaRoleMapPath || !context.qaChannelMapPath) {
    throw new Error(
      'DISCORD_QA_BOT_TOKEN, DISCORD_QA_GUILD_ID, DISCORD_QA_ROLE_MAP, and DISCORD_QA_CHANNEL_MAP are required.',
    );
  }

  const roleMap = loadQaRoleChannelMap(path.resolve(repoRoot, context.qaRoleMapPath));
  const channelMap = loadQaRoleChannelMap(path.resolve(repoRoot, context.qaChannelMapPath));
  if (roleMap.guildId !== channelMap.guildId) {
    throw new Error('Role map and channel map guildIds do not match.');
  }

  return {
    repoRoot,
    qaBotToken: context.qaBotToken,
    qaGuildId: context.qaGuildId,
    qaRoleMapPath: context.qaRoleMapPath,
    qaChannelMapPath: context.qaChannelMapPath,
    qaMap: {
      guildId: roleMap.guildId,
      roles: roleMap.roles,
      channels: channelMap.channels,
    } satisfies QaRoleChannelMap,
  };
}

export async function fetchDiscordJson<T>(
  botToken: string,
  endpoint: string,
  init?: {
    method?: 'GET' | 'POST';
    body?: Record<string, unknown>;
  },
): Promise<T> {
  const response = await fetch(`${DISCORD_API_BASE_URL}${endpoint}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });

  if (!response.ok) {
    throw new Error(`Discord API request failed for ${endpoint}: HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function resolveEffectiveOverwrites(
  channel: DiscordGuildChannel,
  categoriesById: Map<string, DiscordGuildChannel>,
): DiscordPermissionOverwrite[] {
  if (channel.permission_overwrites && channel.permission_overwrites.length > 0) {
    return channel.permission_overwrites;
  }

  const parentId = channel.parent_id ?? undefined;
  if (!parentId) return [];

  return categoriesById.get(parentId)?.permission_overwrites ?? [];
}

export function canRoleViewChannel(
  roleId: string,
  guildId: string,
  rolesById: Map<string, DiscordRole>,
  channel: DiscordGuildChannel,
  categoriesById: Map<string, DiscordGuildChannel>,
): boolean {
  const everyoneRole = rolesById.get(guildId);
  const role = rolesById.get(roleId);
  if (!everyoneRole || !role) return false;

  let permissions = parsePermissionBitfield(everyoneRole.permissions) | parsePermissionBitfield(role.permissions);
  if ((permissions & ADMINISTRATOR_PERMISSION) === ADMINISTRATOR_PERMISSION) {
    return true;
  }

  const overwrites = resolveEffectiveOverwrites(channel, categoriesById);
  const everyoneOverwrite = overwrites.find((overwrite) => overwrite.id === guildId);
  if (everyoneOverwrite) {
    permissions &= ~parsePermissionBitfield(everyoneOverwrite.deny);
    permissions |= parsePermissionBitfield(everyoneOverwrite.allow);
  }

  const roleOverwrite = overwrites.find((overwrite) => overwrite.id === roleId && overwrite.type === 0);
  if (roleOverwrite) {
    permissions &= ~parsePermissionBitfield(roleOverwrite.deny);
    permissions |= parsePermissionBitfield(roleOverwrite.allow);
  }

  return (permissions & VIEW_CHANNEL_PERMISSION) === VIEW_CHANNEL_PERMISSION;
}

export function evaluateQaPersonaVisibility(options: {
  personaId: string;
  guildId: string;
  qaMap: QaRoleChannelMap;
  roles: DiscordRole[];
  channels: DiscordGuildChannel[];
}): EvaluatedQaAccess {
  const roleKey = PERSONA_ROLE_KEY[options.personaId];
  if (!roleKey) {
    throw new Error(`Unsupported QA persona: ${options.personaId}`);
  }

  if (options.qaMap.guildId !== options.guildId) {
    throw new Error(`QA map guildId ${options.qaMap.guildId} does not match DISCORD_QA_GUILD_ID ${options.guildId}`);
  }

  const rolesById = new Map(options.roles.map((role) => [role.id, role]));
  const channelsById = new Map(options.channels.map((channel) => [channel.id, channel]));
  const categoriesById = new Map(
    options.channels
      .filter((channel) => channel.type === 4)
      .map((channel) => [channel.id, channel]),
  );

  for (const mapRoleKey of QA_ROLE_KEYS) {
    if (!rolesById.has(options.qaMap.roles[mapRoleKey])) {
      throw new Error(`Sandbox role ${mapRoleKey} (${options.qaMap.roles[mapRoleKey]}) is missing from guild ${options.guildId}`);
    }
  }
  for (const channelKey of QA_CHANNEL_KEYS) {
    if (!channelsById.has(options.qaMap.channels[channelKey])) {
      throw new Error(`Sandbox channel ${channelKey} (${options.qaMap.channels[channelKey]}) is missing from guild ${options.guildId}`);
    }
  }

  const expectedVisible = [...EXPECTED_VISIBLE_CHANNELS[roleKey]];
  const actualVisible = QA_CHANNEL_KEYS.filter((channelKey) => {
    const channel = channelsById.get(options.qaMap.channels[channelKey]);
    if (!channel) return false;
    return canRoleViewChannel(options.qaMap.roles[roleKey], options.guildId, rolesById, channel, categoriesById);
  });

  const missingChannels = expectedVisible.filter((channelKey) => !actualVisible.includes(channelKey));
  const leakedChannels = actualVisible.filter((channelKey) => !expectedVisible.includes(channelKey));

  return {
    personaId: options.personaId,
    roleKey,
    snapshot: {
      expectedVisible,
      actualVisible,
      missingChannels,
      leakedChannels,
    },
  };
}
