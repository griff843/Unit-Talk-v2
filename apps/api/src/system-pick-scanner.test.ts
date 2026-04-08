import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  InMemoryProviderOfferRepository,
  InMemoryParticipantRepository,
  InMemoryEventRepository,
} from '@unit-talk/db';
import { runSystemPickScan, type SystemPickScanOptions } from './system-pick-scanner.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeOffer(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    provider_key: 'sgo',
    provider_event_id: 'event-1',
    provider_market_key: 'points-all-game-ou',
    provider_participant_id: 'player-ext-1',
    bookmaker_key: 'sgo',
    line: 24.5,
    over_odds: -115,
    under_odds: -105,
    snapshot_at: new Date().toISOString(),
    is_opening: true,
    is_closing: false,
    metadata: {},
    ...overrides,
  };
}

function makeParticipant(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    external_id: 'player-ext-1',
    display_name: 'LeBron James',
    participant_type: 'player' as const,
    sport: 'NBA',
    league: null,
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

interface SubmittedRequest {
  url: string;
  body: Record<string, unknown>;
}

function makeMockFetch(responses: Array<{ status: number; body?: string }>) {
  const calls: SubmittedRequest[] = [];
  let index = 0;

  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown> });
    const response = responses[index++] ?? { status: 200, body: '{"ok":true}' };
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      text: async () => response.body ?? '',
    } as Response;
  };

  return { fetchImpl, calls };
}

function baseOptions(overrides: Partial<SystemPickScanOptions> = {}): SystemPickScanOptions {
  return {
    enabled: true,
    apiUrl: 'http://localhost:4000',
    lookbackHours: 24,
    maxPicksPerRun: 100,
    ...overrides,
  };
}

// ── tests ────────────────────────────────────────────────────────────────────

test('returns zeros when disabled', async () => {
  const offers = new InMemoryProviderOfferRepository();
  const participants = new InMemoryParticipantRepository();
  const events = new InMemoryEventRepository();

  const result = await runSystemPickScan(
    { providerOffers: offers, participants, events },
    baseOptions({ enabled: false }),
  );

  assert.equal(result.scanned, 0);
  assert.equal(result.submitted, 0);
});

test('returns zeros when apiUrl is empty', async () => {
  const offers = new InMemoryProviderOfferRepository();
  const participants = new InMemoryParticipantRepository();
  const events = new InMemoryEventRepository();

  const result = await runSystemPickScan(
    { providerOffers: offers, participants, events },
    baseOptions({ apiUrl: '' }),
  );

  assert.equal(result.scanned, 0);
  assert.equal(result.submitted, 0);
});

test('skips offers with no canonical market key (resolveCanonicalMarketKey returns null)', async () => {
  // Use a mock that returns a valid opening offer but no canonical key
  const mockOffers = {
    ...new InMemoryProviderOfferRepository(),
    resolveCanonicalMarketKey: async () => null,
    listOpeningOffers: async () => [makeOffer()],
  } as ReturnType<typeof Object.assign>;

  const participants = new InMemoryParticipantRepository();
  const events = new InMemoryEventRepository();
  const { fetchImpl, calls } = makeMockFetch([]);

  const result = await runSystemPickScan(
    { providerOffers: mockOffers, participants, events },
    baseOptions({ fetchImpl }),
  );

  assert.equal(result.scanned, 1);
  assert.equal(result.submitted, 0);
  assert.equal(result.skipped, 1);
  assert.equal(calls.length, 0);
});

test('skips offers with no matching participant', async () => {
  // We need a mock providerOffers that returns a canonical key but participant is missing
  const mockOffers = {
    ...new InMemoryProviderOfferRepository(),
    resolveCanonicalMarketKey: async () => 'player_points_ou',
    listOpeningOffers: async () => [makeOffer()],
  } as ReturnType<typeof Object.assign>;

  const participants = new InMemoryParticipantRepository();
  // No participant seeded
  const events = new InMemoryEventRepository();

  const { fetchImpl, calls } = makeMockFetch([]);

  const result = await runSystemPickScan(
    { providerOffers: mockOffers, participants, events },
    baseOptions({ fetchImpl }),
  );

  assert.equal(result.skipped, 1);
  assert.equal(calls.length, 0);
});

test('submits a valid pick and returns submitted=1', async () => {
  const mockOffers = {
    ...new InMemoryProviderOfferRepository(),
    resolveCanonicalMarketKey: async () => 'player_points_ou',
    listOpeningOffers: async () => [makeOffer()],
  } as ReturnType<typeof Object.assign>;

  const participants = new InMemoryParticipantRepository();
  await participants.upsertByExternalId({
    externalId: 'player-ext-1',
    displayName: 'LeBron James',
    participantType: 'player',
    sport: 'NBA',
    metadata: {},
  });

  const events = new InMemoryEventRepository();

  const { fetchImpl, calls } = makeMockFetch([{ status: 200, body: '{"ok":true,"data":{"pickId":"p1","submissionId":"s1"}}' }]);

  const result = await runSystemPickScan(
    { providerOffers: mockOffers, participants, events },
    baseOptions({ fetchImpl }),
  );

  assert.equal(result.submitted, 1);
  assert.equal(result.errors, 0);
  assert.equal(calls.length, 1);

  const body = calls[0]?.body as Record<string, unknown>;
  assert.equal(body.source, 'system-pick-scanner');
  assert.equal(body.market, 'player_points_ou');
  assert.ok(
    typeof body.selection === 'string' && /^(Over|Under) \d/.test(body.selection),
    `selection should be "Over N" or "Under N", got: ${String(body.selection)}`,
  );
  assert.equal(body.line, 24.5);
  assert.ok(typeof body.odds === 'number', 'odds should be a number');
});

test('treats 409 response as idempotent skip, not error', async () => {
  const mockOffers = {
    ...new InMemoryProviderOfferRepository(),
    resolveCanonicalMarketKey: async () => 'player_points_ou',
    listOpeningOffers: async () => [makeOffer()],
  } as ReturnType<typeof Object.assign>;

  const participants = new InMemoryParticipantRepository();
  await participants.upsertByExternalId({
    externalId: 'player-ext-1',
    displayName: 'LeBron James',
    participantType: 'player',
    sport: 'NBA',
    metadata: {},
  });

  const events = new InMemoryEventRepository();
  const { fetchImpl } = makeMockFetch([{ status: 409 }]);

  const result = await runSystemPickScan(
    { providerOffers: mockOffers, participants, events },
    baseOptions({ fetchImpl }),
  );

  assert.equal(result.submitted, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.errors, 0);
});

test('counts API errors without throwing', async () => {
  const mockOffers = {
    ...new InMemoryProviderOfferRepository(),
    resolveCanonicalMarketKey: async () => 'player_points_ou',
    listOpeningOffers: async () => [makeOffer()],
  } as ReturnType<typeof Object.assign>;

  const participants = new InMemoryParticipantRepository();
  await participants.upsertByExternalId({
    externalId: 'player-ext-1',
    displayName: 'LeBron James',
    participantType: 'player',
    sport: 'NBA',
    metadata: {},
  });

  const events = new InMemoryEventRepository();
  const { fetchImpl } = makeMockFetch([{ status: 500, body: 'internal error' }]);

  const result = await runSystemPickScan(
    { providerOffers: mockOffers, participants, events },
    baseOptions({ fetchImpl }),
  );

  assert.equal(result.errors, 1);
  assert.equal(result.submitted, 0);
});

test('picks over side when overFair > underFair', async () => {
  // -130 over, -110 under → over has higher implied prob → overFair > underFair
  const offer = makeOffer({ over_odds: -130, under_odds: -110 });

  const mockOffers = {
    ...new InMemoryProviderOfferRepository(),
    resolveCanonicalMarketKey: async () => 'player_points_ou',
    listOpeningOffers: async () => [offer],
  } as ReturnType<typeof Object.assign>;

  const participants = new InMemoryParticipantRepository();
  await participants.upsertByExternalId({
    externalId: 'player-ext-1',
    displayName: 'LeBron James',
    participantType: 'player',
    sport: 'NBA',
    metadata: {},
  });

  const events = new InMemoryEventRepository();
  const { fetchImpl, calls } = makeMockFetch([{ status: 200, body: '{"ok":true}' }]);

  await runSystemPickScan(
    { providerOffers: mockOffers, participants, events },
    baseOptions({ fetchImpl }),
  );

  const body = calls[0]?.body as Record<string, unknown>;
  assert.ok(
    typeof body.selection === 'string' && body.selection.startsWith('Over'),
    `expected Over selection, got: ${String(body.selection)}`,
  );
  assert.equal(body.odds, -130);
});

test('picks under side when underFair > overFair', async () => {
  // -110 over, -130 under → under has higher implied prob → underFair > overFair
  const offer = makeOffer({ over_odds: -110, under_odds: -130 });

  const mockOffers = {
    ...new InMemoryProviderOfferRepository(),
    resolveCanonicalMarketKey: async () => 'player_points_ou',
    listOpeningOffers: async () => [offer],
  } as ReturnType<typeof Object.assign>;

  const participants = new InMemoryParticipantRepository();
  await participants.upsertByExternalId({
    externalId: 'player-ext-1',
    displayName: 'LeBron James',
    participantType: 'player',
    sport: 'NBA',
    metadata: {},
  });

  const events = new InMemoryEventRepository();
  const { fetchImpl, calls } = makeMockFetch([{ status: 200, body: '{"ok":true}' }]);

  await runSystemPickScan(
    { providerOffers: mockOffers, participants, events },
    baseOptions({ fetchImpl }),
  );

  const body = calls[0]?.body as Record<string, unknown>;
  assert.ok(
    typeof body.selection === 'string' && body.selection.startsWith('Under'),
    `expected Under selection, got: ${String(body.selection)}`,
  );
  assert.equal(body.odds, -130);
});
