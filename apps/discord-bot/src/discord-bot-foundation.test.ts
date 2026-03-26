import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCommandRegistry } from './command-registry.js';
import { buildStatsEmbed, createStatsCommand, type CapperStatsResponse } from './commands/stats.js';
import type { ApiClient } from './api-client.js';

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

test('/stats command is registered in the command registry', async () => {
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
      DISCORD_GUILD_ID: 'guild-1',
      DISCORD_CLIENT_ID: 'client-1',
      OPERATOR_WEB_URL: 'http://localhost:4010',
    },
    async () => {
      const registry = await loadCommandRegistry();
      const command = registry.get('stats');

      assert.ok(command);
      assert.equal(command?.data.name, 'stats');
      const data = command?.data.toJSON();
      assert.equal(data?.options?.length, 3);
    },
  );
});

test('/stats embed renders the expected non-zero layout', () => {
  const embed = buildStatsEmbed(makeStatsResponse()).toJSON();

  assert.equal(embed.title, '📊 @Griff — Last 30 Days (NBA)');
  assert.equal(embed.fields?.[0]?.name, 'Record');
  assert.equal(embed.fields?.[0]?.value, '12-6-1');
  assert.equal(embed.fields?.[1]?.name, 'Win Rate');
  assert.match(embed.fields?.[1]?.value ?? '', /66\.7%/);
  assert.equal(embed.fields?.some((field) => field.name === 'Avg CLV%'), true);
  assert.equal(embed.fields?.some((field) => field.name === 'Last 5'), true);
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

test('/stats command calls the operator-web endpoint with the requested filters', async () => {
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
