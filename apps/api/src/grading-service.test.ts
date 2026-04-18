import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { processSubmission } from './submission-service.js';
import { transitionPickLifecycle } from './lifecycle-service.js';
import { runGradingPass, type GradingRetryState } from './grading-service.js';
import { recordGradedSettlement } from './settlement-service.js';

async function createPostedPickFixture(
  overrides: {
    market?: string;
    selection?: string;
    line?: number | null;
    odds?: number;
    eventName?: string;
  } = {},
) {
  const repositories = createInMemoryRepositoryBundle();
  const eventName = overrides.eventName ?? 'Fixture Event';
  const created = await processSubmission(
    {
      source: 'api',
      market: overrides.market ?? 'points-all-game-ou',
      selection: overrides.selection ?? 'Over 24.5',
      ...(overrides.line === null
        ? {}
        : { line: overrides.line === undefined ? 24.5 : overrides.line }),
      odds: overrides.odds ?? -105,
      eventName,
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

  if (overrides.line === null) {
    mutatePick(repositories, created.pick.id, (existing) => ({
      ...existing,
      line: null,
    }));
  }

  return {
    repositories,
    pickId: created.pick.id,
    eventName,
  };
}

async function attachPlayerEventContext(
  repositories: ReturnType<typeof createInMemoryRepositoryBundle>,
  pickId: string,
  options: {
    participantExternalId?: string;
    participantName?: string;
    eventExternalId?: string;
    eventName?: string;
    eventDate?: string;
    eventStatus?: 'scheduled' | 'in_progress' | 'completed' | 'postponed' | 'cancelled';
    startsAt?: string;
  } = {},
) {
  const participant = await repositories.participants.upsertByExternalId({
    externalId: options.participantExternalId ?? `PLAYER_${pickId}`,
    displayName: options.participantName ?? 'Fixture Player',
    participantType: 'player',
    sport: 'NBA',
    league: 'NBA',
    metadata: {},
  });

  const event = await repositories.events.upsertByExternalId({
    externalId: options.eventExternalId ?? `evt-${pickId}`,
    sportId: 'NBA',
    eventName: options.eventName ?? 'Fixture Event',
    eventDate: options.eventDate ?? '2026-03-26',
    status: options.eventStatus ?? 'completed',
    metadata: {
      starts_at: options.startsAt ?? '2026-03-26T23:30:00.000Z',
    },
  });

  await repositories.eventParticipants.upsert({
    eventId: event.id,
    participantId: participant.id,
    role: 'competitor',
  });

  mutatePick(repositories, pickId, (existing) => ({
    ...existing,
    participant_id: participant.id,
    metadata: {
      ...(asRecord(existing.metadata) ?? {}),
      eventName: options.eventName ?? 'Fixture Event',
    },
  }));

  return { participant, event };
}

async function seedGameResult(
  repositories: ReturnType<typeof createInMemoryRepositoryBundle>,
  input: {
    eventId: string;
    participantId: string | null;
    marketKey: string;
    actualValue: number;
    source?: string;
    sourcedAt?: string;
  },
) {
  return repositories.gradeResults.insert({
    eventId: input.eventId,
    participantId: input.participantId,
    marketKey: input.marketKey,
    actualValue: input.actualValue,
    source: input.source ?? 'manual',
    sourcedAt: input.sourcedAt ?? '2026-03-27T00:00:00.000Z',
  });
}

async function seedClosingLine(
  repositories: ReturnType<typeof createInMemoryRepositoryBundle>,
  input: {
    providerEventId: string;
    providerParticipantId: string;
    marketKey: string;
    snapshotAt?: string;
  },
) {
  await repositories.providerOffers.upsertBatch([
    {
      providerKey: 'sgo',
      providerEventId: input.providerEventId,
      providerMarketKey: input.marketKey,
      providerParticipantId: input.providerParticipantId,
      sportKey: 'NBA',
      line: 24.5,
      overOdds: 110,
      underOdds: -130,
      devigMode: 'PAIRED',
      isOpening: false,
      isClosing: true,
      snapshotAt: input.snapshotAt ?? '2026-03-26T23:20:00.000Z',
      idempotencyKey: `closing-line:${input.providerEventId}:${input.marketKey}`,
      bookmakerKey: null,
    },
  ]);
}

async function seedDistributionReceipt(
  repositories: ReturnType<typeof createInMemoryRepositoryBundle>,
  pickId: string,
  channel: string,
) {
  const outboxRecord = await repositories.outbox.enqueue({
    pickId,
    target: channel,
    payload: {},
    idempotencyKey: `outbox:${pickId}:${channel}`,
  });
  await repositories.outbox.markSent(outboxRecord.id);
  await repositories.receipts.record({
    outboxId: outboxRecord.id,
    receiptType: 'discord.message',
    status: 'sent',
    channel,
    externalId: `message:${pickId}`,
    payload: { adapter: 'discord' },
  });
}

test('runGradingPass grades a posted over pick and records grading settlement', async () => {
  const { repositories, pickId, eventName } = await createPostedPickFixture();
  const { participant, event } = await attachPlayerEventContext(repositories, pickId, {
    eventName,
    eventStatus: 'completed',
  });
  await seedGameResult(repositories, {
    eventId: event.id,
    participantId: participant.id,
    marketKey: 'points-all-game-ou',
    actualValue: 29,
  });

  const result = await runGradingPass(repositories);
  const updatedPick = await repositories.picks.findPickById(pickId);
  const settlements = await repositories.settlements.listByPick(pickId);

  assert.equal(result.attempted, 1);
  assert.equal(result.graded, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors, 0);
  assert.deepEqual(result.details[0], {
    pickId,
    outcome: 'graded',
    result: 'win',
  });
  assert.equal(updatedPick?.status, 'settled');
  assert.equal(settlements.length, 1);
  assert.equal(settlements[0]?.source, 'grading');
  assert.equal(settlements[0]?.result, 'win');
});

test('runGradingPass posts a settlement recap embed for a graded pick with CLV', async () => {
  const { repositories, pickId, eventName } = await createPostedPickFixture({
    odds: -105,
  });
  const { participant, event } = await attachPlayerEventContext(repositories, pickId, {
    eventName,
    eventExternalId: 'evt-recap-1',
    participantExternalId: 'PLAYER_RECAP_1',
  });
  mutatePick(repositories, pickId, (existing) => ({
    ...existing,
    metadata: {
      ...(asRecord(existing.metadata) ?? {}),
      capper: 'griff843',
    },
  }));
  await seedGameResult(repositories, {
    eventId: event.id,
    participantId: participant.id,
    marketKey: 'points-all-game-ou',
    actualValue: 29,
  });
  await seedClosingLine(repositories, {
    providerEventId: 'evt-recap-1',
    providerParticipantId: 'PLAYER_RECAP_1',
    marketKey: 'points-all-game-ou',
  });
  await seedDistributionReceipt(repositories, pickId, 'discord:1296531122234327100');

  const previousToken = process.env.DISCORD_BOT_TOKEN;
  const previousFetch = globalThis.fetch;
  let capturedUrl = '';
  let capturedBody = '';
  process.env.DISCORD_BOT_TOKEN = 'test-token';
  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedBody = String(init?.body ?? '');
    return new Response(JSON.stringify({ id: 'message-1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const result = await runGradingPass(repositories);

    assert.equal(result.graded, 1);
    assert.equal(
      capturedUrl,
      'https://discord.com/api/v10/channels/1296531122234327100/messages',
    );
    const body = JSON.parse(capturedBody) as {
      embeds?: Array<{
        fields?: Array<{ name: string; value: string }>;
      }>;
    };
    const fields = body.embeds?.[0]?.fields ?? [];
    assert.deepEqual(
      fields.map((field) => [field.name, field.value]),
      [
        ['Market', 'points-all-game-ou'],
        ['Selection', 'Over 24.5'],
        ['Result', 'Win'],
        ['P/L', '+1.0u'],
        ['CLV% (vs SGO close)', '+5.5%'],
        ['Capper', 'griff843'],
        ['Stake', '—'],
      ],
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) {
      delete process.env.DISCORD_BOT_TOKEN;
    } else {
      process.env.DISCORD_BOT_TOKEN = previousToken;
    }
  }
});

test('runGradingPass skips recap posting and logs a warning when no delivery target exists', async () => {
  const { repositories, pickId, eventName } = await createPostedPickFixture();
  const { participant, event } = await attachPlayerEventContext(repositories, pickId, {
    eventName,
  });
  await seedGameResult(repositories, {
    eventId: event.id,
    participantId: participant.id,
    marketKey: 'points-all-game-ou',
    actualValue: 29,
  });

  const warnings: string[] = [];
  const previousToken = process.env.DISCORD_BOT_TOKEN;
  process.env.DISCORD_BOT_TOKEN = 'test-token';

  try {
    const result = await runGradingPass(repositories, {
      logger: {
        error() {},
        warn(message: string) {
          warnings.push(message);
        },
      },
    });

    assert.equal(result.graded, 1);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? '', /Skipping recap for pick .*no_sent_distribution_outbox/);
  } finally {
    if (previousToken === undefined) {
      delete process.env.DISCORD_BOT_TOKEN;
    } else {
      process.env.DISCORD_BOT_TOKEN = previousToken;
    }
  }
});

test('runGradingPass grades under selections by inverting the over-side result', async () => {
  const { repositories, pickId, eventName } = await createPostedPickFixture({
    selection: 'Under 24.5',
  });
  const { participant, event } = await attachPlayerEventContext(repositories, pickId, {
    eventName,
  });
  await seedGameResult(repositories, {
    eventId: event.id,
    participantId: participant.id,
    marketKey: 'points-all-game-ou',
    actualValue: 20,
  });

  const result = await runGradingPass(repositories);
  const settlements = await repositories.settlements.listByPick(pickId);

  assert.equal(result.graded, 1);
  assert.equal(result.details[0]?.result, 'win');
  assert.equal(settlements[0]?.result, 'win');
});

test('runGradingPass grades picks with abbreviated O/U selection format from smart-form', async () => {
  // Smart-form serializes player props as "Player Name O X.5" not "Player Name Over X.5"
  const { repositories, pickId, eventName } = await createPostedPickFixture({
    selection: 'Jalen Brunson O 28.5',
  });
  const { participant, event } = await attachPlayerEventContext(repositories, pickId, {
    eventName,
  });
  await seedGameResult(repositories, {
    eventId: event.id,
    participantId: participant.id,
    marketKey: 'points-all-game-ou',
    actualValue: 30,
  });

  const result = await runGradingPass(repositories);
  const settlements = await repositories.settlements.listByPick(pickId);

  assert.equal(result.graded, 1, 'abbreviated O should be recognized as over');
  assert.equal(result.details[0]?.result, 'win');
  assert.equal(settlements[0]?.result, 'win');
});

test('runGradingPass grades picks with abbreviated U/X selection format from smart-form', async () => {
  const { repositories, pickId, eventName } = await createPostedPickFixture({
    selection: 'Donovan Mitchell U 28.5',
  });
  const { participant, event } = await attachPlayerEventContext(repositories, pickId, {
    eventName,
  });
  await seedGameResult(repositories, {
    eventId: event.id,
    participantId: participant.id,
    marketKey: 'points-all-game-ou',
    actualValue: 20,
  });

  const result = await runGradingPass(repositories);
  const settlements = await repositories.settlements.listByPick(pickId);

  assert.equal(result.graded, 1, 'abbreviated U should be recognized as under');
  assert.equal(result.details[0]?.result, 'win');
  assert.equal(settlements[0]?.result, 'win');
});

test('runGradingPass skips picks whose linked event is not completed', async () => {
  const { repositories, pickId, eventName } = await createPostedPickFixture();
  const { participant, event } = await attachPlayerEventContext(repositories, pickId, {
    eventName,
    eventStatus: 'scheduled',
  });
  await seedGameResult(repositories, {
    eventId: event.id,
    participantId: participant.id,
    marketKey: 'points-all-game-ou',
    actualValue: 29,
  });

  const result = await runGradingPass(repositories);
  const updatedPick = await repositories.picks.findPickById(pickId);

  assert.equal(result.graded, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.details[0]?.reason, 'event_not_completed');
  assert.equal(updatedPick?.status, 'posted');
  assert.equal((await repositories.settlements.listByPick(pickId)).length, 0);
});

test('runGradingPass skips picks when no matching game result exists', async () => {
  const { repositories, pickId, eventName } = await createPostedPickFixture();
  await attachPlayerEventContext(repositories, pickId, { eventName });

  const result = await runGradingPass(repositories);

  assert.equal(result.graded, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.details[0]?.reason, 'game_result_not_found');
  assert.equal((await repositories.settlements.listByPick(pickId)).length, 0);
});

test('runGradingPass skips retry-pending pick without incrementing attempts', async () => {
  const { repositories, pickId, eventName } = await createPostedPickFixture();
  await attachPlayerEventContext(repositories, pickId, { eventName });
  const retryState: GradingRetryState = new Map([
    [
      pickId,
      {
        attempts: 1,
        retryAfter: Date.now() + 60_000,
      },
    ],
  ]);

  const result = await runGradingPass(repositories, { retryState });

  assert.equal(result.skipped, 1);
  assert.equal(result.details[0]?.reason, 'game_result_retry_pending');
  assert.equal(retryState.get(pickId)?.attempts, 1);
});

test('runGradingPass re-attempts and grades pick when retryAfter has elapsed', async () => {
  const { repositories, pickId, eventName } = await createPostedPickFixture();
  const { participant, event } = await attachPlayerEventContext(repositories, pickId, {
    eventName,
  });
  const retryState: GradingRetryState = new Map([
    [
      pickId,
      {
        attempts: 1,
        retryAfter: Date.now() - 1,
      },
    ],
  ]);
  await seedGameResult(repositories, {
    eventId: event.id,
    participantId: participant.id,
    marketKey: 'points-all-game-ou',
    actualValue: 29,
  });

  const result = await runGradingPass(repositories, { retryState });

  assert.equal(result.graded, 1);
  assert.equal(result.details[0]?.result, 'win');
  assert.equal(retryState.has(pickId), false);
});

test('runGradingPass marks pick as grade_skipped_final after 3 failed attempts', async () => {
  const { repositories, pickId, eventName } = await createPostedPickFixture();
  await attachPlayerEventContext(repositories, pickId, { eventName });
  const retryState: GradingRetryState = new Map([
    [
      pickId,
      {
        attempts: 2,
        retryAfter: Date.now() - 1,
      },
    ],
  ]);

  const result = await runGradingPass(repositories, { retryState });

  assert.equal(result.skipped, 1);
  assert.equal(result.details[0]?.reason, 'grade_skipped_final');
  assert.equal(retryState.get(pickId)?.attempts, 3);
});

test('runGradingPass is idempotent across repeated executions', async () => {
  const { repositories, pickId, eventName } = await createPostedPickFixture();
  const { participant, event } = await attachPlayerEventContext(repositories, pickId, {
    eventName,
  });
  await seedGameResult(repositories, {
    eventId: event.id,
    participantId: participant.id,
    marketKey: 'points-all-game-ou',
    actualValue: 30,
  });

  const first = await runGradingPass(repositories);
  const second = await runGradingPass(repositories);
  const settlements = await repositories.settlements.listByPick(pickId);

  assert.equal(first.graded, 1);
  assert.equal(second.attempted, 0);
  assert.equal(second.graded, 0);
  assert.equal(settlements.length, 1);
});

test('runGradingPass skips picks with no participant link', async () => {
  const { repositories, pickId } = await createPostedPickFixture();

  const result = await runGradingPass(repositories);

  assert.equal(result.skipped, 1);
  assert.equal(result.details[0]?.pickId, pickId);
  assert.equal(result.details[0]?.reason, 'missing_participant_id');
});

test('runGradingPass resolves participant linkage from pick metadata when participant_id is missing', async () => {
  const { repositories, pickId, eventName } = await createPostedPickFixture({
    selection: 'Jalen Brunson Over 24.5',
  });
  const { participant, event } = await attachPlayerEventContext(repositories, pickId, {
    participantExternalId: 'JALEN_BRUNSON_1_NBA',
    participantName: 'Jalen Brunson',
    eventName,
  });
  mutatePick(repositories, pickId, (existing) => ({
    ...existing,
    participant_id: null,
    metadata: {
      ...(asRecord(existing.metadata) ?? {}),
      sport: 'NBA',
      player: 'Jalen Brunson',
      eventName,
    },
  }));
  await seedGameResult(repositories, {
    eventId: event.id,
    participantId: participant.id,
    marketKey: 'points-all-game-ou',
    actualValue: 29,
  });

  const result = await runGradingPass(repositories);

  assert.equal(result.graded, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.details[0]?.result, 'win');
});

test('runGradingPass resolves participant linkage from metadata playerId before fuzzy name matching', async () => {
  const { repositories, pickId, eventName } = await createPostedPickFixture({
    selection: 'Jalen Brunson Over 24.5',
  });
  const { participant, event } = await attachPlayerEventContext(repositories, pickId, {
    participantExternalId: 'JALEN_BRUNSON_1_NBA',
    participantName: 'Jalen Brunson',
    eventName,
  });
  mutatePick(repositories, pickId, (existing) => ({
    ...existing,
    participant_id: null,
    metadata: {
      ...(asRecord(existing.metadata) ?? {}),
      sport: 'NBA',
      playerId: participant.id,
      eventName,
    },
  }));
  await seedGameResult(repositories, {
    eventId: event.id,
    participantId: participant.id,
    marketKey: 'points-all-game-ou',
    actualValue: 29,
  });

  const result = await runGradingPass(repositories);

  assert.equal(result.graded, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.details[0]?.result, 'win');
});

test('runGradingPass keeps fail-closed behavior when metadata-only participant resolution is ambiguous', async () => {
  const { repositories, pickId } = await createPostedPickFixture({
    selection: 'Jalen Brunson Over 24.5',
  });
  const firstParticipant = await repositories.participants.upsertByExternalId({
    externalId: 'JALEN_BRUNSON_1_NBA',
    displayName: 'Jalen Brunson',
    participantType: 'player',
    sport: 'NBA',
    league: 'NBA',
    metadata: {},
  });
  const secondParticipant = await repositories.participants.upsertByExternalId({
    externalId: 'JALEN_BRUNSON_DUPLICATE',
    displayName: 'Jalen Brunson',
    participantType: 'player',
    sport: 'NBA',
    league: 'NBA',
    metadata: {},
  });
  assert.notEqual(firstParticipant.id, secondParticipant.id);
  mutatePick(repositories, pickId, (existing) => ({
    ...existing,
    participant_id: null,
    metadata: {
      ...(asRecord(existing.metadata) ?? {}),
      sport: 'NBA',
      player: 'Jalen Brunson',
      eventName: 'Knicks vs Heat',
    },
  }));

  const result = await runGradingPass(repositories);

  assert.equal(result.graded, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.details[0]?.reason, 'missing_participant_id');
});

test('runGradingPass skips picks when no event link can be resolved', async () => {
  const { repositories, pickId } = await createPostedPickFixture();
  mutatePick(repositories, pickId, (existing) => ({
    ...existing,
    participant_id: 'unlinked-participant',
  }));

  const result = await runGradingPass(repositories);

  assert.equal(result.skipped, 1);
  assert.equal(result.details[0]?.reason, 'event_link_not_found');
});

test('runGradingPass skips picks whose betting line is null', async () => {
  const { repositories, pickId, eventName } = await createPostedPickFixture({
    line: null,
  });
  await attachPlayerEventContext(repositories, pickId, { eventName });

  const result = await runGradingPass(repositories);

  assert.equal(result.skipped, 1);
  assert.equal(result.details[0]?.reason, 'missing_line');
});

test('recordGradedSettlement enriches the grading settlement payload with CLV when a closing line exists', async () => {
  const { repositories, pickId, eventName } = await createPostedPickFixture({
    odds: -105,
  });
  const { participant, event } = await attachPlayerEventContext(repositories, pickId, {
    eventName,
    eventExternalId: 'evt-clv-1',
    participantExternalId: 'PLAYER_CLV_1',
  });
  const gameResult = await seedGameResult(repositories, {
    eventId: event.id,
    participantId: participant.id,
    marketKey: 'points-all-game-ou',
    actualValue: 29,
  });
  await seedClosingLine(repositories, {
    providerEventId: 'evt-clv-1',
    providerParticipantId: 'PLAYER_CLV_1',
    marketKey: 'points-all-game-ou',
  });

  const result = await recordGradedSettlement(
    pickId,
    'win',
    {
      actualValue: gameResult.actual_value,
      marketKey: gameResult.market_key,
      eventId: gameResult.event_id,
      gameResultId: gameResult.id,
    },
    repositories,
  );

  const payload = result.settlementRecord.payload as Record<string, unknown>;
  const clv = payload.clv as Record<string, unknown> | null;
  assert.ok(clv);
  assert.equal(clv?.providerKey, 'sgo');
  assert.equal(result.finalLifecycleState, 'settled');
});

test('recordGradedSettlement writes clvRaw and clvPercent as top-level payload keys', async () => {
  const { repositories, pickId, eventName } = await createPostedPickFixture({
    odds: -105,
  });
  const { participant, event } = await attachPlayerEventContext(repositories, pickId, {
    eventName,
    eventExternalId: 'evt-clv-top-level',
    participantExternalId: 'PLAYER_CLV_TOP_LEVEL',
  });
  const gameResult = await seedGameResult(repositories, {
    eventId: event.id,
    participantId: participant.id,
    marketKey: 'points-all-game-ou',
    actualValue: 29,
  });
  await seedClosingLine(repositories, {
    providerEventId: 'evt-clv-top-level',
    providerParticipantId: 'PLAYER_CLV_TOP_LEVEL',
    marketKey: 'points-all-game-ou',
  });

  const result = await recordGradedSettlement(
    pickId,
    'win',
    {
      actualValue: gameResult.actual_value,
      marketKey: gameResult.market_key,
      eventId: gameResult.event_id,
      gameResultId: gameResult.id,
    },
    repositories,
  );

  const payload = result.settlementRecord.payload as Record<string, unknown>;
  assert.equal(typeof payload.clvRaw, 'number');
  assert.equal(typeof payload.clvPercent, 'number');
});

test('recordGradedSettlement writes beatsClosingLine true when the pick beats the closing line', async () => {
  const { repositories, pickId, eventName } = await createPostedPickFixture({
    odds: -105,
  });
  const { participant, event } = await attachPlayerEventContext(repositories, pickId, {
    eventName,
    eventExternalId: 'evt-clv-true',
    participantExternalId: 'PLAYER_CLV_TRUE',
  });
  const gameResult = await seedGameResult(repositories, {
    eventId: event.id,
    participantId: participant.id,
    marketKey: 'points-all-game-ou',
    actualValue: 29,
  });
  await seedClosingLine(repositories, {
    providerEventId: 'evt-clv-true',
    providerParticipantId: 'PLAYER_CLV_TRUE',
    marketKey: 'points-all-game-ou',
  });

  const result = await recordGradedSettlement(
    pickId,
    'win',
    {
      actualValue: gameResult.actual_value,
      marketKey: gameResult.market_key,
      eventId: gameResult.event_id,
      gameResultId: gameResult.id,
    },
    repositories,
  );

  const payload = result.settlementRecord.payload as Record<string, unknown>;
  assert.equal(payload.beatsClosingLine, true);
});

test('recordGradedSettlement writes beatsClosingLine false when the pick misses the closing line', async () => {
  const { repositories, pickId, eventName } = await createPostedPickFixture({
    odds: 150,
  });
  const { participant, event } = await attachPlayerEventContext(repositories, pickId, {
    eventName,
    eventExternalId: 'evt-clv-false',
    participantExternalId: 'PLAYER_CLV_FALSE',
  });
  const gameResult = await seedGameResult(repositories, {
    eventId: event.id,
    participantId: participant.id,
    marketKey: 'points-all-game-ou',
    actualValue: 29,
  });
  await seedClosingLine(repositories, {
    providerEventId: 'evt-clv-false',
    providerParticipantId: 'PLAYER_CLV_FALSE',
    marketKey: 'points-all-game-ou',
  });

  const result = await recordGradedSettlement(
    pickId,
    'win',
    {
      actualValue: gameResult.actual_value,
      marketKey: gameResult.market_key,
      eventId: gameResult.event_id,
      gameResultId: gameResult.id,
    },
    repositories,
  );

  const payload = result.settlementRecord.payload as Record<string, unknown>;
  assert.equal(payload.beatsClosingLine, false);
});

test('recordGradedSettlement omits top-level CLV keys when no closing line exists', async () => {
  const { repositories, pickId, eventName } = await createPostedPickFixture({
    odds: -105,
  });
  const { participant, event } = await attachPlayerEventContext(repositories, pickId, {
    eventName,
    eventExternalId: 'evt-clv-none',
    participantExternalId: 'PLAYER_CLV_NONE',
  });
  const gameResult = await seedGameResult(repositories, {
    eventId: event.id,
    participantId: participant.id,
    marketKey: 'points-all-game-ou',
    actualValue: 29,
  });

  const result = await recordGradedSettlement(
    pickId,
    'win',
    {
      actualValue: gameResult.actual_value,
      marketKey: gameResult.market_key,
      eventId: gameResult.event_id,
      gameResultId: gameResult.id,
    },
    repositories,
  );

  const payload = result.settlementRecord.payload as Record<string, unknown>;
  assert.equal('clvRaw' in payload, false);
  assert.equal('clvPercent' in payload, false);
  assert.equal('beatsClosingLine' in payload, false);
  assert.equal(payload.clvStatus, 'missing_closing_line');
  assert.equal(payload.clvUnavailableReason, 'missing_closing_line');
});

test('recordGradedSettlement persists opening-line fallback visibility when CLV uses opening line', async () => {
  const { repositories, pickId, eventName } = await createPostedPickFixture({
    odds: -105,
  });
  const { participant, event } = await attachPlayerEventContext(repositories, pickId, {
    eventName,
    eventExternalId: 'evt-clv-opening-fallback',
    participantExternalId: 'PLAYER_CLV_OPENING',
  });
  const gameResult = await seedGameResult(repositories, {
    eventId: event.id,
    participantId: participant.id,
    marketKey: 'points-all-game-ou',
    actualValue: 29,
  });
  await repositories.providerOffers.upsertBatch([
    {
      providerKey: 'sgo',
      providerEventId: 'evt-clv-opening-fallback',
      providerMarketKey: 'points-all-game-ou',
      providerParticipantId: 'PLAYER_CLV_OPENING',
      sportKey: 'NBA',
      line: 24.5,
      overOdds: -115,
      underOdds: -105,
      devigMode: 'PAIRED',
      isOpening: true,
      isClosing: false,
      snapshotAt: '2026-03-26T23:35:00.000Z',
      idempotencyKey: 'opening-line-clv-visibility',
      bookmakerKey: null,
    },
  ]);

  const result = await recordGradedSettlement(
    pickId,
    'win',
    {
      actualValue: gameResult.actual_value,
      marketKey: gameResult.market_key,
      eventId: gameResult.event_id,
      gameResultId: gameResult.id,
    },
    repositories,
  );

  const payload = result.settlementRecord.payload as Record<string, unknown>;
  assert.equal(payload.clvStatus, 'opening_line_fallback');
  assert.equal(payload.clvUnavailableReason, null);
  assert.equal(payload.isOpeningLineFallback, true);
});

test('recordGradedSettlement produces non-null CLV when a future sibling event is closer by date (UTV2-453 regression)', async () => {
  // Reproduces the production bug: pick created 2026-04-04, graded against the April 3 event
  // (completed), but CLV was returning null because the April 6 event (scheduled, closer by 30h)
  // was selected by proximity. The fix: CLV now uses gradingContext.eventId directly.
  const { repositories, pickId } = await createPostedPickFixture({ odds: -112 });

  // The event that grading resolved to (completed April 3 game)
  const { participant, event: gradedEvent } = await attachPlayerEventContext(repositories, pickId, {
    participantExternalId: 'PLAYER_453_A',
    participantName: 'Fixture Player 453',
    eventExternalId: 'evt-453-apr3',
    eventName: 'Team A vs Team B — Apr 3',
    eventDate: '2026-04-03',
    eventStatus: 'completed',
    startsAt: '2026-04-03T02:30:00.000Z',
  });

  // A FUTURE sibling event that is closer in calendar time to the pick creation date.
  // Without the fix, CLV would pick this event and find no offers → return null.
  const futureEvent = await repositories.events.upsertByExternalId({
    externalId: 'evt-453-apr6',
    sportId: 'NBA',
    eventName: 'Team A vs Team C — Apr 6',
    eventDate: '2026-04-06',
    status: 'scheduled',
    metadata: { starts_at: '2026-04-06T01:00:00.000Z' },
  });
  await repositories.eventParticipants.upsert({
    eventId: futureEvent.id,
    participantId: participant.id,
    role: 'competitor',
  });

  const gameResult = await seedGameResult(repositories, {
    eventId: gradedEvent.id,
    participantId: participant.id,
    marketKey: 'points-all-game-ou',
    actualValue: 29,
  });

  // Closing line exists only for the April 3 event — not the April 6 event.
  await seedClosingLine(repositories, {
    providerEventId: 'evt-453-apr3',
    providerParticipantId: 'PLAYER_453_A',
    marketKey: 'points-all-game-ou',
    snapshotAt: '2026-04-03T02:20:00.000Z',
  });

  const result = await recordGradedSettlement(
    pickId,
    'win',
    {
      actualValue: gameResult.actual_value,
      marketKey: gameResult.market_key,
      eventId: gradedEvent.id,     // grading resolved this — CLV must use the same
      gameResultId: gameResult.id,
    },
    repositories,
  );

  const payload = result.settlementRecord.payload as Record<string, unknown>;
  const clv = payload.clv as Record<string, unknown> | null;
  assert.ok(clv !== null, 'CLV must not be null when a closing line exists for the graded event');
  assert.equal(clv?.providerKey, 'sgo');
});

test('runGradingPass writes settlement.graded audit rows with gradingContext payload', async () => {
  const { repositories, pickId, eventName } = await createPostedPickFixture();
  const { participant, event } = await attachPlayerEventContext(repositories, pickId, {
    eventName,
  });
  const gameResult = await seedGameResult(repositories, {
    eventId: event.id,
    participantId: participant.id,
    marketKey: 'points-all-game-ou',
    actualValue: 27,
  });

  await runGradingPass(repositories);

  const auditRecords = (repositories.audit as unknown as {
    records: Array<Record<string, unknown>>;
  }).records;
  const audit = auditRecords.find((record) => record.action === 'settlement.graded');
  const payload = audit?.payload as Record<string, unknown> | undefined;
  const gradingContext = payload?.gradingContext as Record<string, unknown> | undefined;

  assert.ok(audit);
  assert.equal(audit?.actor, 'grading-service');
  assert.equal(gradingContext?.gameResultId, gameResult.id);
  assert.equal(gradingContext?.actualValue, 27);
});

test('runGradingPass counts write failures as errors and continues grading later picks', async () => {
  const { repositories, pickId: firstPickId, eventName: firstEventName } =
    await createPostedPickFixture({ eventName: 'First Event' });
  const { participant: firstParticipant, event: firstEvent } =
    await attachPlayerEventContext(repositories, firstPickId, {
      eventName: firstEventName,
    });
  await seedGameResult(repositories, {
    eventId: firstEvent.id,
    participantId: firstParticipant.id,
    marketKey: 'points-all-game-ou',
    actualValue: 29,
  });

  const secondCreated = await processSubmission(
    {
      source: 'api',
      market: 'points-all-game-ou',
      selection: 'Over 24.5',
      line: 24.5,
      odds: -110,
      eventName: 'Second Event',
    },
    repositories,
  );
  await transitionPickLifecycle(repositories.picks, secondCreated.pick.id, 'queued', 'queued');
  await transitionPickLifecycle(
    repositories.picks,
    secondCreated.pick.id,
    'posted',
    'posted',
    'poster',
  );
  const { participant: secondParticipant, event: secondEvent } =
    await attachPlayerEventContext(repositories, secondCreated.pick.id, {
      eventName: 'Second Event',
    });
  await seedGameResult(repositories, {
    eventId: secondEvent.id,
    participantId: secondParticipant.id,
    marketKey: 'points-all-game-ou',
    actualValue: 31,
  });

  const originalRecord = repositories.settlements.record.bind(repositories.settlements);
  let shouldFailFirstWrite = true;
  repositories.settlements.record = async (input) => {
    if (shouldFailFirstWrite) {
      shouldFailFirstWrite = false;
      throw new Error('settlement write failed');
    }
    return originalRecord(input);
  };

  const result = await runGradingPass(repositories);

  assert.equal(result.attempted, 2);
  assert.equal(result.graded, 1);
  assert.equal(result.errors, 1);
  assert.equal(result.details[0]?.outcome, 'error');
  assert.equal(result.details[1]?.outcome, 'graded');
  assert.equal((await repositories.settlements.listByPick(firstPickId)).length, 0);
  assert.equal((await repositories.settlements.listByPick(secondCreated.pick.id)).length, 1);
});

function mutatePick(
  repositories: ReturnType<typeof createInMemoryRepositoryBundle>,
  pickId: string,
  mutate: (existing: Record<string, unknown>) => Record<string, unknown>,
) {
  const pickRepository = repositories.picks as unknown as {
    picks: Map<string, Record<string, unknown>>;
  };
  const existing = pickRepository.picks.get(pickId);
  if (!existing) {
    throw new Error(`Missing pick for test mutation: ${pickId}`);
  }

  pickRepository.picks.set(pickId, mutate(existing));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}


// ---------------------------------------------------------------------------
// UTV2-144: system_runs observability for grading.run
// ---------------------------------------------------------------------------

test('runGradingPass writes a grading.run system_runs row on completion', async () => {
  const { repositories, pickId } = await createPostedPickFixture();
  const { participant, event } = await attachPlayerEventContext(repositories, pickId);
  await seedGameResult(repositories, {
    eventId: event.id,
    participantId: participant.id,
    marketKey: 'points-all-game-ou',
    actualValue: 30,
  });

  await runGradingPass(repositories);

  const runs = await repositories.runs.listByType('grading.run');
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.run_type, 'grading.run');
  assert.equal(
    (runs[0]?.details as Record<string, unknown>)?.['picksGraded'],
    1,
  );
  assert.equal(
    (runs[0]?.details as Record<string, unknown>)?.['failed'],
    0,
  );
});

test('runGradingPass writes grading.run row with failed count when errors occur', async () => {
  const repositories = createInMemoryRepositoryBundle();

  const created = await processSubmission(
    {
      source: 'api',
      market: 'points-all-game-ou',
      selection: 'Over 24.5',
      line: 24.5,
      odds: -105,
    },
    repositories,
  );
  await transitionPickLifecycle(repositories.picks, created.pick.id, 'queued', 'queued');
  await transitionPickLifecycle(repositories.picks, created.pick.id, 'posted', 'posted', 'poster');

  const brokenRepos = {
    ...repositories,
    settlements: {
      ...repositories.settlements,
      findLatestForPick: async () => {
        throw new Error('forced settlement error');
      },
    },
  };

  await runGradingPass(brokenRepos as typeof repositories);

  const runs = await repositories.runs.listByType('grading.run');
  assert.equal(runs.length, 1);
  assert.equal(
    (runs[0]?.details as Record<string, unknown>)?.['failed'],
    1,
  );
});
// --- Game-line grading tests (UTV2-385) ---

async function createPostedGameLinePickFixture(
  overrides: {
    market?: string;
    selection?: string;
    line?: number;
    eventName?: string;
  } = {},
) {
  const repositories = createInMemoryRepositoryBundle();
  const eventName = overrides.eventName ?? 'LAL vs BOS';
  const created = await processSubmission(
    {
      source: 'api',
      market: overrides.market ?? 'game_total_ou',
      selection: overrides.selection ?? 'Over 224.5',
      line: overrides.line ?? 224.5,
      odds: -110,
      eventName,
    },
    repositories,
  );

  await transitionPickLifecycle(repositories.picks, created.pick.id, 'queued', 'queued');
  await transitionPickLifecycle(repositories.picks, created.pick.id, 'posted', 'posted', 'poster');

  // eventName is a top-level SubmissionPayload field, not stored in pick.metadata by default.
  // Inject it so resolvePickEventByName can find the event.
  mutatePick(repositories, created.pick.id, (existing) => ({
    ...existing,
    metadata: { ...(asRecord(existing.metadata) ?? {}), eventName },
  }));

  return { repositories, pickId: created.pick.id, eventName };
}

async function attachGameLineEventContext(
  repositories: ReturnType<typeof createInMemoryRepositoryBundle>,
  eventName: string,
  options: {
    eventStatus?: 'scheduled' | 'in_progress' | 'completed' | 'postponed' | 'cancelled';
    eventDate?: string;
  } = {},
) {
  return repositories.events.upsertByExternalId({
    externalId: `evt-game-line-${eventName}`,
    sportId: 'NBA',
    eventName,
    eventDate: options.eventDate ?? '2026-04-04',
    status: options.eventStatus ?? 'completed',
    metadata: { starts_at: '2026-04-04T19:30:00.000Z' },
  });
}

test('runGradingPass grades a game_total_ou pick as win when actual > line', async () => {
  const { repositories, pickId, eventName } = await createPostedGameLinePickFixture({
    selection: 'Over 224.5',
    line: 224.5,
  });

  const event = await attachGameLineEventContext(repositories, eventName);

  await repositories.gradeResults.insert({
    eventId: event.id,
    participantId: null,
    marketKey: 'game_total_ou',
    actualValue: 227,
    source: 'sgo',
    sourcedAt: '2026-04-04T22:00:00.000Z',
  });

  const result = await runGradingPass(repositories);

  assert.equal(result.graded, 1);
  assert.equal(result.skipped, 0);
  const detail = result.details.find((d) => d.pickId === pickId);
  assert.ok(detail);
  assert.equal(detail.outcome, 'graded');
  assert.equal(detail.result, 'win');
});

test('runGradingPass grades a game_total_ou under pick as win when actual < line', async () => {
  const { repositories, pickId, eventName } = await createPostedGameLinePickFixture({
    selection: 'Under 224.5',
    line: 224.5,
  });

  const event = await attachGameLineEventContext(repositories, eventName);

  await repositories.gradeResults.insert({
    eventId: event.id,
    participantId: null,
    marketKey: 'game_total_ou',
    actualValue: 210,
    source: 'sgo',
    sourcedAt: '2026-04-04T22:00:00.000Z',
  });

  const result = await runGradingPass(repositories);

  assert.equal(result.graded, 1);
  const detail = result.details.find((d) => d.pickId === pickId);
  assert.ok(detail);
  assert.equal(detail.outcome, 'graded');
  assert.equal(detail.result, 'win');
});

test('runGradingPass skips game_total_ou pick when event is not completed', async () => {
  const { repositories, pickId, eventName } = await createPostedGameLinePickFixture();

  await attachGameLineEventContext(repositories, eventName, { eventStatus: 'in_progress' });

  const result = await runGradingPass(repositories);

  assert.equal(result.graded, 0);
  const detail = result.details.find((d) => d.pickId === pickId);
  assert.ok(detail);
  assert.equal(detail.outcome, 'skipped');
  assert.equal(detail.reason, 'event_not_completed');
});

test('runGradingPass skips game_total_ou pick when no game result exists', async () => {
  const { repositories, pickId, eventName } = await createPostedGameLinePickFixture();

  await attachGameLineEventContext(repositories, eventName);
  // no game_result seeded

  const result = await runGradingPass(repositories);

  assert.equal(result.graded, 0);
  const detail = result.details.find((d) => d.pickId === pickId);
  assert.ok(detail);
  assert.equal(detail.outcome, 'skipped');
  assert.equal(detail.reason, 'game_result_not_found');
});

// UTV2-448: score-based grading correctness — push and loss cases
test('runGradingPass grades a game_total_ou over pick as push when actual equals line', async () => {
  const { repositories, pickId, eventName } = await createPostedGameLinePickFixture({
    selection: 'Over 224.5',
    line: 224.5,
  });

  const event = await attachGameLineEventContext(repositories, eventName);

  await repositories.gradeResults.insert({
    eventId: event.id,
    participantId: null,
    marketKey: 'game_total_ou',
    actualValue: 224.5,
    source: 'sgo',
    sourcedAt: '2026-04-04T22:00:00.000Z',
  });

  const result = await runGradingPass(repositories);

  assert.equal(result.graded, 1);
  const detail = result.details.find((d) => d.pickId === pickId);
  assert.ok(detail);
  assert.equal(detail.outcome, 'graded');
  assert.equal(detail.result, 'push');
});

test('runGradingPass grades a game_total_ou over pick as loss when actual < line', async () => {
  const { repositories, pickId, eventName } = await createPostedGameLinePickFixture({
    selection: 'Over 224.5',
    line: 224.5,
  });

  const event = await attachGameLineEventContext(repositories, eventName);

  await repositories.gradeResults.insert({
    eventId: event.id,
    participantId: null,
    marketKey: 'game_total_ou',
    actualValue: 198,
    source: 'sgo',
    sourcedAt: '2026-04-04T22:00:00.000Z',
  });

  const result = await runGradingPass(repositories);

  assert.equal(result.graded, 1);
  const detail = result.details.find((d) => d.pickId === pickId);
  assert.ok(detail);
  assert.equal(detail.outcome, 'graded');
  assert.equal(detail.result, 'loss');
});

// ---------------------------------------------------------------------------
// UTV2-614: participant resolution via metadata.player fuzzy match
// ---------------------------------------------------------------------------

test('runGradingPass resolves participant via metadata.player fuzzy match when participant_id is null', async () => {
  // Simulate a Smart Form pick: no participant_id set on the pick row itself,
  // but metadata.player contains the player display name and metadata.sport is set.
  const { repositories, pickId } = await createPostedPickFixture({
    market: 'points-all-game-ou',
    selection: 'Over 24.5',
    line: 24.5,
  });

  // Seed the participant — this is what the ingestor would have stored.
  const participant = await repositories.participants.upsertByExternalId({
    externalId: 'nba-player-lebron-james',
    displayName: 'LeBron James',
    participantType: 'player',
    sport: 'NBA',
    league: 'NBA',
    metadata: {},
  });

  // Seed a completed event linked to that participant.
  const event = await repositories.events.upsertByExternalId({
    externalId: 'evt-lebron-fuzzy',
    sportId: 'NBA',
    eventName: 'Lakers vs Celtics',
    eventDate: '2026-04-15',
    status: 'completed',
    metadata: { starts_at: '2026-04-15T23:30:00.000Z' },
  });
  await repositories.eventParticipants.upsert({
    eventId: event.id,
    participantId: participant.id,
    role: 'competitor',
  });

  // Seed a game result for that participant + market.
  await repositories.gradeResults.insert({
    eventId: event.id,
    participantId: participant.id,
    marketKey: 'points-all-game-ou',
    actualValue: 32,
    source: 'sgo',
    sourcedAt: '2026-04-15T23:59:00.000Z',
  });

  // Mutate the pick to simulate what Smart Form produces:
  // no participant_id on the row, but metadata.player and metadata.sport are set.
  mutatePick(repositories, pickId, (existing) => ({
    ...existing,
    participant_id: null,
    metadata: {
      ...(asRecord(existing.metadata) ?? {}),
      player: 'LeBron James',
      sport: 'NBA',
      eventName: 'Lakers vs Celtics',
    },
  }));

  const result = await runGradingPass(repositories);

  assert.equal(result.graded, 1, 'pick should be graded via fuzzy name match');
  const detail = result.details.find((d) => d.pickId === pickId);
  assert.ok(detail, 'detail entry must exist');
  assert.equal(detail.outcome, 'graded');
  assert.equal(detail.result, 'win', 'actual 32 > line 24.5 → win');
});

test('runGradingPass skips pick with missing_participant_id when metadata.player is absent', async () => {
  // No metadata.player and no participant_id — should remain skipped.
  const { repositories, pickId } = await createPostedPickFixture({
    market: 'points-all-game-ou',
    selection: 'Over 24.5',
    line: 24.5,
  });

  // Ensure participant_id is null and metadata has no player field.
  mutatePick(repositories, pickId, (existing) => ({
    ...existing,
    participant_id: null,
    metadata: {
      sport: 'NBA',
      eventName: 'Some Game',
    },
  }));

  const result = await runGradingPass(repositories);

  assert.equal(result.graded, 0);
  const detail = result.details.find((d) => d.pickId === pickId);
  assert.ok(detail);
  assert.equal(detail.outcome, 'skipped');
  assert.equal(detail.reason, 'missing_participant_id');
});
