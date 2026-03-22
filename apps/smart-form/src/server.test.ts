import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { request } from 'node:http';
import { createSmartFormServer } from './server.js';

// --- Helpers ---

function makeRequest(
  port: number,
  path: string,
  method = 'GET',
  body?: string,
  contentType?: string,
  accept?: string,
) {
  return new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers:
          body || accept
            ? {
                ...(body && contentType
                  ? {
                      'content-type': contentType,
                      'content-length': Buffer.byteLength(body),
                    }
                  : {}),
                ...(accept ? { accept } : {}),
              }
            : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function closeServer(server: ReturnType<typeof createSmartFormServer>) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function createTestServer(fetchImpl?: typeof fetch) {
  return createSmartFormServer({
    apiBaseUrl: 'http://127.0.0.1:3000',
    fetchImpl: fetchImpl ?? (async () => {
      throw new Error('fetch should not be called');
    }),
  });
}

async function startServer(server: ReturnType<typeof createSmartFormServer>) {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected server address');
  return address.port;
}

/** URL-encode a valid player prop form body. */
function playerPropBody(overrides: Record<string, string> = {}): string {
  const fields: Record<string, string> = {
    capper: 'griff843',
    date: '2026-03-21',
    sport: 'NBA',
    sportsbook: 'draftkings',
    units: '1.5',
    oddsFormat: 'American',
    odds: '-110',
    marketType: 'player-prop',
    player: 'Jalen Brunson',
    matchup: 'Knicks vs Heat',
    statType: 'Points',
    overUnder: 'Over',
    line: '24.5',
    ...overrides,
  };
  return new URLSearchParams(fields).toString();
}

function moneylineBody(overrides: Record<string, string> = {}): string {
  const fields: Record<string, string> = {
    capper: 'griff843',
    date: '2026-03-21',
    sport: 'NFL',
    units: '2',
    odds: '+150',
    marketType: 'moneyline',
    matchup: 'Bills vs Chiefs',
    team: 'Bills',
    ...overrides,
  };
  return new URLSearchParams(fields).toString();
}

// --- Tests ---

describe('GET /health', () => {
  test('returns smart-form health payload', async () => {
    const server = createTestServer();
    const port = await startServer(server);
    const response = await makeRequest(port, '/health');
    await closeServer(server);

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body) as { ok: boolean; service: string };
    assert.equal(body.ok, true);
    assert.equal(body.service, 'smart-form');
  });
});

describe('GET /', () => {
  test('returns the V1 smart form with market type controls', async () => {
    const server = createTestServer();
    const port = await startServer(server);
    const response = await makeRequest(port, '/');
    await closeServer(server);

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Submit Pick/);
    assert.match(response.body, /marketType/);
    assert.match(response.body, /player-prop/);
    assert.match(response.body, /moneyline/);
    assert.match(response.body, /spread/);
    assert.match(response.body, /total/);
    assert.match(response.body, /team-total/);
  });

  test('renders sport options from reference data', async () => {
    const server = createTestServer();
    const port = await startServer(server);
    const response = await makeRequest(port, '/');
    await closeServer(server);

    assert.match(response.body, /NBA/);
    assert.match(response.body, /NFL/);
    assert.match(response.body, /NHL/);
    assert.match(response.body, /MLB/);
  });

  test('renders sportsbook as select (not text input)', async () => {
    const server = createTestServer();
    const port = await startServer(server);
    const response = await makeRequest(port, '/');
    await closeServer(server);

    assert.match(response.body, /Select sportsbook/);
    assert.match(response.body, /DraftKings/);
    assert.match(response.body, /FanDuel/);
  });

  test('does not render confidence field', async () => {
    const server = createTestServer();
    const port = await startServer(server);
    const response = await makeRequest(port, '/');
    await closeServer(server);

    assert.doesNotMatch(response.body, /name="confidence"/);
  });

  test('renders ticket type indicator', async () => {
    const server = createTestServer();
    const port = await startServer(server);
    const response = await makeRequest(port, '/');
    await closeServer(server);

    assert.match(response.body, /Ticket Type/);
    assert.match(response.body, /Single/);
  });
});

describe('POST /submit — validation', () => {
  test('rejects submission with missing required fields (JSON)', async () => {
    const server = createTestServer();
    const port = await startServer(server);
    const response = await makeRequest(
      port,
      '/submit',
      'POST',
      'capper=&marketType=player-prop',
      'application/x-www-form-urlencoded',
      'application/json',
    );
    await closeServer(server);

    assert.equal(response.statusCode, 422);
    const body = JSON.parse(response.body) as { ok: boolean; error: { code: string; details: string[] } };
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'FORM_VALIDATION_FAILED');
    assert.ok(body.error.details.length > 0);
  });

  test('rejects submission with missing fields (HTML re-render)', async () => {
    const server = createTestServer();
    const port = await startServer(server);
    const response = await makeRequest(
      port,
      '/submit',
      'POST',
      'capper=&marketType=player-prop',
      'application/x-www-form-urlencoded',
      'text/html',
    );
    await closeServer(server);

    assert.equal(response.statusCode, 422);
    assert.match(response.body, /error/i);
    assert.match(response.body, /Capper is required/i);
  });

  test('rejects units outside 0.5-5.0', async () => {
    const server = createTestServer();
    const port = await startServer(server);
    const response = await makeRequest(
      port,
      '/submit',
      'POST',
      playerPropBody({ units: '10' }),
      'application/x-www-form-urlencoded',
      'application/json',
    );
    await closeServer(server);

    assert.equal(response.statusCode, 422);
    const body = JSON.parse(response.body) as { error: { details: string[] } };
    assert.ok(body.error.details.some((d) => d.includes('units') || d.includes('Units')));
  });

  test('rejects zero odds', async () => {
    const server = createTestServer();
    const port = await startServer(server);
    const response = await makeRequest(
      port,
      '/submit',
      'POST',
      playerPropBody({ odds: '0' }),
      'application/x-www-form-urlencoded',
      'application/json',
    );
    await closeServer(server);

    assert.equal(response.statusCode, 422);
    const body = JSON.parse(response.body) as { error: { details: string[] } };
    assert.ok(body.error.details.some((d) => d.includes('odds') || d.includes('Odds')));
  });

  test('rejects missing market-type-specific fields', async () => {
    const server = createTestServer();
    const port = await startServer(server);
    // Player prop without player
    const response = await makeRequest(
      port,
      '/submit',
      'POST',
      playerPropBody({ player: '' }),
      'application/x-www-form-urlencoded',
      'application/json',
    );
    await closeServer(server);

    assert.equal(response.statusCode, 422);
    const body = JSON.parse(response.body) as { error: { details: string[] } };
    assert.ok(body.error.details.some((d) => d.includes('player')));
  });
});

describe('POST /submit — success flow', () => {
  test('forwards normalized payload to API and renders success', async () => {
    let capturedBody: string | undefined;

    const server = createSmartFormServer({
      apiBaseUrl: 'http://127.0.0.1:3000',
      fetchImpl: async (_url, init) => {
        capturedBody = String(init?.body ?? '');
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              submissionId: 'submission-1',
              pickId: 'pick-1',
              lifecycleState: 'validated',
            },
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      },
    });

    const port = await startServer(server);
    const response = await makeRequest(
      port,
      '/submit',
      'POST',
      playerPropBody(),
      'application/x-www-form-urlencoded',
      'text/html',
    );
    await closeServer(server);

    assert.equal(response.statusCode, 201);
    assert.match(response.body, /Pick created/i);
    assert.match(response.body, /pick-1/);

    // Verify forwarded payload
    const forwarded = JSON.parse(capturedBody ?? '{}') as {
      source: string;
      market: string;
      selection: string;
      odds: number;
      stakeUnits: number;
      metadata: Record<string, unknown>;
    };
    assert.equal(forwarded.source, 'smart-form');
    assert.equal(forwarded.market, 'NBA Points');
    assert.equal(forwarded.selection, 'Jalen Brunson Over 24.5');
    assert.equal(forwarded.odds, -110);
    assert.equal(forwarded.stakeUnits, 1.5);
    assert.equal(forwarded.metadata.capper, 'griff843');
    assert.equal(forwarded.metadata.player, 'Jalen Brunson');
    assert.equal(forwarded.metadata.marketType, 'player-prop');
  });

  test('moneyline payload is correctly constructed', async () => {
    let capturedBody: string | undefined;

    const server = createSmartFormServer({
      apiBaseUrl: 'http://127.0.0.1:3000',
      fetchImpl: async (_url, init) => {
        capturedBody = String(init?.body ?? '');
        return new Response(
          JSON.stringify({
            ok: true,
            data: { submissionId: 'sub-1', pickId: 'pick-1', lifecycleState: 'validated' },
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      },
    });

    const port = await startServer(server);
    await makeRequest(
      port,
      '/submit',
      'POST',
      moneylineBody(),
      'application/x-www-form-urlencoded',
      'application/json',
    );
    await closeServer(server);

    const forwarded = JSON.parse(capturedBody ?? '{}') as {
      source: string;
      market: string;
      selection: string;
      metadata: Record<string, unknown>;
    };
    assert.equal(forwarded.source, 'smart-form');
    assert.equal(forwarded.market, 'NFL Moneyline');
    assert.equal(forwarded.selection, 'Bills');
    assert.equal(forwarded.metadata.team, 'Bills');
  });

  test('source is always smart-form regardless of input', async () => {
    let capturedBody: string | undefined;

    const server = createSmartFormServer({
      apiBaseUrl: 'http://127.0.0.1:3000',
      fetchImpl: async (_url, init) => {
        capturedBody = String(init?.body ?? '');
        return new Response(
          JSON.stringify({
            ok: true,
            data: { submissionId: 'sub-1', pickId: 'pick-1', lifecycleState: 'validated' },
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      },
    });

    const port = await startServer(server);
    await makeRequest(
      port,
      '/submit',
      'POST',
      moneylineBody(),
      'application/x-www-form-urlencoded',
      'application/json',
    );
    await closeServer(server);

    const forwarded = JSON.parse(capturedBody ?? '{}') as { source: string };
    assert.equal(forwarded.source, 'smart-form');
  });
});

describe('POST /submit — error handling', () => {
  test('returns 413 when content-length exceeds maxBodyBytes', async () => {
    const server = createSmartFormServer({
      apiBaseUrl: 'http://127.0.0.1:3000',
      maxBodyBytes: 100,
      fetchImpl: async () => { throw new Error('fetch should not be called'); },
    });

    const port = await startServer(server);
    const oversizedBody = 'x'.repeat(200);
    const response = await makeRequest(
      port,
      '/submit',
      'POST',
      oversizedBody,
      'application/x-www-form-urlencoded',
      'application/json',
    );
    await closeServer(server);

    assert.equal(response.statusCode, 413);
    const body = JSON.parse(response.body) as { ok: boolean; error: { code: string } };
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'PAYLOAD_TOO_LARGE');
  });

  test('renders API error feedback for browser requests', async () => {
    const server = createSmartFormServer({
      apiBaseUrl: 'http://127.0.0.1:3000',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: { code: 'BAD_REQUEST', message: 'Something went wrong' },
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        ),
    });

    const port = await startServer(server);
    const response = await makeRequest(
      port,
      '/submit',
      'POST',
      playerPropBody(),
      'application/x-www-form-urlencoded',
      'text/html',
    );
    await closeServer(server);

    assert.equal(response.statusCode, 400);
    assert.match(response.body, /Something went wrong/i);
  });
});

describe('GET /unknown', () => {
  test('returns 404 for unknown routes', async () => {
    const server = createTestServer();
    const port = await startServer(server);
    const response = await makeRequest(port, '/unknown');
    await closeServer(server);

    assert.equal(response.statusCode, 404);
    const body = JSON.parse(response.body) as { ok: boolean; error: { code: string } };
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'NOT_FOUND');
  });
});

describe('Sport-market cross-validation (server integration)', () => {
  test('MMA + player-prop is rejected with 422', async () => {
    const server = createTestServer();
    const port = await startServer(server);
    const body = new URLSearchParams({
      capper: 'griff843',
      date: '2026-03-21',
      sport: 'MMA',
      units: '1.5',
      odds: '-110',
      marketType: 'player-prop',
      player: 'Jon Jones',
      matchup: 'Jones vs Miocic',
      statType: 'Takedowns',
      overUnder: 'Over',
      line: '2.5',
    }).toString();
    const response = await makeRequest(port, '/submit', 'POST', body, 'application/x-www-form-urlencoded', 'application/json');
    await closeServer(server);

    assert.equal(response.statusCode, 422);
    const result = JSON.parse(response.body) as { ok: boolean; error: { code: string; details?: string[] } };
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'FORM_VALIDATION_FAILED');
    assert.ok(result.error.details?.some((d) => d.includes('marketType')));
  });

  test('MMA + moneyline is accepted by validation', async () => {
    const server = createSmartFormServer({
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ ok: true, data: { submissionId: 'sub-1', pickId: 'pick-1', lifecycleState: 'validated' } }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        ),
    });
    const port = await startServer(server);
    const body = new URLSearchParams({
      capper: 'griff843',
      date: '2026-03-21',
      sport: 'MMA',
      units: '1.5',
      odds: '-110',
      marketType: 'moneyline',
      matchup: 'Jones vs Miocic',
      team: 'Jones',
    }).toString();
    const response = await makeRequest(port, '/submit', 'POST', body, 'application/x-www-form-urlencoded', 'application/json');
    await closeServer(server);

    assert.equal(response.statusCode, 201);
    const result = JSON.parse(response.body) as { ok: boolean };
    assert.equal(result.ok, true);
  });
});
