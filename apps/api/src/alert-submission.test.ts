import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryRepositoryBundle } from './persistence.js';
import {
  buildAlertAgentSubmissionPayload,
  createAlertSubmissionPublisher,
  isSystemPickEligible,
} from './alert-submission.js';
import type { AlertDetectionRecord } from '@unit-talk/db';

test('buildAlertAgentSubmissionPayload maps spread detections to over submissions', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const event = await repositories.events.upsertByExternalId({
    externalId: 'evt-spread',
    sportId: 'NBA',
    eventName: 'Knicks vs Celtics',
    eventDate: '2026-04-03',
    status: 'scheduled',
    metadata: {},
  });

  const payload = buildAlertAgentSubmissionPayload(
    makeDetection({ market_type: 'spread', direction: 'up' }),
    event,
    null,
  );

  assert.equal(payload.market, 'NBA Spread');
  assert.equal(payload.selection, 'over');
  assert.equal(payload.confidence, 0.65);
});

test('buildAlertAgentSubmissionPayload maps totals to under submissions', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const event = await repositories.events.upsertByExternalId({
    externalId: 'evt-total',
    sportId: 'NBA',
    eventName: 'Knicks vs Celtics',
    eventDate: '2026-04-03',
    status: 'scheduled',
    metadata: {},
  });

  const payload = buildAlertAgentSubmissionPayload(
    makeDetection({ market_type: 'total', direction: 'down' }),
    event,
    null,
  );

  assert.equal(payload.market, 'NBA Total');
  assert.equal(payload.selection, 'under');
});

test('buildAlertAgentSubmissionPayload maps moneyline detections to participant names when available', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const event = await repositories.events.upsertByExternalId({
    externalId: 'evt-moneyline',
    sportId: 'NBA',
    eventName: 'Knicks vs Celtics',
    eventDate: '2026-04-03',
    status: 'scheduled',
    metadata: {},
  });
  const participant = await repositories.participants.upsertByExternalId({
    externalId: 'team-knicks',
    displayName: 'New York Knicks',
    participantType: 'team',
    sport: 'NBA',
    metadata: {},
  });

  const payload = buildAlertAgentSubmissionPayload(
    makeDetection({ market_type: 'moneyline', participant_id: participant.id }),
    event,
    participant,
  );

  assert.equal(payload.market, 'NBA Moneyline');
  assert.equal(payload.selection, 'New York Knicks');
});

test('buildAlertAgentSubmissionPayload maps player props to over submissions', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const event = await repositories.events.upsertByExternalId({
    externalId: 'evt-player-prop',
    sportId: 'NBA',
    eventName: 'Knicks vs Celtics',
    eventDate: '2026-04-03',
    status: 'scheduled',
    metadata: {},
  });

  const payload = buildAlertAgentSubmissionPayload(
    makeDetection({ market_type: 'player_prop', direction: 'up' }),
    event,
    null,
  );

  assert.equal(payload.market, 'NBA Player Prop');
  assert.equal(payload.selection, 'over');
});

test('createAlertSubmissionPublisher posts alert-worthy payloads once per process-run key', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const event = await repositories.events.upsertByExternalId({
    externalId: 'evt-submit',
    sportId: 'NBA',
    eventName: 'Knicks vs Celtics',
    eventDate: '2026-04-03',
    status: 'scheduled',
    metadata: {},
  });
  const participant = await repositories.participants.upsertByExternalId({
    externalId: 'team-knicks',
    displayName: 'New York Knicks',
    participantType: 'team',
    sport: 'NBA',
    metadata: {},
  });
  const detection = makeDetection({
    market_type: 'moneyline',
    participant_id: participant.id,
    event_id: event.id,
  });

  const requests: Array<{ url: string; init?: unknown }> = [];
  const publish = createAlertSubmissionPublisher({
    enabled: true,
    apiUrl: 'http://127.0.0.1:4000/',
    apiKey: 'submitter-key',
    events: repositories.events,
    participants: repositories.participants,
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    },
    logger: { error() {}, info() {} },
  });

  await publish(detection);
  await publish(detection);

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, 'http://127.0.0.1:4000/api/submissions');
  const init = requests[0]?.init as RequestInit;
  assert.equal(init.method, 'POST');
  assert.equal(
    (init.headers as Record<string, string>).Authorization,
    'Bearer submitter-key',
  );

  const body = JSON.parse(String(init.body)) as Record<string, unknown>;
  assert.equal(body.source, 'alert-agent');
  assert.equal(body.submittedBy, 'system:alert-agent');
  assert.equal(body.selection, 'New York Knicks');
});

test('createAlertSubmissionPublisher skips player prop detections for autonomous system picks', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const event = await repositories.events.upsertByExternalId({
    externalId: 'evt-player-prop-skip',
    sportId: 'NBA',
    eventName: 'Knicks vs Celtics',
    eventDate: '2026-04-03',
    status: 'scheduled',
    metadata: {},
  });

  const requests: Array<{ url: string; init?: unknown }> = [];
  const publish = createAlertSubmissionPublisher({
    enabled: true,
    apiUrl: 'http://127.0.0.1:4000/',
    events: repositories.events,
    participants: repositories.participants,
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    },
    logger: { error() {}, info() {} },
  });

  await publish(
    makeDetection({
      market_type: 'player_prop',
      event_id: event.id,
    }),
  );

  assert.equal(requests.length, 0);
});

test('createAlertSubmissionPublisher skips disabled sports like NFL', async () => {
  const repositories = createInMemoryRepositoryBundle();
  const event = await repositories.events.upsertByExternalId({
    externalId: 'evt-nfl-skip',
    sportId: 'NFL',
    eventName: 'Bills vs Chiefs',
    eventDate: '2026-09-10',
    status: 'scheduled',
    metadata: {},
  });

  const requests: Array<{ url: string; init?: unknown }> = [];
  const publish = createAlertSubmissionPublisher({
    enabled: true,
    apiUrl: 'http://127.0.0.1:4000/',
    events: repositories.events,
    participants: repositories.participants,
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    },
    logger: { error() {}, info() {} },
  });

  await publish(
    makeDetection({
      market_type: 'moneyline',
      event_id: event.id,
    }),
  );

  assert.equal(requests.length, 0);
});

test('isSystemPickEligible excludes player props and disabled sports', () => {
  assert.equal(
    isSystemPickEligible(
      { tier: 'alert-worthy', market_type: 'moneyline' },
      { sport_id: 'NBA' },
    ),
    true,
  );
  assert.equal(
    isSystemPickEligible(
      { tier: 'alert-worthy', market_type: 'player_prop' },
      { sport_id: 'NBA' },
    ),
    false,
  );
  assert.equal(
    isSystemPickEligible(
      { tier: 'alert-worthy', market_type: 'moneyline' },
      { sport_id: 'NFL' },
    ),
    false,
  );
});

function makeDetection(
  overrides: Partial<AlertDetectionRecord> = {},
): AlertDetectionRecord {
  return {
    id: 'det-1',
    idempotency_key: 'signal-key-1',
    event_id: 'event-1',
    participant_id: null,
    market_key: 'spread',
    bookmaker_key: 'draftkings',
    baseline_snapshot_at: '2026-04-03T10:00:00.000Z',
    current_snapshot_at: '2026-04-03T10:15:00.000Z',
    old_line: 4.5,
    new_line: 7,
    line_change: 2.5,
    line_change_abs: 2.5,
    velocity: 0.1667,
    time_elapsed_minutes: 15,
    direction: 'up',
    market_type: 'spread',
    tier: 'alert-worthy',
    notified: false,
    notified_at: null,
    notified_channels: null,
    cooldown_expires_at: null,
    metadata: {},
    created_at: '2026-04-03T10:15:00.000Z',
    ...overrides,
  };
}
