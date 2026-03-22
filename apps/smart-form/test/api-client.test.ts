/**
 * Runtime path proof for lib/api-client.ts.
 * Uses globalThis.fetch override to verify live submit and catalog paths
 * without requiring a running API server.
 */
import assert from 'node:assert/strict';
import test, { describe, beforeEach, afterEach } from 'node:test';
import { getCatalog, submitPick } from '../lib/api-client.ts';
import { buildSubmissionPayload } from '../lib/form-utils.ts';
import type { BetFormValues } from '../lib/form-schema.ts';

type FetchFn = typeof globalThis.fetch;

// --- getCatalog ---

describe('getCatalog', () => {
  let originalFetch: FetchFn;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('returns catalog data on 200 response', async () => {
    const mockCatalog = { sports: [], sportsbooks: [], ticketTypes: [], cappers: [] };
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ok: true, data: mockCatalog }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const result = await getCatalog();
    assert.deepEqual(result, mockCatalog);
  });

  test('throws on non-200 response with error message', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: { message: 'Service unavailable' } }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });

    await assert.rejects(() => getCatalog(), /Service unavailable/);
  });

  test('throws with status code when no error message in body', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({}), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });

    await assert.rejects(() => getCatalog(), /500/);
  });
});

// --- submitPick ---

describe('submitPick', () => {
  let originalFetch: FetchFn;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('returns result on 200 response', async () => {
    const mockResult = { submissionId: 'sub-123', pickId: 'pick-456', lifecycleState: 'validated' };
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ok: true, data: mockResult }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const result = await submitPick({
      source: 'smart-form',
      market: 'NBA - Player Prop',
      selection: 'J.Brunson Points O 24.5',
    });
    assert.deepEqual(result, mockResult);
  });

  test('throws on non-200 response with error message', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: { message: 'Validation failed' } }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      });

    await assert.rejects(
      () => submitPick({ source: 'smart-form', market: 'NBA - Player Prop', selection: 'test' }),
      /Validation failed/,
    );
  });

  test('sends POST to /api/submissions', async () => {
    let capturedMethod: string | undefined;
    let capturedUrl: string | undefined;

    globalThis.fetch = async (url, opts) => {
      capturedUrl = String(url);
      capturedMethod = opts?.method;
      return new Response(
        JSON.stringify({ ok: true, data: { submissionId: 's', pickId: 'p', lifecycleState: 'validated' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    await submitPick({ source: 'smart-form', market: 'NBA - Player Prop', selection: 'test' });
    assert.ok(capturedUrl?.includes('/api/submissions'), `Expected /api/submissions in URL, got: ${capturedUrl}`);
    assert.equal(capturedMethod, 'POST');
  });
});

// --- Full flow: buildSubmissionPayload -> submitPick ---

describe('full submit flow', () => {
  let originalFetch: FetchFn;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('payload has source=smart-form and metadata.ticketType=single', async () => {
    let capturedBody: Record<string, unknown> | undefined;

    globalThis.fetch = async (_url, opts) => {
      capturedBody = JSON.parse(String(opts?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ ok: true, data: { submissionId: 's', pickId: 'p', lifecycleState: 'validated' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const values: BetFormValues = {
      sport: 'NBA',
      marketType: 'player-prop',
      eventName: 'Knicks vs Heat',
      playerName: 'Jalen Brunson',
      statType: 'Points',
      direction: 'over',
      line: 24.5,
      odds: -110,
      units: 1.5,
      capper: 'griff843',
      gameDate: '2026-03-22',
    };

    const payload = buildSubmissionPayload(values);
    await submitPick(payload);

    assert.equal(capturedBody?.source, 'smart-form');
    const meta = capturedBody?.metadata as Record<string, unknown> | undefined;
    assert.equal(meta?.ticketType, 'single');
    assert.equal(meta?.player, 'Jalen Brunson');
    assert.equal(meta?.overUnder, 'over');
    assert.equal(meta?.date, '2026-03-22');
    assert.equal(meta?.eventName, 'Knicks vs Heat');
  });
});
