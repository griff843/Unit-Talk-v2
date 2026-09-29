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
