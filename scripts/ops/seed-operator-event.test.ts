/**
 * UTV2-1930 — governed operator event seeding.
 *
 * The assertions that matter here are the refusals. A seeding tool that writes
 * something plausible when it should have refused produces reference data nobody can
 * later distinguish from observed data, and the only place that is discoverable is a
 * member looking at a wrong pick.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryParticipantRepository, createInMemoryRepositoryBundle } from '@unit-talk/db';
import type { EventRow, ParticipantRow } from '@unit-talk/db';

import {
  OPERATOR_EVENT_EXTERNAL_ID_PREFIX,
  OPERATOR_EVENT_SOURCE,
  OperatorEventSeedError,
  assertNotProviderOwned,
  buildOperatorEventExternalId,
  buildOperatorEventMetadata,
  parseCli,
  requireParticipantExternalId,
  resolveParticipant,
  seedOperatorEvent,
} from './seed-operator-event.js';

function participant(overrides: Partial<ParticipantRow> & { id: string }): ParticipantRow {
  return {
    id: overrides.id,
    display_name: overrides.display_name ?? 'Bills',
    // `??` would swallow an explicit null, which is exactly the case this file
    // needs to construct: `participants.external_id` is nullable.
    external_id: 'external_id' in overrides ? overrides.external_id : 'BUFFALO_BILLS_NFL',
    league: overrides.league ?? 'NFL',
    metadata: overrides.metadata ?? {},
    participant_type: overrides.participant_type ?? 'team',
    sport: overrides.sport ?? 'NFL',
    created_at: overrides.created_at ?? '2026-01-01T00:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-01-01T00:00:00.000Z',
  } as ParticipantRow;
}

async function seedCatalog(bundle: ReturnType<typeof createInMemoryRepositoryBundle>) {
  await bundle.participants.upsertByExternalId({
    externalId: 'BUFFALO_BILLS_NFL',
    displayName: 'Bills',
    participantType: 'team',
    sport: 'NFL',
    league: 'NFL',
    metadata: {},
  });
  await bundle.participants.upsertByExternalId({
    externalId: 'MIAMI_DOLPHINS_NFL',
    displayName: 'Dolphins',
    participantType: 'team',
    sport: 'NFL',
    league: 'NFL',
    metadata: {},
  });
}

const BASE_ARGV = [
  '--sport', 'NFL',
  '--date', '2026-09-21',
  '--starts-at', '2026-09-21T17:00:00Z',
  '--home', 'BUFFALO_BILLS_NFL',
  '--away', 'MIAMI_DOLPHINS_NFL',
  '--operator', 'griff843',
];

/** Replaces one flag's value, so a test never depends on an index into BASE_ARGV. */
function withFlag(flag: string, value: string): string[] {
  const argv = [...BASE_ARGV];
  const index = argv.indexOf(flag);
  assert.ok(index >= 0, `BASE_ARGV has no ${flag}`);
  argv[index + 1] = value;
  return argv;
}

test('the external id is deterministic and namespaced away from every provider key', () => {
  const first = buildOperatorEventExternalId({
    sport: 'nfl',
    date: '2026-09-21',
    homeExternalId: 'BUFFALO_BILLS_NFL',
    awayExternalId: 'MIAMI_DOLPHINS_NFL',
  });
  const second = buildOperatorEventExternalId({
    sport: 'NFL',
    date: '2026-09-21',
    homeExternalId: 'BUFFALO_BILLS_NFL',
    awayExternalId: 'MIAMI_DOLPHINS_NFL',
  });

  assert.equal(first, second, 're-running the same seed must address the same row');
  assert.ok(first.startsWith(`${OPERATOR_EVENT_EXTERNAL_ID_PREFIX}:`));
  assert.equal(first, 'operator-manual:NFL:2026-09-21:MIAMI_DOLPHINS_NFL@BUFFALO_BILLS_NFL');
});

test('the metadata is unmistakably operator-asserted, not provider-observed', () => {
  const metadata = buildOperatorEventMetadata({
    operator: 'griff843',
    startsAt: '2026-09-21T17:00:00.000Z',
    homeExternalId: 'BUFFALO_BILLS_NFL',
    awayExternalId: 'MIAMI_DOLPHINS_NFL',
    homeDisplayName: 'Bills',
    awayDisplayName: 'Dolphins',
    seededAt: '2026-09-18T07:00:00.000Z',
  });

  assert.equal(metadata['source'], OPERATOR_EVENT_SOURCE);
  assert.equal(metadata['providerIngested'], false);
  assert.equal(metadata['seededBy'], 'operator:griff843');
  assert.equal(metadata['seededAt'], '2026-09-18T07:00:00.000Z');
  // grading-service.ts trusts only `sgo`; nothing here may read as a provider.
  assert.notEqual(metadata['source'], 'sgo');
  assert.equal(metadata['ingestionCycleRunId'], undefined);
});

test('a participant is resolved exactly, or refused by name', () => {
  const catalog = [
    participant({ id: 'p-bills' }),
    participant({ id: 'p-dolphins', display_name: 'Dolphins', external_id: 'MIAMI_DOLPHINS_NFL' }),
  ];

  assert.equal(resolveParticipant(catalog, 'BUFFALO_BILLS_NFL').id, 'p-bills');
  assert.equal(resolveParticipant(catalog, 'dolphins').id, 'p-dolphins', 'display name match is case-insensitive');

  assert.throws(
    () => resolveParticipant(catalog, 'Bill'),
    (error: unknown) => error instanceof OperatorEventSeedError && error.code === 'participant_not_found',
    'a prefix is not a match — near misses are refused, never guessed',
  );
});

test('an ambiguous display name is refused rather than resolved to the first hit', () => {
  const catalog = [
    participant({ id: 'p-a', display_name: 'Jets', external_id: 'NEW_YORK_JETS_NFL' }),
    participant({ id: 'p-b', display_name: 'Jets', external_id: 'WINNIPEG_JETS_NHL', sport: 'NHL' }),
  ];

  assert.throws(
    () => resolveParticipant(catalog, 'Jets'),
    (error: unknown) => error instanceof OperatorEventSeedError && error.code === 'participant_ambiguous',
  );
});

test('a participant with no canonical external id cannot anchor an event identity', () => {
  assert.throws(
    () => requireParticipantExternalId(participant({ id: 'p-x', external_id: null })),
    (error: unknown) =>
      error instanceof OperatorEventSeedError && error.code === 'participant_missing_external_id',
  );
});

test('a provider-owned event is never overwritten', () => {
  const providerEvent = {
    id: 'evt-provider',
    sport_id: 'NFL',
    event_name: 'Dolphins @ Bills',
    event_date: '2026-09-21',
    status: 'scheduled',
    external_id: 'operator-manual:NFL:2026-09-21:MIAMI_DOLPHINS_NFL@BUFFALO_BILLS_NFL',
    metadata: { source: 'sgo', providerKey: 'sgo' },
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
  } as EventRow;

  assert.throws(
    () => assertNotProviderOwned(providerEvent),
    (error: unknown) => error instanceof OperatorEventSeedError && error.code === 'event_not_operator_owned',
  );

  assert.doesNotThrow(() => assertNotProviderOwned(null));
  assert.doesNotThrow(() =>
    assertNotProviderOwned({ ...providerEvent, metadata: { source: OPERATOR_EVENT_SOURCE } } as EventRow),
  );
});

test('every missing flag is reported in one run, not one per invocation', () => {
  assert.throws(
    () => parseCli(['--sport', 'NFL']),
    (error: unknown) =>
      error instanceof OperatorEventSeedError &&
      error.code === 'missing_required_flags' &&
      error.message.includes('--date') &&
      error.message.includes('--starts-at') &&
      error.message.includes('--home') &&
      error.message.includes('--away') &&
      error.message.includes('--operator'),
  );
});

test('malformed dates and instants are refused', () => {
  assert.throws(
    () => parseCli(withFlag('--date', '09/21/2026')),
    (error: unknown) => error instanceof OperatorEventSeedError && error.code === 'invalid_date',
  );
  assert.throws(
    () => parseCli(withFlag('--starts-at', 'kickoff')),
    (error: unknown) => error instanceof OperatorEventSeedError && error.code === 'invalid_starts_at',
  );
});

test('writing is opt-in: without --apply nothing reaches the database', async () => {
  const options = parseCli(BASE_ARGV);
  assert.equal(options.apply, false, '--apply defaults to false');

  const bundle = createInMemoryRepositoryBundle();
  await seedCatalog(bundle);

  const result = await seedOperatorEvent(bundle, options);
  assert.equal(result.applied, false);
  assert.equal(result.eventId, null);
  assert.equal(result.plan.eventName, 'Dolphins @ Bills');

  const written = await bundle.events.findByExternalId(result.plan.externalId);
  assert.equal(written, null, 'a dry run must leave no row behind');
});

test('--apply writes the event and BOTH participant rows together', async () => {
  const bundle = createInMemoryRepositoryBundle();
  await seedCatalog(bundle);

  const result = await seedOperatorEvent(bundle, parseCli([...BASE_ARGV, '--apply']));
  assert.equal(result.applied, true);
  assert.ok(result.eventId);

  const event = await bundle.events.findById(result.eventId!);
  assert.ok(event);
  assert.equal(event!.sport_id, 'NFL');
  assert.equal(event!.event_name, 'Dolphins @ Bills');
  assert.equal(event!.status, 'scheduled');
  assert.equal((event!.metadata as Record<string, unknown>)['source'], OPERATOR_EVENT_SOURCE);

  // The defect this tool exists to make impossible: the hand-seeded canary event
  // 16924899-2a8c-4f90-9c0c-1f45e3230d79 has zero participant rows, so
  // /api/reference-data/matchups renders it with "teams": [] and no side is pickable.
  const links = await bundle.eventParticipants.listByEvent(result.eventId!);
  assert.equal(links.length, 2, 'an event without participants is invisible to the matchup surface');
  assert.deepEqual(
    links.map((row) => row.role).sort(),
    ['away', 'home'],
  );
});

test('re-running the same seed updates one row instead of accumulating duplicates', async () => {
  const bundle = createInMemoryRepositoryBundle();
  await seedCatalog(bundle);

  const first = await seedOperatorEvent(bundle, parseCli([...BASE_ARGV, '--apply']));
  const second = await seedOperatorEvent(bundle, parseCli([...BASE_ARGV, '--apply']));

  assert.equal(first.eventId, second.eventId, 'a capper must never be shown two rows for one game');
  const links = await bundle.eventParticipants.listByEvent(second.eventId!);
  assert.equal(links.length, 2, 'participant rows are upserted, not appended');
});

test('an unknown participant refuses before any row is written', async () => {
  const bundle = createInMemoryRepositoryBundle();
  await seedCatalog(bundle);

  const argv = [...withFlag('--away', 'CAROLINA_PANTHERS_NFL'), '--apply'];
  await assert.rejects(
    seedOperatorEvent(bundle, parseCli(argv)),
    (error: unknown) => error instanceof OperatorEventSeedError && error.code === 'participant_not_found',
  );

  const externalId = buildOperatorEventExternalId({
    sport: 'NFL',
    date: '2026-09-21',
    homeExternalId: 'BUFFALO_BILLS_NFL',
    awayExternalId: 'CAROLINA_PANTHERS_NFL',
  });
  assert.equal(await bundle.events.findByExternalId(externalId), null, 'resolution precedes every write');
});

test('an empty catalog is named as such rather than producing an event with no teams', async () => {
  // `createInMemoryRepositoryBundle()` always seeds the canonical team fixtures, so
  // the empty-catalog branch is only reachable with an empty participant repository.
  // Substituting one keeps the assertion about the refusal rather than the fixture.
  const bundle = createInMemoryRepositoryBundle();
  const emptyCatalog = {
    ...bundle,
    participants: new InMemoryParticipantRepository([]),
  };
  await assert.rejects(
    seedOperatorEvent(emptyCatalog, parseCli([...BASE_ARGV, '--apply'])),
    (error: unknown) => error instanceof OperatorEventSeedError && error.code === 'catalog_empty',
  );
});
