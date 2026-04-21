import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateAvailabilityConfidence,
  AVAILABILITY_CONFIDENCE_MAP,
  STALENESS_THRESHOLD_HOURS,
} from './availability.js';
import type { PlayerAvailability } from './availability.js';

const NOW = '2026-04-15T12:00:00.000Z';
const FRESH_TS = '2026-04-15T10:00:00.000Z';
const STALE_TS = '2026-04-15T06:00:00.000Z';

function player(
  status: PlayerAvailability['status'],
  overrides?: Partial<PlayerAvailability>,
): PlayerAvailability {
  return { participantId: 'player-1', status, ...overrides };
}

test('confirmed status keeps confidence when data is fresh', () => {
  const result = evaluateAvailabilityConfidence(
    player('confirmed', { lastUpdatedAt: FRESH_TS }),
    [],
    NOW,
  );

  assert.equal(result.confidenceMultiplier, 1.0);
  assert.equal(result.recommendationAdjustment, 'none');
  assert.equal(result.staleness, 'fresh');
});

test('availability status scale maps probable, questionable, doubtful, out, and unknown', () => {
  assert.equal(
    evaluateAvailabilityConfidence(player('probable'), [], NOW).confidenceMultiplier,
    AVAILABILITY_CONFIDENCE_MAP.probable,
  );
  assert.equal(
    evaluateAvailabilityConfidence(player('questionable'), [], NOW).recommendationAdjustment,
    'reduce_stake',
  );
  assert.equal(
    evaluateAvailabilityConfidence(player('doubtful'), [], NOW).recommendationAdjustment,
    'hold',
  );
  assert.equal(
    evaluateAvailabilityConfidence(player('out'), [], NOW).recommendationAdjustment,
    'suppress',
  );
  assert.equal(
    evaluateAvailabilityConfidence(player('unknown'), [], NOW).confidenceMultiplier,
    0.80,
  );
});

test('availability staleness distinguishes fresh, stale, and unknown data', () => {
  assert.equal(
    evaluateAvailabilityConfidence(player('confirmed', { lastUpdatedAt: FRESH_TS }), [], NOW).staleness,
    'fresh',
  );
  assert.equal(
    evaluateAvailabilityConfidence(player('confirmed', { lastUpdatedAt: STALE_TS }), [], NOW).staleness,
    'stale',
  );
  assert.equal(
    evaluateAvailabilityConfidence(player('confirmed'), [], NOW).staleness,
    'unknown',
  );
  assert.equal(STALENESS_THRESHOLD_HOURS, 4);
});

test('stale confirmed data reduces stake instead of being treated as fresh', () => {
  const result = evaluateAvailabilityConfidence(
    player('confirmed', { lastUpdatedAt: STALE_TS }),
    [],
    NOW,
  );

  assert.equal(result.recommendationAdjustment, 'reduce_stake');
  assert.ok(result.reason.includes('data_stale'));
});

test('key teammate availability adjusts confidence and explains the reason', () => {
  const teammateOut = evaluateAvailabilityConfidence(
    player('confirmed', { lastUpdatedAt: FRESH_TS }),
    [player('out', { participantId: 'star-1' })],
    NOW,
  );
  assert.equal(teammateOut.confidenceMultiplier, 0.85);
  assert.ok(teammateOut.reason.includes('key_teammate_out'));

  const teammateQuestionable = evaluateAvailabilityConfidence(
    player('confirmed', { lastUpdatedAt: FRESH_TS }),
    [player('questionable', { participantId: 'star-1' })],
    NOW,
  );
  assert.equal(teammateQuestionable.confidenceMultiplier, 0.92);
  assert.ok(teammateQuestionable.reason.includes('key_teammate_questionable'));
});

test('source is included in availability reasoning for review tooling', () => {
  const result = evaluateAvailabilityConfidence(
    player('questionable', {
      source: 'sportsdata',
      lastUpdatedAt: FRESH_TS,
    }),
    [],
    NOW,
  );

  assert.ok(result.reason.includes('source_sportsdata'));
  assert.ok(result.reason.includes('status_questionable'));
});
