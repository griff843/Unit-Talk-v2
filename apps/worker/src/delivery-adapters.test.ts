import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { OutboxRecord } from '@unit-talk/db';
import {
  buildDiscordMessagePayload,
  createDiscordDeliveryAdapter,
} from './delivery-adapters.js';

const PINNED_GUILD_ID = '100000000000000001';
const PINNED_CHANNEL_ID = '100000000000000002';

interface CapturedRequest {
  url: string;
  method: string | undefined;
  body: string;
  headers: Headers;
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

  assert.equal(
    request.url,
    'https://discord.com/api/v10/channels/222222222222222222/messages',
  );
  assert.equal(request.method, 'POST');
  assert.equal(result.status, 'sent');
  // UTV2-1929: the receipt records the channel the message was posted to.
  assert.equal(result.channel, '222222222222222222');
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

  assert.equal(
    request.url,
    'https://discord.com/api/v10/channels/111111111111111111/messages',
  );
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
  assert.equal(
    capturedRequests[0]?.url,
    'https://discord.com/api/v10/users/@me/channels',
  );
  assert.deepEqual(JSON.parse(capturedRequests[0]?.body ?? '{}'), {
    recipient_id: '333333333333333333',
  });
  assert.equal(
    capturedRequests[1]?.url,
    'https://discord.com/api/v10/channels/444444444444444444/messages',
  );
  assert.equal(result.status, 'sent');
  assert.equal(result.channel, '444444444444444444');
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
  assert.match(
    result.reason ?? '',
    /Failed to create Discord DM channel: HTTP 503/,
  );
});

// UTV2-1923: capper-specific destination routing.
function withPinnedDestination(
  outbox: OutboxRecord,
  channelId: string,
): OutboxRecord {
  return {
    ...outbox,
    payload: {
      ...(outbox.payload as Record<string, unknown>),
      deliveryDestination: {
        version: 'capper-discord-routing/v1',
        guildId: PINNED_GUILD_ID,
        channelId,
        capperId: 'griff843',
        source: 'cappers.metadata.discord.picksChannelId',
      },
    },
  };
}

test('UTV2-1923: a pinned destination routes to that capper channel, not the shared map', async () => {
  const outbox = withPinnedDestination(
    createOutboxRecord('discord:official-picks'),
    PINNED_CHANNEL_ID,
  );
  const capturedRequests: CapturedRequest[] = [];
  const adapter = createDiscordDeliveryAdapter({
    dryRun: false,
    botToken: 'test-bot-token',
    // A shared mapping IS present, and must not win.
    targetMap: { 'discord:official-picks': '999999999999999999' },
    fetchImpl: async (url, init) => {
      const request = captureRequest(url, init);
      capturedRequests.push(request);
      if (request.method === 'GET') {
        return publicThreadResponse();
      }
      return jsonResponse({ id: 'capper-message-1' });
    },
  });

  const result = await adapter(outbox);
  assert.equal(capturedRequests.length, 2);
  assert.equal(capturedRequests[0]?.method, 'GET');
  const request = requireCapturedRequest(capturedRequests[1] ?? null);
  assert.equal(
    request.url,
    `https://discord.com/api/v10/channels/${PINNED_CHANNEL_ID}/messages`,
  );
  assert.equal(request.method, 'POST');
  assert.equal(result.status, 'sent');
  assert.deepEqual(
    JSON.parse(request.body),
    JSON.parse(JSON.stringify(buildDiscordMessagePayload(outbox))),
  );
});

test('UTV2-1929: the receipt records the pinned channel, not the logical target', async () => {
  // The receipt is the only durable record of where a pick actually went, and
  // `resolveRecapChannel` in apps/api/src/grading-service.ts resolves the
  // settlement recap from it. Recording `discord:official-picks` here made
  // every human capper delivery unrecapable: that string is not a numeric id,
  // and UTV2-1923 exempts human delivery targets from the shared target map,
  // so neither resolution branch could ever succeed.
  const outbox = withPinnedDestination(
    createOutboxRecord('discord:official-picks'),
    PINNED_CHANNEL_ID,
  );
  const adapter = createDiscordDeliveryAdapter({
    dryRun: false,
    botToken: 'test-bot-token',
    targetMap: { 'discord:official-picks': '999999999999999999' },
    fetchImpl: async (_url, init) =>
      init?.method === 'GET'
        ? publicThreadResponse()
        : jsonResponse({ id: 'capper-message-1' }),
  });

  const result = await adapter(outbox);

  assert.equal(result.status, 'sent');
  assert.equal(result.channel, PINNED_CHANNEL_ID);
  // The logical target is not lost -- it stays on the payload, which is where
  // a reader asking "which delivery lane was this" should look.
  assert.equal(
    (result.payload as Record<string, unknown>)['target'],
    'discord:official-picks',
  );
  // And the idempotency key still keys on the logical target, so this change
  // cannot resend an already-delivered row.
  assert.equal(
    result.idempotencyKey,
    `${outbox.id}:discord:official-picks:receipt`,
  );
});

test('UTV2-1970: an archived locked Official Picks thread is safely reopened, re-read, then posted', async () => {
  const outbox = withPinnedDestination(
    createOutboxRecord('discord:official-picks'),
    PINNED_CHANNEL_ID,
  );
  const requests: CapturedRequest[] = [];
  let channelReads = 0;
  const adapter = createDiscordDeliveryAdapter({
    dryRun: false,
    botToken: 'test-bot-token',
    targetMap: { 'discord:official-picks': '999999999999999999' },
    fetchImpl: async (url, init) => {
      const request = captureRequest(url, init);
      requests.push(request);
      if (request.method === 'GET') {
        channelReads += 1;
        return publicThreadResponse({
          threadMetadata: {
            archived: channelReads === 1,
            locked: true,
          },
        });
      }
      if (request.method === 'PATCH') {
        return jsonResponse({});
      }
      return jsonResponse({ id: 'capper-message-archived' });
    },
  });

  const result = await adapter(outbox);

  assert.equal(result.status, 'sent');
  assert.equal(result.channel, PINNED_CHANNEL_ID);
  assert.deepEqual(
    requests.map((request) => request.method),
    ['GET', 'PATCH', 'GET', 'POST'],
  );
  assert.deepEqual(JSON.parse(requests[1]?.body ?? '{}'), {
    archived: false,
    locked: true,
  });
  const auditReason = requests[1]?.headers.get('X-Audit-Log-Reason') ?? '';
  assert.ok(auditReason.length > 0);
  assert.ok(auditReason.length <= 512);
  assert.match(decodeURIComponent(auditReason), new RegExp(outbox.id, 'u'));
  for (const request of requests) {
    if (!request.body) continue;
    const body = JSON.parse(request.body) as Record<string, unknown>;
    assert.notEqual(
      body['locked'],
      false,
      'no Discord request may send locked=false',
    );
  }
});

test('UTV2-1970: an unlocked Official Picks thread is refused before message POST', async () => {
  const outbox = withPinnedDestination(
    createOutboxRecord('discord:official-picks'),
    PINNED_CHANNEL_ID,
  );
  const requests: CapturedRequest[] = [];
  const adapter = createDiscordDeliveryAdapter({
    dryRun: false,
    botToken: 'test-bot-token',
    targetMap: { 'discord:official-picks': '999999999999999999' },
    fetchImpl: async (url, init) => {
      requests.push(captureRequest(url, init));
      return publicThreadResponse({
        threadMetadata: { archived: false, locked: false },
      });
    },
  });

  const result = await adapter(outbox);

  assert.equal(result.status, 'retryable-failure');
  assert.equal(result.dispatch, 'not-sent');
  assert.match(result.reason ?? '', /is unlocked; refusing delivery/u);
  assert.deepEqual(
    requests.map((request) => request.method),
    ['GET'],
  );
});

for (const malformedCase of [
  {
    name: 'missing thread_metadata',
    response: () => publicThreadResponse({ omitThreadMetadata: true }),
  },
  {
    name: 'non-object thread_metadata',
    response: () => publicThreadResponse({ threadMetadata: 'locked' }),
  },
  {
    name: 'missing archived flag',
    response: () => publicThreadResponse({ threadMetadata: { locked: true } }),
  },
  {
    name: 'non-boolean locked flag',
    response: () =>
      publicThreadResponse({
        threadMetadata: { archived: false, locked: 'true' },
      }),
  },
] as const) {
  test(`UTV2-1970: ${malformedCase.name} is refused before message POST`, async () => {
    const outbox = withPinnedDestination(
      createOutboxRecord('discord:official-picks'),
      PINNED_CHANNEL_ID,
    );
    const methods: Array<string | undefined> = [];
    const adapter = createDiscordDeliveryAdapter({
      dryRun: false,
      botToken: 'test-bot-token',
      targetMap: { 'discord:official-picks': '999999999999999999' },
      fetchImpl: async (_url, init) => {
        methods.push(init?.method);
        return malformedCase.response();
      },
    });

    const result = await adapter(outbox);

    assert.equal(result.dispatch, 'not-sent');
    assert.match(result.reason ?? '', /malformed thread_metadata/u);
    assert.deepEqual(methods, ['GET']);
  });
}

for (const mismatchCase of [
  {
    name: 'channel id',
    response: () => publicThreadResponse({ id: '100000000000000099' }),
    reason: /id mismatch/u,
  },
  {
    name: 'guild id',
    response: () => publicThreadResponse({ guildId: '100000000000000099' }),
    reason: /guild mismatch/u,
  },
  {
    name: 'channel type',
    response: () => publicThreadResponse({ type: 12 }),
    reason: /not a public thread/u,
  },
] as const) {
  test(`UTV2-1970: wrong ${mismatchCase.name} is refused before message POST`, async () => {
    const outbox = withPinnedDestination(
      createOutboxRecord('discord:official-picks'),
      PINNED_CHANNEL_ID,
    );
    const methods: Array<string | undefined> = [];
    const adapter = createDiscordDeliveryAdapter({
      dryRun: false,
      botToken: 'test-bot-token',
      targetMap: { 'discord:official-picks': '999999999999999999' },
      fetchImpl: async (_url, init) => {
        methods.push(init?.method);
        return mismatchCase.response();
      },
    });

    const result = await adapter(outbox);

    assert.equal(result.dispatch, 'not-sent');
    assert.match(result.reason ?? '', mismatchCase.reason);
    assert.deepEqual(methods, ['GET']);
  });
}

for (const failureCase of [
  { name: 'initial GET failure', failureCall: 1, expectedMethods: ['GET'] },
  {
    name: 'PATCH failure',
    failureCall: 2,
    expectedMethods: ['GET', 'PATCH'],
  },
  {
    name: 're-read failure',
    failureCall: 3,
    expectedMethods: ['GET', 'PATCH', 'GET'],
  },
] as const) {
  test(`UTV2-1970: ${failureCase.name} remains not-sent`, async () => {
    const outbox = withPinnedDestination(
      createOutboxRecord('discord:official-picks'),
      PINNED_CHANNEL_ID,
    );
    const methods: Array<string | undefined> = [];
    const adapter = createDiscordDeliveryAdapter({
      dryRun: false,
      botToken: 'test-bot-token',
      targetMap: { 'discord:official-picks': '999999999999999999' },
      fetchImpl: async (_url, init) => {
        methods.push(init?.method);
        if (methods.length === failureCase.failureCall) {
          return new Response('unavailable', { status: 503 });
        }
        if (init?.method === 'GET') {
          return publicThreadResponse({
            threadMetadata: { archived: methods.length === 1, locked: true },
          });
        }
        return jsonResponse({});
      },
    });

    const result = await adapter(outbox);

    assert.equal(result.dispatch, 'not-sent');
    assert.match(result.reason ?? '', /HTTP 503/u);
    assert.deepEqual(methods, failureCase.expectedMethods);
    assert.equal(methods.includes('POST'), false);
  });
}

for (const timeoutCase of [
  { name: 'initial GET timeout', timeoutCall: 1, expectedMethods: ['GET'] },
  {
    name: 'PATCH timeout',
    timeoutCall: 2,
    expectedMethods: ['GET', 'PATCH'],
  },
  {
    name: 're-read timeout',
    timeoutCall: 3,
    expectedMethods: ['GET', 'PATCH', 'GET'],
  },
] as const) {
  test(`UTV2-1970: ${timeoutCase.name} remains not-sent`, async () => {
    const outbox = withPinnedDestination(
      createOutboxRecord('discord:official-picks'),
      PINNED_CHANNEL_ID,
    );
    const methods: Array<string | undefined> = [];
    const adapter = createDiscordDeliveryAdapter({
      dryRun: false,
      botToken: 'test-bot-token',
      targetMap: { 'discord:official-picks': '999999999999999999' },
      fetchTimeoutMs: 5,
      fetchImpl: async (_url, init) => {
        methods.push(init?.method);
        if (methods.length === timeoutCase.timeoutCall) {
          return await rejectWhenAborted(init?.signal);
        }
        if (init?.method === 'GET') {
          return publicThreadResponse({
            threadMetadata: { archived: methods.length === 1, locked: true },
          });
        }
        return jsonResponse({});
      },
    });

    const result = await adapter(outbox);

    assert.equal(result.dispatch, 'not-sent');
    assert.match(result.reason ?? '', /timed out after 5ms/u);
    assert.deepEqual(methods, timeoutCase.expectedMethods);
    assert.equal(methods.includes('POST'), false);
  });
}

test('UTV2-1970: an archived thread that re-reads unlocked is refused before message POST', async () => {
  const outbox = withPinnedDestination(
    createOutboxRecord('discord:official-picks'),
    PINNED_CHANNEL_ID,
  );
  const methods: Array<string | undefined> = [];
  let reads = 0;
  const adapter = createDiscordDeliveryAdapter({
    dryRun: false,
    botToken: 'test-bot-token',
    targetMap: { 'discord:official-picks': '999999999999999999' },
    fetchImpl: async (_url, init) => {
      methods.push(init?.method);
      if (init?.method === 'GET') {
        reads += 1;
        return publicThreadResponse({
          threadMetadata: {
            archived: reads === 1,
            locked: reads === 1,
          },
        });
      }
      return jsonResponse({});
    },
  });

  const result = await adapter(outbox);

  assert.equal(result.dispatch, 'not-sent');
  assert.match(result.reason ?? '', /is unlocked; refusing delivery/u);
  assert.deepEqual(methods, ['GET', 'PATCH', 'GET']);
});

test('UTV2-1923: human delivery with no pinned destination refuses rather than falling back', async () => {
  // The shared mapping is present and resolvable. Before capper-specific
  // routing this delivered; now it must refuse, because delivering here would
  // send this capper's pick to a channel that is not theirs.
  const outbox = createOutboxRecord('discord:official-picks');
  const adapter = createDiscordDeliveryAdapter({
    dryRun: false,
    botToken: 'test-bot-token',
    targetMap: { 'discord:official-picks': '999999999999999999' },
    fetchImpl: async () => {
      throw new Error('no HTTP call must be made');
    },
  });

  const result = await adapter(outbox);
  // The adapter classifies every thrown error as retryable, so the row stays in
  // the outbox and retries rather than being discarded. What matters for this
  // assertion is that it was NOT delivered anywhere: `fetchImpl` throws if it
  // is ever called, so a `sent` result is unreachable.
  assert.notEqual(result.status, 'sent');
  assert.match(JSON.stringify(result), /no pinned destination/u);
});

test('UTV2-1923: a malformed pin is not a destination', async () => {
  const base = createOutboxRecord('discord:official-picks');
  const outbox: OutboxRecord = {
    ...base,
    payload: {
      ...(base.payload as Record<string, unknown>),
      // A channel NAME where an id belongs.
      deliveryDestination: {
        version: 'capper-discord-routing/v1',
        guildId: '100000000000000001',
        channelId: '#griff-official-picks',
        capperId: 'griff843',
        source: 'cappers.metadata.discord.picksChannelId',
      },
    },
  };
  const adapter = createDiscordDeliveryAdapter({
    dryRun: false,
    botToken: 'test-bot-token',
    targetMap: { 'discord:official-picks': '999999999999999999' },
    fetchImpl: async () => {
      throw new Error('no HTTP call must be made');
    },
  });

  const result = await adapter(outbox);
  assert.notEqual(result.status, 'sent');
  assert.match(JSON.stringify(result), /no pinned destination/u);
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

function captureRequest(
  input: Parameters<typeof fetch>[0],
  init: RequestInit | undefined,
): CapturedRequest {
  return {
    url: String(input),
    method: init?.method,
    body: String(init?.body ?? ''),
    headers: new Headers(init?.headers),
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

function publicThreadResponse(options?: {
  id?: unknown;
  guildId?: unknown;
  type?: unknown;
  threadMetadata?: unknown;
  omitThreadMetadata?: boolean;
}) {
  const body: Record<string, unknown> = {
    id: options?.id ?? PINNED_CHANNEL_ID,
    guild_id: options?.guildId ?? PINNED_GUILD_ID,
    type: options?.type ?? 11,
  };
  if (!options?.omitThreadMetadata) {
    body.thread_metadata = options?.threadMetadata ?? {
      archived: false,
      locked: true,
    };
  }
  return jsonResponse(body);
}

function rejectWhenAborted(
  signal: AbortSignal | null | undefined,
): Promise<Response> {
  return new Promise((_resolve, reject) => {
    if (!signal) {
      reject(new Error('expected a bounded Discord request signal'));
      return;
    }
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    signal.addEventListener('abort', () => reject(new Error('aborted')), {
      once: true,
    });
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
