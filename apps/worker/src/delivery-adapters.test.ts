import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { OutboxRecord } from '@unit-talk/db';
import { createDiscordDeliveryAdapter } from './delivery-adapters.js';

interface CapturedRequest {
  url: string;
  method: string | undefined;
  body: string;
}

test('createDiscordDeliveryAdapter routes game-thread target to mapped event thread', async () => {
  const outbox = createOutboxRecord('discord:game-threads');
  let capturedRequest: CapturedRequest | null = null;
  const adapter = createDiscordDeliveryAdapter({
    dryRun: false,
    botToken: 'test-bot-token',
    targetMap: {
      'discord:game-threads': '111111111111111111',
    },
    gameThreadMap: {
      'Lakers vs Celtics': '222222222222222222',
    },
    fetchImpl: async (url, init) => {
      capturedRequest = captureRequest(url, init);
      return jsonResponse({ id: 'thread-message-1' });
    },
  });

  const result = await adapter(outbox);
  const request = requireCapturedRequest(capturedRequest);

  assert.equal(request.url, 'https://discord.com/api/v10/channels/222222222222222222/messages');
  assert.equal(request.method, 'POST');
  assert.equal(result.status, 'sent');
  assert.equal(result.channel, 'discord:game-threads');
  assert.equal(result.externalId, 'thread-message-1');
  assert.deepEqual(readPayloadRoute(result.payload), {
    route: 'game-thread',
    channelId: '222222222222222222',
    parentChannelId: '111111111111111111',
    eventKey: 'Lakers vs Celtics',
    fallback: false,
  });
});

test('createDiscordDeliveryAdapter falls back to game-thread channel when event thread is missing', async () => {
  const outbox = createOutboxRecord('discord:game-threads');
  let capturedRequest: CapturedRequest | null = null;
  const adapter = createDiscordDeliveryAdapter({
    dryRun: false,
    botToken: 'test-bot-token',
    targetMap: {
      'discord:game-threads': '111111111111111111',
    },
    gameThreadMap: {},
    fetchImpl: async (url, init) => {
      capturedRequest = captureRequest(url, init);
      return jsonResponse({ id: 'fallback-message-1' });
    },
  });

  const result = await adapter(outbox);
  const request = requireCapturedRequest(capturedRequest);

  assert.equal(request.url, 'https://discord.com/api/v10/channels/111111111111111111/messages');
  assert.equal(result.status, 'sent');
  assert.equal(result.externalId, 'fallback-message-1');
  assert.deepEqual(readPayloadRoute(result.payload), {
    route: 'game-thread-fallback',
    channelId: '111111111111111111',
    eventKey: 'Lakers vs Celtics',
    fallback: true,
  });
});

test('createDiscordDeliveryAdapter routes strategy-room target through a Discord DM channel', async () => {
  const outbox = createOutboxRecord('discord:strategy-room');
  const capturedRequests: CapturedRequest[] = [];
  const adapter = createDiscordDeliveryAdapter({
    dryRun: false,
    botToken: 'test-bot-token',
    strategyRoomRecipientMap: {
      'discord:strategy-room': '333333333333333333',
    },
    fetchImpl: async (url, init) => {
      capturedRequests.push(captureRequest(url, init));
      if (capturedRequests.length === 1) {
        return jsonResponse({ id: '444444444444444444' });
      }
      return jsonResponse({ id: 'dm-message-1' });
    },
  });

  const result = await adapter(outbox);

  assert.equal(capturedRequests.length, 2);
  assert.equal(capturedRequests[0]?.url, 'https://discord.com/api/v10/users/@me/channels');
  assert.deepEqual(JSON.parse(capturedRequests[0]?.body ?? '{}'), {
    recipient_id: '333333333333333333',
  });
  assert.equal(capturedRequests[1]?.url, 'https://discord.com/api/v10/channels/444444444444444444/messages');
  assert.equal(result.status, 'sent');
  assert.equal(result.channel, 'discord:strategy-room');
  assert.equal(result.externalId, 'dm-message-1');
  assert.deepEqual(readPayloadRoute(result.payload), {
    route: 'strategy-room-dm',
    channelId: '444444444444444444',
    recipientId: '333333333333333333',
  });
});

test('createDiscordDeliveryAdapter reports strategy-room DM setup failure as retryable', async () => {
  const outbox = createOutboxRecord('discord:strategy-room');
  const adapter = createDiscordDeliveryAdapter({
    dryRun: false,
    botToken: 'test-bot-token',
    strategyRoomRecipientMap: {
      'discord:strategy-room': '333333333333333333',
    },
    fetchImpl: async () =>
      new Response(JSON.stringify({ message: 'temporarily unavailable' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
  });

  const result = await adapter(outbox);

  assert.equal(result.status, 'retryable-failure');
  assert.equal(result.channel, 'discord:strategy-room');
  assert.match(result.reason ?? '', /Failed to create Discord DM channel: HTTP 503/);
});

function createOutboxRecord(target: string): OutboxRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    pick_id: randomUUID(),
    target,
    status: 'pending',
    attempt_count: 0,
    next_attempt_at: null,
    last_error: null,
    payload: {
      market: 'Player points',
      selection: 'Over 24.5',
      line: 24.5,
      odds: -110,
      source: 'smart-form',
      lifecycleState: 'queued',
      metadata: {
        sport: 'NBA',
        eventName: 'Lakers vs Celtics',
        capper: 'griff843',
      },
    },
    claimed_at: null,
    claimed_by: null,
    idempotency_key: `${target}:idempotent`,
    created_at: now,
    updated_at: now,
  };
}

function captureRequest(input: Parameters<typeof fetch>[0], init: RequestInit | undefined): CapturedRequest {
  return {
    url: String(input),
    method: init?.method,
    body: String(init?.body ?? ''),
  };
}

function requireCapturedRequest(request: CapturedRequest | null) {
  assert.ok(request, 'expected Discord request to be captured');
  return request;
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function readPayloadRoute(payload: unknown) {
  assert.ok(payload && typeof payload === 'object' && !Array.isArray(payload));
  const record = payload as Record<string, unknown>;
  const route = {
    route: record['route'],
    channelId: record['channelId'],
    parentChannelId: record['parentChannelId'],
    eventKey: record['eventKey'],
    fallback: record['fallback'],
    recipientId: record['recipientId'],
  };

  return Object.fromEntries(
    Object.entries(route).filter(([, value]) => value !== undefined),
  );
}
