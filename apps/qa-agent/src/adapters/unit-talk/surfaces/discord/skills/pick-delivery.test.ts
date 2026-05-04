import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getPersona } from '../../../../../personas/index.js';
import type { SkillContext } from '../../../../../core/types.js';
import {
  buildPickDeliveryEmbed,
  embedHasRequiredFields,
  pickDeliverySkill,
  pollForDiscordMessage,
} from './pick-delivery.js';

function makeQaMapFile() {
  const dir = mkdtempSync(path.join(tmpdir(), 'utv2-828-pick-delivery-'));
  const mapPath = path.join(dir, 'discord-qa-map.json');
  writeFileSync(
    mapPath,
    JSON.stringify({
      guildId: '1195598141026742343',
      roles: {
        admin: 'admin-role',
        operator: 'operator-role',
        capper: 'capper-role',
        vip: 'vip-role',
        vipPlus: 'vip-plus-role',
        free: 'free-role',
        noAccess: 'no-access-role',
      },
      channels: {
        qaBotLog: 'qa-bot-log',
        qaAccessCheck: 'qa-access-check',
        qaPickDelivery: 'qa-pick-delivery-id',
        freePicks: 'free-picks',
        vipPicks: 'vip-picks',
        vipPlusPicks: 'vip-plus-picks',
        adminOps: 'admin-ops',
        recap: 'recap',
      },
    }),
    'utf8',
  );

  return { dir, mapPath };
}

function baseRoles() {
  const view = '1024';
  return [
    { id: '1195598141026742343', name: '@everyone', permissions: '0' },
    { id: 'admin-role', name: 'QA_Admin', permissions: view },
    { id: 'operator-role', name: 'QA_Operator', permissions: view },
    { id: 'capper-role', name: 'QA_Capper', permissions: view },
    { id: 'vip-role', name: 'QA_VIP', permissions: view },
    { id: 'vip-plus-role', name: 'QA_VIPPlus', permissions: view },
    { id: 'free-role', name: 'QA_Free', permissions: view },
    { id: 'no-access-role', name: 'QA_NoAccess', permissions: view },
  ];
}

function everyoneHidden() {
  return { id: '1195598141026742343', type: 0 as const, allow: '0', deny: '1024' };
}

function allow(roleId: string) {
  return { id: roleId, type: 0 as const, allow: '1024', deny: '0' };
}

function baseChannels() {
  const categoryOverwrites = [
    everyoneHidden(),
    allow('admin-role'),
    allow('operator-role'),
    allow('capper-role'),
    allow('vip-role'),
    allow('vip-plus-role'),
    allow('free-role'),
  ];

  return [
    {
      id: 'qa-sandbox-category',
      type: 4,
      name: 'QA SANDBOX',
      permission_overwrites: categoryOverwrites,
    },
    {
      id: 'qa-pick-delivery-id',
      type: 0,
      name: 'qa-pick-delivery',
      parent_id: 'qa-sandbox-category',
      permission_overwrites: [everyoneHidden(), allow('admin-role'), allow('operator-role'), allow('capper-role'), allow('vip-role'), allow('vip-plus-role')],
    },
    {
      id: 'free-picks',
      type: 0,
      name: 'free-picks',
      parent_id: 'qa-sandbox-category',
      permission_overwrites: categoryOverwrites,
    },
    {
      id: 'vip-picks',
      type: 0,
      name: 'vip-picks',
      parent_id: 'qa-sandbox-category',
      permission_overwrites: [everyoneHidden(), allow('admin-role'), allow('operator-role'), allow('capper-role'), allow('vip-role'), allow('vip-plus-role')],
    },
    {
      id: 'vip-plus-picks',
      type: 0,
      name: 'vip-plus-picks',
      parent_id: 'qa-sandbox-category',
      permission_overwrites: [everyoneHidden(), allow('admin-role'), allow('operator-role'), allow('capper-role'), allow('vip-plus-role')],
    },
    {
      id: 'qa-bot-log',
      type: 0,
      name: 'qa-bot-log',
      parent_id: 'qa-sandbox-category',
      permission_overwrites: [everyoneHidden(), allow('admin-role'), allow('operator-role')],
    },
    {
      id: 'qa-access-check',
      type: 0,
      name: 'qa-access-check',
      parent_id: 'qa-sandbox-category',
      permission_overwrites: categoryOverwrites,
    },
    {
      id: 'admin-ops',
      type: 0,
      name: 'admin-ops',
      parent_id: 'qa-sandbox-category',
      permission_overwrites: [everyoneHidden(), allow('admin-role'), allow('operator-role')],
    },
    {
      id: 'recap',
      type: 0,
      name: 'recap',
      parent_id: 'qa-sandbox-category',
      permission_overwrites: categoryOverwrites,
    },
  ];
}

function makeSkillContext(personaId: string): SkillContext {
  return {
    page: {
      setContent: async () => {},
    } as never,
    persona: getPersona(personaId),
    surface: {
      id: 'discord',
      displayName: 'Discord',
      baseUrls: { local: 'http://localhost', staging: 'http://localhost', production: 'http://localhost' },
    },
    product: {
      id: 'unit-talk',
      displayName: 'Unit Talk',
      surfaces: {},
    },
    mode: 'fast',
    env: 'local',
    runId: 'run-1',
    artifactsDir: 'artifacts',
    log: () => {},
    screenshot: async () => 'screenshot.png',
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function withEnvAndFetch<T>(
  overrides: Record<string, string | undefined>,
  fetchImpl: typeof fetch,
  fn: () => Promise<T>,
): Promise<T> {
  const previousEnv = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previousEnv.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  const previousFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;

  try {
    return await fn();
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of previousEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('buildPickDeliveryEmbed includes the required Discord embed fields', () => {
  const embed = buildPickDeliveryEmbed();

  assert.equal(embed.title, 'QA Test Pick — Over 42.5');
  assert.equal(embed.color, 5793266);
  assert.equal(embedHasRequiredFields(embed), true);
});

test('pollForDiscordMessage fails fast when the embed never appears', async () => {
  const fetchImpl: typeof fetch = async () => jsonResponse([]);

  await withEnvAndFetch({}, fetchImpl, async () => {
    await assert.rejects(
      () => pollForDiscordMessage('qa-token', 'channel-1', 'message-1', 5, 0),
      /did not appear/,
    );
  });
});

test('pickDeliverySkill passes the VIP success path with mocked Discord and QA API clients', async () => {
  const { dir, mapPath } = makeQaMapFile();
  const postedEmbeds: unknown[] = [];

  try {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.endsWith('/guilds/1195598141026742343/roles')) {
        return jsonResponse(baseRoles());
      }
      if (url.endsWith('/guilds/1195598141026742343/channels')) {
        return jsonResponse(baseChannels());
      }
      if (url === 'http://qa.local/api/qa/seed-pick') {
        return jsonResponse({
          pickId: 'pick-1',
          outboxId: 'outbox-1',
          channelId: 'qa-pick-delivery-id',
        });
      }
      if (url.endsWith('/channels/qa-pick-delivery-id/messages') && init?.method === 'POST') {
        postedEmbeds.push(JSON.parse(String(init.body ?? '{}')));
        return jsonResponse({ id: 'message-1', embeds: [buildPickDeliveryEmbed()] });
      }
      if (url.endsWith('/channels/qa-pick-delivery-id/messages')) {
        return jsonResponse([{ id: 'message-1', embeds: [buildPickDeliveryEmbed()] }]);
      }
      if (url === 'http://qa.local/api/qa/pick-status/pick-1') {
        return jsonResponse({
          pickId: 'pick-1',
          status: 'queued',
          outboxId: 'outbox-1',
          outboxStatus: 'pending',
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    await withEnvAndFetch(
      {
        DISCORD_QA_BOT_TOKEN: 'qa-token',
        DISCORD_QA_GUILD_ID: '1195598141026742343',
        DISCORD_QA_ROLE_MAP: mapPath,
        DISCORD_QA_CHANNEL_MAP: mapPath,
        UNIT_TALK_QA_API_URL: 'http://qa.local',
      },
      fetchImpl,
      async () => {
        const result = await pickDeliverySkill.run(makeSkillContext('vip_user'));

        assert.equal(result.status, 'PASS');
        assert.equal(postedEmbeds.length, 1);
        assert.deepEqual(postedEmbeds[0], { embeds: [buildPickDeliveryEmbed()] });
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pickDeliverySkill fails when free access leaks into #vip-picks', async () => {
  const { dir, mapPath } = makeQaMapFile();

  try {
    const leakedChannels = baseChannels().map((channel) =>
      channel.id === 'vip-picks'
        ? {
            ...channel,
            permission_overwrites: [
              everyoneHidden(),
              allow('admin-role'),
              allow('operator-role'),
              allow('capper-role'),
              allow('vip-role'),
              allow('vip-plus-role'),
              allow('free-role'),
            ],
          }
        : channel,
    );

    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/guilds/1195598141026742343/roles')) {
        return jsonResponse(baseRoles());
      }
      if (url.endsWith('/guilds/1195598141026742343/channels')) {
        return jsonResponse(leakedChannels);
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    await withEnvAndFetch(
      {
        DISCORD_QA_BOT_TOKEN: 'qa-token',
        DISCORD_QA_GUILD_ID: '1195598141026742343',
        DISCORD_QA_ROLE_MAP: mapPath,
        DISCORD_QA_CHANNEL_MAP: mapPath,
        UNIT_TALK_QA_API_URL: 'http://qa.local',
      },
      fetchImpl,
      async () => {
        const result = await pickDeliverySkill.run(makeSkillContext('free_user'));
        assert.equal(result.status, 'FAIL');
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pickDeliverySkill fails when QA env is incomplete and does not print secret values', async () => {
  const secret = 'super-secret-token';
  const fetchImpl: typeof fetch = async () => {
    throw new Error('fetch should not run when env is incomplete');
  };

  await withEnvAndFetch(
    {
      DISCORD_QA_BOT_TOKEN: secret,
      DISCORD_QA_GUILD_ID: undefined,
      DISCORD_QA_ROLE_MAP: undefined,
      DISCORD_QA_CHANNEL_MAP: undefined,
      UNIT_TALK_QA_API_URL: undefined,
    },
    fetchImpl,
    async () => {
      const result = await pickDeliverySkill.run(makeSkillContext('vip_user'));
      assert.equal(result.status, 'FAIL');
      assert.equal(JSON.stringify(result).includes(secret), false);
    },
  );
});
