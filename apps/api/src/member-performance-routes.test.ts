import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { SignJWT } from 'jose';
import type { AddressInfo } from 'node:net';
import { createApiRuntimeDependencies, createApiServer } from './server.js';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { canReadMemberPerformance } from './routes/member-performance.js';

async function serverTest(
  fn: (base: string) => Promise<void>,
  authEnabled = true,
) {
  const runtime = createApiRuntimeDependencies({
    repositories: createInMemoryRepositoryBundle(),
  });
  runtime.authConfig = {
    enabled: authEnabled,
    failClosed: false,
    jwtSecret: 'public-performance-test-secret',
    keys: new Map([
      ['operator', { role: 'operator', identity: 'operator:configured' }],
      [
        'discord-bot',
        { role: 'submitter', identity: 'submitter:discord-bot:configured' },
      ],
      ['submitter', { role: 'submitter', identity: 'submitter:configured' }],
      ['worker', { role: 'worker', identity: 'worker:configured' }],
    ]),
  };
  const server = createApiServer({ runtime });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const routes = ['/api/operator/stats', '/api/operator/leaderboard'];
test('auth policy admits only authenticated operator and the configured bot identity', () => {
  assert.ok(
    canReadMemberPerformance({
      role: 'operator',
      identity: 'operator:configured',
    }),
  );
  assert.ok(
    canReadMemberPerformance({
      role: 'submitter',
      identity: 'submitter:discord-bot:key',
    }),
  );
  for (const identity of [
    'anonymous:auth-bypass',
    'submitter:configured',
    'submitter:discord-bot-spoof',
  ]) {
    assert.equal(
      canReadMemberPerformance({
        role: identity.startsWith('anonymous') ? 'operator' : 'submitter',
        identity,
      }),
      false,
    );
  }
  assert.equal(
    canReadMemberPerformance({ role: 'capper', identity: 'capper:griff' }),
    false,
  );
});

test('both canonical routes authenticate and preserve the existing response contracts', async () => {
  await serverTest(async (base) => {
    for (const route of routes) {
      for (const token of ['operator', 'discord-bot']) {
        const response = await fetch(base + route, {
          headers: { authorization: `Bearer ${token}` },
        });
        assert.equal(response.status, 200);
        const body = (await response.json()) as {
          ok: boolean;
          data: Record<string, unknown>;
        };
        assert.equal(body.ok, true);
        assert.equal(body.data['window'], 30);
        if (route.endsWith('stats')) {
          assert.deepEqual(
            Object.keys(body.data).sort(),
            [
              'scope',
              'capper',
              'window',
              'sport',
              'picks',
              'wins',
              'losses',
              'pushes',
              'winRate',
              'roiPct',
              'avgClvPct',
              'beatsLine',
              'picksWithClv',
              'lastFive',
            ].sort(),
          );
          assert.equal(body.data['picks'], 0);
        } else {
          assert.deepEqual(
            Object.keys(body.data).sort(),
            ['window', 'sport', 'minPicks', 'entries', 'observedAt'].sort(),
          );
          assert.deepEqual(body.data['entries'], []);
          assert.ok(
            Number.isFinite(Date.parse(String(body.data['observedAt']))),
          );
        }
      }
    }
  });
});

test('anonymous, invalid, generic submitter, worker and capper JWT cannot access either aggregate', async () => {
  const capperToken = await new SignJWT({
    role: 'capper',
    capperId: 'griff843',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode('public-performance-test-secret'));
  await serverTest(async (base) => {
    for (const route of routes) {
      for (const [token, expected] of [
        [undefined, 401],
        ['invalid', 401],
        ['submitter', 403],
        ['worker', 403],
        [capperToken, 403],
      ] as const) {
        const response = await fetch(base + route, {
          headers: token ? { authorization: `Bearer ${token}` } : {},
        });
        assert.equal(response.status, expected);
        const body = (await response.json()) as { ok: boolean; data?: unknown };
        assert.equal(body.ok, false);
        assert.equal(body.data, undefined);
      }
    }
  });
});

test('auth-disabled anonymous bypass is refused on both new routes', async () => {
  await serverTest(async (base) => {
    for (const route of routes)
      assert.equal((await fetch(base + route)).status, 401);
  }, false);
});

test('existing windows, filters, rank bounds and invalid-query responses are wired', async () => {
  await serverTest(async (base) => {
    const headers = { authorization: 'Bearer discord-bot' };
    for (const last of [7, 14, 30, 90]) {
      const response = await fetch(
        `${base}/api/operator/stats?last=${last}&sport=MLB&capper=Unknown`,
        { headers },
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        data: { window: number; sport: string; capper: string; picks: number };
      };
      assert.equal(body.data.window, last);
      assert.equal(body.data.sport, 'MLB');
      assert.equal(body.data.capper, 'Unknown');
      assert.equal(body.data.picks, 0);
    }
    for (const query of [
      'last=8',
      'last=30.5',
      'limit=NaN',
      'minPicks=-1',
      'sport=' + 'x'.repeat(21),
    ]) {
      assert.equal(
        (await fetch(`${base}/api/operator/leaderboard?${query}`, { headers }))
          .status,
        400,
      );
    }
    for (const limit of [0, 1, 25, 100]) {
      assert.equal(
        (
          await fetch(`${base}/api/operator/leaderboard?limit=${limit}`, {
            headers,
          })
        ).status,
        200,
      );
    }
  });
});

test('repository failure returns generic 503 without operational errors or partial aggregates', async () => {
  const runtime = createApiRuntimeDependencies({
    repositories: createInMemoryRepositoryBundle(),
  });
  runtime.authConfig = {
    enabled: true,
    keys: new Map([
      ['operator', { role: 'operator', identity: 'operator:configured' }],
    ]),
  };
  runtime.repositories.picks.listByLifecycleStates = async () => {
    throw new Error('PRIVATE DATABASE SECRET');
  };
  const server = createApiServer({ runtime });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    for (const route of routes) {
      const response = await fetch(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}${route}`,
        { headers: { authorization: 'Bearer operator' } },
      );
      assert.equal(response.status, 503);
      const raw = await response.text();
      assert.ok(!raw.includes('PRIVATE'));
      assert.equal((JSON.parse(raw) as { data?: unknown }).data, undefined);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
