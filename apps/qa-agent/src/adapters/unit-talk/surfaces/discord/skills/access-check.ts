import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { QASkill, SkillContext, SkillResult, StepResult, Severity } from '../../../../../core/types.js';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const ADMINISTRATOR_PERMISSION = 1n << 3n;
const VIEW_CHANNEL_PERMISSION = 1n << 10n;
const QA_CHANNEL_KEYS = [
  'qaBotLog',
  'qaAccessCheck',
  'qaPickDelivery',
  'freePicks',
  'vipPicks',
  'vipPlusPicks',
  'adminOps',
  'recap',
] as const;
const QA_ROLE_KEYS = ['admin', 'operator', 'capper', 'vip', 'vipPlus', 'free', 'noAccess'] as const;

type QaChannelKey = (typeof QA_CHANNEL_KEYS)[number];
type QaRoleKey = (typeof QA_ROLE_KEYS)[number];

type QaRoleChannelMap = {
  guildId: string;
  roles: Record<QaRoleKey, string>;
  channels: Record<QaChannelKey, string>;
};

type DiscordRole = {
  id: string;
  name: string;
  permissions: string;
};

type DiscordPermissionOverwrite = {
  id: string;
  type: 0 | 1;
  allow: string;
  deny: string;
};

type DiscordGuildChannel = {
  id: string;
  type: number;
  name: string;
  parent_id?: string | null;
  permission_overwrites?: DiscordPermissionOverwrite[];
};

type VisibilitySnapshot = {
  expectedVisible: QaChannelKey[];
  actualVisible: QaChannelKey[];
  missingChannels: QaChannelKey[];
  leakedChannels: QaChannelKey[];
};

type EvaluatedQaAccess = {
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

function parsePermissionBitfield(value: string | undefined): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function loadQaRoleChannelMap(mapPath: string): QaRoleChannelMap {
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

function resolveRepoRoot(): string {
  const cwd = process.cwd();
  const candidates = [cwd, path.resolve(cwd, '..', '..')];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'local.env')) || existsSync(path.join(candidate, 'pnpm-workspace.yaml'))) {
      return candidate;
    }
  }
  return cwd;
}

function parseEnvFile(filePath: string): Map<string, string> {
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

function readQaEnv(key: string, repoRoot: string): string | undefined {
  const direct = process.env[key];
  if (direct && direct.trim().length > 0) return direct;

  const localEnvPath = path.join(repoRoot, 'local.env');
  if (!existsSync(localEnvPath)) return undefined;
  return parseEnvFile(localEnvPath).get(key);
}

async function fetchDiscordJson<T>(botToken: string, endpoint: string): Promise<T> {
  const response = await fetch(`${DISCORD_API_BASE_URL}${endpoint}`, {
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Discord API request failed for ${endpoint}: HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function resolveEffectiveOverwrites(
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

function canRoleViewChannel(
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
    throw new Error(`Unsupported access-check persona: ${options.personaId}`);
  }

  if (options.qaMap.guildId !== options.guildId) {
    throw new Error(`QA map guildId ${options.qaMap.guildId} does not match DISCORD_QA_GUILD_ID ${options.guildId}`);
  }

  const rolesById = new Map(options.roles.map((role) => [role.id, role]));
  const channelsById = new Map(options.channels.map((channel) => [channel.id, channel]));
  const categoriesById = new Map(options.channels.filter((channel) => channel.type === 4).map((channel) => [channel.id, channel]));

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

function buildSummaryHtml(evaluation: EvaluatedQaAccess): string {
  const rows = QA_CHANNEL_KEYS.map((channelKey) => {
    const expected = evaluation.snapshot.expectedVisible.includes(channelKey);
    const actual = evaluation.snapshot.actualVisible.includes(channelKey);
    const status = expected === actual ? 'PASS' : 'FAIL';
    return `<tr><td>${channelKey}</td><td>${expected ? 'visible' : 'hidden'}</td><td>${actual ? 'visible' : 'hidden'}</td><td>${status}</td></tr>`;
  }).join('');

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>Discord QA Access Check</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 24px; background: #0f172a; color: #e2e8f0; }
        h1, h2 { margin: 0 0 12px; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        th, td { border: 1px solid #334155; padding: 8px; text-align: left; }
        th { background: #1e293b; }
        .ok { color: #22c55e; }
        .bad { color: #ef4444; }
      </style>
    </head>
    <body>
      <h1>Discord QA Access Check</h1>
      <h2>Persona: ${evaluation.personaId}</h2>
      <p>Role key: ${evaluation.roleKey}</p>
      <p class="${evaluation.snapshot.leakedChannels.length === 0 && evaluation.snapshot.missingChannels.length === 0 ? 'ok' : 'bad'}">
        Missing: ${evaluation.snapshot.missingChannels.join(', ') || 'none'} | Leaks: ${evaluation.snapshot.leakedChannels.join(', ') || 'none'}
      </p>
      <table>
        <thead><tr><th>Channel</th><th>Expected</th><th>Actual</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </body>
  </html>`;
}

function buildIssueRecommendation(evaluation: EvaluatedQaAccess): SkillResult['issueRecommendation'] {
  const leakList = evaluation.snapshot.leakedChannels.join(', ') || 'none';
  const missingList = evaluation.snapshot.missingChannels.join(', ') || 'none';

  return {
    title: `[QA] Discord access leak for ${evaluation.personaId}`,
    severity: 'high',
    product: 'unit-talk',
    surface: 'discord',
    description:
      `Sandbox Discord access matrix mismatch for ${evaluation.personaId}. ` +
      `Leaked channels: ${leakList}. Missing expected channels: ${missingList}.`,
    stepsToReproduce: [
      'Run pnpm --filter @unit-talk/qa-agent validate:discord-qa-config',
      `Run pnpm qa:experience --surface discord --persona ${evaluation.personaId} --flow access_check --mode fast`,
      'Inspect sandbox guild role/category/channel permissions for the mismatched channels',
    ],
    expectedBehavior: `Persona ${evaluation.personaId} sees exactly the channels defined in the QA sandbox matrix.`,
    actualBehavior: `Leaked channels: ${leakList}. Missing expected channels: ${missingList}.`,
    screenshotPaths: [],
    labels: ['qa-agent', 'unit-talk', 'discord', 'severity-high', 'access-check'],
  };
}

function toStatus(snapshot: VisibilitySnapshot): { status: SkillResult['status']; severity?: Severity } {
  if (snapshot.leakedChannels.length > 0) {
    return { status: 'FAIL', severity: 'critical' };
  }
  if (snapshot.missingChannels.length > 0) {
    return { status: 'FAIL', severity: 'high' };
  }
  return { status: 'PASS' };
}

export const accessCheckSkill: QASkill = {
  id: 'discord/access-check',
  product: 'unit-talk',
  surface: 'discord',
  flow: 'access_check',
  supportedPersonas: ['free', 'free_user', 'vip', 'vip_user', 'vip_plus_user', 'no_access'],
  description: 'Discord sandbox access check: validates channel visibility by QA role against the sandbox permission matrix',

  async run(ctx: SkillContext): Promise<SkillResult> {
    const steps: StepResult[] = [];
    const observations: string[] = [];
    const repoRoot = resolveRepoRoot();

    const qaBotToken = readQaEnv('DISCORD_QA_BOT_TOKEN', repoRoot);
    const qaGuildId = readQaEnv('DISCORD_QA_GUILD_ID', repoRoot);
    const qaRoleMapPath = readQaEnv('DISCORD_QA_ROLE_MAP', repoRoot);
    const qaChannelMapPath = readQaEnv('DISCORD_QA_CHANNEL_MAP', repoRoot);

    if (!qaBotToken || !qaGuildId || !qaRoleMapPath || !qaChannelMapPath) {
      return {
        status: 'NEEDS_REVIEW',
        steps: [{
          step: 'Check QA Discord env',
          status: 'skip',
          detail: 'DISCORD_QA_BOT_TOKEN, DISCORD_QA_GUILD_ID, DISCORD_QA_ROLE_MAP, and DISCORD_QA_CHANNEL_MAP are required.',
          timestamp: new Date().toISOString(),
          durationMs: 0,
        }],
        consoleErrors: [],
        networkErrors: [],
        uxFriction: ['Discord sandbox access-check requires the QA-only Discord env vars to be present.'],
      };
    }

    const resolvedRoleMapPath = path.resolve(repoRoot, qaRoleMapPath);
    const resolvedChannelMapPath = path.resolve(repoRoot, qaChannelMapPath);
    const roleMap = loadQaRoleChannelMap(resolvedRoleMapPath);
    const channelMap = loadQaRoleChannelMap(resolvedChannelMapPath);

    steps.push({
      step: 'Load QA role/channel map',
      status: 'pass',
      detail: `Loaded sandbox map for guild ${roleMap.guildId}`,
      timestamp: new Date().toISOString(),
      durationMs: 0,
    });

    const [roles, channels] = await Promise.all([
      fetchDiscordJson<DiscordRole[]>(qaBotToken, `/guilds/${qaGuildId}/roles`),
      fetchDiscordJson<DiscordGuildChannel[]>(qaBotToken, `/guilds/${qaGuildId}/channels`),
    ]);

    steps.push({
      step: 'Fetch sandbox guild metadata',
      status: 'pass',
      detail: `Fetched ${roles.length} roles and ${channels.length} channels from sandbox guild ${qaGuildId}`,
      timestamp: new Date().toISOString(),
      durationMs: 0,
    });

    const evaluation = evaluateQaPersonaVisibility({
      personaId: ctx.persona.id,
      guildId: qaGuildId,
      qaMap: roleMap.guildId === channelMap.guildId ? roleMap : (() => { throw new Error('Role map and channel map guildIds do not match.'); })(),
      roles,
      channels,
    });

    for (const channelKey of QA_CHANNEL_KEYS) {
      const expectedVisible = evaluation.snapshot.expectedVisible.includes(channelKey);
      const actualVisible = evaluation.snapshot.actualVisible.includes(channelKey);
      steps.push({
        step: `Assert ${channelKey} visibility`,
        status: expectedVisible === actualVisible ? 'pass' : 'fail',
        detail: `Expected ${expectedVisible ? 'visible' : 'hidden'}, actual ${actualVisible ? 'visible' : 'hidden'}`,
        timestamp: new Date().toISOString(),
        durationMs: 0,
      });
    }

    observations.push(`Persona ${ctx.persona.id} mapped to sandbox role ${evaluation.roleKey}.`);
    observations.push(`Expected visible channels: ${evaluation.snapshot.expectedVisible.join(', ') || 'none'}`);
    observations.push(`Actual visible channels: ${evaluation.snapshot.actualVisible.join(', ') || 'none'}`);
    if (evaluation.snapshot.missingChannels.length > 0) {
      observations.push(`Missing expected channels: ${evaluation.snapshot.missingChannels.join(', ')}`);
    }
    if (evaluation.snapshot.leakedChannels.length > 0) {
      observations.push(`Leaked channels: ${evaluation.snapshot.leakedChannels.join(', ')}`);
    }

    await ctx.page.setContent(buildSummaryHtml(evaluation), { waitUntil: 'domcontentloaded' });
    await ctx.screenshot(`discord-access-check-${ctx.persona.id}`);

    const { status, severity } = toStatus(evaluation.snapshot);

    return {
      status,
      severity,
      steps,
      consoleErrors: [],
      networkErrors: [],
      uxFriction: [],
      observations,
      issueRecommendation: status === 'FAIL' ? buildIssueRecommendation(evaluation) : undefined,
      regressionRecommendation:
        status === 'PASS'
          ? 'Sandbox Discord access matrix matches the expected QA visibility rules for this persona.'
          : 'Fix the sandbox Discord role/category/channel permission mismatch before relying on access_check as a gate.',
    };
  },
};
