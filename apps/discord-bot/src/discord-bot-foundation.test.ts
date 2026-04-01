/**
 * Discord Bot Foundation tests
 *
 * Coverage:
 *   - parseBotConfig: validates required vars, throws on missing
 *   - checkRoles: role access gate logic
 *   - loadCommandRegistry: empty registry when commands/ is empty
 *   - createInteractionHandler: dispatch, unknown command, role gate, error handling
 *   - createApiClient: URL construction, error on non-200
 *
 * Tests run with: tsx --test apps/discord-bot/src/discord-bot-foundation.test.ts
 * No live Discord connection required.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import type { AppEnv } from '@unit-talk/config';
import { parseBotConfig } from './config.js';
import { checkRoles } from './role-guard.js';
import { loadCommandRegistry } from './command-registry.js';
import { createInteractionHandler } from './router.js';
import {
  ApiClientError,
  createApiClient,
  type ApiClient,
  type QueriedPick,
  type RecentSettlement,
} from './api-client.js';
import type { ChatInputCommandInteraction, GuildMember, Interaction } from 'discord.js';
import type { CommandHandler, CommandRegistry } from './command-registry.js';
import { createPickCommand, parsePickSubmission } from './commands/pick.js';
import { buildCapperRecapEmbed, createRecapCommand } from './commands/recap.js';
import { buildStatsEmbed, createStatsCommand, type CapperStatsResponse } from './commands/stats.js';
import {
  buildLeaderboardEmbed,
  createLeaderboardCommand,
  type LeaderboardResponse,
} from './commands/leaderboard.js';
import {
  buildAlertsSetupEmbed,
  createAlertsSetupCommand,
} from './commands/alerts-setup.js';
import { createHelpCommand } from './commands/help.js';
import {
  buildTrialStatusEmbed,
  createTrialStatusCommand,
} from './commands/trial-status.js';
import {
  buildUpgradeEmbed,
  createUpgradeCommand,
} from './commands/upgrade.js';
import {
  createHeatSignalCommand,
} from './commands/heat-signal.js';
import {
  buildLiveEmbeds,
  createLiveCommand,
} from './commands/live.js';
import {
  buildTodayEmbeds,
  filterTodayPicks,
} from './commands/today.js';
import {
  buildMyPicksEmbeds,
  createMyPicksCommand,
  filterPicksForIdentity,
} from './commands/my-picks.js';
import {
  buildResultsEmbeds,
  createResultsCommand,
} from './commands/results.js';
import { buildRecapEmbedData } from './embeds/recap-embed.js';
import { buildPickUrgencyDisplay } from './embeds/urgency-utils.js';
import { buildBettorIntelligenceFields } from './embeds/intelligence-display.js';
import { resolveMemberTier } from './tier-resolver.js';
import {
  buildCapperWelcomeEmbed,
  createCapperOnboardingHandler,
} from './handlers/capper-onboarding-handler.js';
import { createMemberTierSyncHandler } from './handlers/member-tier-sync-handler.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeMinimalEnv(overrides?: Partial<AppEnv>): AppEnv {
  return {
    NODE_ENV: 'development',
    UNIT_TALK_APP_ENV: 'local',
    UNIT_TALK_ACTIVE_WORKSPACE: '/workspace',
    UNIT_TALK_LEGACY_WORKSPACE: '/legacy',
    LINEAR_TEAM_KEY: 'UTV2',
    LINEAR_TEAM_NAME: 'unit-talk-v2',
    NOTION_WORKSPACE_NAME: 'unit-talk-v2',
    SLACK_WORKSPACE_NAME: 'unit-talk-v2',
    DISCORD_BOT_TOKEN: 'test-token',
    DISCORD_CLIENT_ID: 'test-client-id',
    DISCORD_GUILD_ID: '1284478946171293736',
    DISCORD_CAPPER_ROLE_ID: 'role-capper',
    DISCORD_VIP_ROLE_ID: 'role-vip',
    DISCORD_VIP_PLUS_ROLE_ID: 'role-vip-plus',
    DISCORD_TRIAL_ROLE_ID: 'role-trial',
    DISCORD_CAPPER_CHANNEL_ID: 'channel-capper',
    DISCORD_OPERATOR_ROLE_ID: 'role-operator',
    UNIT_TALK_API_URL: 'http://localhost:4000',
    ...overrides,
  } as AppEnv;
}

function makeRegistryEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'test',
    UNIT_TALK_APP_ENV: 'local',
    UNIT_TALK_ACTIVE_WORKSPACE: 'C:\\dev\\unit-talk-v2',
    UNIT_TALK_LEGACY_WORKSPACE: 'C:\\dev\\unit-talk-production',
    LINEAR_TEAM_KEY: 'UTV2',
    LINEAR_TEAM_NAME: 'unit-talk-v2',
    NOTION_WORKSPACE_NAME: 'unit-talk-v2',
    SLACK_WORKSPACE_NAME: 'unit-talk-v2',
    DISCORD_BOT_TOKEN: 'test-token',
    DISCORD_CLIENT_ID: 'test-client-id',
    DISCORD_GUILD_ID: '1284478946171293736',
    DISCORD_CAPPER_ROLE_ID: 'role-capper',
    DISCORD_VIP_ROLE_ID: 'role-vip',
    DISCORD_VIP_PLUS_ROLE_ID: 'role-vip-plus',
    DISCORD_TRIAL_ROLE_ID: 'role-trial',
    DISCORD_CAPPER_CHANNEL_ID: 'channel-capper',
    DISCORD_OPERATOR_ROLE_ID: 'role-operator',
    UNIT_TALK_API_URL: 'http://localhost:4000',
    ...overrides,
  };
}

function withEnvVars<T>(values: Record<string, string>, callback: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }

  return callback().finally(() => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

function makeCommandOptions(values: Record<string, string | number | undefined>) {
  return {
    getString(name: string, required?: boolean) {
      const value = values[name];
      if (value == null) {
        if (required) throw new Error(`${name} missing`);
        return null;
      }

      return typeof value === 'string' ? value : String(value);
    },
    getInteger(name: string, required?: boolean) {
      const value = values[name];
      if (value == null) {
        if (required) throw new Error(`${name} missing`);
        return null;
      }

      return Number(value);
    },
    getNumber(name: string, required?: boolean) {
      const value = values[name];
      if (value == null) {
        if (required) throw new Error(`${name} missing`);
        return null;
      }

      return Number(value);
    },
  };
}

function makePickInteraction(values: Record<string, string | number | undefined>) {
  const edited: string[] = [];
  const editedPayloads: Array<{ content?: string; embeds?: unknown[] }> = [];
  const interaction = {
    options: makeCommandOptions(values),
    user: {
      username: 'griff843',
      globalName: 'Griff',
    },
    member: {
      displayName: 'Griff Display',
    },
    editReply: async (payload: { content?: string; embeds?: unknown[] }) => {
      edited.push(payload.content ?? '');
      editedPayloads.push(payload);
    },
  };

  return {
    interaction: interaction as unknown as ChatInputCommandInteraction,
    edited,
    editedPayloads,
  };
}

interface MockRoles {
  heldRoles: string[];
}

function makeMockInteraction(opts: {
  commandName?: string;
  roles?: MockRoles | null;
  isChatInputCommand?: boolean;
} = {}): {
  interaction: Interaction;
  replies: string[];
  deferred: boolean;
  deferredOptions: unknown[];
  edited: string[];
  deferOrder: number;
  executeOrder: number;
  callOrder: number[];
} {
  const replies: string[] = [];
  const edited: string[] = [];
  const deferredOptions: unknown[] = [];
  let deferred = false;
  let deferOrder = -1;
  let executeOrder = -1;
  let step = 0;

  const callOrder: number[] = [];

  const mock = {
    commandName: opts.commandName ?? 'test-cmd',
    isChatInputCommand: () => opts.isChatInputCommand ?? true,
    member: opts.roles === null ? null : {
      roles: {
        cache: {
          has: (id: string) => (opts.roles?.heldRoles ?? []).includes(id),
        },
      },
    },
    reply: async (options: { content: string }) => {
      replies.push(options.content);
    },
    deferReply: async (opts: unknown) => {
      deferred = true;
      deferredOptions.push(opts);
      deferOrder = step++;
      callOrder.push(deferOrder);
    },
    editReply: async (options: { content: string }) => {
      edited.push(options.content);
    },
  };

  return {
    interaction: mock as unknown as Interaction,
    replies,
    edited,
    deferredOptions,
    get deferred() { return deferred; },
    get deferOrder() { return deferOrder; },
    get executeOrder() { return executeOrder; },
    callOrder,
    _setExecuteOrder: (o: number) => { executeOrder = o; step = o; },
  } as unknown as {
    interaction: Interaction;
    replies: string[];
    deferred: boolean;
    deferredOptions: unknown[];
    edited: string[];
    deferOrder: number;
    executeOrder: number;
    callOrder: number[];
  };
}

function makeRegistry(commands: CommandHandler[]): CommandRegistry {
  const registry = new Map<string, CommandHandler>();
  for (const cmd of commands) {
    registry.set(cmd.data.name, cmd);
  }
  return registry;
}

function makeMember(heldRoles: string[] = [], id = 'user-123'): Pick<GuildMember, 'id' | 'roles'> {
  return {
    id,
    roles: {
      cache: {
        has: (roleId: string) => heldRoles.includes(roleId),
      },
    },
  } as unknown as Pick<GuildMember, 'id' | 'roles'>;
}

function makeStatsResponse(): CapperStatsResponse {
  return {
    scope: 'capper',
    capper: 'Griff',
    window: 30,
    sport: 'NBA',
    picks: 19,
    wins: 12,
    losses: 6,
    pushes: 1,
    winRate: 12 / 18,
    roiPct: 33.3,
    avgClvPct: 2.1,
    beatsLine: 0.71,
    picksWithClv: 14,
    lastFive: ['W', 'W', 'L', 'W', 'W'],
  };
}

function makeLeaderboardResponse(): LeaderboardResponse {
  return {
    window: 30,
    sport: 'NBA',
    minPicks: 3,
    observedAt: '2026-03-27T12:00:00.000Z',
    entries: [
      {
        rank: 1,
        capper: 'Griff',
        picks: 5,
        wins: 4,
        losses: 1,
        pushes: 0,
        winRate: 0.8,
        roiPct: 60,
        avgClvPct: 2.4,
        streak: 5,
      },
      {
        rank: 2,
        capper: 'Casey',
        picks: 4,
        wins: 2,
        losses: 2,
        pushes: 0,
        winRate: 0.5,
        roiPct: 0,
        avgClvPct: 0.4,
        streak: -2,
      },
    ],
  };
}

function makeRecapResponse() {
  return {
    submittedBy: 'Griff Display',
    picks: [
      {
        market: 'NBA points',
        selection: 'Over 24.5',
        result: 'win' as const,
        profitLossUnits: 1,
        clvPercent: 3.8,
        stakeUnits: 1.5,
        settledAt: '2026-03-27T12:00:00.000Z',
      },
      {
        market: 'NBA assists',
        selection: 'Over 8.5',
        result: 'loss' as const,
        profitLossUnits: -1,
        clvPercent: null,
        stakeUnits: null,
        settledAt: '2026-03-26T12:00:00.000Z',
      },
    ],
  };
}

function makeQueriedPick(overrides: Partial<QueriedPick> = {}): QueriedPick {
  return {
    id: overrides.id ?? 'pick-1',
    market: overrides.market ?? 'NBA - Moneyline',
    selection: overrides.selection ?? 'Knicks',
    odds: overrides.odds ?? -110,
    stake_units: overrides.stake_units ?? 1,
    status: overrides.status ?? 'validated',
    source: overrides.source ?? 'discord-bot',
    created_at: overrides.created_at ?? '2026-03-28T12:00:00.000Z',
    promotion_status: overrides.promotion_status ?? 'not_eligible',
    promotion_target: overrides.promotion_target ?? null,
    metadata: overrides.metadata ?? { submittedBy: 'griff843' },
  };
}

function makeRecentSettlement(overrides: Partial<RecentSettlement> = {}): RecentSettlement {
  return {
    id: overrides.id ?? 'settlement-1',
    pick_id: overrides.pick_id ?? 'pick-1',
    status: overrides.status ?? 'settled',
    result: overrides.result ?? 'win',
    settled_at: overrides.settled_at ?? '2026-03-28T14:00:00.000Z',
    created_at: overrides.created_at ?? '2026-03-28T14:00:00.000Z',
    payload: overrides.payload ?? {},
  };
}

// ---------------------------------------------------------------------------
// parseBotConfig tests
// ---------------------------------------------------------------------------

test('parseBotConfig returns BotConfig when all required vars are present', () => {
  const env = makeMinimalEnv();
  const config = parseBotConfig(env);

  assert.equal(config.token, 'test-token');
  assert.equal(config.clientId, 'test-client-id');
  assert.equal(config.guildId, '1284478946171293736');
  assert.equal(config.capperRoleId, 'role-capper');
  assert.equal(config.vipRoleId, 'role-vip');
  assert.equal(config.vipPlusRoleId, 'role-vip-plus');
  assert.equal(config.trialRoleId, 'role-trial');
  assert.equal(config.capperChannelId, 'channel-capper');
  assert.equal(config.operatorRoleId, 'role-operator');
  assert.equal(config.apiUrl, 'http://localhost:4000');
  assert.equal(config.appEnv, 'local');
});

test('loadCommandRegistry also loads live, today, my-picks, and results commands', async () => {
  await withEnvVars(
    makeRegistryEnv({
      DISCORD_CLIENT_ID: '123',
      DISCORD_GUILD_ID: 'g123',
      DISCORD_CAPPER_ROLE_ID: 'r123',
    }),
    async () => {
      const registry = await loadCommandRegistry();
      for (const commandName of ['live', 'today', 'my-picks', 'results']) {
        assert.ok(registry.get(commandName), `${commandName} command not found in registry`);
      }
    },
  );
});

test('createApiClient.getPicksByStatus calls GET /api/picks with status and limit params', async () => {
  let capturedUrl = '';
  const mockFetch: typeof fetch = async (input) => {
    capturedUrl = String(input);
    return new Response(JSON.stringify({ picks: [], count: 0 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const client = createApiClient('http://localhost:4000', mockFetch);
  const result = await client.getPicksByStatus?.(['validated', 'queued'], 25);

  assert.equal(
    capturedUrl,
    'http://localhost:4000/api/picks?status=validated%2Cqueued&limit=25',
  );
  assert.equal(result?.count, 0);
});

test('createApiClient.getRecentSettlements calls GET /api/settlements/recent with limit param', async () => {
  let capturedUrl = '';
  const mockFetch: typeof fetch = async (input) => {
    capturedUrl = String(input);
    return new Response(JSON.stringify({ settlements: [], count: 0 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const client = createApiClient('http://localhost:4000', mockFetch);
  const result = await client.getRecentSettlements?.(15);

  assert.equal(
    capturedUrl,
    'http://localhost:4000/api/settlements/recent?limit=15',
  );
  assert.equal(result?.count, 0);
});

test('/live command renders active picks from the picks query API', async () => {
  type Payload = { content?: string; embeds?: Array<{ toJSON(): Record<string, unknown> }> };
  const apiClient: ApiClient = {
    get: async <T>() => ({ picks: [], count: 0 } as T),
    post: async <T>() => ({} as T),
    getPicksByStatus: async () => ({
      count: 2,
      picks: [
        makeQueriedPick({ id: 'pick-1', status: 'validated', selection: 'Knicks ML' }),
        makeQueriedPick({ id: 'pick-2', status: 'posted', selection: 'Suns ML' }),
      ],
    }),
  };
  const command = createLiveCommand(apiClient);
  let payload: Payload | null = null;

  await command.execute({
    editReply: async (next: Payload) => {
      payload = next;
    },
  } as never);

  assert.ok(payload);
  const settledPayload = payload as Payload;
  const embed = settledPayload.embeds?.[0]?.toJSON() as { title?: string; description?: string };
  assert.equal(embed.title, 'Live Board');
  assert.match(embed.description ?? '', /\[VALIDATED\].*Knicks ML/);
  assert.match(embed.description ?? '', /\[POSTED\].*Suns ML/);
});

test('buildLiveEmbeds paginates after 10 picks', () => {
  const embeds = buildLiveEmbeds(
    Array.from({ length: 11 }, (_, index) =>
      makeQueriedPick({ id: `pick-${index}`, selection: `Pick ${index}` }),
    ),
  );

  assert.equal(embeds.length, 2);
  assert.equal(embeds[0]?.toJSON().title, 'Live Board - Page 1/2');
  assert.equal(embeds[1]?.toJSON().title, 'Live Board - Page 2/2');
});

test('filterTodayPicks keeps only picks created on the same UTC date', () => {
  const picks = [
    makeQueriedPick({ id: 'pick-today', created_at: '2026-03-28T01:00:00.000Z' }),
    makeQueriedPick({ id: 'pick-yesterday', created_at: '2026-03-27T23:59:00.000Z' }),
  ];

  const filtered = filterTodayPicks(picks, new Date('2026-03-28T13:00:00.000Z'));

  assert.deepEqual(filtered.map((pick) => pick.id), ['pick-today']);
});

test('buildTodayEmbeds paginates after 10 picks', () => {
  const embeds = buildTodayEmbeds(
    Array.from({ length: 12 }, (_, index) =>
      makeQueriedPick({ id: `today-${index}`, selection: `Today ${index}` }),
    ),
  );

  assert.equal(embeds.length, 2);
});

test('filterPicksForIdentity matches metadata submittedBy against Discord usernames and display names', () => {
  const picks = [
    makeQueriedPick({ id: 'mine', metadata: { submittedBy: 'Griff Display' } }),
    makeQueriedPick({ id: 'other', metadata: { submittedBy: 'Casey' } }),
  ];

  const filtered = filterPicksForIdentity(picks, {
    user: { username: 'griff843', globalName: 'Griff' },
    member: { displayName: 'Griff Display' },
  } as never);

  assert.deepEqual(filtered.map((pick) => pick.id), ['mine']);
});

test('/my-picks command renders only picks matching the caller identity', async () => {
  type Payload = { content?: string; embeds?: Array<{ toJSON(): Record<string, unknown> }> };
  const apiClient: ApiClient = {
    get: async <T>() => ({ picks: [], count: 0 } as T),
    post: async <T>() => ({} as T),
    getPicksByStatus: async () => ({
      count: 2,
      picks: [
        makeQueriedPick({ id: 'mine', selection: 'My Pick', metadata: { submittedBy: 'griff843' } }),
        makeQueriedPick({ id: 'other', selection: 'Other Pick', metadata: { submittedBy: 'casey' } }),
      ],
    }),
  };
  const command = createMyPicksCommand(apiClient);
  let payload: Payload | null = null;

  await command.execute({
    user: { username: 'griff843', globalName: 'Griff' },
    member: { displayName: 'Griff Display' },
    editReply: async (next: Payload) => {
      payload = next;
    },
  } as never);

  assert.ok(payload);
  const settledPayload = payload as Payload;
  const embed = settledPayload.embeds?.[0]?.toJSON() as { title?: string; description?: string };
  assert.equal(embed.title, 'My Picks');
  assert.match(embed.description ?? '', /My Pick/);
  assert.doesNotMatch(embed.description ?? '', /Other Pick/);
});

test('buildMyPicksEmbeds paginates after 10 picks', () => {
  const embeds = buildMyPicksEmbeds(
    Array.from({ length: 13 }, (_, index) =>
      makeQueriedPick({ id: `mine-${index}`, selection: `Mine ${index}` }),
    ),
  );

  assert.equal(embeds.length, 2);
});

test('/results command joins recent settlements to settled picks and shows P/L', async () => {
  type Payload = { content?: string; embeds?: Array<{ toJSON(): Record<string, unknown> }> };
  const apiClient: ApiClient = {
    get: async <T>() => ({ settlements: [], count: 0 } as T),
    post: async <T>() => ({} as T),
    getRecentSettlements: async () => ({
      count: 1,
      settlements: [
        makeRecentSettlement({ pick_id: 'pick-win', result: 'win' }),
      ],
    }),
    getPicksByStatus: async () => ({
      count: 1,
      picks: [
        makeQueriedPick({
          id: 'pick-win',
          selection: 'Knicks ML',
          market: 'NBA - Moneyline',
          odds: 150,
          stake_units: 1,
          status: 'settled',
        }),
      ],
    }),
  };
  const command = createResultsCommand(apiClient);
  let payload: Payload | null = null;

  await command.execute({
    editReply: async (next: Payload) => {
      payload = next;
    },
  } as never);

  assert.ok(payload);
  const settledPayload = payload as Payload;
  const embed = settledPayload.embeds?.[0]?.toJSON() as { title?: string; description?: string };
  assert.equal(embed.title, 'Recent Results');
  assert.match(embed.description ?? '', /\[WIN\].*Knicks ML.*\+1\.5u/);
});

test('buildResultsEmbeds paginates after 10 settlements', () => {
  const picks = Array.from({ length: 11 }, (_, index) =>
    makeQueriedPick({ id: `pick-${index}`, selection: `Selection ${index}` }),
  );
  const settlements = Array.from({ length: 11 }, (_, index) =>
    makeRecentSettlement({ id: `settlement-${index}`, pick_id: `pick-${index}` }),
  );

  const embeds = buildResultsEmbeds(settlements, picks);

  assert.equal(embeds.length, 2);
});

test('parseBotConfig throws when DISCORD_BOT_TOKEN is missing', () => {
  const env = makeMinimalEnv({ DISCORD_BOT_TOKEN: undefined });
  assert.throws(
    () => parseBotConfig(env),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('DISCORD_BOT_TOKEN'), err.message);
      return true;
    },
  );
});

test('parseBotConfig throws when DISCORD_CLIENT_ID is missing', () => {
  const env = makeMinimalEnv({ DISCORD_CLIENT_ID: undefined });
  assert.throws(
    () => parseBotConfig(env),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('DISCORD_CLIENT_ID'), err.message);
      return true;
    },
  );
});

test('parseBotConfig throws when UNIT_TALK_API_URL is missing', () => {
  const env = makeMinimalEnv({ UNIT_TALK_API_URL: undefined });
  assert.throws(
    () => parseBotConfig(env),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('UNIT_TALK_API_URL'), err.message);
      return true;
    },
  );
});

test('parseBotConfig throws when DISCORD_CAPPER_ROLE_ID is missing', () => {
  const env = makeMinimalEnv({ DISCORD_CAPPER_ROLE_ID: undefined });
  assert.throws(
    () => parseBotConfig(env),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('DISCORD_CAPPER_ROLE_ID'), err.message);
      return true;
    },
  );
});

test('parseBotConfig throws when DISCORD_VIP_ROLE_ID is missing', () => {
  const env = makeMinimalEnv({ DISCORD_VIP_ROLE_ID: undefined });
  assert.throws(
    () => parseBotConfig(env),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('DISCORD_VIP_ROLE_ID'), err.message);
      return true;
    },
  );
});

test('parseBotConfig throws when DISCORD_VIP_PLUS_ROLE_ID is missing', () => {
  const env = makeMinimalEnv({ DISCORD_VIP_PLUS_ROLE_ID: undefined });
  assert.throws(
    () => parseBotConfig(env),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('DISCORD_VIP_PLUS_ROLE_ID'), err.message);
      return true;
    },
  );
});

test('parseBotConfig throws when DISCORD_CAPPER_CHANNEL_ID is missing', () => {
  const env = makeMinimalEnv({ DISCORD_CAPPER_CHANNEL_ID: undefined });
  assert.throws(
    () => parseBotConfig(env),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('DISCORD_CAPPER_CHANNEL_ID'), err.message);
      return true;
    },
  );
});

test('parseBotConfig treats DISCORD_TRIAL_ROLE_ID as optional', () => {
  const env = makeMinimalEnv({ DISCORD_TRIAL_ROLE_ID: undefined });
  const config = parseBotConfig(env);

  assert.equal(config.trialRoleId, null);
});

test('parseBotConfig error message lists all missing vars at once', () => {
  const env = makeMinimalEnv({
    DISCORD_BOT_TOKEN: undefined,
    DISCORD_CLIENT_ID: undefined,
    DISCORD_VIP_ROLE_ID: undefined,
    UNIT_TALK_API_URL: undefined,
  });
  assert.throws(
    () => parseBotConfig(env),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('DISCORD_BOT_TOKEN'), err.message);
      assert.ok(err.message.includes('DISCORD_CLIENT_ID'), err.message);
      assert.ok(err.message.includes('DISCORD_VIP_ROLE_ID'), err.message);
      assert.ok(err.message.includes('UNIT_TALK_API_URL'), err.message);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// tier resolver and trial management command tests
// ---------------------------------------------------------------------------

test('resolveMemberTier returns free when member has no paid roles', () => {
  const context = resolveMemberTier(makeMember(), parseBotConfig(makeMinimalEnv()));

  assert.equal(context.tier, 'free');
  assert.equal(context.isTrial, false);
  assert.equal(context.isVip, false);
  assert.equal(context.isVipPlus, false);
  assert.equal(context.isCapper, false);
});

test('resolveMemberTier returns trial when member holds the trial role', () => {
  const context = resolveMemberTier(makeMember(['role-trial']), parseBotConfig(makeMinimalEnv()));

  assert.equal(context.tier, 'trial');
  assert.equal(context.isTrial, true);
});

test('resolveMemberTier returns vip-plus when member holds the highest active tier role', () => {
  const context = resolveMemberTier(
    makeMember(['role-vip', 'role-vip-plus']),
    parseBotConfig(makeMinimalEnv()),
  );

  assert.equal(context.tier, 'vip-plus');
  assert.equal(context.isVip, true);
  assert.equal(context.isVipPlus, true);
});

test('buildTrialStatusEmbed includes capper guidance when the member is also a contributor', () => {
  const embed = buildTrialStatusEmbed({
    discordUserId: 'user-123',
    tier: 'vip',
    isCapper: true,
    isVip: true,
    isVipPlus: false,
    isTrial: false,
    resolvedAt: '2026-03-28T12:00:00.000Z',
  }).toJSON();

  assert.equal(embed.title, 'Your Unit Talk Access - VIP');
  assert.equal(embed.color, 0x5865f2);
  assert.equal(embed.fields?.[0]?.name, 'Capper Role');
});

test('/trial-status command replies privately with the resolved tier embed', async () => {
  const command = createTrialStatusCommand(parseBotConfig(makeMinimalEnv()));
  const payloads: Array<{ content?: string; embeds?: Array<{ toJSON(): Record<string, unknown> }> }> = [];

  await command.execute({
    member: makeMember(['role-trial']) as unknown as GuildMember,
    editReply: async (payload: { content?: string; embeds?: Array<{ toJSON(): Record<string, unknown> }> }) => {
      payloads.push(payload);
    },
  } as never);

  assert.equal(command.responseVisibility, 'private');
  assert.equal(payloads.length, 1);
  const embed = payloads[0]?.embeds?.[0]?.toJSON() as { title?: string; description?: string };
  assert.equal(embed.title, 'Your Unit Talk Access - Trial');
  assert.match(embed.description ?? '', /trial/i);
});

test('buildUpgradeEmbed shows the free-to-paid path', () => {
  const embed = buildUpgradeEmbed({
    discordUserId: 'user-123',
    tier: 'free',
    isCapper: false,
    isVip: false,
    isVipPlus: false,
    isTrial: false,
    resolvedAt: '2026-03-28T12:00:00.000Z',
  }).toJSON();

  assert.equal(embed.title, 'Upgrade Your Access');
  assert.match(String(embed.description ?? ''), /\*\*VIP\*\*/);
  assert.match(String(embed.description ?? ''), /\*\*VIP\+\*\*/);
});

test('/upgrade command short-circuits when the member is already vip-plus', async () => {
  const command = createUpgradeCommand(parseBotConfig(makeMinimalEnv()));
  const payloads: Array<{ content?: string; embeds?: unknown[] }> = [];

  await command.execute({
    member: makeMember(['role-vip-plus']) as unknown as GuildMember,
    editReply: async (payload: { content?: string; embeds?: unknown[] }) => {
      payloads.push(payload);
    },
  } as never);

  assert.equal(command.responseVisibility, 'private');
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0]?.content, "You're already on our highest active tier.");
  assert.deepEqual(payloads[0]?.embeds, []);
});

// ---------------------------------------------------------------------------
// checkRoles tests
// ---------------------------------------------------------------------------

test('checkRoles returns true when member holds one of the required roles', () => {
  const interaction = {
    member: { roles: { cache: { has: (id: string) => id === 'role-capper' } } },
  } as unknown as ChatInputCommandInteraction;

  assert.equal(checkRoles(interaction, ['role-capper', 'role-operator']), true);
});

test('checkRoles returns false when member holds none of the required roles', () => {
  const interaction = {
    member: { roles: { cache: { has: () => false } } },
  } as unknown as ChatInputCommandInteraction;

  assert.equal(checkRoles(interaction, ['role-admin']), false);
});

test('checkRoles returns true when requiredRoles is empty (no restriction)', () => {
  const interaction = {
    member: { roles: { cache: { has: () => false } } },
  } as unknown as ChatInputCommandInteraction;

  assert.equal(checkRoles(interaction, []), true);
});

test('checkRoles returns false when member is null', () => {
  const interaction = {
    member: null,
  } as unknown as ChatInputCommandInteraction;

  assert.equal(checkRoles(interaction, ['role-x']), false);
});

test('checkRoles returns false when member lacks roles.cache', () => {
  // APIInteractionGuildMember shape - roles is a string array, no .cache
  const interaction = {
    member: { roles: ['role-a', 'role-b'] },
  } as unknown as ChatInputCommandInteraction;

  assert.equal(checkRoles(interaction, ['role-a']), false);
});

// ---------------------------------------------------------------------------
// loadCommandRegistry tests
// ---------------------------------------------------------------------------

test('loadCommandRegistry loads the pick command from the commands directory', async () => {
  await withEnvVars(
    makeRegistryEnv(),
    async () => {
      const registry = await loadCommandRegistry();
      assert.equal(registry.has('pick'), true);
      assert.ok(registry.get('pick'));
    },
  );
});

test('loadCommandRegistry also loads the stats command from the commands directory', async () => {
  await withEnvVars(
    makeRegistryEnv(),
    async () => {
      const registry = await loadCommandRegistry();
      const command = registry.get('stats');
      assert.ok(command);
      assert.equal(command?.data.name, 'stats');
      assert.equal(command?.data.toJSON().options?.length, 3);
    },
  );
});

test('loadCommandRegistry also loads the leaderboard command from the commands directory', async () => {
  await withEnvVars(
    makeRegistryEnv(),
    async () => {
      const registry = await loadCommandRegistry();
      const command = registry.get('leaderboard');
      assert.ok(command);
      assert.equal(command?.data.name, 'leaderboard');
      assert.equal(command?.requiredRoles, undefined);
      assert.equal(command?.responseVisibility, 'public');
      assert.equal(command?.data.toJSON().options?.length, 3);
    },
  );
});

test('loadCommandRegistry also loads the recap command from the commands directory', async () => {
  await withEnvVars(
    makeRegistryEnv(),
    async () => {
      const registry = await loadCommandRegistry();
      const command = registry.get('recap');
      assert.ok(command);
      assert.equal(command?.data.name, 'recap');
      assert.equal(command?.responseVisibility, 'private');
      assert.equal(command?.data.toJSON().options?.length, 1);
    },
  );
});

test('/stats embed omits CLV fields when picksWithClv is zero', () => {
  const embed = buildStatsEmbed({
    ...makeStatsResponse(),
    picksWithClv: 0,
    avgClvPct: null,
    beatsLine: null,
  }).toJSON();

  assert.equal(embed.fields?.some((field) => field.name === 'Avg CLV%'), false);
  assert.equal(embed.fields?.some((field) => field.name === 'Beats Line'), false);
});

test('/stats command calls the operator endpoint with the requested filters', async () => {
  let requestedPath = '';
  const apiClient: ApiClient = {
    async get<T>(path: string) {
      requestedPath = path;
      return { ok: true, data: makeStatsResponse() } as T;
    },
    async post<T>() {
      return {} as T;
    },
  };

  const command = createStatsCommand(apiClient);
  const edited: Array<{ embeds?: unknown[]; content?: string }> = [];

  await command.execute({
    options: {
      getUser(name: string) {
        return name === 'capper'
          ? { username: 'griff843', globalName: 'Griff' }
          : null;
      },
      getMember() {
        return { displayName: 'Griff' };
      },
      getInteger(name: string) {
        return name === 'window' ? 30 : null;
      },
      getString(name: string) {
        return name === 'sport' ? 'NBA' : null;
      },
    },
    editReply: async (payload: { embeds?: unknown[]; content?: string }) => {
      edited.push(payload);
    },
  } as never);

  assert.equal(requestedPath, '/api/operator/stats?last=30&capper=Griff&sport=NBA');
  assert.equal(edited.length, 1);
  assert.ok(Array.isArray(edited[0]?.embeds));
});

test('/recap command calls the operator recap endpoint and renders settled picks', async () => {
  let requestedPath = '';
  const apiClient: ApiClient = {
    async get<T>(path: string) {
      requestedPath = path;
      return { ok: true, data: makeRecapResponse() } as T;
    },
    async post<T>() {
      return {} as T;
    },
  };

  const command = createRecapCommand(apiClient);
  const edited: Array<{ embeds?: Array<{ toJSON(): Record<string, unknown> }>; content?: string }> =
    [];

  await command.execute({
    options: {
      getInteger(name: string) {
        return name === 'limit' ? 2 : null;
      },
    },
    member: {
      displayName: 'Griff Display',
    },
    user: {
      username: 'griff843',
    },
    editReply: async (payload: {
      embeds?: Array<{ toJSON(): Record<string, unknown> }>;
      content?: string;
    }) => {
      edited.push(payload);
    },
  } as never);

  assert.equal(
    requestedPath,
    '/api/operator/capper-recap?submittedBy=Griff+Display&limit=2',
  );
  assert.equal(edited.length, 1);
  assert.equal(edited[0]?.content, '');
  const embed = edited[0]?.embeds?.[0]?.toJSON() as {
    title?: string;
    fields?: Array<{ value?: unknown }>;
  };
  assert.equal(embed?.title, 'Griff Display · Last 2 Settled Picks');
  assert.equal(embed?.fields?.length, 2);
  assert.match(String(embed?.fields?.[0]?.value ?? ''), /CLV: \+3\.8%/);
  assert.match(String(embed?.fields?.[0]?.value ?? ''), /Stake: 1\.5u/);
});

test('/recap command returns an empty-state message when no settled picks exist', async () => {
  const apiClient: ApiClient = {
    async get<T>() {
      return {
        ok: true,
        data: {
          submittedBy: 'Griff Display',
          picks: [],
        },
      } as T;
    },
    async post<T>() {
      return {} as T;
    },
  };

  const command = createRecapCommand(apiClient);
  const edited: Array<{ embeds?: unknown[]; content?: string }> = [];

  await command.execute({
    options: {
      getInteger() {
        return null;
      },
    },
    member: {
      displayName: 'Griff Display',
    },
    user: {
      username: 'griff843',
    },
    editReply: async (payload: { embeds?: unknown[]; content?: string }) => {
      edited.push(payload);
    },
  } as never);

  assert.equal(edited.length, 1);
  assert.equal(edited[0]?.content, 'No settled picks found.');
  assert.deepEqual(edited[0]?.embeds, []);
});

test('buildCapperRecapEmbed renders CLV and stake details in the recap fields', () => {
  const embed = buildCapperRecapEmbed(makeRecapResponse()).toJSON() as {
    title?: string;
    fields?: Array<{ value?: unknown }>;
  };

  assert.equal(embed.title, 'Griff Display · Last 2 Settled Picks');
  assert.equal(embed.fields?.length, 2);
  assert.match(String(embed.fields?.[0]?.value ?? ''), /CLV: \+3\.8%/);
  assert.match(String(embed.fields?.[0]?.value ?? ''), /Stake: 1\.5u/);
});

test('/leaderboard command registers the expected public options', () => {
  const apiClient: ApiClient = {
    get: async <T>() => ({ ok: true, data: makeLeaderboardResponse() } as T),
    post: async <T>() => ({} as T),
  };

  const command = createLeaderboardCommand(apiClient);
  const commandJson = command.data.toJSON();

  assert.equal(command.data.name, 'leaderboard');
  assert.equal(command.requiredRoles, undefined);
  assert.equal(command.responseVisibility, 'public');
  assert.deepEqual(
    commandJson.options?.map((option) => option.name),
    ['window', 'sport', 'limit'],
  );
});

test('/leaderboard embed renders rank, record, roi, and streak format', () => {
  const embed = buildLeaderboardEmbed(makeLeaderboardResponse()).toJSON();

  assert.equal(embed.color, 0xffd700);
  assert.match(embed.title ?? '', /Leaderboard/);
  assert.equal(embed.fields?.[0]?.name, '#1 Griff');
  assert.equal(embed.fields?.[0]?.value, '4–1–0  80.0%  +60.0% ROI  🔥5');
  assert.equal(embed.fields?.[1]?.name, '#2 Casey');
  assert.equal(embed.fields?.[1]?.value, '2–2–0  50.0%  0.0% ROI  🧊2');
  assert.match(embed.footer?.text ?? '', /Min 3 settled picks/);
});

test('recap embed renders win result, units, and CLV fields', () => {
  const embed = buildRecapEmbedData({
    market: 'points-all-game-ou',
    selection: 'Over 24.5',
    result: 'win',
    stakeUnits: 1,
    profitLossUnits: 1,
    clvPercent: 3.8,
    submittedBy: 'griff843',
  });

  assert.equal(embed.title, 'Pick Recap');
  assert.equal(embed.color, 0x22c55e);
  assert.deepEqual(
    embed.fields?.map((field) => [field.name, field.value]),
    [
      ['Market', 'points-all-game-ou'],
      ['Selection', 'Over 24.5'],
      ['Result', 'Win'],
      ['P/L', '+1.0u'],
      ['CLV% (vs SGO close)', '+3.8%'],
      ['Capper', 'griff843'],
      ['Stake', '1.0u'],
    ],
  );
});

// ---------------------------------------------------------------------------
// createInteractionHandler (router) tests
// ---------------------------------------------------------------------------

test('router ignores non-chat-input interactions silently', async () => {
  const registry = makeRegistry([]);
  const handler = createInteractionHandler(registry);
  const mock = makeMockInteraction({ isChatInputCommand: false });

  await handler(mock.interaction);

  assert.equal(mock.replies.length, 0, 'no reply for non-chat-input');
});

test('router replies with unknown-command when command not in registry', async () => {
  const registry = makeRegistry([]);
  const handler = createInteractionHandler(registry);
  const mock = makeMockInteraction({ commandName: 'nonexistent' });

  await handler(mock.interaction);

  assert.equal(mock.replies.length, 1);
  assert.equal(mock.replies[0], 'Unknown command.');
  assert.equal(mock.deferred, false, 'must not defer for unknown command');
});

test('router replies access-denied when role guard fails', async () => {
  const fakeCommand: CommandHandler = {
    data: { name: 'restricted', toJSON: () => ({}) } as unknown as import('discord.js').SlashCommandBuilder,
    execute: async () => { throw new Error('must not be called'); },
    requiredRoles: ['role-operator'],
  };
  const registry = makeRegistry([fakeCommand]);
  const handler = createInteractionHandler(registry);
  const mock = makeMockInteraction({
    commandName: 'restricted',
    roles: { heldRoles: [] }, // holds no roles
  });

  await handler(mock.interaction);

  assert.equal(mock.replies[0], "You don't have access to this command.");
  assert.equal(mock.deferred, false, 'must not defer when role guard fails');
});

test('router calls deferReply before execute (ack-within-3s discipline)', async () => {
  let executeCalled = false;
  let deferCalledFirst = false;

  const mock = {
    commandName: 'probe',
    isChatInputCommand: () => true,
    member: { roles: { cache: { has: () => true } } },
    reply: async () => {},
    deferReply: async () => { deferCalledFirst = !executeCalled; },
    editReply: async () => {},
  } as unknown as Interaction;

  const fakeCommand: CommandHandler = {
    data: { name: 'probe', toJSON: () => ({}) } as unknown as import('discord.js').SlashCommandBuilder,
    execute: async () => { executeCalled = true; },
  };
  const registry = makeRegistry([fakeCommand]);
  const handler = createInteractionHandler(registry);

  await handler(mock);

  assert.equal(deferCalledFirst, true, 'deferReply must be called before execute');
  assert.equal(executeCalled, true, 'execute must be called');
});

test('router calls deferReply and passes interaction to execute when command found and roles pass', async () => {
  let receivedInteraction: unknown = null;
  const fakeCommand: CommandHandler = {
    data: { name: 'hello', toJSON: () => ({}) } as unknown as import('discord.js').SlashCommandBuilder,
    execute: async (interaction) => { receivedInteraction = interaction; },
    requiredRoles: ['role-user'],
  };
  const registry = makeRegistry([fakeCommand]);
  const handler = createInteractionHandler(registry);
  const mock = makeMockInteraction({
    commandName: 'hello',
    roles: { heldRoles: ['role-user'] },
  });

  await handler(mock.interaction);

  assert.equal(mock.deferred, true, 'deferReply must be called');
  assert.deepEqual(mock.deferredOptions[0], { ephemeral: true });
  assert.ok(receivedInteraction !== null, 'execute must receive the interaction');
});

test('router makes leaderboard replies public when command visibility is public', async () => {
  const fakeCommand: CommandHandler = {
    data: { name: 'leaderboard', toJSON: () => ({}) } as unknown as import('discord.js').SlashCommandBuilder,
    responseVisibility: 'public',
    execute: async () => {},
  };
  const registry = makeRegistry([fakeCommand]);
  const handler = createInteractionHandler(registry);
  const mock = makeMockInteraction({ commandName: 'leaderboard', roles: null });

  await handler(mock.interaction);

  assert.equal(mock.deferred, true);
  assert.deepEqual(mock.deferredOptions[0], { ephemeral: false });
});

test('router catches execute errors and edits reply with generic message', async () => {
  const errors: unknown[] = [];
  const logger = { error: (_msg: string, err?: unknown) => { errors.push(err); } };

  const fakeCommand: CommandHandler = {
    data: { name: 'boom', toJSON: () => ({}) } as unknown as import('discord.js').SlashCommandBuilder,
    execute: async () => { throw new Error('kaboom'); },
  };
  const registry = makeRegistry([fakeCommand]);
  const handler = createInteractionHandler(registry, logger);

  const edited: string[] = [];
  const mock = {
    commandName: 'boom',
    isChatInputCommand: () => true,
    member: null,
    reply: async () => {},
    deferReply: async () => {},
    editReply: async (opts: { content: string }) => { edited.push(opts.content); },
  } as unknown as Interaction;

  await handler(mock);

  assert.equal(edited.length, 1, 'editReply must be called once');
  assert.ok(
    edited[0]?.includes('unexpected error'),
    'generic error message must mention unexpected error',
  );
  assert.equal(errors.length, 1, 'error must be logged');
  assert.ok(errors[0] instanceof Error);
});

test('router dispatches to correct handler when multiple commands registered', async () => {
  const called: string[] = [];
  const makeCmd = (name: string): CommandHandler => ({
    data: { name, toJSON: () => ({}) } as unknown as import('discord.js').SlashCommandBuilder,
    execute: async () => { called.push(name); },
  });
  const registry = makeRegistry([makeCmd('alpha'), makeCmd('beta'), makeCmd('gamma')]);
  const handler = createInteractionHandler(registry);

  for (const name of ['beta', 'gamma', 'alpha']) {
    const m = {
      commandName: name,
      isChatInputCommand: () => true,
      member: null,
      reply: async () => {},
      deferReply: async () => {},
      editReply: async () => {},
    } as unknown as Interaction;
    await handler(m);
  }

  assert.deepEqual(called, ['beta', 'gamma', 'alpha']);
});

// ---------------------------------------------------------------------------
// /pick command tests
// ---------------------------------------------------------------------------

test('/pick command registers the required option contract and private visibility', () => {
  const apiClient: ApiClient = {
    get: async <T>() => ({} as T),
    post: async <T>() => ({
      ok: true as const,
      data: {
        submissionId: 'sub-1',
        pickId: 'pick-1',
        lifecycleState: 'validated',
        promotionStatus: 'suppressed',
        promotionTarget: null,
        outboxEnqueued: false,
      },
    } as T),
  };

  const command = createPickCommand(apiClient, 'role-capper');
  const commandJson = command.data.toJSON();

  assert.equal(command.data.name, 'pick');
  assert.deepEqual(command.requiredRoles, ['role-capper']);
  assert.equal(command.responseVisibility, 'private');
  assert.deepEqual(
    commandJson.options?.map((option) => ({
      name: option.name,
      required: option.required,
    })),
    [
      { name: 'market', required: true },
      { name: 'selection', required: true },
      { name: 'odds', required: true },
      { name: 'stake_units', required: true },
      { name: 'event_name', required: false },
      { name: 'confidence', required: false },
      { name: 'event_start_time', required: false },
      { name: 'edge_percent', required: false },
      { name: 'clv_trend', required: false },
    ],
  );
});

test('parsePickSubmission maps slash command values into the canonical submission payload', () => {
  const mock = makePickInteraction({
    market: 'NBA - Player Prop',
    event_name: 'Lakers vs Celtics',
    selection: 'LeBron James Points O 27.5',
    odds: -110,
    stake_units: 2,
    confidence: 0.78,
    event_start_time: '2026-03-28T18:15:00.000Z',
    edge_percent: 2.3,
    clv_trend: 'improving',
  });

  const payload = parsePickSubmission(mock.interaction);

  assert.deepEqual(payload, {
    source: 'discord-bot',
    submittedBy: 'griff843',
    market: 'NBA - Player Prop',
    selection: 'LeBron James Points O 27.5',
    odds: -110,
    stakeUnits: 2,
    confidence: 0.78,
    eventName: 'Lakers vs Celtics',
    metadata: {
      eventStartTime: '2026-03-28T18:15:00.000Z',
      edgePercent: 2.3,
      clvTrend: 'improving',
    },
  });
});

test('parsePickSubmission rejects invalid odds', () => {
  const mock = makePickInteraction({
    market: 'NBA - Moneyline',
    selection: 'Knicks',
    odds: -99,
    stake_units: 1,
  });

  assert.throws(
    () => parsePickSubmission(mock.interaction),
    /odds must be an American odds integer/,
  );
});

test('parsePickSubmission rejects non-positive stake units', () => {
  const mock = makePickInteraction({
    market: 'NBA - Spread',
    selection: 'Knicks -3.5',
    odds: -110,
    stake_units: 0,
  });

  assert.throws(
    () => parsePickSubmission(mock.interaction),
    /stake_units must be a positive number/,
  );
});

test('parsePickSubmission omits eventName when not supplied', () => {
  const mock = makePickInteraction({
    market: 'NBA - Total',
    selection: 'Over 228.5',
    odds: -108,
    stake_units: 1.25,
  });

  const payload = parsePickSubmission(mock.interaction);

  assert.equal(payload.eventName, undefined);
});

test('/pick command posts to /api/submissions and replies with a success embed', async () => {
  let capturedPath = '';
  let capturedBody: unknown;
  const apiClient: ApiClient = {
    get: async <T>() => ({} as T),
    post: async <T>(path: string, body: unknown) => {
      capturedPath = path;
      capturedBody = body;
      return {
        ok: true as const,
        data: {
          submissionId: 'sub-123',
          pickId: 'pick-456',
        },
      } as T;
    },
  };
  const command = createPickCommand(apiClient, 'role-capper');
  const mock = makePickInteraction({
    market: 'NFL - Moneyline',
    event_name: 'Bills vs Chiefs',
    selection: 'Bills',
    odds: 140,
    stake_units: 1.5,
  });

  await command.execute(mock.interaction);

  assert.equal(capturedPath, '/api/submissions');
  assert.deepEqual(capturedBody, {
    source: 'discord-bot',
    submittedBy: 'griff843',
    market: 'NFL - Moneyline',
    selection: 'Bills',
    odds: 140,
    stakeUnits: 1.5,
    eventName: 'Bills vs Chiefs',
  });
  assert.equal(mock.editedPayloads.length, 1);
  assert.equal(mock.editedPayloads[0]?.content, '');
  const embed = (mock.editedPayloads[0]?.embeds?.[0] as { toJSON(): Record<string, unknown> }).toJSON();
  assert.equal(embed.title, 'Pick Submitted');
  assert.deepEqual(
    embed.fields,
    [
      { name: 'Submission ID', value: 'sub-123', inline: false },
      { name: 'Pick ID', value: 'pick-456', inline: false },
      { name: 'Market', value: 'NFL - Moneyline', inline: false },
      { name: 'Selection', value: 'Bills', inline: false },
    ],
  );
});

test('/pick command surfaces API validation failures back to the user', async () => {
  const apiClient: ApiClient = {
    get: async <T>() => ({} as T),
    post: async <T>() => {
      throw new ApiClientError(
        'bad request',
        400,
        JSON.stringify({
          ok: false,
          error: {
            message: 'selection is required',
          },
        }),
      );
      return {} as T;
    },
  };
  const command = createPickCommand(apiClient, 'role-capper');
  const mock = makePickInteraction({
    market: 'NFL - Moneyline',
    selection: 'Bills',
    odds: 140,
    stake_units: 1.5,
  });

  await command.execute(mock.interaction);

  assert.equal(mock.edited[0], 'Pick submission failed: selection is required');
});

test('/pick command returns service unavailable when the API cannot be reached', async () => {
  const apiClient: ApiClient = {
    get: async <T>() => ({} as T),
    post: async <T>() => {
      throw new ApiClientError('network failed');
      return {} as T;
    },
  };
  const command = createPickCommand(apiClient, 'role-capper');
  const mock = makePickInteraction({
    market: 'NFL - Moneyline',
    selection: 'Bills',
    odds: 140,
    stake_units: 1.5,
  });

  await command.execute(mock.interaction);

  assert.equal(mock.edited[0], 'Service temporarily unavailable - try again shortly.');
});

test('buildPickUrgencyDisplay formats countdown, closing soon, and locked states', () => {
  const standard = buildPickUrgencyDisplay(
    '2026-03-28T18:15:00.000Z',
    new Date('2026-03-28T16:00:00.000Z'),
  );
  const closingSoon = buildPickUrgencyDisplay(
    '2026-03-28T16:20:00.000Z',
    new Date('2026-03-28T16:00:00.000Z'),
  );
  const locked = buildPickUrgencyDisplay(
    '2026-03-28T15:55:00.000Z',
    new Date('2026-03-28T16:00:00.000Z'),
  );

  assert.equal(standard?.countdownLabel, 'Starts in 2h 15m');
  assert.equal(standard?.statusLabel, 'Live window open');
  assert.equal(closingSoon?.statusLabel, '⚡ Closing soon');
  assert.equal(locked?.statusLabel, '🔒 Locked');
});

test('buildBettorIntelligenceFields uses bettor-safe labels and avoids internal jargon', () => {
  const fields = buildBettorIntelligenceFields({
    confidence: 0.82,
    metadata: {
      edgePercent: 2.3,
      clvTrend: 'improving',
    },
  });

  assert.deepEqual(
    fields.map((field) => field.name),
    ['Market Edge', 'Confidence', 'Track Record'],
  );
  assert.match(fields[0]?.value ?? '', /2\.3% edge vs market/);
  assert.ok(fields.every((field) => !field.value.includes('promotionScores')));
});

test('/pick command includes urgency and bettor-safe intelligence context when optional metadata is supplied', async () => {
  const apiClient: ApiClient = {
    get: async <T>() => ({} as T),
    post: async <T>() =>
      ({
        ok: true as const,
        data: {
          submissionId: 'sub-1',
          pickId: 'pick-1',
        },
      } as T),
  };
  const command = createPickCommand(apiClient, 'role-capper');
  const mock = makePickInteraction({
    market: 'NFL - Spread',
    selection: 'Bills -3.5',
    odds: -110,
    stake_units: 1.5,
    confidence: 0.82,
    event_start_time: '2099-03-28T18:15:00.000Z',
    edge_percent: 2.3,
    clv_trend: 'improving',
  });

  await command.execute(mock.interaction);

  const embed = mock.editedPayloads[0]?.embeds?.[0] as { toJSON(): Record<string, unknown> };
  const json = embed.toJSON() as { fields?: Array<{ name?: string; value?: string }> };
  const fields = new Map((json.fields ?? []).map((field) => [field.name, field.value] as const));

  assert.match(String(fields.get('Game Time') ?? ''), /2099-03-28 18:15 UTC/);
  assert.match(String(fields.get('Timing') ?? ''), /Starts in/);
  assert.equal(fields.get('Market Edge'), '+2.3% edge vs market');
  assert.equal(fields.get('Confidence'), 'High conviction');
  assert.equal(fields.get('Track Record'), 'Beating the close lately');
});

// ---------------------------------------------------------------------------
// createApiClient tests
// ---------------------------------------------------------------------------

test('createApiClient.get constructs correct URL and returns JSON', async () => {
  let capturedUrl = '';
  const mockFetch = async (url: string | URL | Request) => {
    capturedUrl = String(url);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const client = createApiClient('http://localhost:4000', mockFetch as typeof fetch);
  const result = await client.get<{ ok: boolean }>('/health');

  assert.equal(capturedUrl, 'http://localhost:4000/health');
  assert.equal(result.ok, true);
});

test('createApiClient.get strips trailing slash from base URL', async () => {
  let capturedUrl = '';
  const mockFetch = async (url: string | URL | Request) => {
    capturedUrl = String(url);
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const client = createApiClient('http://localhost:4000/', mockFetch as typeof fetch);
  await client.get('/api/health');

  assert.equal(capturedUrl, 'http://localhost:4000/api/health');
});

test('createApiClient.post sends POST with JSON body', async () => {
  let capturedMethod = '';
  let capturedBody = '';
  const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
    capturedMethod = init?.method ?? '';
    capturedBody = String(init?.body ?? '');
    return new Response(JSON.stringify({ id: 'abc' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const client = createApiClient('http://localhost:4000', mockFetch as typeof fetch);
  const result = await client.post<{ id: string }>('/api/submissions', { market: 'NBA points' });

  assert.equal(capturedMethod, 'POST');
  assert.deepEqual(JSON.parse(capturedBody), { market: 'NBA points' });
  assert.equal(result.id, 'abc');
});

test('createApiClient.get throws on non-200 response', async () => {
  const mockFetch = async () => {
    return new Response('Not found', { status: 404 });
  };

  const client = createApiClient('http://localhost:4000', mockFetch as typeof fetch);

  await assert.rejects(
    () => client.get('/api/missing'),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('404'), err.message);
      return true;
    },
  );
});

test('createApiClient.post throws on non-200 response', async () => {
  const mockFetch = async () => {
    return new Response('Bad request', { status: 400 });
  };

  const client = createApiClient('http://localhost:4000', mockFetch as typeof fetch);

  await assert.rejects(
    () => client.post('/api/submissions', {}),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('400'), err.message);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// /help command tests
// ---------------------------------------------------------------------------

test('/help command registers with name "help" and no role gate or public visibility', () => {
  const command = createHelpCommand();

  assert.equal(command.data.name, 'help');
  assert.equal(command.requiredRoles, undefined);
  // responseVisibility omitted → router treats it as private/ephemeral
  assert.notEqual(command.responseVisibility, 'public');
});

test('/help command execute calls editReply with a single embed containing all command names', async () => {
  const command = createHelpCommand();

  let repliedWith: unknown = null;
  const mockInteraction = {
    isChatInputCommand: () => true,
    commandName: 'help',
    deferReply: async () => {},
    editReply: async (payload: unknown) => { repliedWith = payload; },
  } as unknown as ChatInputCommandInteraction;

  await command.execute(mockInteraction);

  assert.ok(repliedWith !== null, 'editReply was not called');
  const payload = repliedWith as { embeds: Array<{ toJSON(): { description?: string } }> };
  assert.ok(Array.isArray(payload.embeds), 'embeds must be an array');
  assert.equal(payload.embeds.length, 1, 'exactly one embed expected');

  const description = payload.embeds[0]?.toJSON().description ?? '';
  for (const name of ['alerts-setup', 'heat-signal', 'live', 'today', 'my-picks', 'results', 'pick', 'stats', 'leaderboard', 'trial-status', 'upgrade', 'help', 'recap']) {
    assert.ok(description.includes(`/${name}`), `embed description missing /${name}`);
  }
});

test('/heat-signal command renders an embed for mixed-tier detections', async () => {
  type HeatSignalPayload = {
    content?: string;
    embeds?: Array<{ toJSON(): Record<string, unknown> }>;
  };
  const apiClient: ApiClient = {
    async get<T>() {
      return {} as T;
    },
    async post<T>() {
      return {} as T;
    },
    async getRecentAlerts() {
      return {
        total: 2,
        detections: [
          {
            id: 'd1',
            eventId: 'e1',
            marketKey: 'spreads/nfl',
            bookmakerKey: 'fanduel',
            marketType: 'spread' as const,
            direction: 'down' as const,
            tier: 'alert-worthy' as const,
            oldLine: -3,
            newLine: -5.5,
            lineChange: -2.5,
            lineChangeAbs: 2.5,
            velocity: 0.25,
            timeElapsedMinutes: 10,
            currentSnapshotAt: '2026-03-28T12:10:00.000Z',
            notified: true,
            cooldownExpiresAt: null,
          },
          {
            id: 'd2',
            eventId: 'e2',
            marketKey: 'totals/nba',
            bookmakerKey: 'draftkings',
            marketType: 'total' as const,
            direction: 'up' as const,
            tier: 'notable' as const,
            oldLine: 224.5,
            newLine: 226,
            lineChange: 1.5,
            lineChangeAbs: 1.5,
            velocity: 0.05,
            timeElapsedMinutes: 30,
            currentSnapshotAt: '2026-03-28T12:05:00.000Z',
            notified: false,
            cooldownExpiresAt: null,
          },
        ],
      };
    },
  };
  const command = createHeatSignalCommand(apiClient);
  let payload: HeatSignalPayload | null = null;

  await command.execute({
    options: {
      getInteger(name: string) {
        return name === 'count' ? 2 : null;
      },
    },
    editReply: async (next: HeatSignalPayload) => {
      payload = next;
    },
  } as never);

  assert.ok(payload);
  const settledPayload = payload as HeatSignalPayload;
  assert.equal(settledPayload.content, '');
  const embed = settledPayload.embeds?.[0]?.toJSON() as {
    title?: string;
    description?: string;
  };
  assert.equal(embed.title, 'Heat Signal - Top 2 Line Movements');
  assert.match(embed.description ?? '', /\[ALERT\].*spreads\/nfl/);
  assert.match(embed.description ?? '', /\[NOTE\].*totals\/nba/);
});

test('/heat-signal command returns empty-state copy when no detections exist', async () => {
  type EmptyHeatSignalPayload = {
    content?: string;
    embeds?: unknown[];
  };
  const apiClient: ApiClient = {
    get: async <T>() => ({} as T),
    post: async <T>() => ({} as T),
    getRecentAlerts: async () => ({ detections: [], total: 0 }),
  };
  const command = createHeatSignalCommand(apiClient);
  let payload: EmptyHeatSignalPayload | null = null;

  await command.execute({
    options: {
      getInteger() {
        return null;
      },
    },
    editReply: async (next: EmptyHeatSignalPayload) => {
      payload = next;
    },
  } as never);

  assert.ok(payload);
  const emptyPayload = payload as EmptyHeatSignalPayload;
  assert.equal(emptyPayload.content, 'No notable line movements detected in the current window.');
});

test('/alerts-setup command requires operator role and registers private visibility', () => {
  const apiClient: ApiClient = {
    get: async <T>() => ({} as T),
    post: async <T>() => ({} as T),
    getAlertStatus: async () => ({
      enabled: true,
      dryRun: true,
      minTier: 'notable',
      lookbackMinutes: 60,
      last1h: { notable: 0, alertWorthy: 0, notified: 0 },
      lastDetectedAt: null,
    }),
  };

  const command = createAlertsSetupCommand(apiClient, ['role-operator']);

  assert.equal(command.data.name, 'alerts-setup');
  assert.deepEqual(command.requiredRoles, ['role-operator']);
  assert.equal(command.responseVisibility, 'private');
});

test('buildAlertsSetupEmbed renders current status fields', () => {
  const embed = buildAlertsSetupEmbed({
    enabled: true,
    dryRun: false,
    minTier: 'alert-worthy',
    lookbackMinutes: 90,
    last1h: {
      notable: 4,
      alertWorthy: 2,
      notified: 1,
    },
    lastDetectedAt: '2026-03-28T12:10:00.000Z',
  }).toJSON();

  assert.equal(embed.title, 'Alert Agent Status');
  assert.equal(embed.fields?.[0]?.name, 'Agent');
  assert.equal(embed.fields?.[0]?.value, 'Enabled');
  assert.equal(embed.fields?.[1]?.value, 'LIVE');
  assert.equal(embed.fields?.[7]?.value, '2026-03-28T12:10:00.000Z');
});

test('loadCommandRegistry also loads the help command from the commands directory', async () => {
  await withEnvVars(
    makeRegistryEnv({
      DISCORD_CLIENT_ID: '123',
      DISCORD_GUILD_ID: 'g123',
      DISCORD_CAPPER_ROLE_ID: 'r123',
    }),
    async () => {
      const registry = await loadCommandRegistry();
      const command = registry.get('help');
      assert.ok(command, 'help command not found in registry');
      assert.equal(command?.data.name, 'help');
      assert.notEqual(command?.responseVisibility, 'public');
    },
  );
});

// ---------------------------------------------------------------------------
// capper-onboarding-handler tests
// ---------------------------------------------------------------------------

test('buildCapperWelcomeEmbed renders correct title, color, and all four fields', () => {
  const embed = buildCapperWelcomeEmbed('Griff').toJSON() as {
    title?: string;
    color?: number;
    description?: string;
    fields?: Array<{ name: string; value: string }>;
    footer?: { text: string };
  };

  assert.equal(embed.title, '👋 Welcome to Unit Talk Cappers — Griff');
  assert.equal(embed.color, 0x5865f2);
  assert.ok(embed.description?.includes("You've been added as a Unit Talk Capper"));
  assert.equal(embed.fields?.length, 4);
  assert.equal(embed.fields?.[0]?.name, 'Submit a pick');
  assert.equal(embed.fields?.[1]?.name, 'Your stats');
  assert.equal(embed.fields?.[2]?.name, 'Your recap');
  assert.equal(embed.fields?.[3]?.name, 'Questions');
  assert.ok(embed.footer?.text.startsWith('Unit Talk · Capper Onboarding'));
});

test('createCapperOnboardingHandler: capper role added → posts welcome embed to channel', async () => {
  const sent: Array<{ embeds: unknown[] }> = [];
  const mockChannel = {
    isTextBased: () => true,
    send: async (payload: { embeds: unknown[] }) => { sent.push(payload); },
  };
  const mockClient = {
    channels: {
      cache: { get: () => mockChannel },
      fetch: async () => mockChannel,
    },
  };

  const config = { capperRoleId: 'role-capper', capperChannelId: 'channel-capper' };
  const handler = createCapperOnboardingHandler(
    config,
    mockClient as never,
  );

  const oldMember = { roles: { cache: { keys: () => [].values() } }, displayName: 'Griff' };
  const newMember = {
    roles: { cache: { keys: () => ['role-capper'].values() } },
    displayName: 'Griff',
    user: { username: 'griff843' },
  };

  await handler(oldMember as never, newMember as never);

  assert.equal(sent.length, 1);
  assert.equal((sent[0]?.embeds ?? []).length, 1);
});

test('createCapperOnboardingHandler: non-capper role change → no-op, no channel fetch', async () => {
  let channelFetched = false;
  const mockClient = {
    channels: {
      cache: { get: () => { channelFetched = true; return undefined; } },
      fetch: async () => { channelFetched = true; return null; },
    },
  };

  const config = { capperRoleId: 'role-capper', capperChannelId: 'channel-capper' };
  const handler = createCapperOnboardingHandler(config, mockClient as never);

  const oldMember = { roles: { cache: { keys: () => [].values() } } };
  const newMember = {
    roles: { cache: { keys: () => ['role-other'].values() } },
    displayName: 'Griff',
    user: { username: 'griff843' },
  };

  await handler(oldMember as never, newMember as never);

  assert.equal(channelFetched, false, 'channel should not be fetched for non-capper role change');
});

test('createCapperOnboardingHandler: channel fetch throws → swallowed, does not propagate', async () => {
  const mockClient = {
    channels: {
      cache: { get: () => undefined },
      fetch: async () => { throw new Error('channel not found'); },
    },
  };

  const config = { capperRoleId: 'role-capper', capperChannelId: 'channel-capper' };
  const handler = createCapperOnboardingHandler(config, mockClient as never);

  const oldMember = { roles: { cache: { keys: () => [].values() } } };
  const newMember = {
    roles: { cache: { keys: () => ['role-capper'].values() } },
    displayName: 'Griff',
    user: { username: 'griff843' },
  };

  // Must not throw — handler swallows all errors
  await assert.doesNotReject(async () => handler(oldMember as never, newMember as never));
});

// ---------------------------------------------------------------------------
// ApiClient.syncMemberTier tests
// ---------------------------------------------------------------------------

test('createApiClient.syncMemberTier calls POST /api/member-tiers with correct body', async () => {
  let capturedUrl: string | undefined;
  let capturedBody: unknown;

  const mockFetch: typeof fetch = async (input, init) => {
    capturedUrl = typeof input === 'string' ? input : (input as URL).toString();
    capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
    return new Response(JSON.stringify({ ok: true, tier: 'vip', action: 'activate' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const client = createApiClient('http://localhost:4000', mockFetch);
  await client.syncMemberTier?.({
    discord_id: 'user-123',
    tier: 'vip',
    action: 'activate',
    source: 'discord-role',
  });

  assert.equal(capturedUrl, 'http://localhost:4000/api/member-tiers');
  assert.deepEqual(capturedBody, {
    discord_id: 'user-123',
    tier: 'vip',
    action: 'activate',
    source: 'discord-role',
  });
});

test('createApiClient.syncMemberTier swallows errors and does not throw', async () => {
  const mockFetch: typeof fetch = async () => {
    return new Response('{"error":"server error"}', {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const client = createApiClient('http://localhost:4000', mockFetch);
  await assert.doesNotReject(async () => {
    await client.syncMemberTier?.({
      discord_id: 'user-123',
      tier: 'vip',
      action: 'activate',
      source: 'discord-role',
    });
  });
});

// ---------------------------------------------------------------------------
// createMemberTierSyncHandler tests
// ---------------------------------------------------------------------------

test('createMemberTierSyncHandler activates tier when a tier-relevant role is added', async () => {
  const synced: Array<{ discord_id: string; tier: string; action: string }> = [];
  const mockApiClient: ApiClient = {
    get: async () => ({}) as never,
    post: async () => ({}) as never,
    syncMemberTier: async (params) => {
      synced.push({ discord_id: params.discord_id, tier: params.tier, action: params.action });
    },
  };

  const config = parseBotConfig(makeMinimalEnv());
  const handler = createMemberTierSyncHandler(config, mockApiClient);

  const oldMember = { id: 'user-999', roles: { cache: { keys: () => [].values() } } };
  const newMember = {
    id: 'user-999',
    roles: { cache: { keys: () => ['role-vip'].values() } },
  };

  await handler(oldMember as never, newMember as never);

  assert.equal(synced.length, 1);
  assert.equal(synced[0]?.discord_id, 'user-999');
  assert.equal(synced[0]?.tier, 'vip');
  assert.equal(synced[0]?.action, 'activate');
});

test('createMemberTierSyncHandler deactivates tier when a tier-relevant role is removed', async () => {
  const synced: Array<{ discord_id: string; tier: string; action: string }> = [];
  const mockApiClient: ApiClient = {
    get: async () => ({}) as never,
    post: async () => ({}) as never,
    syncMemberTier: async (params) => {
      synced.push({ discord_id: params.discord_id, tier: params.tier, action: params.action });
    },
  };

  const config = parseBotConfig(makeMinimalEnv());
  const handler = createMemberTierSyncHandler(config, mockApiClient);

  const oldMember = { id: 'user-888', roles: { cache: { keys: () => ['role-vip-plus'].values() } } };
  const newMember = {
    id: 'user-888',
    roles: { cache: { keys: () => [].values() } },
  };

  await handler(oldMember as never, newMember as never);

  assert.equal(synced.length, 1);
  assert.equal(synced[0]?.discord_id, 'user-888');
  assert.equal(synced[0]?.tier, 'vip-plus');
  assert.equal(synced[0]?.action, 'deactivate');
});

test('createMemberTierSyncHandler ignores roles not in the tier map', async () => {
  const synced: Array<unknown> = [];
  const mockApiClient: ApiClient = {
    get: async () => ({}) as never,
    post: async () => ({}) as never,
    syncMemberTier: async (params) => {
      synced.push(params);
    },
  };

  const config = parseBotConfig(makeMinimalEnv());
  const handler = createMemberTierSyncHandler(config, mockApiClient);

  const oldMember = { id: 'user-777', roles: { cache: { keys: () => [].values() } } };
  const newMember = {
    id: 'user-777',
    roles: { cache: { keys: () => ['role-unknown-xyz', 'role-other'].values() } },
  };

  await handler(oldMember as never, newMember as never);

  assert.equal(synced.length, 0, 'No syncs for unrecognized roles');
});

test('createMemberTierSyncHandler swallows errors from apiClient.syncMemberTier', async () => {
  const mockApiClient: ApiClient = {
    get: async () => ({}) as never,
    post: async () => ({}) as never,
    syncMemberTier: async () => {
      throw new Error('network failure');
    },
  };

  const config = parseBotConfig(makeMinimalEnv());
  const handler = createMemberTierSyncHandler(config, mockApiClient);

  const oldMember = { id: 'user-555', roles: { cache: { keys: () => [].values() } } };
  const newMember = {
    id: 'user-555',
    roles: { cache: { keys: () => ['role-vip'].values() } },
  };

  // Must not throw — handler swallows all errors
  await assert.doesNotReject(async () => handler(oldMember as never, newMember as never));
});
