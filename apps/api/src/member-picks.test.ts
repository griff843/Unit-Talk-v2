/**
 * WORK-2026092901: member pick truth. `/api/member/picks` returns only
 * delivery-eligible, server-authorized official picks that were posted to
 * members or have settled -- whatever the caller asks for.
 */
import assert from 'node:assert/strict';
import { once } from 'node:events';
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
import { createInMemoryRepositoryBundle } from './persistence.js';

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
