import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { runSmoke } from './post-deploy-smoke.js';

function makeServer(body: unknown, status = 200): { url: string; close: () => void } {
  const server = createServer((req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  server.listen(0);
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}/health`, close: () => server.close() };
}

test('passes for a healthy API response', async () => {
  const srv = makeServer({
    status: 'healthy',
    dbReachable: true,
    runtimeMode: 'fail_closed',
    persistenceMode: 'database',
  });

  try {
    const result = await runSmoke(srv.url, 1, 0);
    assert.strictEqual(result.verdict, 'PASS');
    assert.strictEqual(result.httpStatus, 200);
    assert.ok(result.checks.every(c => c.passed));
  } finally {
    srv.close();
  }
});

test('fails when DB is not reachable', async () => {
  const srv = makeServer({ status: 'degraded', dbReachable: false, runtimeMode: 'fail_closed' });
  try {
    const result = await runSmoke(srv.url, 1, 0);
    assert.strictEqual(result.verdict, 'FAIL');
    assert.ok(result.checks.some(c => !c.passed && c.name.includes('dbReachable')));
  } finally {
    srv.close();
  }
});

test('fails when runtimeMode is not fail_closed', async () => {
  const srv = makeServer({ status: 'healthy', dbReachable: true, runtimeMode: 'fail_open' });
  try {
    const result = await runSmoke(srv.url, 1, 0);
    assert.strictEqual(result.verdict, 'FAIL');
    assert.ok(result.checks.some(c => !c.passed && c.name.includes('runtimeMode')));
  } finally {
    srv.close();
  }
});

test('fails when API status is down', async () => {
  const srv = makeServer({ status: 'down', dbReachable: true, runtimeMode: 'fail_closed' }, 503);
  try {
    const result = await runSmoke(srv.url, 1, 0);
    assert.strictEqual(result.verdict, 'FAIL');
    assert.ok(result.checks.some(c => !c.passed && c.name.includes('HTTP 200')));
  } finally {
    srv.close();
  }
});

test('fails when queue health is down', async () => {
  const srv = makeServer({
    status: 'degraded',
    dbReachable: true,
    runtimeMode: 'fail_closed',
    queueHealth: { status: 'down', alerts: [] },
  });
  try {
    const result = await runSmoke(srv.url, 1, 0);
    assert.strictEqual(result.verdict, 'FAIL');
    assert.ok(result.checks.some(c => !c.passed && c.name.includes('queue health')));
  } finally {
    srv.close();
  }
});

test('fails when health endpoint is unreachable', async () => {
  const result = await runSmoke('http://127.0.0.1:1', 1, 0);
  assert.strictEqual(result.verdict, 'FAIL');
  assert.strictEqual(result.httpStatus, null);
  assert.ok(result.checks.some(c => !c.passed && c.name.includes('reachable')));
});

test('fails when response is not JSON', async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
  server.listen(0);
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}/health`;

  try {
    const result = await runSmoke(url, 1, 0);
    assert.strictEqual(result.verdict, 'FAIL');
    assert.ok(result.checks.some(c => !c.passed && c.name.includes('JSON')));
  } finally {
    server.close();
  }
});

test('queue health check skipped when queueHealth is null', async () => {
  const srv = makeServer({ status: 'healthy', dbReachable: true, runtimeMode: 'fail_closed', queueHealth: null });
  try {
    const result = await runSmoke(srv.url, 1, 0);
    assert.strictEqual(result.verdict, 'PASS');
    assert.ok(!result.checks.some(c => c.name.includes('queue health')));
  } finally {
    srv.close();
  }
});
