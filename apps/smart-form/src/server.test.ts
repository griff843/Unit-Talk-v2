import assert from 'node:assert/strict';
import test from 'node:test';
import { request } from 'node:http';
import { createSmartFormServer } from './server.js';

test('GET /health returns smart-form health payload', async () => {
  const server = createSmartFormServer({
    apiBaseUrl: 'http://127.0.0.1:3000',
    fetchImpl: async () => {
      throw new Error('fetch should not be called');
    },
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/health');
  await closeServer(server);

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body) as { ok: boolean; service: string };
  assert.equal(body.ok, true);
  assert.equal(body.service, 'smart-form');
});

test('GET / returns a form surface', async () => {
  const server = createSmartFormServer({
    apiBaseUrl: 'http://127.0.0.1:3000',
    fetchImpl: async () => {
      throw new Error('fetch should not be called');
    },
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(address.port, '/');
  await closeServer(server);

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Unit Talk V2 Smart Form/);
  assert.match(response.body, /Submit Pick/);
});

test('POST /submit forwards a normalized submission payload to the API', async () => {
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
        {
          status: 201,
          headers: {
            'content-type': 'application/json',
          },
        },
      );
    },
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(
    address.port,
    '/submit',
    'POST',
    'source=smart-form&submittedBy=griff843&market=NBA+points&selection=Over+24.5&line=24.5&odds=-110&stakeUnits=1&confidence=0.72&eventName=Lakers+vs+Celtics&metadata=%7B%22sport%22%3A%22NBA%22%7D',
    'application/x-www-form-urlencoded',
    'text/html',
  );
  await closeServer(server);

  assert.equal(response.statusCode, 201);
  assert.match(response.body, /Submission received/i);
  assert.match(response.body, /Pick queued for processing/i);
  assert.match(response.body, /submission-1/);
  assert.match(response.body, /pick-1/);
  const forwarded = JSON.parse(capturedBody ?? '{}') as {
    source: string;
    submittedBy?: string;
    market: string;
    selection: string;
    line?: number;
    odds?: number;
    metadata?: Record<string, unknown>;
  };

  assert.equal(forwarded.source, 'smart-form');
  assert.equal(forwarded.submittedBy, 'griff843');
  assert.equal(forwarded.market, 'NBA points');
  assert.equal(forwarded.selection, 'Over 24.5');
  assert.equal(forwarded.line, 24.5);
  assert.equal(forwarded.odds, -110);
  assert.equal(forwarded.metadata?.sport, 'NBA');
});

test('POST /submit always forwards smart-form as source regardless of form input', async () => {
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

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  await makeRequest(
    address.port,
    '/submit',
    'POST',
    'source=api&market=Test+market&selection=Over+5',
    'application/x-www-form-urlencoded',
    'application/json',
  );
  await closeServer(server);

  const forwarded = JSON.parse(capturedBody ?? '{}') as { source: string };
  assert.equal(forwarded.source, 'smart-form');
});

test('POST /submit returns 413 when content-length exceeds maxBodyBytes', async () => {
  const server = createSmartFormServer({
    apiBaseUrl: 'http://127.0.0.1:3000',
    maxBodyBytes: 100,
    fetchImpl: async () => {
      throw new Error('fetch should not be called for oversized body');
    },
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const oversizedBody = 'x'.repeat(200);
  const response = await makeRequest(
    address.port,
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

test('POST /submit re-renders the form with validation feedback for browser requests', async () => {
  const server = createSmartFormServer({
    apiBaseUrl: 'http://127.0.0.1:3000',
    fetchImpl: async () => {
      throw new Error('fetch should not be called for invalid form input');
    },
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(
    address.port,
    '/submit',
    'POST',
    'market=&selection=&metadata=%7Bbad-json',
    'application/x-www-form-urlencoded',
    'text/html',
  );
  await closeServer(server);

  assert.equal(response.statusCode, 422);
  assert.match(response.body, /Please correct the highlighted fields and resubmit/i);
  assert.match(response.body, /Market is required/i);
  assert.match(response.body, /Selection is required/i);
  assert.match(response.body, /Metadata must be valid JSON/i);
});

test('POST /submit re-renders the form with API error feedback for browser requests', async () => {
  const server = createSmartFormServer({
    apiBaseUrl: 'http://127.0.0.1:3000',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: 'BAD_REQUEST',
            message: 'Market is required',
          },
        }),
        {
          status: 400,
          headers: {
            'content-type': 'application/json',
          },
        },
      ),
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server address');
  }

  const response = await makeRequest(
    address.port,
    '/submit',
    'POST',
    'market=NBA+points&selection=Over+24.5',
    'application/x-www-form-urlencoded',
    'text/html',
  );
  await closeServer(server);

  assert.equal(response.statusCode, 400);
  assert.match(response.body, /Market is required/i);
  assert.match(response.body, /NBA points/);
  assert.match(response.body, /Over 24\.5/);
});

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
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function closeServer(server: ReturnType<typeof createSmartFormServer>) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
