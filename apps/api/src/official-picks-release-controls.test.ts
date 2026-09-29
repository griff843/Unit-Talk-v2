/**
 * WORK-2026092901: the controls around the first watched official-picks
 * release -- the separate recap control, the reason-required release, and the
 * retry route's refusal to re-post a message that may already exist.
 */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  dispatchLedgerActions,
  humanCapperDeliveryAuthorizationVersion,
  humanCapperRecapControl,
} from '@unit-talk/contracts';
import {
  InMemoryDeliveryKillSwitchRepository,
  type RepositoryBundle,
  type SettlementRecord,
} from '@unit-talk/db';
import { isHumanCapperRecapStopped } from './human-capper-recap-gate.js';
import { postSettlementRecapIfPossible } from './grading-service.js';
import { retryDeliveryController } from './controllers/retry-delivery-controller.js';
import { createApiServer } from './server.js';
import { createInMemoryRepositoryBundle } from './persistence.js';

const authorized = {
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
    decidedAt: '2026-09-28T00:00:00.000Z',
  },
};

async function release(ks: InMemoryDeliveryKillSwitchRepository, target: string) {
  await ks.setKilled({ target, killed: false, actor: 'test', reason: 'test' });
}

// ---------------------------------------------------------------------------
// (a) the recap gate
// ---------------------------------------------------------------------------

test('recap gate: official-picks released but no recap row -> stopped', async () => {
  const killSwitch = new InMemoryDeliveryKillSwitchRepository();
  await release(killSwitch, 'official-picks');
  assert.equal(await isHumanCapperRecapStopped({ killSwitch }), true);
});

test('recap gate: recap control explicitly killed -> stopped', async () => {
  const killSwitch = new InMemoryDeliveryKillSwitchRepository();
  await release(killSwitch, 'official-picks');
  await killSwitch.setKilled({ target: humanCapperRecapControl, killed: true, actor: 'test' });
  assert.equal(await isHumanCapperRecapStopped({ killSwitch }), true);
});

test('recap gate: recap released but official-picks killed -> stopped', async () => {
  const killSwitch = new InMemoryDeliveryKillSwitchRepository();
  await release(killSwitch, humanCapperRecapControl);
  assert.equal(await isHumanCapperRecapStopped({ killSwitch }), true);
});

test('recap gate: both released -> not stopped', async () => {
  const killSwitch = new InMemoryDeliveryKillSwitchRepository();
  await release(killSwitch, 'official-picks');
  await release(killSwitch, humanCapperRecapControl);
  assert.equal(await isHumanCapperRecapStopped({ killSwitch }), false);
});

test('recap gate: no kill-switch repository -> stopped', async () => {
  assert.equal(await isHumanCapperRecapStopped({}), true);
});

// ---------------------------------------------------------------------------
// (b) the per-pick settlement recap chokepoint
// ---------------------------------------------------------------------------

async function recapAttempt(releaseRecaps: boolean) {
  const repositories = createInMemoryRepositoryBundle();
  const pickId = randomUUID();
  await repositories.picks.savePick({
    id: pickId,
    submissionId: randomUUID(),
    market: 'Moneyline',
    selection: 'Yankees ML',
    odds: -143,
    stakeUnits: 2,
    source: 'smart-form',
    approvalStatus: 'approved',
    promotionStatus: 'not_eligible',
    lifecycleState: 'settled',
    metadata: authorized,
    createdAt: new Date().toISOString(),
  });
  const pick = await repositories.picks.findPickById(pickId);
  assert.ok(pick);
  const killSwitch = new InMemoryDeliveryKillSwitchRepository();
  await release(killSwitch, 'official-picks');
  if (releaseRecaps) await release(killSwitch, humanCapperRecapControl);

  const previousToken = process.env.DISCORD_BOT_TOKEN;
  const previousFetch = globalThis.fetch;
  let fetches = 0;
  process.env.DISCORD_BOT_TOKEN = 'test-token';
  globalThis.fetch = (async () => {
    fetches += 1;
    return new Response(JSON.stringify({ id: 'recap-1' }), { status: 200 });
  }) as typeof fetch;
  try {
    const outcome = await postSettlementRecapIfPossible(
      pick,
      { id: randomUUID(), result: 'win' } as unknown as SettlementRecord,
      { ...repositories, killSwitch },
      {},
    );
    return { outcome, fetches };
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = previousToken;
  }
}

test('settlement recap: official-picks released alone does not release the recap', async () => {
  const { outcome, fetches } = await recapAttempt(false);
  assert.deepEqual(outcome, { posted: false, reason: 'human-capper-recap-stopped' });
  assert.equal(fetches, 0);
});

test('settlement recap: with both released, the gate is passed (the pick proceeds to channel resolution)', async () => {
  const { outcome } = await recapAttempt(true);
  assert.notEqual(
    (outcome as { reason?: string }).reason,
    'human-capper-recap-stopped',
    'the gate must be the thing that stopped the previous case',
  );
});

// ---------------------------------------------------------------------------
// (c) the kill-switch route
// ---------------------------------------------------------------------------

async function postKillSwitch(repositories: RepositoryBundle, body: Record<string, unknown>) {
  const server = createApiServer({ repositories });
  server.listen(0);
  await once(server, 'listening');
  try {
    const response = await fetch(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/discord/kill-switch`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    );
    return { status: response.status, body: (await response.json()) as { ok: boolean; error?: { code: string } } };
  } finally {
    server.close();
  }
}

test('kill-switch route: the recap control is a valid key', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await postKillSwitch(repositories, { target: humanCapperRecapControl, killed: true });
  assert.equal(result.status, 200);
  assert.equal(await repositories.killSwitch!.isKilled(humanCapperRecapControl), true);
});

for (const reason of [undefined, '', '   ']) {
  test(`kill-switch route: a release with reason ${JSON.stringify(reason)} is refused`, async () => {
    const repositories = createInMemoryRepositoryBundle();
    const result = await postKillSwitch(repositories, {
      target: 'official-picks',
      killed: false,
      ...(reason === undefined ? {} : { reason }),
    });
    assert.equal(result.status, 400);
    assert.equal(result.body.error?.code, 'REASON_REQUIRED');
    assert.equal(await repositories.killSwitch!.isKilled('official-picks'), true, 'still killed');
  });
}

test('kill-switch route: a release with a reason succeeds', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await postKillSwitch(repositories, {
    target: 'official-picks',
    killed: false,
    reason: 'first watched release',
  });
  assert.equal(result.status, 200);
  assert.equal(await repositories.killSwitch!.isKilled('official-picks'), false);
});

test('kill-switch route: engaging never needs a reason', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const result = await postKillSwitch(repositories, { target: 'official-picks', killed: true });
  assert.equal(result.status, 200);
});

// ---------------------------------------------------------------------------
// (d) the retry route's duplicate guard
// ---------------------------------------------------------------------------

async function deadLetteredOfficialRow() {
  const repositories = createInMemoryRepositoryBundle();
  const pickId = randomUUID();
  await repositories.picks.savePick({
    id: pickId,
    submissionId: randomUUID(),
    market: 'Moneyline',
    selection: 'Yankees ML',
    source: 'smart-form',
    approvalStatus: 'approved',
    promotionStatus: 'not_eligible',
    lifecycleState: 'queued',
    metadata: authorized,
    createdAt: new Date().toISOString(),
  });
  const outbox = await repositories.outbox.enqueue({
    pickId,
    target: 'discord:official-picks',
    payload: {},
    idempotencyKey: `${pickId}:official`,
  });
  await repositories.outbox.markDeadLetter(outbox.id, 'ambiguous-prior-dispatch');
  const ledger = (action: string, payload: Record<string, unknown>) =>
    repositories.audit.record({
      entityType: 'distribution_outbox',
      entityId: outbox.id,
      entityRef: pickId,
      action,
      actor: 'worker',
      payload,
    });
  return { repositories, pickId, outbox, ledger };
}

const retry = { reason: 'operator retry', actor: 'operator' };

test('retry: a sent receipt refuses with ALREADY_DELIVERED', async () => {
  const { repositories, pickId, outbox } = await deadLetteredOfficialRow();
  await repositories.receipts.record({
    outboxId: outbox.id,
    receiptType: 'discord.message',
    status: 'sent',
    channel: '1',
    externalId: 'm-1',
    payload: {},
  });
  const result = await retryDeliveryController(pickId, retry, repositories);
  assert.equal(result.status, 409);
  assert.equal((result.body as { error?: { code: string } }).error?.code, 'ALREADY_DELIVERED');
});

test('retry: a ledger delivered marker refuses with ALREADY_DELIVERED', async () => {
  const { repositories, pickId, ledger } = await deadLetteredOfficialRow();
  await ledger(dispatchLedgerActions.started, { attempt: 1 });
  await ledger(dispatchLedgerActions.delivered, {
    attempt: 1,
    receipt: { receiptType: 'discord.message', channel: '1', externalId: 'm-1', payload: {} },
  });
  const result = await retryDeliveryController(pickId, retry, repositories);
  assert.equal(result.status, 409);
  assert.equal((result.body as { error?: { code: string } }).error?.code, 'ALREADY_DELIVERED');
});

test('retry: an ambiguous attempt refuses without an operator attestation and leaves the row alone', async () => {
  const { repositories, pickId, outbox, ledger } = await deadLetteredOfficialRow();
  await ledger(dispatchLedgerActions.started, { attempt: 1 });
  const result = await retryDeliveryController(pickId, retry, repositories);
  assert.equal(result.status, 409);
  assert.equal((result.body as { error?: { code: string } }).error?.code, 'DELIVERY_OUTCOME_AMBIGUOUS');
  const [row] = await repositories.outbox.listByPickId(pickId);
  assert.equal(row?.id, outbox.id);
  assert.equal(row?.status, 'dead_letter');
});

test('retry: confirmedNotDelivered records the reconciliation BEFORE resetting the row', async () => {
  const { repositories, pickId, outbox, ledger } = await deadLetteredOfficialRow();
  await ledger(dispatchLedgerActions.started, { attempt: 1 });
  const originalReset = repositories.outbox.resetForRetry.bind(repositories.outbox);
  let reconciledAtReset = false;
  repositories.outbox.resetForRetry = async (id: string) => {
    const rows = await repositories.audit.listByEntity!('distribution_outbox', outbox.id);
    reconciledAtReset = rows.some(
      (r) =>
        r.action === dispatchLedgerActions.reconciled &&
        (r.payload as Record<string, unknown>)['throughAttempt'] === 1,
    );
    return originalReset(id);
  };
  const result = await retryDeliveryController(
    pickId,
    { ...retry, confirmedNotDelivered: true },
    repositories,
  );
  assert.equal(result.status, 200);
  assert.equal(reconciledAtReset, true);
  assert.equal((await repositories.outbox.listByPickId(pickId))[0]?.status, 'pending');
});

test('retry: an unreadable ledger fails closed with 503', async () => {
  const { repositories, pickId } = await deadLetteredOfficialRow();
  const audit = repositories.audit;
  repositories.audit = {
    record: audit.record.bind(audit),
    listRecentByEntityType: audit.listRecentByEntityType.bind(audit),
  };
  const result = await retryDeliveryController(pickId, retry, repositories);
  assert.equal(result.status, 503);
});
