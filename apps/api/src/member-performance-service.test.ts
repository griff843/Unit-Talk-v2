import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createApiRuntimeDependencies, createApiServer } from './server.js';
import {
  capperDiscordRoutingVersion,
  humanCapperDeliveryAuthorizationVersion,
} from '@unit-talk/contracts';
import {
  DatabasePickRepository,
  DatabaseOutboxRepository,
  DatabaseSettlementRepository,
  DatabaseReceiptRepository,
  DatabaseCapperRepository,
  InMemoryCapperRepository,
  type PickRecord,
  type ReceiptRecord,
} from '@unit-talk/db';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { getMemberPerformance } from './member-performance-service.js';

const at = '2026-10-14T12:00:00.000Z';
const options = {
  window: 30 as const,
  sport: null,
  capper: null,
  minPicks: 1,
  limit: 10,
  observedAt: '2026-10-14T23:00:00.000Z',
};

function databaseReadClient(
  tables: Record<string, Array<Record<string, unknown>>>,
) {
  const reads: string[] = [];
  return {
    reads,
    from(table: string) {
      assert.ok(
        table in tables,
        `Only the five approved read tables may be queried: ${table}`,
      );
      reads.push(table);
      let selected = tables[table]!.slice();
      let exact = false;
      const order: Array<[string, boolean]> = [];
      let limit: number | undefined;
      const sorted = () =>
        selected.slice().sort((a, b) => {
          for (const [key, ascending] of order) {
            const comparison = String(a[key]).localeCompare(String(b[key]));
            if (comparison) return ascending ? comparison : -comparison;
          }
          return 0;
        });
      const query = {
        select(_fields?: string, config?: { count?: string }) {
          exact = config?.count === 'exact';
          return query;
        },
        in(key: string, values: readonly string[]) {
          selected = selected.filter((row) =>
            values.includes(String(row[key])),
          );
          return query;
        },
        eq(key: string, value: string) {
          selected = selected.filter((row) => row[key] === value);
          return query;
        },
        order(key: string, config: { ascending: boolean }) {
          order.push([key, config.ascending]);
          return query;
        },
        limit(value: number) {
          limit = value;
          return query;
        },
        async range(from: number, to: number) {
          return {
            data: sorted().slice(from, to + 1),
            error: null,
            count: exact ? selected.length : null,
          };
        },
        async maybeSingle() {
          return { data: sorted().slice(0, limit)[0] ?? null, error: null };
        },
      };
      return query;
    },
  };
}
async function fixture() {
  const repositories = createInMemoryRepositoryBundle();
  const cappers = repositories.cappers;
  assert.ok(cappers instanceof InMemoryCapperRepository);
  cappers.seed({
    id: 'griff843',
    display_name: 'Griff',
    active: true,
    metadata: {},
    created_at: at,
    updated_at: at,
  });
  const pick = await repositories.picks.savePick({
    id: randomUUID(),
    submissionId: randomUUID(),
    market: 'moneyline',
    selection: 'PRIVATE SELECTION',
    odds: 150,
    stakeUnits: 2,
    source: 'smart-form',
    approvalStatus: 'approved',
    promotionStatus: 'not_eligible',
    lifecycleState: 'settled',
    createdAt: at,
    metadata: {
      capper: 'griff843',
      sport: 'MLB',
      thesis: 'PRIVATE THESIS',
      realEdge: 0.25,
      distributionMode: 'delivery-eligible',
      deliveryAuthorization: {
        version: humanCapperDeliveryAuthorizationVersion,
        decision: 'authorized',
        capperId: 'griff843',
        authority: 'server-allowlist',
        allowlistSource: 'UNIT_TALK_HUMAN_CAPPER_DELIVERY_ALLOWLIST',
        decidedAt: at,
      },
    },
  });
  pick.posted_at = at;
  pick.settled_at = at;
  const outbox = await repositories.outbox.enqueue({
    pickId: pick.id,
    target: 'discord:official-picks',
    idempotencyKey: randomUUID(),
    payload: {
      deliveryDestination: {
        version: capperDiscordRoutingVersion,
        capperId: 'griff843',
        guildId: '1284478946171293736',
        channelId: '1288600096682016789',
        source: 'capper-metadata',
      },
    },
  });
  await repositories.outbox.markSent(outbox.id);
  const receipt = await repositories.receipts.record({
    outboxId: outbox.id,
    receiptType: 'discord.message',
    status: 'sent',
    channel: '1288600096682016789',
    externalId: '1560064200447885323',
    payload: {
      adapter: 'discord',
      dryRun: false,
      target: 'discord:official-picks',
      outboxId: outbox.id,
      messageId: '1560064200447885323',
      channelId: '1288600096682016789',
      route: 'capper-pinned',
      capperId: 'griff843',
      guildId: '1284478946171293736',
    },
  });
  const settlement = await repositories.settlements.record({
    pickId: pick.id,
    status: 'settled',
    result: 'win',
    source: 'operator',
    confidence: 'confirmed',
    evidenceRef: 'https://example.test/score',
    settledBy: 'operator',
    settledAt: at,
    payload: { profitLossUnits: 999 },
  });
  return { repositories, pick, outbox, receipt, settlement };
}

test('public performance uses canonical attribution and real prices, projecting aggregate fields only without writes', async () => {
  const { repositories, pick, outbox, receipt, settlement } = await fixture();
  const before = structuredClone({ pick, outbox, receipt, settlement });
  const result = await getMemberPerformance(repositories, options);
  assert.equal(result.stats.picks, 1);
  assert.equal(result.stats.wins, 1);
  assert.equal(result.stats.roiPct, 150);
  assert.equal(result.leaderboard.entries[0]?.capper, 'Griff');
  assert.equal(result.stats.avgClvPct, null);
  assert.deepEqual({ pick, outbox, receipt, settlement }, before);
  const serialized = JSON.stringify(result);
  for (const secret of [
    pick.id,
    outbox.id,
    receipt.id,
    settlement.id,
    'PRIVATE',
    'realEdge',
    'distributionMode',
    'discord:',
  ]) {
    assert.ok(!serialized.includes(secret), secret);
  }
});

for (const reader of ['service', 'stats', 'leaderboard']) {
  test(`WORK-2026103005: ${reader} excludes private, unknown and mismatched audience pins alongside a normal pick`, async () => {
    for (const audience of ['staff-canary', 'unknown', null]) {
      const { repositories, pick, outbox, receipt } = await fixture();
      const outboxPayload = outbox.payload as Record<string, unknown>;
      const receiptPayload = receipt.payload as Record<string, unknown>;
      assert.ok(receipt.channel);
      assert.ok(receipt.external_id);
      // Keep the original real sent/receipt fixture as the normal public result;
      // a second complete copy carries private pins and must not change totals.
      const hiddenId = randomUUID();
      const hidden = await repositories.picks.savePick({
        id: hiddenId,
        submissionId: randomUUID(),
        market: 'moneyline',
        selection: 'CANARY',
        odds: 150,
        stakeUnits: 2,
        source: 'smart-form',
        approvalStatus: 'approved',
        promotionStatus: 'not_eligible',
        lifecycleState: 'settled',
        createdAt: at,
        metadata: {
          ...(pick.metadata as Record<string, unknown>),
          deliveryAuthorization: {
            ...((pick.metadata as Record<string, unknown>)[
              'deliveryAuthorization'
            ] as Record<string, unknown>),
            audience,
          },
        },
      });
      hidden.posted_at = at;
      const hiddenOutbox = await repositories.outbox.enqueue({
        pickId: hiddenId,
        target: outbox.target,
        idempotencyKey: hiddenId,
        payload: {
          ...outboxPayload,
          deliveryDestination: {
            ...(outboxPayload['deliveryDestination'] as Record<
              string,
              unknown
            >),
            audience,
          },
        },
      });
      await repositories.receipts.record({
        outboxId: hiddenOutbox.id,
        receiptType: 'discord.message',
        status: 'sent',
        channel: receipt.channel,
        externalId: receipt.external_id,
        payload: { ...receiptPayload, outboxId: hiddenOutbox.id },
      });
      await repositories.settlements.record({
        pickId: hiddenId,
        status: 'settled',
        result: 'loss',
        source: 'operator',
        confidence: 'confirmed',
        evidenceRef: 'test://canary-score',
        settledBy: 'operator',
        settledAt: at,
        payload: {},
      });
      if (reader === 'service') {
        const result = await getMemberPerformance(repositories, options);
        assert.equal(result.stats.picks, 1);
        assert.equal(result.stats.wins, 1);
      } else {
        const runtime = createApiRuntimeDependencies({ repositories });
        runtime.now = () => Date.parse(options.observedAt);
        runtime.authConfig = {
          enabled: true,
          failClosed: true,
          jwtSecret: 'audience-test-secret',
          keys: new Map([
            [
              'audience-bot',
              {
                role: 'submitter',
                identity: 'submitter:discord-bot:audience-test',
              },
            ],
          ]),
        };
        const server = createApiServer({ runtime });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        try {
          for (const route of [`/api/operator/${reader}?last=30&minPicks=1`]) {
            const response = await fetch(
              `http://127.0.0.1:${(server.address() as AddressInfo).port}${route}`,
              {
                headers: { authorization: 'Bearer audience-bot' },
              },
            );
            assert.equal(response.status, 200, route);
            const body = (await response.json()) as {
              data: { picks?: number; entries?: Array<{ picks: number }> };
            };
            assert.equal(
              body.data.picks ?? body.data.entries?.[0]?.picks,
              1,
              route,
            );
          }
        } finally {
          server.closeAllConnections();
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      }
      // A members pick paired with a private outbox pin must also be omitted,
      // without making the unrelated normal result unavailable.
      (hidden.metadata as Record<string, unknown>)['deliveryAuthorization'] = (
        pick.metadata as Record<string, unknown>
      )['deliveryAuthorization'];
      assert.equal(
        (await getMemberPerformance(repositories, options)).stats.picks,
        1,
      );
    }
  });
}

test('the service has matching complete behavior through actual Database reader implementations', async () => {
  const { repositories, pick, outbox, receipt, settlement } = await fixture();
  const expected = await getMemberPerformance(repositories, options);
  const capper = await repositories.cappers!.findById('griff843');
  assert.ok(capper);
  const client = databaseReadClient({
    picks: [{ ...pick }],
    distribution_outbox: [{ ...outbox }],
    distribution_receipts: [{ ...receipt }],
    settlement_records: [{ ...settlement }],
    cappers: [{ ...capper }],
  });
  // Inject a read-only query boundary without constructing a live DB client.
  repositories.picks = Object.create(DatabasePickRepository.prototype, {
    client: { value: client },
  }) as DatabasePickRepository;
  repositories.outbox = Object.create(DatabaseOutboxRepository.prototype, {
    client: { value: client },
  }) as DatabaseOutboxRepository;
  repositories.receipts = Object.create(DatabaseReceiptRepository.prototype, {
    client: { value: client },
  }) as DatabaseReceiptRepository;
  repositories.settlements = Object.create(
    DatabaseSettlementRepository.prototype,
    { client: { value: client } },
  ) as DatabaseSettlementRepository;
  repositories.cappers = Object.create(DatabaseCapperRepository.prototype, {
    client: { value: client },
  }) as DatabaseCapperRepository;
  assert.deepEqual(await getMemberPerformance(repositories, options), expected);
  assert.equal(
    client.reads.filter((table) => table === 'picks').length,
    2,
    'both complete populations stop at their verified counts',
  );
});

for (const change of [
  { status: 'posted' },
  { status: 'queued' },
  { source: 'system-pick-scanner' },
  { metadata: { distributionMode: 'track-only' } },
  { metadata: { fixture: true } },
  { metadata: { simulation: true } },
  { metadata: { visibility: 'private' } },
  { metadata: { internal: true } },
  { metadata: { proof_fixture_id: 'proof' } },
  { metadata: { eventName: 'Proof member test' } },
  { metadata: { eventName: 'Test Event football' } },
] as const) {
  test(`public performance excludes ${JSON.stringify(change)}`, async () => {
    const { repositories, pick } = await fixture();
    if ('metadata' in change)
      pick.metadata = { ...(pick.metadata as object), ...change.metadata };
    else Object.assign(pick, change);
    assert.equal(
      (await getMemberPerformance(repositories, options)).stats.picks,
      0,
    );
  });
}

for (const source of ['api', 'discord', 'discord-bot', 'alert-agent']) {
  test(`genuinely delivered human source ${source} remains in the complete public record`, async () => {
    const { repositories, pick } = await fixture();
    pick.source = source;
    assert.equal(
      (await getMemberPerformance(repositories, options)).stats.picks,
      1,
    );
  });
}

test('receipt reads have bounded concurrency and a whole-request provenance budget', async () => {
  const { repositories, outbox, receipt } = await fixture();
  let running = 0;
  let peak = 0;
  let requests = 0;
  repositories.outbox.listByPickId = async () =>
    Array.from({ length: 33 }, (_, index) => ({
      ...outbox,
      id: index === 0 ? outbox.id : String(index),
    }));
  repositories.receipts.findLatestByOutboxId = async (id) => {
    requests++;
    peak = Math.max(peak, ++running);
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
    running--;
    return id === outbox.id ? receipt : null;
  };
  assert.equal(
    (await getMemberPerformance(repositories, options)).stats.picks,
    1,
  );
  assert.ok(peak <= 8, `peak ${peak}`);
  assert.equal(requests, 66);
  requests = 0;
  repositories.outbox.listByPickId = async () =>
    Array.from({ length: 20_001 }, (_, index) => ({
      ...outbox,
      id: String(index),
    }));
  await assert.rejects(getMemberPerformance(repositories, options), /budget/);
  assert.equal(requests, 0);
});

test('undelivered and sent terminal-skip rows do not qualify without a genuine message receipt', async () => {
  const { repositories, pick } = await fixture();
  pick.posted_at = null;
  repositories.receipts.findLatestByOutboxId = async () => null;
  assert.equal(
    (await getMemberPerformance(repositories, options)).stats.picks,
    0,
  );
});

for (const mutation of [
  { status: 'retryable-failure' },
  { channel: 'discord:official-picks' },
  { external_id: 'discord-dry:fake' },
  { payload: { adapter: 'discord', dryRun: true } },
  { outbox_id: 'unrelated' },
] satisfies Array<Partial<ReceiptRecord>>) {
  test(`unverified receipt fails whole public result: ${JSON.stringify(mutation)}`, async () => {
    const { repositories, receipt } = await fixture();
    Object.assign(receipt, mutation);
    await assert.rejects(getMemberPerformance(repositories, options));
  });
}

test('failed latest receipt does not silently hide an earlier successful delivery even if outbox is failed', async () => {
  const { repositories, outbox, pick, receipt } = await fixture();
  outbox.status = 'failed';
  pick.posted_at = null;
  receipt.status = 'retryable-failure';
  await assert.rejects(getMemberPerformance(repositories, options));
});

test('unresolved or mismatched canonical capper fails instead of grouping by submitted aliases', async () => {
  const { repositories, pick } = await fixture();
  repositories.cappers!.findById = async () => null;
  await assert.rejects(getMemberPerformance(repositories, options));
  pick.capper_id = 'unrelated';
  await assert.rejects(getMemberPerformance(repositories, options));
});

test('confirmed correction replaces original result once; delivered void remains transparent', async () => {
  const { repositories, pick, settlement } = await fixture();
  await repositories.settlements.record({
    pickId: pick.id,
    status: 'settled',
    result: 'void',
    source: 'operator',
    confidence: 'confirmed',
    evidenceRef: 'https://example.test/correction',
    settledBy: 'operator',
    settledAt: at,
    correctsId: settlement.id,
    payload: {},
  });
  pick.status = 'voided';
  pick.settled_at = null;
  const result = await getMemberPerformance(repositories, options);
  assert.equal(result.stats.picks, 1);
  assert.equal(result.stats.wins, 0);
  assert.equal(result.stats.pushes, 0);
  assert.deepEqual(result.stats.lastFive, []);
});

test('a voided lifecycle cannot be counted as a win from an inconsistent settlement', async () => {
  const { repositories, pick } = await fixture();
  pick.status = 'voided';
  await assert.rejects(getMemberPerformance(repositories, options), /disagree/);
});

test('partial, unverified or branched settlement history fails the whole response', async () => {
  const { repositories, settlement } = await fixture();
  settlement.corrects_id = randomUUID();
  await assert.rejects(getMemberPerformance(repositories, options));
  settlement.corrects_id = null;
  settlement.confidence = 'estimated';
  await assert.rejects(getMemberPerformance(repositories, options));
});

test('the service requests two complete populations without imposing a response-page limit', async () => {
  const { repositories, pick } = await fixture();
  const rows = Array.from(
    { length: 403 },
    (_, index): PickRecord => ({
      ...pick,
      id: String(index).padStart(8, '0'),
      source: 'system',
      metadata: {},
    }),
  );
  let calls = 0;
  repositories.picks.listByLifecycleStates = async (_states, limit, offset) => {
    calls++;
    assert.equal(limit, undefined);
    assert.equal(offset, undefined);
    return rows;
  };
  assert.equal(
    (await getMemberPerformance(repositories, options)).stats.picks,
    0,
  );
  assert.equal(calls, 2);
});

test('duplicate/nonprogress pages and repository errors never produce partial success', async () => {
  const { repositories, pick } = await fixture();
  repositories.picks.listByLifecycleStates = async () => [pick, pick];
  await assert.rejects(
    getMemberPerformance(repositories, options),
    /inconsistent/,
  );
  repositories.picks.listByLifecycleStates = async () => {
    throw new Error('database secret');
  };
  await assert.rejects(getMemberPerformance(repositories, options));
});

test('population and child-history mutations between consistency scans fail closed', async () => {
  const { repositories, pick } = await fixture();
  const reader = repositories.picks.listByLifecycleStates.bind(
    repositories.picks,
  );
  let scans = 0;
  repositories.picks.listByLifecycleStates = async (states, limit, offset) => {
    if (offset === undefined && ++scans === 2) pick.odds = -110;
    return reader(states, limit, offset);
  };
  await assert.rejects(getMemberPerformance(repositories, options), /changed/);
  repositories.picks.listByLifecycleStates = reader;
  const childReader = repositories.settlements.listByPick.bind(
    repositories.settlements,
  );
  let calls = 0;
  repositories.settlements.listByPick = async (id) => {
    const rows = await childReader(id);
    return ++calls === 2
      ? rows.map((row) => ({ ...row, result: 'loss' }))
      : rows;
  };
  await assert.rejects(getMemberPerformance(repositories, options), /changed/);
});
