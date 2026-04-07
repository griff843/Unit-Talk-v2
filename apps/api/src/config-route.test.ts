/**
 * Tests for GET /api/health/config
 *
 * Covers:
 * - Operator auth required (401 when missing/wrong role)
 * - feature-availability semantics in in-memory mode
 * - feature-availability semantics: closing lines, sharp reference, CLV, edge
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { handleHealthConfig } from './routes/config.js';
import { createInMemoryRepositoryBundle } from '@unit-talk/db';
import type { ApiRuntimeDependencies } from './server.js';
import type { ProviderOfferRecord } from '@unit-talk/db';
import { loadAuthConfig } from './auth.js';

// Minimal response mock
function makeResponse() {
  const state = { statusCode: 0, body: '' };
  const res = {
    get statusCode() { return state.statusCode; },
    set statusCode(v: number) { state.statusCode = v; },
    get body() { return JSON.parse(state.body) as unknown; },
    setHeader() {},
    end(data: string) { state.body = data; },
  };
  return res as unknown as import('node:http').ServerResponse & { body: unknown };
}

// Minimal request with optional Authorization header
function makeRequest(authHeader?: string): IncomingMessage {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
  } as IncomingMessage;
}

// Runtime with in-memory repos and configurable persistenceMode
function makeRuntime(
  persistenceMode: 'in_memory' | 'database' = 'in_memory',
  offers: ProviderOfferRecord[] = [],
): ApiRuntimeDependencies {
  const repositories = createInMemoryRepositoryBundle();

  // Seed provider offers
  for (const offer of offers) {
    (repositories.providerOffers as { offers?: Map<string, ProviderOfferRecord> } & typeof repositories.providerOffers);
    // Use listRecentOffers override via monkey-patching for test isolation
  }

  // Override listRecentOffers to return seeded data
  const originalRepo = repositories.providerOffers;
  repositories.providerOffers = {
    ...originalRepo,
    async listRecentOffers(_since: string) {
      return offers;
    },
    async listByProvider(_providerKey: string) {
      return [];
    },
  };

  const authConfig = loadAuthConfig({
    UNIT_TALK_API_KEY_OPERATOR: 'op-key',
  });

  return {
    repositories,
    persistenceMode,
    runtimeMode: 'test',
    authConfig,
  } as unknown as ApiRuntimeDependencies;
}

// ─── Auth tests ──────────────────────────────────────────────────────────────

test('GET /api/health/config returns 401 with no auth header', async () => {
  const req = makeRequest();
  const res = makeResponse();
  await handleHealthConfig(req, res, makeRuntime());
  assert.equal(res.statusCode, 401);
  const b = res.body as { ok: boolean; error: { code: string } };
  assert.equal(b.ok, false);
  assert.equal(b.error.code, 'UNAUTHORIZED');
});

test('GET /api/health/config returns 401 with wrong role (submitter key)', async () => {
  const runtime = makeRuntime();
  // Override authConfig with only a submitter key — operator role is required
  runtime.authConfig = loadAuthConfig({ UNIT_TALK_API_KEY_SUBMITTER: 'sub-key' });
  const req = makeRequest('Bearer sub-key');
  const res = makeResponse();
  await handleHealthConfig(req, res, runtime);
  assert.equal(res.statusCode, 401);
});

test('GET /api/health/config returns 200 with valid operator key', async () => {
  const req = makeRequest('Bearer op-key');
  const res = makeResponse();
  await handleHealthConfig(req, res, makeRuntime());
  assert.equal(res.statusCode, 200);
  const b = res.body as { service: string };
  assert.equal(b.service, 'api');
});

// ─── Feature availability — in-memory mode ────────────────────────────────────

test('GET /api/health/config: all features unavailable in in-memory mode', async () => {
  const req = makeRequest('Bearer op-key');
  const res = makeResponse();
  await handleHealthConfig(req, res, makeRuntime('in_memory'));
  assert.equal(res.statusCode, 200);
  const b = res.body as { featureAvailability: { closingLines: { available: boolean }; clv: { available: boolean }; sharpConsensus: { available: boolean }; edge: { available: boolean } } };
  assert.equal(b.featureAvailability.closingLines.available, false);
  assert.equal(b.featureAvailability.clv.available, false);
  assert.equal(b.featureAvailability.sharpConsensus.available, false);
  assert.equal(b.featureAvailability.edge.available, false);
});

// ─── Feature availability — database mode with seeded offers ─────────────────

function makeOffer(overrides: Partial<ProviderOfferRecord> = {}): ProviderOfferRecord {
  return {
    id: 'offer-1',
    provider_key: 'sgo',
    provider_event_id: 'evt-1',
    provider_market_key: 'player-points-ou',
    provider_participant_id: null,
    sport_key: 'NBA',
    line: 24.5,
    over_odds: -110,
    under_odds: -110,
    devig_mode: 'PAIRED',
    is_opening: false,
    is_closing: false,
    snapshot_at: new Date().toISOString(),
    idempotency_key: 'key-1',
    bookmaker_key: 'draftkings',
    created_at: new Date().toISOString(),
    ...overrides,
  } as ProviderOfferRecord;
}

test('GET /api/health/config: closingLines available when is_closing rows present', async () => {
  const offers = [makeOffer({ is_closing: true, idempotency_key: 'k1' })];
  const req = makeRequest('Bearer op-key');
  const res = makeResponse();
  await handleHealthConfig(req, res, makeRuntime('database', offers));
  const b = res.body as { featureAvailability: { closingLines: { available: boolean }; clv: { available: boolean }; sharpConsensus: { available: boolean }; edge: { available: boolean } } };
  assert.equal(b.featureAvailability.closingLines.available, true);
  assert.equal(b.featureAvailability.clv.available, true);
  assert.equal(b.featureAvailability.edge.available, true);
});

test('GET /api/health/config: closingLines unavailable when no is_closing rows', async () => {
  const offers = [makeOffer({ is_closing: false, is_opening: true })];
  const req = makeRequest('Bearer op-key');
  const res = makeResponse();
  await handleHealthConfig(req, res, makeRuntime('database', offers));
  const b = res.body as { featureAvailability: { closingLines: { available: boolean }; clv: { available: boolean }; sharpConsensus: { available: boolean }; edge: { available: boolean } } };
  assert.equal(b.featureAvailability.closingLines.available, false);
  assert.equal(b.featureAvailability.clv.available, false);
});

test('GET /api/health/config: sharpConsensus available when Pinnacle offers present', async () => {
  const offers = [makeOffer({ bookmaker_key: 'pinnacle', idempotency_key: 'k2' })];
  const req = makeRequest('Bearer op-key');
  const res = makeResponse();
  await handleHealthConfig(req, res, makeRuntime('database', offers));
  const b = res.body as { featureAvailability: { closingLines: { available: boolean }; clv: { available: boolean }; sharpConsensus: { available: boolean }; edge: { available: boolean } } };
  assert.equal(b.featureAvailability.sharpConsensus.available, true);
});

test('GET /api/health/config: sharpConsensus available when Circa offers present', async () => {
  const offers = [makeOffer({ bookmaker_key: 'circa', idempotency_key: 'k3' })];
  const req = makeRequest('Bearer op-key');
  const res = makeResponse();
  await handleHealthConfig(req, res, makeRuntime('database', offers));
  const b = res.body as { featureAvailability: { closingLines: { available: boolean }; clv: { available: boolean }; sharpConsensus: { available: boolean }; edge: { available: boolean } } };
  assert.equal(b.featureAvailability.sharpConsensus.available, true);
});

test('GET /api/health/config: sharpConsensus unavailable when no Pinnacle/Circa offers', async () => {
  const offers = [makeOffer({ bookmaker_key: 'draftkings' })];
  const req = makeRequest('Bearer op-key');
  const res = makeResponse();
  await handleHealthConfig(req, res, makeRuntime('database', offers));
  const b = res.body as { featureAvailability: { closingLines: { available: boolean }; clv: { available: boolean }; sharpConsensus: { available: boolean }; edge: { available: boolean } } };
  assert.equal(b.featureAvailability.sharpConsensus.available, false);
});
