import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateAvailabilityConfidence,
  AVAILABILITY_CONFIDENCE_MAP,
  STALENESS_THRESHOLD_HOURS,
} from './availability.js';
import type { PlayerAvailability } from './availability.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const NOW = '2026-04-15T12:00:00.000Z';
const FRESH_TS = '2026-04-15T10:00:00.000Z';   // 2h ago — fresh
const STALE_TS = '2026-04-15T06:00:00.000Z';   // 6h ago — stale

function player(
  status: PlayerAvailability['status'],
  overrides?: Partial<PlayerAvailability>,
): PlayerAvailability {
  return { participantId: 'player-1', status, ...overrides };
}

// ── Status scale ─────────────────────────────────────────────────────────────

describe('evaluateAvailabilityConfidence — status scale', () => {
  it('confirmed status → confidenceMultiplier = 1.0, recommendationAdjustment = none', () => {
    const result = evaluateAvailabilityConfidence(
      player('confirmed', { lastUpdatedAt: FRESH_TS }),
      [],
      NOW,
    );
    assert.equal(result.confidenceMultiplier, 1.0);
    assert.equal(result.recommendationAdjustment, 'none');
  });

  it('probable status → multiplier = 0.92', () => {
    const result = evaluateAvailabilityConfidence(player('probable'), [], NOW);
    assert.equal(result.confidenceMultiplier, AVAILABILITY_CONFIDENCE_MAP.probable);
    assert.equal(result.confidenceMultiplier, 0.92);
  });

  it('questionable status → reduce_stake', () => {
    const result = evaluateAvailabilityConfidence(
      player('questionable', { lastUpdatedAt: FRESH_TS }),
      [],
      NOW,
    );
    assert.equal(result.confidenceMultiplier, 0.70);
    assert.equal(result.recommendationAdjustment, 'reduce_stake');
  });

  it('doubtful status → hold', () => {
    const result = evaluateAvailabilityConfidence(player('doubtful'), [], NOW);
    assert.equal(result.confidenceMultiplier, 0.40);
    assert.equal(result.recommendationAdjustment, 'hold');
  });

  it('out status → confidenceMultiplier = 0, suppress', () => {
    const result = evaluateAvailabilityConfidence(player('out'), [], NOW);
    assert.equal(result.confidenceMultiplier, 0);
    assert.equal(result.recommendationAdjustment, 'suppress');
  });

  it('unknown status → multiplier = 0.80', () => {
    const result = evaluateAvailabilityConfidence(player('unknown'), [], NOW);
    assert.equal(result.confidenceMultiplier, 0.80);
  });
});

// ── Staleness ────────────────────────────────────────────────────────────────

describe('evaluateAvailabilityConfidence — staleness', () => {
  it('data updated < 4h ago → staleness = fresh', () => {
    const result = evaluateAvailabilityConfidence(
      player('confirmed', { lastUpdatedAt: FRESH_TS }),
      [],
      NOW,
    );
    assert.equal(result.staleness, 'fresh');
  });

  it('data updated > 4h ago → staleness = stale', () => {
    const result = evaluateAvailabilityConfidence(
      player('confirmed', { lastUpdatedAt: STALE_TS }),
      [],
      NOW,
    );
    assert.equal(result.staleness, 'stale');
  });

  it('no lastUpdatedAt → staleness = unknown', () => {
    const result = evaluateAvailabilityConfidence(player('confirmed'), [], NOW);
    assert.equal(result.staleness, 'unknown');
  });

  it('stale data on confirmed player → reduce_stake', () => {
    const result = evaluateAvailabilityConfidence(
      player('confirmed', { lastUpdatedAt: STALE_TS }),
      [],
      NOW,
    );
    assert.equal(result.recommendationAdjustment, 'reduce_stake');
  });

  it('staleness threshold constant is 4', () => {
    assert.equal(STALENESS_THRESHOLD_HOURS, 4);
  });
});

// ── Key teammate impact ───────────────────────────────────────────────────────

describe('evaluateAvailabilityConfidence — key teammate impact', () => {
  it('key teammate out → reduces composite multiplier (0.85 impact)', () => {
    const result = evaluateAvailabilityConfidence(
      player('confirmed', { lastUpdatedAt: FRESH_TS }),
      [player('out', { participantId: 'star-1' })],
      NOW,
    );
    // base = 1.0 (confirmed) * 0.85 (teammate out)
    assert.equal(result.confidenceMultiplier, 0.85);
    assert.ok(result.reason.includes('key_teammate_out'));
  });

  it('key teammate questionable → 0.92 teammate impact', () => {
    const result = evaluateAvailabilityConfidence(
      player('confirmed', { lastUpdatedAt: FRESH_TS }),
      [player('questionable', { participantId: 'star-1' })],
      NOW,
    );
    // base = 1.0 * 0.92
    assert.equal(result.confidenceMultiplier, 0.92);
    assert.ok(result.reason.includes('key_teammate_questionable'));
  });

  it('key teammate doubtful → 0.92 teammate impact', () => {
    const result = evaluateAvailabilityConfidence(
      player('confirmed', { lastUpdatedAt: FRESH_TS }),
      [player('doubtful', { participantId: 'star-1' })],
      NOW,
    );
    assert.equal(result.confidenceMultiplier, 0.92);
  });

  it('key teammate confirmed → no teammate impact', () => {
    const result = evaluateAvailabilityConfidence(
      player('confirmed', { lastUpdatedAt: FRESH_TS }),
      [player('confirmed', { participantId: 'star-1' })],
      NOW,
    );
    assert.equal(result.confidenceMultiplier, 1.0);
    assert.ok(!result.reason.includes('key_teammate'));
  });

  it('no teammates provided → no impact', () => {
    const result = evaluateAvailabilityConfidence(
      player('confirmed', { lastUpdatedAt: FRESH_TS }),
      undefined,
      NOW,
    );
    assert.equal(result.confidenceMultiplier, 1.0);
  });

  it('teammate out when target is doubtful → hold (low composite)', () => {
    const result = evaluateAvailabilityConfidence(
      player('doubtful'),
      [player('out', { participantId: 'star-1' })],
      NOW,
    );
    // 0.40 * 0.85 = 0.34 < 0.45 → hold
    assert.ok(result.confidenceMultiplier < 0.45);
    assert.equal(result.recommendationAdjustment, 'hold');
  });
});

// ── Reason string ─────────────────────────────────────────────────────────────

describe('evaluateAvailabilityConfidence — reason string', () => {
  it('includes status in reason', () => {
    const result = evaluateAvailabilityConfidence(player('questionable'), [], NOW);
    assert.ok(result.reason.includes('status_questionable'));
  });

  it('includes staleness in reason when lastUpdatedAt is set', () => {
    const result = evaluateAvailabilityConfidence(
      player('confirmed', { lastUpdatedAt: FRESH_TS }),
      [],
      NOW,
    );
    assert.ok(result.reason.includes('data_fresh'));
  });

  it('confirmed + fresh data → 1.0 multiplier, no adjustment', () => {
    const result = evaluateAvailabilityConfidence(
      player('confirmed', { lastUpdatedAt: FRESH_TS }),
      [],
      NOW,
    );
    assert.equal(result.confidenceMultiplier, 1.0);
    assert.equal(result.recommendationAdjustment, 'none');
    assert.equal(result.staleness, 'fresh');
  });
});
