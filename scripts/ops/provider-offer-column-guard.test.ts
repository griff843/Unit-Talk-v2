import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { readDatabaseStatus } from '../ingestor-supervisor.js';
import { evaluateAgeFinding, unknownMonitorFinding } from '../ingestor-alert-check.js';
import { evaluateIngestorHealth } from '../../apps/ingestor/src/supervisor.js';
import {
  evaluateIngestorHealthCheck,
  readLatestProviderOfferUpdatedAt,
} from './ingestor-health-check.js';

function brokenOfferQueries(source: string): number[] {
  const file = ts.createSourceFile('reader.ts', source, ts.ScriptTarget.Latest, true);
  const hits = new Set<number>();
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const calls: ts.CallExpression[] = [];
      let current: ts.Expression = node;
      while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
        calls.push(current);
        current = current.expression.expression;
      }
      const hasCall = (name: string, matches: (value: string) => boolean) =>
        calls.some((call) =>
          ts.isPropertyAccessExpression(call.expression) &&
          call.expression.name.text === name &&
          call.arguments[0] &&
          ts.isStringLiteralLike(call.arguments[0]) &&
          matches(call.arguments[0].text),
        );
      if (
        hasCall('from', (value) => value === 'provider_offers') &&
        (hasCall('select', (value) => /\bupdated_at\b/u.test(value)) ||
          hasCall('order', (value) => value === 'updated_at'))
      ) {
        const from = calls.find((call) =>
          ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'from',
        );
        hits.add(file.getLineAndCharacterOfPosition((from ?? node).getStart(file)).line + 1);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return [...hits];
}

function scriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return scriptFiles(filename);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [filename] : [];
  });
}

test('all scripts reject provider_offers.updated_at queries', () => {
  const hits = scriptFiles('scripts').flatMap((filename) =>
    brokenOfferQueries(readFileSync(filename, 'utf8')).map((line) => `${filename}:${line}`),
  );
  assert.deepEqual(hits, []);
});

for (const filename of ['scripts/ops/ingestor-health-check.ts', 'scripts/ingestor-supervisor.ts']) {
  test(`column guard inversion catches the original defect in ${filename}`, () => {
    const source = readFileSync(filename, 'utf8');
    assert.match(source, /\.from\('provider_offer_current'\)/u);
    const reverted = source.replace(".from('provider_offer_current')", ".from('provider_offers')");
    assert.ok(brokenOfferQueries(reverted).length > 0);
    assert.throws(() => assert.deepEqual(brokenOfferQueries(reverted), []), assert.AssertionError);
  });
}

test('column guard catches select and order separately without flagging valid legacy columns', () => {
  assert.equal(brokenOfferQueries("db.from('provider_offers').select('updated_at')").length, 1);
  assert.equal(brokenOfferQueries("db.from('provider_offers').order('updated_at')").length, 1);
  assert.deepEqual(brokenOfferQueries("db.from('provider_offers').select('created_at')"), []);
  assert.deepEqual(brokenOfferQueries("db.from('provider_offer_current').select('updated_at')"), []);
});

const environment = {
  SUPABASE_URL: 'http://127.0.0.1:1',
  SUPABASE_SERVICE_ROLE_KEY: 'unit-test-only',
};
const now = new Date('2026-10-04T12:00:00.000Z');
const runStartedAt = '2026-10-04T11:59:00.000Z';
const readers = [
  { name: 'health check', read: readLatestProviderOfferUpdatedAt },
  {
    name: 'supervisor',
    read: async (env: typeof environment) => (await readDatabaseStatus(env)).latestOfferUpdatedAt,
  },
];

for (const reader of readers) {
  for (const scenario of [
    { name: 'fresh', rows: [{ updated_at: runStartedAt }], timestamp: runStartedAt, healthy: true },
    { name: 'stale', rows: [{ updated_at: '2026-10-04T09:00:00.000Z' }], timestamp: '2026-10-04T09:00:00.000Z', healthy: false },
    { name: 'empty', rows: [], timestamp: null, healthy: false },
    { name: 'missing timestamp', rows: [{}], timestamp: null, healthy: false },
  ]) {
    test(`${reader.name} reads canonical freshness and fails closed for ${scenario.name} truth`, async (t) => {
      let offerRequests = 0;
      t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        let rows: unknown;
        if (url.pathname.endsWith('/provider_offer_current')) {
          offerRequests += 1;
          assert.equal(url.searchParams.get('select'), 'updated_at');
          assert.equal(url.searchParams.get('order'), 'updated_at.desc');
          assert.equal(url.searchParams.get('limit'), '1');
          rows = scenario.rows;
        } else {
          assert.ok(url.pathname.endsWith('/system_runs'));
          rows = [{ status: 'completed', started_at: runStartedAt }];
        }
        return new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json' } });
      });
      const timestamp = await reader.read(environment);
      assert.equal(offerRequests, 1);
      assert.equal(timestamp, scenario.timestamp);
      const health = evaluateIngestorHealthCheck({
        container: { running: true, healthy: true },
        latestOfferUpdatedAt: timestamp,
        latestRunStartedAt: runStartedAt,
        now,
      });
      assert.equal(health.healthy, scenario.healthy);
      const supervisorHealth = evaluateIngestorHealth({
        autorun: true, pollIntervalMs: 60_000, supervisorRunning: true,
        childRunning: true, restartCount: 0, latestRunStatus: 'completed',
        latestRunStartedAt: runStartedAt, latestOfferCreatedAt: timestamp,
      }, now);
      assert.equal(supervisorHealth.status === 'healthy', scenario.healthy);
      const finding = evaluateAgeFinding('offers', timestamp, 30, null, now);
      assert.equal(finding.level, scenario.healthy ? 'OK' : 'CRITICAL');
    });
  }

  test(`${reader.name} distinguishes query failure from stale or empty truth`, async (t) => {
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const failed = !url.pathname.endsWith('/system_runs');
      return new Response(JSON.stringify(failed
        ? { code: '42703', message: 'column does not exist' }
        : [{ status: 'completed', started_at: runStartedAt }]), {
        status: failed ? 400 : 200, headers: { 'Content-Type': 'application/json' },
      });
    });
    await assert.rejects(reader.read(environment), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /provider_offer_current freshness query failed: column does not exist/u);
      assert.match(unknownMonitorFinding(error).message, /UNKNOWN/u);
      return true;
    });
  });

  test(`${reader.name} missing credentials cannot report healthy`, async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected request'); });
    assert.equal(await reader.read({ SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }), null);
    assert.equal(fetch.mock.callCount(), 0);
  });
}

test('supervisor preserves system_runs observer failures', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const failed = url.pathname.endsWith('/system_runs');
    return new Response(JSON.stringify(failed
      ? { message: 'observer permission denied' }
      : [{ updated_at: runStartedAt }]), {
      status: failed ? 403 : 200, headers: { 'Content-Type': 'application/json' },
    });
  });
  await assert.rejects(readDatabaseStatus(environment), /system_runs freshness query failed: observer permission denied/u);
});
