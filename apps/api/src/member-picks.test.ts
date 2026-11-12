/**
 * WORK-2026092901: member pick truth. `/api/member/picks` returns only
 * delivery-eligible, server-authorized official picks that were posted to
 * members or have settled -- whatever the caller asks for.
 */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  humanCapperDeliveryAuthorizationVersion,
  isMemberVisibleOfficialPick,
  type CanonicalPick,
} from '@unit-talk/contracts';
import type { RepositoryBundle } from '@unit-talk/db';
import { createApiServer } from './server.js';
import { canReadMemberPicks } from './routes/member-picks.js';
import { canSyncMemberTiers, handleMemberTiers } from './routes/member-tiers.js';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { authenticateRequest, authorizeRoute, loadAuthConfig } from './auth.js';

function authorization(decision: 'authorized' | 'refused') {
  return {
    version: humanCapperDeliveryAuthorizationVersion,
    decision,
    capperId: 'griff843',
    authority: 'server-allowlist',
    allowlistSource: 'UNIT_TALK_HUMAN_CAPPER_DELIVERY_ALLOWLIST',
    decidedAt: '2026-09-28T00:00:00.000Z',
    ...(decision === 'refused' ? { reason: 'track-only-requested' } : {}),
  };
}

const official = {
  sport: 'MLB',
  eventName: 'Yankees vs Red Sox',
  eventTime: '2026-09-29T23:05:00.000Z',
  capper: 'griff843',
  thesis: 'Bullpen edge.',
  distributionMode: 'delivery-eligible',
  deliveryAuthorization: authorization('authorized'),
  // Internal fields a member surface must never receive.
  realEdge: 0.05,
  capperClvPct: 2.4,
  smartFormProvenance: { path: 'manual' },
};

const cases: Array<{ label: string; status: CanonicalPick['lifecycleState']; metadata: Record<string, unknown>; visible: boolean }> = [
  { label: 'posted official', status: 'posted', metadata: official, visible: true },
  { label: 'settled official', status: 'settled', metadata: official, visible: true },
  { label: 'queued official (held by the kill switch)', status: 'queued', metadata: official, visible: false },
  { label: 'validated official', status: 'validated', metadata: official, visible: false },
  { label: 'voided official', status: 'voided', metadata: official, visible: false },
  {
    label: 'posted track-only',
    status: 'posted',
    metadata: { ...official, distributionMode: 'track-only', deliveryAuthorization: authorization('refused') },
    visible: false,
  },
  {
    label: 'posted delivery-eligible but refused',
    status: 'posted',
    metadata: { ...official, deliveryAuthorization: authorization('refused') },
    visible: false,
  },
  {
    label: 'posted fixture with no distributionMode',
    status: 'posted',
    metadata: { sport: 'NBA', eventName: 'Fixture', capper: 'ci' },
    visible: false,
  },
  {
    label: 'posted scanner row with a forged unversioned authorization',
    status: 'posted',
    metadata: { ...official, deliveryAuthorization: { decision: 'authorized' } },
    visible: false,
  },
];

async function seed(repositories: RepositoryBundle) {
  const ids = new Map<string, string>();
  for (const [index, c] of cases.entries()) {
    const id = randomUUID();
    ids.set(c.label, id);
    await repositories.picks.savePick({
      id,
      submissionId: randomUUID(),
      market: 'Moneyline',
      selection: `Pick ${index}`,
      odds: -110,
      stakeUnits: 2,
      source: 'smart-form',
      approvalStatus: 'approved',
      promotionStatus: 'not_eligible',
      lifecycleState: c.status,
      metadata: c.metadata,
      createdAt: new Date(Date.UTC(2026, 8, 29, 0, index)).toISOString(),
    });
  }
  return ids;
}

async function withServer<T>(
  repositories: RepositoryBundle,
  fn: (base: string) => Promise<T>,
): Promise<T> {
  const server = createApiServer({ repositories });
  server.listen(0);
  await once(server, 'listening');
  try {
    return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
}

type Body = {
  ok: boolean;
  count?: number;
  picks?: Array<{ id: string; status: string; stake_units: number | null; metadata: Record<string, unknown> }>;
  error?: { code: string };
};

for (const route of ['/api/member/picks?status=settled', '/api/picks?status=settled', '/api/settlements/recent']) {
test(`WORK-2026103005: ${route} excludes canary, unknown and mismatched outbox audiences`, async () => {
  const repositories = createInMemoryRepositoryBundle();
  const visibleIds: string[] = [];
  for (const [audience, outboxAudience] of [
    [undefined, undefined], ['members', 'members'], ['staff-canary', 'staff-canary'],
    ['unknown', 'unknown'], [null, null], ['members', 'staff-canary'],
  ]) {
    const id = randomUUID();
    if (audience === undefined || (audience === 'members' && outboxAudience === 'members')) visibleIds.push(id);
    await repositories.picks.savePick({
      id, submissionId: randomUUID(), market: 'moneyline', selection: id, odds: 100,
      stakeUnits: 1, source: 'smart-form', approvalStatus: 'approved', promotionStatus: 'not_eligible',
      lifecycleState: 'settled', createdAt: '2026-10-30T12:00:00.000Z',
      metadata: { ...official, deliveryAuthorization: { ...authorization('authorized'), ...(audience === undefined ? {} : { audience }) } },
    });
    await repositories.outbox.enqueue({ pickId: id, target: 'discord:official-picks', idempotencyKey: id,
      payload: { deliveryDestination: { ...(outboxAudience === undefined ? {} : { audience: outboxAudience }) } } });
    await repositories.settlements.record({ pickId: id, status: 'settled', result: 'win', source: 'operator',
      confidence: 'confirmed', evidenceRef: 'test://audience', settledBy: 'operator:test',
      settledAt: '2026-10-30T12:00:00.000Z', payload: {} });
  }
  await withServer(repositories, async (base) => {
      const response = await fetch(base + route);
      assert.equal(response.status, 200, route);
      const body = await response.json() as { count: number; picks?: Array<{ id: string }>; settlements?: Array<{ pick_id: string }> };
      assert.equal(body.count, 2, route);
      assert.deepEqual((body.picks?.map((p) => p.id) ?? body.settlements!.map((s) => s.pick_id)).sort(), visibleIds.slice().sort(), route);
  });
  // Exclusion is a projection, never deletion or a lifecycle rewrite.
  assert.equal((await repositories.picks.listByLifecycleStates(['settled'])).length, 6);
});
}

test('the contracts predicate admits exactly the member-visible cases', () => {
  for (const c of cases) {
    assert.equal(isMemberVisibleOfficialPick({ status: c.status, metadata: c.metadata }), c.visible, c.label);
  }
  assert.equal(isMemberVisibleOfficialPick({ status: 'posted', metadata: null }), false);
});

test('GET /api/member/picks returns only posted/settled authorized official picks', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const ids = await seed(repositories);
  await withServer(repositories, async (base) => {
    const response = await fetch(`${base}/api/member/picks?status=posted,settled&limit=50`);
    const body = (await response.json()) as Body;
    assert.equal(response.status, 200);
    const returned = new Set(body.picks?.map((p) => p.id));
    for (const c of cases) {
      assert.equal(returned.has(ids.get(c.label)!), c.visible, c.label);
    }
    assert.equal(body.count, 2);
  });
});

test('status=posted narrows to posted only', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await seed(repositories);
  await withServer(repositories, async (base) => {
    const body = (await (await fetch(`${base}/api/member/picks?status=posted`)).json()) as Body;
    assert.deepEqual(body.picks?.map((p) => p.status), ['posted']);
  });
});

test('member metadata is projected to capper, sport, eventName, eventTime and thesis only', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await seed(repositories);
  await withServer(repositories, async (base) => {
    const body = (await (await fetch(`${base}/api/member/picks?status=posted`)).json()) as Body;
    const pick = body.picks?.[0];
    assert.ok(pick);
    assert.deepEqual(Object.keys(pick.metadata).sort(), ['capper', 'eventName', 'eventTime', 'sport', 'thesis']);
    assert.equal(pick.stake_units, 2);
  });
});

for (const status of ['validated', 'queued', 'posted,queued', 'voided']) {
  test(`status=${status} is refused with 400, never widened`, async () => {
    const repositories = createInMemoryRepositoryBundle();
    await seed(repositories);
    await withServer(repositories, async (base) => {
      const response = await fetch(`${base}/api/member/picks?status=${status}`);
      const body = (await response.json()) as Body;
      assert.equal(response.status, 400);
      assert.equal(body.error?.code, 'INVALID_STATUS');
    });
  });
}

test('a missing status is refused with 400', async () => {
  await withServer(createInMemoryRepositoryBundle(), async (base) => {
    const response = await fetch(`${base}/api/member/picks`);
    assert.equal(response.status, 400);
  });
});

test('a pick repository without the member reader fails closed with 503', async () => {
  const repositories = createInMemoryRepositoryBundle();
  await seed(repositories);
  const picks = repositories.picks as { listMemberVisibleOfficialPicks?: unknown };
  picks.listMemberVisibleOfficialPicks = undefined;
  await withServer(repositories, async (base) => {
    const response = await fetch(`${base}/api/member/picks?status=posted`);
    const body = (await response.json()) as Body;
    assert.equal(response.status, 503);
    assert.equal(body.error?.code, 'MEMBER_PICKS_UNAVAILABLE');
  });
});

// --- Access boundary -------------------------------------------------------
//
// With no API key configured and fail_open, authenticateRequest falls back to
// an operator bypass context, so an anonymous request would be authorized and
// a 401 assertion would be vacuous. These tests configure real keys and
// restore the environment afterwards.

const AUTH_KEYS = {
  UNIT_TALK_API_KEY_OPERATOR: 'op-member-picks-key',
  UNIT_TALK_BOT_API_KEY: 'bot-member-picks-key',
  UNIT_TALK_API_KEY_SUBMITTER: 'sub-member-picks-key',
  UNIT_TALK_API_KEY_WORKER: 'wkr-member-picks-key',
} as const;

async function withAuthKeys<T>(fn: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(AUTH_KEYS)) {
    previous.set(name, process.env[name]);
    process.env[name] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function getMemberPicks(base: string, token?: string) {
  const response = await fetch(`${base}/api/member/picks?status=posted,settled`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: response.status, raw: await response.text() };
}

test('anonymous GET /api/member/picks is refused with 401 and leaks no pick', async () => {
  await withAuthKeys(async () => {
    const repositories = createInMemoryRepositoryBundle();
    const ids = await seed(repositories);
    await withServer(repositories, async (base) => {
      for (const token of [undefined, 'not-a-configured-key']) {
        const { status, raw } = await getMemberPicks(base, token);
        assert.equal(status, 401, `token=${token ?? 'none'}`);
        assert.equal((JSON.parse(raw) as Body).error?.code, 'UNAUTHORIZED');
        for (const id of ids.values()) {
          assert.ok(!raw.includes(id), 'a refused response must not contain any pick id');
        }
        assert.ok(!raw.includes('Bullpen edge.'), 'a refused response must not contain pick content');
      }
    });
  });
});

test('an authenticated key that is neither operator nor the Discord bot is refused with 403', async () => {
  await withAuthKeys(async () => {
    const repositories = createInMemoryRepositoryBundle();
    const ids = await seed(repositories);
    await withServer(repositories, async (base) => {
      for (const token of [AUTH_KEYS.UNIT_TALK_API_KEY_SUBMITTER, AUTH_KEYS.UNIT_TALK_API_KEY_WORKER]) {
        const { status, raw } = await getMemberPicks(base, token);
        assert.equal(status, 403, token);
        assert.equal((JSON.parse(raw) as Body).error?.code, 'FORBIDDEN');
        for (const id of ids.values()) {
          assert.ok(!raw.includes(id), 'a refused response must not contain any pick id');
        }
      }
    });
  });
});

test('the Discord bot service key and an operator key read exactly the member-visible picks', async () => {
  await withAuthKeys(async () => {
    const repositories = createInMemoryRepositoryBundle();
    const ids = await seed(repositories);
    const visible = new Set(cases.filter((c) => c.visible).map((c) => ids.get(c.label)!));
    await withServer(repositories, async (base) => {
      for (const token of [AUTH_KEYS.UNIT_TALK_BOT_API_KEY, AUTH_KEYS.UNIT_TALK_API_KEY_OPERATOR]) {
        const { status, raw } = await getMemberPicks(base, token);
        assert.equal(status, 200, token);
        const body = JSON.parse(raw) as Body;
        assert.deepEqual(new Set(body.picks?.map((p) => p.id)), visible, token);
      }
    });
  });
});

test('canReadMemberPicks admits only an operator or the Discord bot service identity', () => {
  assert.equal(canReadMemberPicks({ role: 'operator', identity: 'operator:abcd1234' }), true);
  assert.equal(canReadMemberPicks({ role: 'submitter', identity: 'submitter:discord-bot:abcd1234' }), true);
  assert.equal(canReadMemberPicks({ role: 'submitter', identity: 'submitter:abcd1234' }), false);
  assert.equal(canReadMemberPicks({ role: 'worker', identity: 'submitter:discord-bot:abcd1234' }), false);
  assert.equal(
    canReadMemberPicks({ role: 'capper', identity: 'capper:griff843', capperId: 'griff843' }),
    false,
  );
});

// --- WORK-2026101104: bot-scoped member-tier sync authorization -------------
//
// Kept beside the member-picks access tests because they share the real
// authenticateRequest + gate path and the same bot/submitter key shapes
// (no mock of the gate). auth.test.ts:205 keeps asserting that
// authorizeRoute refuses a submitter for /api/member-tiers; ROUTE_ROLES is
// unchanged, and the bot is admitted by identity in the server gate.

const BOT_IDENTITY = 'submitter:discord-bot:bot-memb';
const BOT_USER = '123456789012345678';

async function postMemberTier(base: string, token: string | undefined, body: Record<string, unknown>) {
  const response = await fetch(`${base}/api/member-tiers`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, raw: await response.text() };
}

const SYNC_BODY = { discord_id: BOT_USER, tier: 'trial', action: 'activate', source: 'discord-role' };

test('canSyncMemberTiers admits only an operator or the Discord bot service identity', () => {
  assert.equal(canSyncMemberTiers({ role: 'operator', identity: 'operator:abcd1234' }), true);
  assert.equal(canSyncMemberTiers({ role: 'submitter', identity: BOT_IDENTITY }), true);
  assert.equal(canSyncMemberTiers({ role: 'submitter', identity: 'submitter:abcd1234' }), false);
  assert.equal(canSyncMemberTiers({ role: 'submitter', identity: 'submitter:discord-bot' }), false);
  assert.equal(canSyncMemberTiers({ role: 'submitter', identity: 'submitter:discord-botx:abcd1234' }), false);
  assert.equal(canSyncMemberTiers({ role: 'submitter', identity: 'operator:discord-bot:abcd1234' }), false);
  assert.equal(canSyncMemberTiers({ role: 'worker', identity: BOT_IDENTITY }), false);
  assert.equal(canSyncMemberTiers({ role: 'settler', identity: BOT_IDENTITY }), false);
  assert.equal(
    canSyncMemberTiers({ role: 'capper', identity: 'capper:griff843', capperId: 'griff843' }),
    false,
  );
});

test('POST /api/member-tiers refuses anonymous with 401 and a generic submitter or worker key with 403, writing nothing', async () => {
  await withAuthKeys(async () => {
    const repositories = createInMemoryRepositoryBundle();
    await withServer(repositories, async (base) => {
      for (const token of [undefined, 'not-a-configured-key']) {
        const { status } = await postMemberTier(base, token, SYNC_BODY);
        assert.equal(status, 401, `token=${token ?? 'none'}`);
      }
      for (const token of [AUTH_KEYS.UNIT_TALK_API_KEY_SUBMITTER, AUTH_KEYS.UNIT_TALK_API_KEY_WORKER]) {
        const { status, raw } = await postMemberTier(base, token, SYNC_BODY);
        assert.equal(status, 403, token);
        assert.equal((JSON.parse(raw) as Body).error?.code, 'FORBIDDEN');
      }
      assert.deepEqual(await repositories.tiers.getTierHistory(BOT_USER), []);
      assert.deepEqual(
        await repositories.audit.listRecentByEntityType('member_tiers', '2000-01-01T00:00:00.000Z', 'member_tier.synced'),
        [],
      );
    });
  });
});

test('the bot key syncs a tier: 200, source forced to discord-role, changed_by is the caller identity, one audit row', async () => {
  await withAuthKeys(async () => {
    const repositories = createInMemoryRepositoryBundle();
    await withServer(repositories, async (base) => {
      // The body asks for a different source; the server ignores it.
      const { status } = await postMemberTier(base, AUTH_KEYS.UNIT_TALK_BOT_API_KEY, {
        ...SYNC_BODY,
        source: 'manual',
      });
      assert.equal(status, 200);

      const history = await repositories.tiers.getTierHistory(BOT_USER);
      assert.equal(history.length, 1);
      assert.equal(history[0]?.tier, 'trial');
      assert.equal(history[0]?.source, 'discord-role');
      assert.equal(history[0]?.changed_by, BOT_IDENTITY);

      const audit = await repositories.audit.listRecentByEntityType(
        'member_tiers',
        '2000-01-01T00:00:00.000Z',
        'member_tier.synced',
      );
      assert.equal(audit.length, 1);
      assert.equal(audit[0]?.actor, BOT_IDENTITY);
      assert.equal(audit[0]?.entity_id, history[0]?.id);
      assert.equal((audit[0]?.payload as Record<string, unknown>).source, 'discord-role');

      // Idempotent: the same activation returns the existing row, no duplicate.
      const again = await postMemberTier(base, AUTH_KEYS.UNIT_TALK_BOT_API_KEY, SYNC_BODY);
      assert.equal(again.status, 200);
      assert.equal((await repositories.tiers.getTierHistory(BOT_USER)).length, 1);

      // Deactivation ends it and is audited.
      const off = await postMemberTier(base, AUTH_KEYS.UNIT_TALK_BOT_API_KEY, { ...SYNC_BODY, action: 'deactivate' });
      assert.equal(off.status, 200);
      assert.deepEqual(await repositories.tiers.getActiveTiers(BOT_USER), []);
      // Deactivating a tier that is not active is a no-op 200.
      const offAgain = await postMemberTier(base, AUTH_KEYS.UNIT_TALK_BOT_API_KEY, { ...SYNC_BODY, action: 'deactivate' });
      assert.equal(offAgain.status, 200);
    });
  });
});

test('the bot key rejects free but accepts all five Discord-mapped tiers', async () => {
  await withAuthKeys(async () => {
    const repositories = createInMemoryRepositoryBundle();
    await withServer(repositories, async (base) => {
      for (const tier of ['free']) {
        for (const action of ['activate', 'deactivate']) {
          const { status, raw } = await postMemberTier(base, AUTH_KEYS.UNIT_TALK_BOT_API_KEY, {
            ...SYNC_BODY,
            tier,
            action,
          });
          assert.equal(status, 403, `${tier}/${action}`);
          assert.equal((JSON.parse(raw) as Body).error?.code, 'TIER_NOT_BOT_SYNCABLE');
        }
      }
      assert.deepEqual(await repositories.tiers.getTierHistory(BOT_USER), []);
      assert.deepEqual(
        await repositories.audit.listRecentByEntityType('member_tiers', '2000-01-01T00:00:00.000Z', 'member_tier.synced'),
        [],
      );
      // All configured Discord-mapped tiers are accepted.
      for (const tier of ['trial', 'vip', 'vip-plus', 'capper', 'operator']) {
        const { status } = await postMemberTier(base, AUTH_KEYS.UNIT_TALK_BOT_API_KEY, { ...SYNC_BODY, tier });
        assert.equal(status, 200, tier);
      }
    });
  });
});

test('an operator key can still write capper and operator tiers', async () => {
  await withAuthKeys(async () => {
    const repositories = createInMemoryRepositoryBundle();
    await withServer(repositories, async (base) => {
      for (const tier of ['capper', 'operator']) {
        const { status } = await postMemberTier(base, AUTH_KEYS.UNIT_TALK_API_KEY_OPERATOR, { ...SYNC_BODY, tier });
        assert.equal(status, 200, tier);
      }
    });
  });
});

test('the bot key cannot write a malformed discord_id: 400 and nothing written', async () => {
  await withAuthKeys(async () => {
    const repositories = createInMemoryRepositoryBundle();
    await withServer(repositories, async (base) => {
      for (const id of ['', 'abc', 'user-123', '12345', '1234567890123456', '123456789012345678901', '12345678901234567 ', '१२३४५६७८९०१२३४५६७८९']) {
        const { status } = await postMemberTier(base, AUTH_KEYS.UNIT_TALK_BOT_API_KEY, { ...SYNC_BODY, discord_id: id });
        assert.equal(status, 400, JSON.stringify(id));
      }
      const { status } = await postMemberTier(base, AUTH_KEYS.UNIT_TALK_BOT_API_KEY, { ...SYNC_BODY, discord_id: 1234567890123 });
      assert.equal(status, 400, 'a number is not a string id');
      assert.deepEqual(
        await repositories.audit.listRecentByEntityType('member_tiers', '2000-01-01T00:00:00.000Z', 'member_tier.synced'),
        [],
      );
    });
  });
});

test('KNOWN LIMITATION (B2 scope): if the audit write fails the tier write has already happened and the caller sees a 500', async () => {
  await withAuthKeys(async () => {
    const repositories = createInMemoryRepositoryBundle();
    repositories.audit.record = async () => {
      throw new Error('audit unavailable');
    };
    await withServer(repositories, async (base) => {
      const { status } = await postMemberTier(base, AUTH_KEYS.UNIT_TALK_BOT_API_KEY, SYNC_BODY);
      assert.notEqual(status, 200, 'the failure is visible to the caller, never reported as success');
      assert.ok(status >= 500, `status=${status}`);
      // The two writes are not atomic: the tier row exists without its audit row.
      // Fixing that needs the Tier C repository work owned by B2; this test
      // pins today's behaviour so a change to it is deliberate.
      assert.equal((await repositories.tiers.getTierHistory(BOT_USER)).length, 1);
    });
  });
});

test('the server gate alone refuses a generic submitter: its 403 comes from the gate, not the handler', async () => {
  await withAuthKeys(async () => {
    const repositories = createInMemoryRepositoryBundle();
    await withServer(repositories, async (base) => {
      const { status, raw } = await postMemberTier(base, AUTH_KEYS.UNIT_TALK_API_KEY_SUBMITTER, SYNC_BODY);
      assert.equal(status, 403);
      assert.match(
        (JSON.parse(raw) as { error?: { message?: string } }).error?.message ?? '',
        /is not authorized for \/api\/member-tiers/u,
        'the gate (not the handler) must be what refuses a generic submitter',
      );
    });
  });
});

test('the handler alone fails closed: no auth context, or a generic submitter context, is refused before any write', async () => {
  const repositories = createInMemoryRepositoryBundle();
  for (const auth of [undefined, { role: 'submitter' as const, identity: 'submitter:abcd1234' }]) {
    let status = 0;
    const request = { auth } as never;
    const response = {
      setHeader() {},
      getHeader() { return undefined; },
      end() {},
      set statusCode(value: number) { status = value; },
    } as never;
    await handleMemberTiers(request, response, { repositories, bodyLimitBytes: 1024 } as never);
    assert.equal(status, 403, JSON.stringify(auth));
  }
  assert.deepEqual(await repositories.tiers.getTierHistory(BOT_USER), []);
});

test('an operator key still syncs a tier, keeps its source, records its identity and is audited', async () => {
  await withAuthKeys(async () => {
    const repositories = createInMemoryRepositoryBundle();
    await withServer(repositories, async (base) => {
      const { status } = await postMemberTier(base, AUTH_KEYS.UNIT_TALK_API_KEY_OPERATOR, {
        discord_id: 'discord-user-2',
        tier: 'free',
        action: 'activate',
        source: 'manual',
      });
      assert.equal(status, 200);
      const history = await repositories.tiers.getTierHistory('discord-user-2');
      assert.equal(history[0]?.source, 'manual');
      assert.equal(history[0]?.changed_by, 'operator:op-membe');
      const audit = await repositories.audit.listRecentByEntityType(
        'member_tiers',
        '2000-01-01T00:00:00.000Z',
        'member_tier.synced',
      );
      assert.equal(audit.length, 1);
      assert.equal(audit[0]?.actor, 'operator:op-membe');
    });
  });
});

test('bot Trial activation passes a bounded expiry to the existing repository API', async () => {
  await withAuthKeys(async () => {
    const repositories = createInMemoryRepositoryBundle();
    const activate = repositories.tiers.activateTier.bind(repositories.tiers);
    const inputs: Array<Parameters<typeof activate>[0]> = [];
    repositories.tiers.activateTier = async (input) => {
      inputs.push(input);
      return activate(input);
    };
    await withServer(repositories, async (base) => {
      const before = Date.now();
      assert.equal((await postMemberTier(base, AUTH_KEYS.UNIT_TALK_BOT_API_KEY, SYNC_BODY)).status, 200);
      const after = Date.now();
      const raw = Number.parseInt(process.env.TRIAL_DURATION_DAYS ?? '', 10);
      const days = Number.isFinite(raw) && raw > 0 ? raw : 7;
      const expiry = inputs[0]?.effectiveUntil;
      assert.ok(expiry instanceof Date, 'activateTier receives a non-null Date');
      assert.ok(expiry.getTime() >= before + days * 86_400_000);
      assert.ok(expiry.getTime() <= after + days * 86_400_000);
      assert.equal((await repositories.tiers.getTierHistory(BOT_USER))[0]?.effective_until, expiry.toISOString());
      for (const tier of ['vip', 'vip-plus']) {
        assert.equal((await postMemberTier(base, AUTH_KEYS.UNIT_TALK_BOT_API_KEY, { ...SYNC_BODY, tier })).status, 200);
        assert.equal(inputs.at(-1)?.effectiveUntil, undefined, tier);
        assert.equal((await repositories.tiers.getTierHistory(BOT_USER)).find((row) => row.tier === tier)?.effective_until, null);
      }
    });
  });
});

test('bot Trial expiry honors both the seven-day default and configured duration in fresh API processes', () => {
  for (const duration of [undefined, '11']) {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    if (duration === undefined) delete env.TRIAL_DURATION_DAYS;
    else env.TRIAL_DURATION_DAYS = duration;
    const result = spawnSync(process.execPath, [
      '--import', 'tsx', '--test', '--test-reporter=tap',
      '--test-name-pattern=bot Trial activation passes',
      'apps/api/src/member-picks.test.ts',
    ], { env, encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /# pass 1/u);
  }
});

test('Capper and Operator member-tier sync never elevates the bot caller or bypasses route authorization', async () => {
  await withAuthKeys(async () => {
    const repositories = createInMemoryRepositoryBundle();
    await withServer(repositories, async (base) => {
      for (const tier of ['capper', 'operator']) {
        assert.equal((await postMemberTier(base, AUTH_KEYS.UNIT_TALK_BOT_API_KEY, { ...SYNC_BODY, tier })).status, 200);
        const auth = await authenticateRequest({ headers: { authorization: `Bearer ${AUTH_KEYS.UNIT_TALK_BOT_API_KEY}` } } as Parameters<typeof authenticateRequest>[0], loadAuthConfig(process.env));
        assert.ok(auth);
        assert.equal(auth.role, 'submitter');
        assert.equal(auth.identity, BOT_IDENTITY);
        assert.equal(authorizeRoute(auth, '/api/member-tiers'), false);
        const audit = await repositories.audit.listRecentByEntityType('member_tiers', '2000-01-01T00:00:00.000Z', 'member_tier.synced');
        assert.ok(audit.every((row) => row.actor === BOT_IDENTITY && (row.payload as Record<string, unknown>).callerRole === 'submitter'));
      }
      const tiers = await repositories.tiers.getActiveTiers(BOT_USER);
      assert.ok(tiers.some((row) => row.tier === 'capper'));
      assert.ok(tiers.some((row) => row.tier === 'operator'));
    });
  });
});
