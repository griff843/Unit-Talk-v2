import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { PlayerAvailability } from '@unit-talk/domain';

import { evaluateStalenessGuard } from './injury-staleness-guard.js';

const NOW_ISO = '2026-05-11T12:00:00.000Z';

function buildAvailability(
  overrides: Partial<PlayerAvailability> = {},
): PlayerAvailability {
  return {
    participantId: 'player-1',
    status: 'questionable',
    lastUpdatedAt: NOW_ISO,
    ...overrides,
  };
}

test('allows fresh data that is one hour old', () => {
  const result = evaluateStalenessGuard(
    buildAvailability({
      lastUpdatedAt: '2026-05-11T11:00:00.000Z',
    }),
    NOW_ISO,
  );

  assert.equal(result.suppressed, false);
  assert.equal(result.dataAgeHours, 1);
});

test('suppresses stale data that is five hours old', () => {
  const result = evaluateStalenessGuard(
    buildAvailability({
      lastUpdatedAt: '2026-05-11T07:00:00.000Z',
    }),
    NOW_ISO,
  );

  assert.equal(result.suppressed, true);
  assert.equal(result.reason, 'stale_data');
  assert.equal(result.dataAgeHours, 5);
});

test('suppresses availability without a lastUpdatedAt timestamp', () => {
  const availability = buildAvailability();
  delete availability.lastUpdatedAt;

  const result = evaluateStalenessGuard(availability, NOW_ISO);

  assert.deepEqual(result, {
    suppressed: true,
    reason: 'missing_timestamp',
  });
});

test('suppresses data exactly at the staleness threshold', () => {
  const result = evaluateStalenessGuard(
    buildAvailability({
      lastUpdatedAt: '2026-05-11T08:00:00.000Z',
    }),
    NOW_ISO,
  );

  assert.equal(result.suppressed, true);
  assert.equal(result.reason, 'stale_data');
  assert.equal(result.dataAgeHours, 4);
});

test('uses the provided now parameter for age calculation', () => {
  const result = evaluateStalenessGuard(
    buildAvailability({
      lastUpdatedAt: '2026-05-11T09:30:00.000Z',
    }),
    NOW_ISO,
  );

  assert.equal(result.suppressed, false);
  assert.equal(result.dataAgeHours, 2.5);
});
