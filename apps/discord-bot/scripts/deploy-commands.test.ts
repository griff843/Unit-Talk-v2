import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Routes } from 'discord.js';
import { buildCommandManifest } from '../src/command-manifest.js';
import { registerGuildCommands } from './deploy-commands.js';

const config = {
  clientId: '1418387196116861049',
  guildId: '1284478946171293736',
};
const route = Routes.applicationGuildCommands(config.clientId, config.guildId);
type Payload = Awaited<ReturnType<typeof buildCommandManifest>>[number];
const payload: Payload[] = [
  { name: 'live', description: 'Posted picks', type: 1, options: [] },
  {
    name: 'today',
    description: 'Today picks',
    type: 1,
    options: [
      {
        name: 'limit',
        description: 'Maximum picks',
        type: 4,
        required: false,
        min_value: 1,
      },
    ],
  },
];

class FakeRest {
  calls: { method: string; route: string; body?: unknown }[] = [];
  applicationId = config.clientId;
  inventory: unknown = [{ name: 'stale' }];
  transform: (body: Payload[]) => unknown = (body) =>
    body.map((command) => ({
      ...command,
      id: 'discord-id',
      version: 'version',
      application_id: config.clientId,
      guild_id: config.guildId,
    }));
  failPut = false;
  failRead = false;
  async get(requestRoute: `/${string}`): Promise<unknown> {
    this.calls.push({ method: 'GET', route: requestRoute });
    if (requestRoute === Routes.oauth2CurrentApplication())
      return { id: this.applicationId };
    assert.equal(requestRoute, route);
    if (this.failRead) throw new Error('Read unavailable');
    return this.inventory;
  }
  async put(
    requestRoute: `/${string}`,
    options: { body: unknown },
  ): Promise<unknown> {
    this.calls.push({ method: 'PUT', route: requestRoute, body: options.body });
    assert.equal(requestRoute, route);
    if (this.failPut) throw new Error('Registration unavailable');
    this.inventory = this.transform(options.body as Payload[]);
    return this.inventory;
  }
}

test('registers full source payload once, removes stale commands, and verifies only configured guild', async () => {
  const rest = new FakeRest();
  const result = await registerGuildCommands(rest, config, payload);
  assert.deepEqual(result, {
    applicationId: config.clientId,
    guildId: config.guildId,
    count: 2,
    commands: ['live', 'today'],
  });
  assert.deepEqual(rest.calls, [
    { method: 'GET', route: Routes.oauth2CurrentApplication() },
    { method: 'PUT', route, body: payload },
    { method: 'GET', route },
  ]);
  await registerGuildCommands(rest, config, payload);
  assert.equal(
    (rest.inventory as unknown[]).length,
    2,
    'repeat registration remains idempotent',
  );
});

test('wrong application token is refused before any command replacement', async () => {
  const rest = new FakeRest();
  rest.applicationId = 'wrong-application';
  await assert.rejects(
    registerGuildCommands(rest, config, payload),
    /Token application/,
  );
  assert.equal(rest.calls.length, 1);
});

test('empty source manifest cannot wipe the guild registry', async () => {
  const rest = new FakeRest();
  await assert.rejects(registerGuildCommands(rest, config, []), /empty/);
  assert.equal(rest.calls.length, 0);
});

test('PUT and read-back failures reject instead of claiming verified registration', async () => {
  const rest = new FakeRest();
  rest.failPut = true;
  await assert.rejects(
    registerGuildCommands(rest, config, payload),
    /Registration unavailable/,
  );
  rest.failPut = false;
  rest.failRead = true;
  await assert.rejects(
    registerGuildCommands(rest, config, payload),
    /Read unavailable/,
  );
});

test('read-back rejects missing, stale, duplicate, foreign, and altered command definitions', async () => {
  for (const mutate of [
    (rows: Record<string, unknown>[]) => rows.slice(1),
    (rows: Record<string, unknown>[]) => [
      ...rows,
      { ...rows[0], name: 'stale' },
    ],
    (rows: Record<string, unknown>[]) => [rows[0], rows[0]],
    (rows: Record<string, unknown>[]) =>
      rows.map((row) => ({ ...row, application_id: 'foreign' })),
    (rows: Record<string, unknown>[]) =>
      rows.map((row) => ({ ...row, guild_id: 'foreign' })),
    (rows: Record<string, unknown>[]) =>
      rows.map((row) => ({ ...row, description: 'drift' })),
    (rows: Record<string, unknown>[]) =>
      rows.map((row) => ({ ...row, options: [] })),
  ]) {
    const rest = new FakeRest();
    const normal = rest.transform;
    rest.transform = (body) =>
      mutate(normal(body) as Record<string, unknown>[]);
    await assert.rejects(
      registerGuildCommands(rest, config, payload),
      /inventory/,
    );
  }
});

test('Discord omitted default option flags and empty option lists do not invent drift', async () => {
  const rest = new FakeRest();
  const normal = rest.transform;
  rest.transform = (body) =>
    (normal(body) as Record<string, unknown>[]).map((row) => {
      if (row.name === 'live') delete row.options;
      else
        row.options = [
          {
            name: 'limit',
            description: 'Maximum picks',
            type: 4,
            min_value: 1,
          },
        ];
      return row;
    });
  assert.equal((await registerGuildCommands(rest, config, payload)).count, 2);
});

test('authoritative source manifest equals checked-in definitions and retains live/today', async () => {
  const defaults = {
    DISCORD_BOT_TOKEN: 'test-token',
    DISCORD_CLIENT_ID: config.clientId,
    DISCORD_GUILD_ID: config.guildId,
    DISCORD_CAPPER_ROLE_ID: 'test-capper',
    DISCORD_VIP_ROLE_ID: 'test-vip',
    DISCORD_VIP_PLUS_ROLE_ID: 'test-vip-plus',
    DISCORD_CAPPER_CHANNEL_ID: 'test-channel',
    UNIT_TALK_API_URL: 'http://127.0.0.1:4000',
  };
  const previous = Object.fromEntries(
    Object.keys(defaults).map((key) => [key, process.env[key]]),
  );
  try {
    Object.assign(process.env, defaults);
    const manifest = await buildCommandManifest(process.cwd());
    assert.deepEqual(
      JSON.parse(JSON.stringify(manifest)),
      JSON.parse(
        readFileSync('apps/discord-bot/command-manifest.json', 'utf8'),
      ),
    );
    assert.ok(manifest.some((command) => command.name === 'live'));
    assert.ok(manifest.some((command) => command.name === 'today'));
    const rest = new FakeRest();
    const result = await registerGuildCommands(rest, config, manifest);
    assert.equal(result.count, manifest.length);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('CLI error path never logs raw REST errors and never registers on module import', () => {
  const source = readFileSync(
    'apps/discord-bot/scripts/deploy-commands.ts',
    'utf8',
  );
  assert.match(source, /import\.meta\.url === pathToFileURL/);
  assert.match(source, /deployCommands\(\)\.catch\(\(\) =>/);
  assert.doesNotMatch(
    source,
    /console\.(?:log|error)\([^\n]*(?:err|config\.token)/,
  );
  assert.match(source, /process\.exitCode = 1/);
});
