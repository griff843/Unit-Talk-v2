import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryRepositoryBundle } from './persistence.js';
import { processSubmission } from './submission-service.js';
import { transitionPickLifecycle } from './lifecycle-service.js';
import { runGradingPass } from './grading-service.js';
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
      source: 'grading-test',
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
    },
  ]);
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
      source: 'grading-test',
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
