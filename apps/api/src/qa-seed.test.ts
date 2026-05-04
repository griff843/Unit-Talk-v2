import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { createApiServer } from './server.js';
import { createInMemoryRepositoryBundle } from './persistence.js';

function makeQaMapFile(): { dir: string; mapPath: string; channelId: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'utv2-828-qa-map-'));
  const mapPath = path.join(dir, 'discord-qa-map.json');
  const channelId = '1500843115144151222';
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
        qaPickDelivery: channelId,
        freePicks: 'free-picks',
        vipPicks: 'vip-picks',
        vipPlusPicks: 'vip-plus-picks',
        adminOps: 'admin-ops',
        recap: 'recap',
      },
    }),
    'utf8',
  );

  return { dir, mapPath, channelId };
}

async function withServer<T>(
  fn: (baseUrl: string, repositories: ReturnType<typeof createInMemoryRepositoryBundle>) => Promise<T>,
): Promise<T> {
  const repositories = createInMemoryRepositoryBundle();
  const server = createApiServer({ repositories });
  server.listen(0);
  await once(server, 'listening');
  const address = server.address() as AddressInfo;

  try {
    return await fn(`http://127.0.0.1:${address.port}`, repositories);
  } finally {
    server.close();
  }
}

async function withQaSeedEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('POST /api/qa/seed-pick returns 501 when QA seed is disabled', async () => {
  const { dir, mapPath } = makeQaMapFile();

  try {
    await withQaSeedEnv(
      {
        UNIT_TALK_QA_SEED_ENABLED: 'false',
        NODE_ENV: 'development',
        DISCORD_QA_CHANNEL_MAP: mapPath,
      },
      async () => {
        await withServer(async (baseUrl) => {
          const response = await fetch(`${baseUrl}/api/qa/seed-pick`, { method: 'POST' });
          const body = (await response.json()) as { error: string };

          assert.equal(response.status, 501);
          assert.deepEqual(body, { error: 'QA seed not enabled' });
        });
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/qa/seed-pick returns 403 in production', async () => {
  const { dir, mapPath } = makeQaMapFile();

  try {
    await withQaSeedEnv(
      {
        UNIT_TALK_QA_SEED_ENABLED: 'true',
        NODE_ENV: 'production',
        DISCORD_QA_CHANNEL_MAP: mapPath,
      },
      async () => {
        await withServer(async (baseUrl) => {
          const response = await fetch(`${baseUrl}/api/qa/seed-pick`, { method: 'POST' });
          const body = (await response.json()) as { error: string };

          assert.equal(response.status, 403);
          assert.deepEqual(body, { error: 'QA seed forbidden in production' });
        });
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/qa/seed-pick returns the seed response shape and enqueues sandbox-only outbox work', async () => {
  const { dir, mapPath, channelId } = makeQaMapFile();

  try {
    await withQaSeedEnv(
      {
        UNIT_TALK_QA_SEED_ENABLED: 'true',
        NODE_ENV: 'development',
        DISCORD_QA_CHANNEL_MAP: mapPath,
      },
      async () => {
        await withServer(async (baseUrl, repositories) => {
          const response = await fetch(`${baseUrl}/api/qa/seed-pick`, { method: 'POST' });
          const body = (await response.json()) as {
            pickId: string;
            outboxId: string;
            channelId: string;
          };

          assert.equal(response.status, 200);
          assert.ok(body.pickId);
          assert.ok(body.outboxId);
          assert.equal(body.channelId, channelId);

          const pick = await repositories.picks.findPickById(body.pickId);
          const [outbox] = await repositories.outbox.listByPickId(body.pickId);
          assert.ok(pick, 'expected seeded pick to exist');
          assert.equal(pick?.status, 'queued');
          assert.ok(outbox, 'expected seeded outbox row to exist');
          assert.equal(outbox.target, 'discord:qa-pick-delivery');
          assert.equal(outbox.status, 'pending');
        });
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /api/qa/pick-status/:id returns the pick and outbox status shape', async () => {
  const { dir, mapPath } = makeQaMapFile();

  try {
    await withQaSeedEnv(
      {
        UNIT_TALK_QA_SEED_ENABLED: 'true',
        NODE_ENV: 'development',
        DISCORD_QA_CHANNEL_MAP: mapPath,
      },
      async () => {
        await withServer(async (baseUrl) => {
          const seedResponse = await fetch(`${baseUrl}/api/qa/seed-pick`, { method: 'POST' });
          const seeded = (await seedResponse.json()) as { pickId: string; outboxId: string };

          const response = await fetch(`${baseUrl}/api/qa/pick-status/${seeded.pickId}`);
          const body = (await response.json()) as {
            pickId: string;
            status: string;
            outboxId: string;
            outboxStatus: string;
          };

          assert.equal(response.status, 200);
          assert.equal(body.pickId, seeded.pickId);
          assert.equal(body.status, 'queued');
          assert.equal(body.outboxId, seeded.outboxId);
          assert.equal(body.outboxStatus, 'pending');
        });
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
