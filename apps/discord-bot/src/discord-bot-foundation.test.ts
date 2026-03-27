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
import { ApiClientError, createApiClient, type ApiClient } from './api-client.js';
import type { ChatInputCommandInteraction, Interaction } from 'discord.js';
import type { CommandHandler, CommandRegistry } from './command-registry.js';
import { createPickCommand, parsePickSubmission } from './commands/pick.js';
import { buildStatsEmbed, createStatsCommand, type CapperStatsResponse } from './commands/stats.js';
import {
  buildLeaderboardEmbed,
  createLeaderboardCommand,
  type LeaderboardResponse,
} from './commands/leaderboard.js';
import { createHelpCommand } from './commands/help.js';

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
    UNIT_TALK_API_URL: 'http://localhost:4000',
    ...overrides,
  } as AppEnv;
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
  const interaction = {
    options: makeCommandOptions(values),
    user: {
      username: 'griff843',
      globalName: 'Griff',
    },
    member: {
      displayName: 'Griff Display',
    },
    editReply: async ({ content }: { content: string }) => {
      edited.push(content);
    },
  };

  return {
    interaction: interaction as unknown as ChatInputCommandInteraction,
    edited,
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
  assert.equal(config.apiUrl, 'http://localhost:4000');
  assert.equal(config.appEnv, 'local');
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

test('parseBotConfig error message lists all missing vars at once', () => {
  const env = makeMinimalEnv({
    DISCORD_BOT_TOKEN: undefined,
    DISCORD_CLIENT_ID: undefined,
    UNIT_TALK_API_URL: undefined,
  });
  assert.throws(
    () => parseBotConfig(env),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('DISCORD_BOT_TOKEN'), err.message);
      assert.ok(err.message.includes('DISCORD_CLIENT_ID'), err.message);
      assert.ok(err.message.includes('UNIT_TALK_API_URL'), err.message);
      return true;
    },
  );
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
    {
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
      UNIT_TALK_API_URL: 'http://localhost:4000',
    },
    async () => {
      const registry = await loadCommandRegistry();
      assert.equal(registry.has('pick'), true);
      assert.ok(registry.get('pick'));
    },
  );
});

test('loadCommandRegistry also loads the stats command from the commands directory', async () => {
  await withEnvVars(
    {
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
      UNIT_TALK_API_URL: 'http://localhost:4000',
    },
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
    {
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
      UNIT_TALK_API_URL: 'http://localhost:4000',
    },
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

test('/pick command registers the expected name and capper role gate', () => {
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

  assert.equal(command.data.name, 'pick');
  assert.deepEqual(command.requiredRoles, ['role-capper']);
});

test('parsePickSubmission maps slash command values into the canonical submission payload', () => {
  const mock = makePickInteraction({
    sport: 'NBA',
    market_type: 'player-prop',
    event_name: 'Lakers vs Celtics',
    selection: 'LeBron James Points O 27.5',
    odds: -110,
    units: 2,
    conviction: 8,
    line: 27.5,
    sportsbook: 'draftkings',
  });

  const payload = parsePickSubmission(mock.interaction);

  assert.deepEqual(payload, {
    source: 'discord-bot',
    submittedBy: 'Griff Display',
    market: 'NBA - Player Prop',
    selection: 'LeBron James Points O 27.5',
    line: 27.5,
    odds: -110,
    stakeUnits: 2,
    eventName: 'Lakers vs Celtics',
    metadata: {
      ticketType: 'single',
      sport: 'NBA',
      marketType: 'player-prop',
      capper: 'Griff Display',
      sportsbook: 'draftkings',
      eventName: 'Lakers vs Celtics',
      promotionScores: {
        trust: 80,
      },
    },
  });
});

test('parsePickSubmission rejects invalid odds', () => {
  const mock = makePickInteraction({
    sport: 'NBA',
    market_type: 'moneyline',
    event_name: 'Knicks vs Heat',
    selection: 'Knicks',
    odds: -99,
    units: 1,
    conviction: 6,
  });

  assert.throws(
    () => parsePickSubmission(mock.interaction),
    /odds must be an American odds integer/,
  );
});

test('parsePickSubmission rejects units outside the authorized range', () => {
  const mock = makePickInteraction({
    sport: 'NBA',
    market_type: 'spread',
    event_name: 'Knicks vs Heat',
    selection: 'Knicks -3.5',
    odds: -110,
    units: 5.5,
    conviction: 6,
  });

  assert.throws(
    () => parsePickSubmission(mock.interaction),
    /units must be between 0.5 and 5.0/,
  );
});

test('/pick command posts to /api/submissions and formats the success reply', async () => {
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
          lifecycleState: 'validated',
          promotionStatus: 'suppressed',
          promotionTarget: null,
          outboxEnqueued: false,
        },
      } as T;
    },
  };
  const command = createPickCommand(apiClient, 'role-capper');
  const mock = makePickInteraction({
    sport: 'NFL',
    market_type: 'moneyline',
    event_name: 'Bills vs Chiefs',
    selection: 'Bills',
    odds: 140,
    units: 1.5,
    conviction: 9,
    sportsbook: 'circa',
  });

  await command.execute(mock.interaction);

  assert.equal(capturedPath, '/api/submissions');
  assert.deepEqual(capturedBody, {
    source: 'discord-bot',
    submittedBy: 'Griff Display',
    market: 'NFL - Moneyline',
    selection: 'Bills',
    line: undefined,
    odds: 140,
    stakeUnits: 1.5,
    eventName: 'Bills vs Chiefs',
    metadata: {
      ticketType: 'single',
      sport: 'NFL',
      marketType: 'moneyline',
      capper: 'Griff Display',
      sportsbook: 'circa',
      eventName: 'Bills vs Chiefs',
      promotionScores: {
        trust: 90,
      },
    },
  });
  assert.match(mock.edited[0] ?? '', /Pick submitted\./);
  assert.match(mock.edited[0] ?? '', /Submission ID: sub-123/);
  assert.match(mock.edited[0] ?? '', /Pick ID: pick-456/);
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
            code: 'BAD_REQUEST',
            message: 'selection is required',
          },
        }),
      );
      return {} as T;
    },
  };
  const command = createPickCommand(apiClient, 'role-capper');
  const mock = makePickInteraction({
    sport: 'NFL',
    market_type: 'moneyline',
    event_name: 'Bills vs Chiefs',
    selection: 'Bills',
    odds: 140,
    units: 1.5,
    conviction: 9,
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
    sport: 'NFL',
    market_type: 'moneyline',
    event_name: 'Bills vs Chiefs',
    selection: 'Bills',
    odds: 140,
    units: 1.5,
    conviction: 9,
  });

  await command.execute(mock.interaction);

  assert.equal(mock.edited[0], 'Service temporarily unavailable - try again shortly.');
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
  for (const name of ['pick', 'stats', 'leaderboard', 'help']) {
    assert.ok(description.includes(`/${name}`), `embed description missing /${name}`);
  }
});

test('loadCommandRegistry also loads the help command from the commands directory', async () => {
  await withEnvVars(
    {
      NODE_ENV: 'test',
      UNIT_TALK_APP_ENV: 'local',
      DISCORD_BOT_TOKEN: 'test-token',
      DISCORD_CLIENT_ID: '123',
      DISCORD_GUILD_ID: 'g123',
      DISCORD_CAPPER_ROLE_ID: 'r123',
      UNIT_TALK_API_URL: 'http://localhost:4000',
    },
    async () => {
      const registry = await loadCommandRegistry();
      const command = registry.get('help');
      assert.ok(command, 'help command not found in registry');
      assert.equal(command?.data.name, 'help');
      assert.notEqual(command?.responseVisibility, 'public');
    },
  );
});
