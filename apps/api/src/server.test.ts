import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createApiServer } from './server.js';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { processSubmission } from './submission-service.js';
import { transitionPickLifecycle } from './lifecycle-service.js';

test('GET /health returns service status', async () => {
  const server = createApiServer({
    repositories: createInMemoryRepositoryBundle(),
  });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    const body = (await response.json()) as {
      ok: boolean;
      service: string;
      persistenceMode: string;
    };

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.service, 'api');
    assert.equal(body.persistenceMode, 'in_memory');
  } finally {
    server.close();
  }
});

test('POST /api/submissions returns created submission payload', async () => {
  const server = createApiServer({
    repositories: createInMemoryRepositoryBundle(),
  });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/submissions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        source: 'server-test',
        market: 'NBA points',
        selection: 'Player Over 18.5',
      }),
    });
    const body = (await response.json()) as {
      ok: boolean;
      data?: {
        pickId: string;
        lifecycleState: string;
      };
    };

    assert.equal(response.status, 201);
    assert.equal(body.ok, true);
    assert.ok(body.data?.pickId);
    assert.equal(body.data?.lifecycleState, 'validated');
  } finally {
    server.close();
  }
});

test('POST /api/picks/:id/settle settles a posted pick', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const created = await processSubmission(
    {
      source: 'server-test',
      market: 'NBA rebounds',
      selection: 'Player Over 10.5',
    },
    repositories,
  );
  await transitionPickLifecycle(repositories.picks, created.pick.id, 'queued', 'queued');
  await transitionPickLifecycle(
    repositories.picks,
    created.pick.id,
    'posted',
    'posted',
    'poster',
  );

  const server = createApiServer({ repositories });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/picks/${created.pick.id}/settle`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          status: 'settled',
          result: 'win',
          source: 'operator',
          confidence: 'confirmed',
          evidenceRef: 'boxscore://server-test',
          settledBy: 'operator',
        }),
      },
    );
    const body = (await response.json()) as {
      ok: boolean;
      data?: {
        settlementStatus: string;
        finalLifecycleState: string;
        downstream: {
          effectiveSettlementResult: string | null;
          totalRecords: number;
          lossAttributionClassification: string | null;
        };
      };
    };

    assert.equal(response.status, 201);
    assert.equal(body.ok, true);
    assert.equal(body.data?.settlementStatus, 'settled');
    assert.equal(body.data?.finalLifecycleState, 'settled');
    assert.equal(body.data?.downstream.effectiveSettlementResult, 'win');
    assert.equal(body.data?.downstream.totalRecords, 1);
    assert.equal(body.data?.downstream.lossAttributionClassification, null);
  } finally {
    server.close();
  }
});

test('POST /api/picks/:id/settle returns downstream loss attribution when inputs exist', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const created = await processSubmission(
    {
      source: 'server-test',
      market: 'NBA rebounds',
      selection: 'Player Over 10.5',
      metadata: {
        lossAttribution: {
          ev: 5.2,
          clvAtBet: -4.2,
          clvAtClose: -4.1,
          hasFeatureSnapshot: true,
        },
      },
    },
    repositories,
  );
  await transitionPickLifecycle(repositories.picks, created.pick.id, 'queued', 'queued');
  await transitionPickLifecycle(
    repositories.picks,
    created.pick.id,
    'posted',
    'posted',
    'poster',
  );

  const server = createApiServer({ repositories });

  server.listen(0);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/picks/${created.pick.id}/settle`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          status: 'settled',
          result: 'loss',
          source: 'operator',
          confidence: 'confirmed',
          evidenceRef: 'boxscore://server-test-loss',
          settledBy: 'operator',
        }),
      },
    );
    const body = (await response.json()) as {
      ok: boolean;
      data?: {
        downstream: {
          effectiveSettlementResult: string | null;
          lossAttributionClassification: string | null;
        };
      };
    };

    assert.equal(response.status, 201);
    assert.equal(body.ok, true);
    assert.equal(body.data?.downstream.effectiveSettlementResult, 'loss');
    assert.equal(
      body.data?.downstream.lossAttributionClassification,
      'PRICE_MISS',
    );
  } finally {
    server.close();
  }
});
