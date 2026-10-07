/**
 * WORK-2026092901: exactly-once official-picks delivery.
 *
 * A Discord post that may already exist is never posted again. These tests
 * drive the real worker (`processNextDistributionWork`) through every way a
 * dispatch can end without a recorded outcome -- an abort after the request
 * left, a 5xx, a watchdog timeout, a crash between dispatch and confirm -- and
 * count the POSTs. The count must stay at one.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  discordMessageNonce,
  dispatchLedgerActions,
  humanCapperDeliveryAuthorizationVersion,
  type CanonicalPick,
} from '@unit-talk/contracts';
import {
  createInMemoryRepositoryBundle,
  type OutboxRecord,
  type RepositoryBundle,
} from '@unit-talk/db';
import { createDiscordDeliveryAdapter } from './delivery-adapters.js';
import { processNextDistributionWork, type DeliveryResult } from './distribution-worker.js';

const TARGET = 'discord:official-picks';
const REGISTRY = [{ target: 'official-picks' as const, enabled: true, rolloutPct: 100 }];

interface Harness {
  repositories: RepositoryBundle;
  pickId: string;
  outbox: OutboxRecord;
}

async function seedOfficialPick(): Promise<Harness> {
  const repositories = createInMemoryRepositoryBundle();
  const pickId = randomUUID();
  const pick: CanonicalPick = {
    id: pickId,
    submissionId: randomUUID(),
    market: 'Moneyline',
    selection: 'Yankees ML',
    odds: -143,
    stakeUnits: 2,
    source: 'smart-form',
    approvalStatus: 'approved',
    promotionStatus: 'not_eligible',
    lifecycleState: 'queued',
    metadata: {
      sport: 'MLB',
      eventName: 'Yankees vs Red Sox',
      capper: 'griff843',
      distributionMode: 'delivery-eligible',
      deliveryAuthorization: {
        version: humanCapperDeliveryAuthorizationVersion,
        decision: 'authorized',
        capperId: 'griff843',
        authority: 'server-allowlist',
        allowlistSource: 'UNIT_TALK_HUMAN_CAPPER_DELIVERY_ALLOWLIST',
        decidedAt: new Date().toISOString(),
      },
    },
    createdAt: new Date().toISOString(),
  };
  await repositories.picks.savePick(pick);
  await repositories.killSwitch!.setKilled({
    target: 'official-picks',
    killed: false,
    actor: 'test-operator',
    reason: 'test release',
  });
  const outbox = await repositories.outbox.enqueue({
    pickId,
    target: TARGET,
    payload: { market: 'Moneyline', selection: 'Yankees ML', odds: -143, metadata: {} },
    idempotencyKey: `${pickId}:${TARGET}`,
  });
  return { repositories, pickId, outbox };
}

function run(
  h: Harness,
  deliver: (outbox: OutboxRecord) => Promise<DeliveryResult>,
  watchdogMs?: number,
) {
  return processNextDistributionWork(h.repositories, TARGET, 'worker-test', deliver, {
    persistenceMode: 'in_memory',
    targetRegistry: REGISTRY,
    ...(watchdogMs === undefined ? {} : { watchdogMs }),
  });
}

/** The worker's retry backoff puts the row in the future; bring it back now. */
async function makeClaimableNow(h: Harness) {
  const [row] = await h.repositories.outbox.listByPickId(h.pickId);
  assert.ok(row);
  row.next_attempt_at = null;
  return row;
}

async function ledgerActions(h: Harness) {
  const rows = await h.repositories.audit.listByEntity!('distribution_outbox', h.outbox.id);
  return rows.map((row) => row.action);
}

function sentResult(outbox: OutboxRecord, externalId = 'discord-message-1'): DeliveryResult {
  return {
    receiptType: 'discord.message',
    status: 'sent',
    dispatch: 'delivered',
    channel: '100000000000000002',
    externalId,
    idempotencyKey: `${outbox.id}:${outbox.target}:receipt`,
    payload: { adapter: 'test', messageId: externalId },
  };
}

function spy(first: (outbox: OutboxRecord) => Promise<DeliveryResult>) {
  let calls = 0;
  const deliver = async (outbox: OutboxRecord) => {
    calls += 1;
    if (calls === 1) return first(outbox);
    return sentResult(outbox, `discord-message-${calls}`);
  };
  return { deliver, calls: () => calls };
}

async function assertSecondClaimDeadLettersWithoutPosting(
  h: Harness,
  counter: { deliver: (o: OutboxRecord) => Promise<DeliveryResult>; calls: () => number },
) {
  await makeClaimableNow(h);
  const second = await run(h, counter.deliver);
  assert.equal(second.status, 'failed');
  assert.equal(counter.calls(), 1, 'the possibly-posted message must not be posted again');
  const [row] = await h.repositories.outbox.listByPickId(h.pickId);
  assert.equal(row?.status, 'dead_letter');
  assert.match(row?.last_error ?? '', /ambiguous-prior-dispatch/u);
  assert.ok((await ledgerActions(h)).includes(dispatchLedgerActions.ambiguous));
  assert.equal(await h.repositories.receipts.findLatestByOutboxId(h.outbox.id), null);
}

test('(a) an abort after the request was issued is never re-posted', async () => {
  const h = await seedOfficialPick();
  const counter = spy(async () => ({
    receiptType: 'discord.message',
    payload: {},
    status: 'retryable-failure',
    dispatch: 'ambiguous',
    reason: 'This operation was aborted',
  }));
  const first = await run(h, counter.deliver);
  assert.equal(first.status, 'failed');
  assert.equal((await h.repositories.outbox.listByPickId(h.pickId))[0]?.status, 'pending');
  await assertSecondClaimDeadLettersWithoutPosting(h, counter);
});

test('(a2) an adapter that throws after starting a dispatch is never re-posted', async () => {
  const h = await seedOfficialPick();
  const counter = spy(async () => {
    throw new Error('socket hang up');
  });
  await run(h, counter.deliver);
  await assertSecondClaimDeadLettersWithoutPosting(h, counter);
});

test('(b) a 5xx after the request was issued is never re-posted', async () => {
  const h = await seedOfficialPick();
  const counter = spy(async () => ({
    receiptType: 'discord.message',
    payload: {},
    status: 'retryable-failure',
    dispatch: 'ambiguous',
    reason: 'HTTP 502: bad gateway',
  }));
  await run(h, counter.deliver);
  await assertSecondClaimDeadLettersWithoutPosting(h, counter);
});

test('(c) a watchdog timeout is never re-posted', async () => {
  const h = await seedOfficialPick();
  const counter = spy(() => new Promise<DeliveryResult>(() => {}));
  const first = await run(h, counter.deliver, 20);
  assert.equal(first.status, 'failed');
  await assertSecondClaimDeadLettersWithoutPosting(h, counter);
});

test('(d) delivered then confirm failure: the next claim confirms from the ledger with zero new POSTs', async () => {
  const h = await seedOfficialPick();
  const originalMarkSent = h.repositories.outbox.markSent.bind(h.repositories.outbox);
  let failOnce = true;
  h.repositories.outbox.markSent = async (id: string) => {
    if (failOnce) {
      failOnce = false;
      throw new Error('confirm failed: connection reset');
    }
    return originalMarkSent(id);
  };
  let calls = 0;
  const deliver = async (outbox: OutboxRecord) => {
    calls += 1;
    return sentResult(outbox, `discord-message-${calls}`);
  };

  const first = await run(h, deliver);
  assert.equal(first.status, 'failed', 'the confirm failed after Discord accepted the message');
  assert.equal(calls, 1);
  assert.ok((await ledgerActions(h)).includes(dispatchLedgerActions.delivered));

  await makeClaimableNow(h);
  const second = await run(h, deliver);
  assert.equal(second.status, 'sent');
  assert.equal(calls, 1, 'recovery confirms the existing message; it does not post');
  const receipt = await h.repositories.receipts.findLatestByOutboxId(h.outbox.id);
  assert.equal(receipt?.status, 'sent');
  assert.equal(receipt?.external_id, 'discord-message-1', 'the receipt is the ORIGINAL message');
  assert.equal((await h.repositories.picks.findPickById(h.pickId))?.status, 'posted');
});

test('(e) crash/reclaim: an unresolved started attempt dead-letters with zero POSTs', async () => {
  const h = await seedOfficialPick();
  // A previous worker recorded `started` and died before any outcome.
  await h.repositories.audit.record({
    entityType: 'distribution_outbox',
    entityId: h.outbox.id,
    entityRef: h.pickId,
    action: dispatchLedgerActions.started,
    actor: 'worker-crashed',
    payload: { outboxId: h.outbox.id, attempt: 1 },
  });
  let calls = 0;
  const result = await run(h, async (outbox) => {
    calls += 1;
    return sentResult(outbox);
  });
  assert.equal(result.status, 'failed');
  assert.equal(calls, 0);
  assert.equal((await h.repositories.outbox.listByPickId(h.pickId))[0]?.status, 'dead_letter');
});

for (const [label, dispatch, status] of [
  ['not-sent (failed before the request)', 'not-sent', 'retryable-failure'],
  ['429 rejected', 'rejected', 'retryable-failure'],
] as const) {
  test(`(f) ${label}: the ledger is resolved and the next attempt may post`, async () => {
    const h = await seedOfficialPick();
    const counter = spy(async () => ({
      receiptType: 'discord.message',
      payload: {},
      status,
      dispatch,
      reason: label,
    }));
    await run(h, counter.deliver);
    assert.ok((await ledgerActions(h)).includes(dispatchLedgerActions.notCreated));
    await makeClaimableNow(h);
    const second = await run(h, counter.deliver);
    assert.equal(second.status, 'sent');
    assert.equal(counter.calls(), 2);
  });
}

test('(f2) a 4xx terminal rejection dead-letters as a definite non-delivery, not ambiguous', async () => {
  const h = await seedOfficialPick();
  const result = await run(h, async () => ({
    receiptType: 'discord.message',
    payload: {},
    status: 'terminal-failure',
    dispatch: 'rejected',
    reason: 'HTTP 403: missing access',
  }));
  assert.equal(result.status, 'failed');
  const actions = await ledgerActions(h);
  assert.ok(actions.includes(dispatchLedgerActions.notCreated));
  assert.ok(!actions.includes(dispatchLedgerActions.ambiguous));
});

test('(g) an existing sent receipt refuses dispatch with zero POSTs', async () => {
  const h = await seedOfficialPick();
  await h.repositories.receipts.record({
    outboxId: h.outbox.id,
    receiptType: 'discord.message',
    status: 'sent',
    channel: '100000000000000002',
    externalId: 'already-there',
    idempotencyKey: `${h.outbox.id}:${TARGET}:receipt`,
    payload: {},
  });
  let calls = 0;
  const result = await run(h, async (outbox) => {
    calls += 1;
    return sentResult(outbox);
  });
  assert.equal(result.status, 'failed');
  assert.equal(calls, 0);
  const [row] = await h.repositories.outbox.listByPickId(h.pickId);
  assert.equal(row?.status, 'dead_letter');
  assert.match(row?.last_error ?? '', /already-receipted/u);
});

test('(h) an audit repository without listByEntity refuses dispatch with zero POSTs', async () => {
  const h = await seedOfficialPick();
  const audit = h.repositories.audit;
  h.repositories.audit = {
    record: audit.record.bind(audit),
    listRecentByEntityType: audit.listRecentByEntityType.bind(audit),
  };
  let calls = 0;
  const result = await run(h, async (outbox) => {
    calls += 1;
    return sentResult(outbox);
  });
  assert.equal(result.status, 'failed');
  assert.equal(calls, 0);
  assert.match(
    (await h.repositories.outbox.listByPickId(h.pickId))[0]?.last_error ?? '',
    /dispatch-ledger-unavailable/u,
  );
});

test('(i) an operator reconciliation through the ambiguous attempt allows one fresh post', async () => {
  const h = await seedOfficialPick();
  const counter = spy(async () => ({
    receiptType: 'discord.message',
    payload: {},
    status: 'retryable-failure',
    dispatch: 'ambiguous',
    reason: 'HTTP 503',
  }));
  await run(h, counter.deliver);
  await h.repositories.audit.record({
    entityType: 'distribution_outbox',
    entityId: h.outbox.id,
    entityRef: h.pickId,
    action: dispatchLedgerActions.reconciled,
    actor: 'operator',
    payload: { outboxId: h.outbox.id, throughAttempt: 1, reason: 'checked channel: absent' },
  });
  await makeClaimableNow(h);
  const second = await run(h, counter.deliver);
  assert.equal(second.status, 'sent');
  assert.equal(counter.calls(), 2);
  const started = (await ledgerActions(h)).filter((a) => a === dispatchLedgerActions.started);
  assert.equal(started.length, 2, 'the fresh post is attempt 2, recorded before dispatch');
});

test('a non-human target is not governed by the ledger', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const listByEntity = repositories.audit.listByEntity;
  let ledgerReads = 0;
  repositories.audit.listByEntity = async (...args) => {
    ledgerReads += 1;
    return listByEntity!.apply(repositories.audit, args);
  };
  const pickId = randomUUID();
  await repositories.picks.savePick({
    id: pickId,
    submissionId: randomUUID(),
    market: 'Moneyline',
    selection: 'Mets ML',
    source: 'smart-form',
    approvalStatus: 'approved',
    promotionStatus: 'qualified',
    lifecycleState: 'queued',
    metadata: { sport: 'MLB', eventName: 'Mets vs Braves' },
    createdAt: new Date().toISOString(),
  });
  await repositories.outbox.enqueue({
    pickId,
    target: 'discord:canary',
    payload: {},
    idempotencyKey: `${pickId}:canary`,
  });
  const result = await processNextDistributionWork(
    repositories,
    'discord:canary',
    'worker-test',
    async (outbox) => sentResult(outbox),
    { persistenceMode: 'in_memory' },
  );
  assert.equal(result.status, 'sent');
  assert.equal(ledgerReads, 0);
});

// ---------------------------------------------------------------------------
// Adapter: what the Discord adapter reports about its own request
// ---------------------------------------------------------------------------

function pinnedOutbox(): OutboxRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    pick_id: randomUUID(),
    target: TARGET,
    status: 'pending',
    attempt_count: 0,
    next_attempt_at: null,
    last_error: null,
    payload: {
      market: 'Moneyline',
      selection: 'Yankees ML',
      odds: -143,
      stakeUnits: 2,
      metadata: { sport: 'MLB', eventName: 'Yankees vs Red Sox', capper: 'griff843' },
      deliveryDestination: {
        version: 'capper-discord-routing/v1',
        guildId: '100000000000000001',
        channelId: '100000000000000002',
        capperId: 'griff843',
        source: 'cappers.metadata.discord.picksChannelId',
      },
    },
    claimed_at: null,
    claimed_by: null,
    idempotency_key: `${TARGET}:idempotent`,
    created_at: now,
    updated_at: now,
  };
}

function adapterWith(fetchImpl: typeof fetch) {
  return createDiscordDeliveryAdapter({
    dryRun: false,
    botToken: 'test-bot-token',
    // A shared mapping is present so the pre-flight resolves; a human target
    // must still route only to its pinned capper channel.
    targetMap: { [TARGET]: '999999999999999999' },
    fetchImpl: async (url, init) => {
      if (init?.method === 'GET') {
        return new Response(
          JSON.stringify({
            id: '100000000000000002',
            guild_id: '100000000000000001',
            type: 11,
            thread_metadata: { archived: false, locked: true },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return fetchImpl(url, init);
    },
  });
}

test('adapter: every official-pick POST carries the row nonce with enforce_nonce', async () => {
  const outbox = pinnedOutbox();
  let body: Record<string, unknown> = {};
  const result = await adapterWith(async (_url, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ id: 'm-1' }), { status: 200 });
  })(outbox);
  assert.equal(result.status, 'sent');
  assert.equal(result.dispatch, 'delivered');
  assert.equal(body['nonce'], discordMessageNonce(outbox.id));
  assert.equal(body['enforce_nonce'], true);
});

test('adapter: a throw after the request was issued is ambiguous', async () => {
  const result = await adapterWith(async () => {
    throw new Error('This operation was aborted');
  })(pinnedOutbox());
  assert.equal(result.status, 'retryable-failure');
  assert.equal(result.dispatch, 'ambiguous');
});

test('adapter: a refusal before any request (no pinned destination) is not-sent', async () => {
  const outbox = pinnedOutbox();
  const payload = { ...(outbox.payload as Record<string, unknown>) };
  delete payload['deliveryDestination'];
  let calls = 0;
  const result = await adapterWith(async () => {
    calls += 1;
    throw new Error('no HTTP call must be made');
  })({ ...outbox, payload: payload as OutboxRecord['payload'] });
  assert.equal(calls, 0);
  assert.equal(result.dispatch, 'not-sent');
});

test('adapter: a pre-flight throw (no bot token) escapes the adapter, so the worker leaves the attempt unresolved', async () => {
  // Fail closed by design: the worker has already recorded `started`, the
  // throw records no outcome, and the next claim dead-letters rather than
  // guessing that nothing was posted.
  const adapter = createDiscordDeliveryAdapter({
    dryRun: false,
    botToken: '',
    targetMap: { [TARGET]: '999999999999999999' },
    fetchImpl: async () => {
      throw new Error('no HTTP call must be made');
    },
  });
  await assert.rejects(adapter(pinnedOutbox()), /DISCORD_BOT_TOKEN/u);
});

for (const [status, expected] of [
  [500, 'ambiguous'],
  [502, 'ambiguous'],
  [400, 'rejected'],
  [403, 'rejected'],
  [429, 'rejected'],
] as const) {
  test(`adapter: HTTP ${status} is ${expected}`, async () => {
    const result = await adapterWith(async () => new Response('x', { status }))(pinnedOutbox());
    assert.notEqual(result.status, 'sent');
    assert.equal(result.dispatch, expected);
  });
}

test('adapter: a 2xx without a message id is ambiguous, never a retryable non-delivery', async () => {
  const result = await adapterWith(
    async () => new Response(JSON.stringify({}), { status: 200 }),
  )(pinnedOutbox());
  assert.equal(result.status, 'retryable-failure');
  assert.equal(result.dispatch, 'ambiguous');
});
